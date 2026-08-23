import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperimentRecord, ExperimentTaskAttempt } from "../evaluations/evaluation-types";
import type { ExperimentControllerEvent } from "../evaluations/experiment-controller";
import { createAttentionService } from "./attention-service";

function attempt(status: ExperimentTaskAttempt["status"]): ExperimentTaskAttempt {
  return {
    id: "a1",
    runId: "run-1",
    trial: 0,
    status,
    startedAt: 100,
    finishedAt: status === "running" || status === "queued" ? null : 200,
    error: null,
  };
}

function experiment(status: ExperimentRecord["status"], id = "exp-1"): ExperimentRecord {
  return {
    id,
    revision: 1,
    suiteId: "suite-1",
    suiteVersion: 1,
    protocolFingerprint: "sha256:abc",
    status,
    execution: null,
    snapshot: {
      suiteId: "suite-1",
      suiteVersion: 1,
      tasks: [
        {
          id: "t1",
          title: "T",
          prompt: "P",
          systemPrompt: "",
          evaluation: { kind: "holistic" },
          judgeInstructionOverride: "",
          order: 0,
        },
      ],
      modelSlots: [],
      defaultJudge: { providerId: "openrouter", model: "judge" },
      defaultEvaluation: { kind: "holistic" },
      profiles: [],
      protocolFingerprint: "sha256:abc",
      createdAt: 1000,
    },
    tasks: [{ taskId: "t1", selectedAttemptId: "a1", attempts: [attempt(status === "completed" ? "completed" : "interrupted")] }],
    createdAt: 1000,
    updatedAt: 2000,
  };
}

function harness() {
  let records = [experiment("interrupted")];
  const comparisonListeners = new Set<() => void>();
  const runListeners = new Set<() => void>();
  const controllerListeners = new Set<(e: ExperimentControllerEvent) => void>();
  const visibilityListeners = new Set<() => void>();
  const broadcastListeners = new Set<(data: unknown) => void>();
  let hidden = false;
  const listExperiments = vi.fn(async () => records);
  const listComparisons = vi.fn(async () => []);
  return {
    listExperiments,
    listComparisons,
    setRecords(next: ExperimentRecord[]) {
      records = next;
    },
    setHidden(next: boolean) {
      hidden = next;
    },
    emitComparison() {
      for (const l of comparisonListeners) l();
    },
    emitRun() {
      for (const l of runListeners) l();
    },
    emitController(event: ExperimentControllerEvent) {
      for (const l of controllerListeners) l(event);
    },
    emitVisibility() {
      for (const l of visibilityListeners) l();
    },
    emitBroadcast(data: unknown = { kind: "lease" }) {
      for (const l of broadcastListeners) l(data);
    },
    deps: {
      listExperiments,
      listComparisons,
      subscribeComparisons: (l: () => void) => {
        comparisonListeners.add(l);
        return () => comparisonListeners.delete(l);
      },
      subscribeRuns: (l: () => void) => {
        runListeners.add(l);
        return () => runListeners.delete(l);
      },
      subscribeController: (l: (e: ExperimentControllerEvent) => void) => {
        controllerListeners.add(l);
        return () => controllerListeners.delete(l);
      },
      addVisibilityListener: (l: () => void) => {
        visibilityListeners.add(l);
        return () => visibilityListeners.delete(l);
      },
      addBroadcastListener: (l: (data: unknown) => void) => {
        broadcastListeners.add(l);
        return () => broadcastListeners.delete(l);
      },
      isDocumentHidden: () => hidden,
      debounceMs: 10,
    },
    listenerCount: () =>
      comparisonListeners.size +
      runListeners.size +
      controllerListeners.size +
      visibilityListeners.size +
      broadcastListeners.size,
  };
}

describe("createAttentionService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads actionable evaluation items on start", async () => {
    const h = harness();
    const service = createAttentionService(h.deps);
    const result = await service.start();
    expect(result.total).toBe(1);
    expect(result.items[0]?.reasonCode).toBe("evaluation_interrupted");
    expect(h.listExperiments).toHaveBeenCalledTimes(1);
    service.dispose();
  });

  it("refreshes from a source commit and drops a resolved item", async () => {
    const h = harness();
    const service = createAttentionService(h.deps);
    await service.start();
    h.setRecords([experiment("completed")]);
    h.emitRun();
    await vi.advanceTimersByTimeAsync(10);
    expect(service.getSnapshot().total).toBe(0);
    service.dispose();
  });

  it("coalesces duplicate events in the debounce window into one reload", async () => {
    const h = harness();
    const service = createAttentionService(h.deps);
    await service.start();
    h.emitComparison();
    h.emitRun();
    h.emitController({ kind: "task-terminal", taskId: "t1", attemptId: "a1", status: "interrupted" });
    await vi.advanceTimersByTimeAsync(10);
    expect(h.listExperiments).toHaveBeenCalledTimes(2);
    service.dispose();
  });

  it("refreshes on visibility return", async () => {
    const h = harness();
    const service = createAttentionService(h.deps);
    await service.start();
    h.setRecords([]);
    h.emitVisibility();
    await vi.advanceTimersByTimeAsync(10);
    expect(service.getSnapshot().total).toBe(0);
    service.dispose();
  });

  it("refreshes on other-tab broadcast when visible", async () => {
    const h = harness();
    const service = createAttentionService(h.deps);
    await service.start();
    h.setRecords([experiment("completed")]);
    h.emitBroadcast({ kind: "recovery" });
    await vi.advanceTimersByTimeAsync(10);
    expect(service.getSnapshot().total).toBe(0);
    service.dispose();
  });

  it("ignores hidden-tab ticks so lease timing cannot invent items", async () => {
    const h = harness();
    const service = createAttentionService(h.deps);
    await service.start();
    h.setHidden(true);
    h.setRecords([experiment("completed")]);
    h.emitController({ kind: "task-terminal", taskId: "t1", attemptId: "a1", status: "interrupted" });
    h.emitBroadcast({ kind: "lease" });
    await vi.advanceTimersByTimeAsync(10);
    expect(h.listExperiments).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().items[0]?.reasonCode).toBe("evaluation_interrupted");
    service.dispose();
  });

  it("drops a stale in-flight refresh when a newer one finishes first", async () => {
    const h = harness();
    let releaseSlow: ((value: ExperimentRecord[]) => void) | undefined;
    const slow = new Promise<ExperimentRecord[]>((resolve) => {
      releaseSlow = resolve;
    });
    h.listExperiments.mockImplementationOnce(async () => [experiment("interrupted")]);
    const service = createAttentionService(h.deps);
    await service.start();
    h.listExperiments.mockImplementationOnce(() => slow);
    h.listExperiments.mockImplementationOnce(async () => [experiment("completed")]);
    h.emitRun();
    await vi.advanceTimersByTimeAsync(10);
    h.emitVisibility();
    await vi.advanceTimersByTimeAsync(10);
    releaseSlow?.([experiment("interrupted")]);
    await Promise.resolve();
    await Promise.resolve();
    expect(service.getSnapshot().total).toBe(0);
    service.dispose();
  });

  it("does not start a polling loop", async () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    const h = harness();
    const service = createAttentionService(h.deps);
    await service.start();
    expect(interval).not.toHaveBeenCalled();
    interval.mockRestore();
    service.dispose();
  });

  it("dispose unsubscribes every source", async () => {
    const h = harness();
    const service = createAttentionService(h.deps);
    await service.start();
    expect(h.listenerCount()).toBeGreaterThan(0);
    service.dispose();
    expect(h.listenerCount()).toBe(0);
  });
});
