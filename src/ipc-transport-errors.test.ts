import { describe, expect, it } from "bun:test";

import {
  isJsonRpcError,
  JsonRpcError,
  jsonRpcErrorCode,
  jsonRpcErrorData,
  jsonRpcErrorMessage,
} from "./ipc-transport.js";

describe("jsonRpcErrorCode", () => {
  it("reads a numeric code", () => {
    expect(jsonRpcErrorCode({ code: -32021, message: "warming" })).toBe(-32021);
  });

  it("returns null for a non-numeric or absent code", () => {
    // The peer is untrusted input: a string code must not be passed through as
    // though it were a number, or `err.code === -32021` silently never matches.
    expect(jsonRpcErrorCode({ code: "-32021", message: "x" })).toBeNull();
    expect(jsonRpcErrorCode({ message: "x" })).toBeNull();
    expect(jsonRpcErrorCode(null)).toBeNull();
    expect(jsonRpcErrorCode("nope")).toBeNull();
  });
});

describe("jsonRpcErrorData", () => {
  it("passes data through verbatim", () => {
    const data = { code: "embedding_warming", readiness: { state: "warming", elapsedMs: 4200 } };
    expect(jsonRpcErrorData({ code: -32021, message: "m", data })).toEqual(data);
  });

  it("is undefined when absent, and distinguishes an explicit null", () => {
    expect(jsonRpcErrorData({ code: -1, message: "m" })).toBeUndefined();
    expect(jsonRpcErrorData({ code: -1, message: "m", data: null })).toBeNull();
    expect(jsonRpcErrorData(undefined)).toBeUndefined();
  });
});

describe("JsonRpcError", () => {
  it("is an Error and keeps the message the transport always threw", () => {
    // BACKWARD COMPATIBILITY. Consumers on the old transport could only read
    // `.message`; some match on it. Changing it would break them silently.
    const wire = { code: -32021, message: "index.searchRanked: still warming up" };
    const err = new JsonRpcError(jsonRpcErrorMessage(wire), jsonRpcErrorCode(wire), wire);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("index.searchRanked: still warming up");
    expect(String(err)).toContain("index.searchRanked: still warming up");
  });

  it("carries code and data", () => {
    const err = new JsonRpcError("m", -32021, { code: "embedding_warming" });
    expect(err.code).toBe(-32021);
    expect(err.data).toEqual({ code: "embedding_warming" });
    expect(err.name).toBe("JsonRpcError");
  });
});

describe("isJsonRpcError", () => {
  it("accepts a real instance", () => {
    expect(isJsonRpcError(new JsonRpcError("m", -1, undefined))).toBe(true);
  });

  it("accepts a branded object from a DUPLICATE copy of this package", () => {
    // The reason this is a brand check and not `instanceof`: hoisting can put two
    // copies of @nimbus-dev/client in one graph, and an error thrown by one fails
    // `instanceof` against the other's class. Simulated here by a plain object
    // carrying the brand — exactly what the other copy's instance looks like.
    const fromOtherCopy = Object.assign(new Error("m"), {
      nimbusErrorBrand: "nimbus-dev/client:json-rpc-error",
      code: -32021,
      data: undefined,
    });
    expect(isJsonRpcError(fromOtherCopy)).toBe(true);
  });

  it("rejects a plain Error and other non-branded values", () => {
    expect(isJsonRpcError(new Error("m"))).toBe(false);
    expect(isJsonRpcError({ code: -32021 })).toBe(false);
    expect(isJsonRpcError({ nimbusErrorBrand: "something-else" })).toBe(false);
    expect(isJsonRpcError(null)).toBe(false);
    expect(isJsonRpcError(undefined)).toBe(false);
    expect(isJsonRpcError("json-rpc-error")).toBe(false);
  });
});
