import { describe, expect, test } from "bun:test";
import { validateWorkflowRun } from "../src/validate.ts";
import { createWorkflowRunStream } from "../src/workflow-stream.ts";
import { asIpc, FakeIpc, makeClient } from "./_fake-ipc.ts";

const RUN_RESULT = { runId: "run-1", status: "done", dryRun: false, stepResults: [] };

/** The `streamId` the client actually put on the wire for call `i`. */
function sentStreamId(ipc: FakeIpc, i: number): string | undefined {
  const params = ipc.calls[i]?.params as { streamId?: string } | undefined;
  return params?.streamId;
}

describe("NimbusClient.workflowCancel", () => {
  test("routes to workflow.cancel and reports a cancelled run", async () => {
    const ipc = new FakeIpc([{ cancelled: true }]);
    const out = await makeClient(ipc).workflowCancel({ streamId: "wf-1" });
    expect(ipc.calls[0]).toEqual({ method: "workflow.cancel", params: { streamId: "wf-1" } });
    expect(out).toEqual({ cancelled: true });
  });

  test("reports cancelled: false when no live run of ours held that id", async () => {
    const ipc = new FakeIpc([{ cancelled: false }]);
    expect(await makeClient(ipc).workflowCancel({ streamId: "nope" })).toEqual({
      cancelled: false,
    });
  });

  test("rejects a response that is not { cancelled: boolean }", async () => {
    const ipc = new FakeIpc([{ cancelled: "yes" }]);
    await expect(makeClient(ipc).workflowCancel({ streamId: "wf-1" })).rejects.toThrow(
      /Invalid workflow\.cancel response/,
    );
  });
});

describe("workflow.run status", () => {
  test("validates the terminal status when the Gateway reports one", async () => {
    const ipc = new FakeIpc([{ runId: "r", status: "cancelled", dryRun: false, stepResults: [] }]);
    const out = await makeClient(ipc).workflowRun({ name: "x" });
    expect(out.status).toBe("cancelled");
  });

  test("tolerates a Gateway too old to report a status", async () => {
    // Older Gateways omit `status` entirely. Requiring it here would make every
    // workflowRun against a shipped Gateway throw IpcResponseError.
    const ipc = new FakeIpc([{ runId: "r", dryRun: false, stepResults: [] }]);
    const out = await makeClient(ipc).workflowRun({ name: "x" });
    expect(out.status).toBeUndefined();
    expect(out.runId).toBe("r");
  });

  test("rejects a non-string status", async () => {
    const ipc = new FakeIpc([{ runId: "r", status: 3, dryRun: false, stepResults: [] }]);
    await expect(makeClient(ipc).workflowRun({ name: "x" })).rejects.toThrow(
      /Invalid workflow\.run response/,
    );
  });

  test("workflowRun forwards an explicit streamId", async () => {
    const ipc = new FakeIpc([RUN_RESULT]);
    await makeClient(ipc).workflowRun({ name: "x", streamId: "caller-chosen" });
    expect(sentStreamId(ipc, 0)).toBe("caller-chosen");
  });
});

describe("workflowRunStream correlation", () => {
  test("mints a unique streamId per run and sends it with workflow.run", () => {
    const ipc = new FakeIpc([RUN_RESULT, RUN_RESULT]);
    const a = createWorkflowRunStream(asIpc(ipc), { name: "x" }, validateWorkflowRun);
    const b = createWorkflowRunStream(asIpc(ipc), { name: "x" }, validateWorkflowRun);

    expect(a.streamId).not.toBe(b.streamId);
    expect(a.streamId.length).toBeGreaterThan(0);
    expect(sentStreamId(ipc, 0)).toBe(a.streamId);
    expect(sentStreamId(ipc, 1)).toBe(b.streamId);
  });

  test("ignores a chunk tagged for a different run", async () => {
    const ipc = new FakeIpc([RUN_RESULT]);
    const handle = createWorkflowRunStream(asIpc(ipc), { name: "x" }, validateWorkflowRun);

    ipc.emit("agent.chunk", { streamId: "someone-else", text: "not mine" });
    ipc.emit("agent.chunk", { streamId: handle.streamId, text: "mine" });

    const seen: string[] = [];
    for await (const ev of handle) {
      if (ev.type === "chunk") seen.push(ev.text);
      if (ev.type === "done") break;
    }
    expect(seen).toEqual(["mine"]);
  });

  test("still accepts untagged chunks from a Gateway too old to echo the id", async () => {
    // Strict filtering would silently yield zero chunks against a shipped Gateway.
    const ipc = new FakeIpc([RUN_RESULT]);
    const handle = createWorkflowRunStream(asIpc(ipc), { name: "x" }, validateWorkflowRun);

    ipc.emit("agent.chunk", { text: "legacy chunk" });

    const seen: string[] = [];
    for await (const ev of handle) {
      if (ev.type === "chunk") seen.push(ev.text);
      if (ev.type === "done") break;
    }
    expect(seen).toEqual(["legacy chunk"]);
  });

  test("cancel() calls workflow.cancel with the minted id and reports found-ness", async () => {
    const ipc = new FakeIpc();
    const finishRun = ipc.deferMethod("workflow.run", RUN_RESULT);
    ipc.setResponse("workflow.cancel", { cancelled: true });
    const handle = createWorkflowRunStream(asIpc(ipc), { name: "x" }, validateWorkflowRun);

    const out = await handle.cancel();

    expect(out).toEqual({ cancelled: true });
    expect(ipc.calls.find((c) => c.method === "workflow.cancel")?.params).toEqual({
      streamId: handle.streamId,
    });
    finishRun();
    await handle.result;
  });

  test("cancel() leaves the stream open so the cancelled result still arrives", async () => {
    // Cancellation lands at the NEXT STEP BOUNDARY: the run keeps going and
    // settles as "cancelled". Closing the iterator on cancel() would throw that
    // terminal result away — the only thing that tells a caller it worked.
    const ipc = new FakeIpc();
    const finishRun = ipc.deferMethod("workflow.run", {
      runId: "r",
      status: "cancelled",
      dryRun: false,
      stepResults: [],
    });
    ipc.setResponse("workflow.cancel", { cancelled: true });
    const handle = createWorkflowRunStream(asIpc(ipc), { name: "x" }, validateWorkflowRun);

    await handle.cancel();
    // The in-flight step runs to completion, so chunks keep arriving after cancel.
    ipc.emit("agent.chunk", { streamId: handle.streamId, text: "step still finishing" });
    finishRun();

    const events: string[] = [];
    for await (const ev of handle) {
      events.push(ev.type);
      if (ev.type === "done") {
        expect(ev.result.status).toBe("cancelled");
        break;
      }
    }
    expect(events).toEqual(["chunk", "done"]);
    expect((await handle.result).status).toBe("cancelled");
  });

  test("cancel() against a Gateway with no workflow.cancel reports cancelled: false", async () => {
    const ipc = new FakeIpc();
    const finishRun = ipc.deferMethod("workflow.run", RUN_RESULT);
    ipc.failMethod("workflow.cancel", "Method not found: workflow.cancel");
    const handle = createWorkflowRunStream(asIpc(ipc), { name: "x" }, validateWorkflowRun);

    expect(await handle.cancel()).toEqual({ cancelled: false });
    finishRun();
    await handle.result;
  });
});

describe("workflowRunStream teardown", () => {
  test("finish() releases EVERY parked next(), not just the first", async () => {
    // The hang this guards: `finish()` drains `waiters` in a LOOP. Resolving only
    // the head leaves the rest awaiting a promise nothing will ever settle — and
    // a workflow stream has no `requestTimeoutMs` behind it, because the RPC that
    // started the run has already returned.
    //
    // THREE waiters, not two: `push()` hands the terminal `done` event to the
    // first, so with only one left over a single-shot `if (w !== undefined)`
    // drains it and the test cannot tell a loop from an if.
    const ipc = new FakeIpc();
    const finishRun = ipc.deferMethod("workflow.run", RUN_RESULT);
    const handle = createWorkflowRunStream(asIpc(ipc), { name: "x" }, validateWorkflowRun);

    const it = handle[Symbol.asyncIterator]();
    const first = it.next();
    const rest = [it.next(), it.next()];

    finishRun();

    expect((await first).value).toMatchObject({ type: "done" });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const stillParked = new Promise<"still parked">((resolve) => {
      timer = setTimeout(() => {
        resolve("still parked");
      }, 250);
    });
    const outcomes = await Promise.all(rest.map(async (p) => await Promise.race([p, stillParked])));
    if (timer !== undefined) clearTimeout(timer);

    expect(outcomes).toEqual([
      { value: undefined, done: true },
      { value: undefined, done: true },
    ]);
    await handle.result;
  });
});
