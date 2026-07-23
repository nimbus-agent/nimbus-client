import { describe, expect, test } from "bun:test";

import { FakeIpc, makeClient } from "./_fake-ipc.ts";

const WORKFLOW_ROW = {
  id: "wf-1",
  name: "nightly-sync",
  description: "Sync everything overnight",
  steps_json: "[]",
  created_at: 1,
  updated_at: 2,
};

describe("NimbusClient workflow.* dispatch", () => {
  test("workflowList routes to workflow.list and validates the raw row shape", async () => {
    const ipc = new FakeIpc([{ workflows: [WORKFLOW_ROW] }]);
    const out = await makeClient(ipc).workflowList();
    expect(ipc.calls[0]).toEqual({ method: "workflow.list", params: undefined });
    expect(out).toEqual({ workflows: [WORKFLOW_ROW] });
  });

  test("workflowList validates a null description", async () => {
    const ipc = new FakeIpc([{ workflows: [{ ...WORKFLOW_ROW, description: null }] }]);
    const out = await makeClient(ipc).workflowList();
    expect(out.workflows[0]?.description).toBeNull();
  });

  test("workflowSave forwards name/description/stepsJson and validates the id", async () => {
    const ipc = new FakeIpc([{ id: "wf-1" }]);
    const out = await makeClient(ipc).workflowSave({
      name: "nightly-sync",
      description: "desc",
      stepsJson: "[]",
    });
    expect(ipc.calls[0]).toEqual({
      method: "workflow.save",
      params: { name: "nightly-sync", description: "desc", stepsJson: "[]" },
    });
    expect(out).toEqual({ id: "wf-1" });
  });

  test("workflowDelete forwards name and validates { ok }", async () => {
    const ipc = new FakeIpc([{ ok: true }]);
    const out = await makeClient(ipc).workflowDelete({ name: "nightly-sync" });
    expect(ipc.calls[0]).toEqual({ method: "workflow.delete", params: { name: "nightly-sync" } });
    expect(out).toEqual({ ok: true });
  });

  test("workflowListRuns forwards workflowName/limit and validates run rows", async () => {
    const run = {
      id: "run-1",
      startedAt: 10,
      finishedAt: 20,
      durationMs: 10,
      status: "ok",
      errorMsg: null,
      dryRun: false,
      paramsOverrideJson: null,
      triggeredBy: "cli",
    };
    const ipc = new FakeIpc([{ runs: [run] }]);
    const out = await makeClient(ipc).workflowListRuns({
      workflowName: "nightly-sync",
      limit: 20,
    });
    expect(ipc.calls[0]).toEqual({
      method: "workflow.listRuns",
      params: { workflowName: "nightly-sync", limit: 20 },
    });
    expect(out).toEqual({ runs: [run] });
  });

  test("workflowListRuns validates a still-running row (finishedAt/durationMs null)", async () => {
    const ipc = new FakeIpc([
      {
        runs: [
          {
            id: "run-2",
            startedAt: 10,
            finishedAt: null,
            durationMs: null,
            status: "running",
            errorMsg: null,
            dryRun: false,
            paramsOverrideJson: null,
            triggeredBy: "watcher",
          },
        ],
      },
    ]);
    const out = await makeClient(ipc).workflowListRuns({ workflowName: "x", limit: 1 });
    expect(out.runs[0]?.finishedAt).toBeNull();
    expect(out.runs[0]?.durationMs).toBeNull();
  });

  test("workflowRun is an ordinary promise call — resolves the run result directly, no streamId", async () => {
    const ipc = new FakeIpc([
      {
        runId: "run-3",
        dryRun: false,
        stepResults: [{ label: "step1", status: "ok", output: "done" }],
      },
    ]);
    const out = await makeClient(ipc).workflowRun({ name: "nightly-sync" });
    expect(ipc.calls[0]).toEqual({
      method: "workflow.run",
      params: {
        name: "nightly-sync",
        triggeredBy: undefined,
        dryRun: undefined,
        stream: undefined,
        sessionId: undefined,
        agent: undefined,
        paramsOverride: undefined,
      },
    });
    // No `streamId` on the resolved value — unlike engine.askStream.
    expect(out).not.toHaveProperty("streamId");
    expect(out).toEqual({
      runId: "run-3",
      dryRun: false,
      stepResults: [{ label: "step1", status: "ok", output: "done" }],
    });
  });

  test("workflowRun forwards dryRun/stream/sessionId/agent/paramsOverride", async () => {
    const ipc = new FakeIpc([{ runId: "run-4", dryRun: true, stepResults: [] }]);
    await makeClient(ipc).workflowRun({
      name: "nightly-sync",
      triggeredBy: "cli",
      dryRun: true,
      stream: true,
      sessionId: "s1",
      agent: "expert",
      paramsOverride: { step1: { foo: "bar" } },
    });
    expect(ipc.calls[0]?.params).toEqual({
      name: "nightly-sync",
      triggeredBy: "cli",
      dryRun: true,
      stream: true,
      sessionId: "s1",
      agent: "expert",
      paramsOverride: { step1: { foo: "bar" } },
    });
  });

  test("workflowRun validates a step result with an error and no output", async () => {
    const ipc = new FakeIpc([
      { runId: "run-5", dryRun: false, stepResults: [{ status: "error", error: "boom" }] },
    ]);
    const out = await makeClient(ipc).workflowRun({ name: "x" });
    expect(out.stepResults[0]).toEqual({ status: "error", error: "boom" });
  });
});
