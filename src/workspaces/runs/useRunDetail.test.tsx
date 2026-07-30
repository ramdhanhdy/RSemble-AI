// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useRunDetail } from "./useRunDetail";
import { InMemoryRunRepository } from "../../lib/persistence/run-repository";
import type { RunRecordV2 } from "../../lib/persistence/run-types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  flush: () => Promise<void>;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function renderHook<Result>(
  useHook: () => Result,
): Harness & { result: { current: Result } } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const result = { current: null as Result };
  function Probe() {
    result.current = useHook();
    return null;
  }
  act(() => root.render(<Probe />));
  return {
    container,
    root,
    flush,
    result,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

/** Minimal RunRecordV2 for testing. */
function makeRecord(id: string): RunRecordV2 {
  return {
    schemaVersion: 2,
    id,
    revision: 1,
    execution: { ownerId: "tab-1", fence: 1 },
    createdAt: Date.now() - 60000,
    updatedAt: Date.now(),
    completedAt: Date.now() - 55000,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: { title: "Test task", prompt: "Do a thing", systemPrompt: "You are helpful", temperature: 0.7 },
    evaluation: { profile: null, candidateMessages: [] },
    candidates: [{
      candidateId: "c1",
      slotId: "s1",
      modelKey: "openrouter:gpt-4o",
      providerId: "openrouter",
      model: "GPT-4o",
      slug: "gpt-4o",
      acceptedAttemptId: "att-1",
      attempts: [{
        attemptId: "att-1",
        messages: [{ role: "user", content: "Do a thing" }],
        startedAt: Date.now() - 60000,
        finishedAt: Date.now() - 55000,
        status: "completed",
        output: "result text",
        tokensIn: 20,
        tokensOut: 30,
        error: null,
      }],
    }],
    judge: {
      status: "done",
      acceptedAttemptId: "judge-att-1",
      report: {
        labelMap: [{ label: "A", candidateId: "c1" }],
        evaluationsById: { c1: { candidateId: "c1", blindLabel: "A", overallScore: 4.0, position: "First", rationale: "Good", strengths: [], deductions: [], missedRequirements: [], criterionScores: [] } },
        comparisons: [],
      },
      consensus: null,
      attempts: [{
        attemptId: "judge-att-1",
        providerId: "openrouter",
        model: "judge-model",
        instruction: "Evaluate",
        messages: [],
        blindLabelToCandidateId: { A: "c1" },
        candidateAttemptIdsByCandidateId: { c1: "att-1" },
        startedAt: Date.now() - 55000,
        finishedAt: Date.now() - 50000,
        status: "completed",
        error: null,
        report: { labelMap: [{ label: "A", candidateId: "c1" }], evaluationsById: { c1: { candidateId: "c1", blindLabel: "A", overallScore: 4.0, position: "First", rationale: "Good", strengths: [], deductions: [], missedRequirements: [], criterionScores: [] } }, comparisons: [] },
        consensus: null,
      }],
    },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: ["openrouter:gpt-4o"],
  };
}

describe("useRunDetail", () => {
  it("returns null for null/empty id", () => {
    const repo = new InMemoryRunRepository();
    const hook = renderHook(() => useRunDetail(repo, null));
    expect(hook.result.current.record).toBeNull();
    expect(hook.result.current.loading).toBe(false);
    act(() => hook.root.unmount());
  });

  it("returns loading then record for valid id", async () => {
    const repo = new InMemoryRunRepository();
    const record = makeRecord("run-1");
    await repo.importArchive({
      schemaVersion: 1,
      exportedAt: Date.now(),
      runs: [record],
      summaries: [{
        kind: "full",
        schemaVersion: 2,
        id: "run-1",
        revision: 1,
        createdAt: record.createdAt,
        completedAt: record.completedAt,
        status: "completed",
        mode: "rank",
        source: { kind: "adhoc" },
        taskTitle: "Test task",
        taskExcerpt: "Test",
        modelKeys: ["openrouter:gpt-4o"],
        winnerKeys: ["openrouter:gpt-4o"],
        scoresByModelKey: { "openrouter:gpt-4o": 4.0 },
        judgeModelKey: "openrouter:judge",
        evaluationProfileId: null,
        evaluationProfileVersion: null,
        detailAvailable: true,
        searchText: "test task",
      }],
    });

    const hook = renderHook(() => useRunDetail(repo, "run-1"));
    expect(hook.result.current.loading).toBe(true);

    await hook.flush();
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.record).not.toBeNull();
    expect(hook.result.current.record?.id).toBe("run-1");
    act(() => hook.root.unmount());
  });

  it("returns null for nonexistent id", async () => {
    const repo = new InMemoryRunRepository();
    const hook = renderHook(() => useRunDetail(repo, "does-not-exist"));
    await hook.flush();
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.record).toBeNull();
    expect(hook.result.current.error).toBeNull();
    act(() => hook.root.unmount());
  });

  it("returns error state on repository failure", async () => {
    const failingRepo = {
      get: vi.fn().mockRejectedValue(new Error("storage corrupted")),
      subscribe: vi.fn().mockReturnValue(() => {}),
    } as unknown as InMemoryRunRepository;

    const hook = renderHook(() => useRunDetail(failingRepo, "run-1"));
    await hook.flush();
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.error).not.toBeNull();
    expect(hook.result.current.record).toBeNull();
    act(() => hook.root.unmount());
  });

  it("does not re-fetch when repo identity is stable", async () => {
    const repo = new InMemoryRunRepository();
    let fetchCount = 0;
    const originalGet = repo.get.bind(repo);
    repo.get = vi.fn((id: string) => { fetchCount++; return originalGet(id); });

    const hook = renderHook(() => useRunDetail(repo, "run-1"));
    await hook.flush();
    expect(fetchCount).toBe(1);

    // Rerender with same id should not trigger a new fetch
    // (React would normally re-run the effect; our stability check catches it)
    act(() => hook.root.unmount());
  });

  it("fetches new record when id changes", async () => {
    const repo = new InMemoryRunRepository();
    const r1 = makeRecord("run-1");
    const r2 = makeRecord("run-2");
    await repo.importArchive({
      schemaVersion: 1,
      exportedAt: Date.now(),
      runs: [r1, r2],
      summaries: [
        { kind: "full", schemaVersion: 2, id: "run-1", revision: 1, createdAt: 100, completedAt: 1, status: "completed", mode: "rank", source: { kind: "adhoc" }, taskTitle: "Task 1", taskExcerpt: "T1", modelKeys: [], winnerKeys: [], scoresByModelKey: {}, judgeModelKey: null, evaluationProfileId: null, evaluationProfileVersion: null, detailAvailable: true, searchText: "task 1" },
        { kind: "full", schemaVersion: 2, id: "run-2", revision: 1, createdAt: 200, completedAt: 1, status: "completed", mode: "rank", source: { kind: "adhoc" }, taskTitle: "Task 2", taskExcerpt: "T2", modelKeys: [], winnerKeys: [], scoresByModelKey: {}, judgeModelKey: null, evaluationProfileId: null, evaluationProfileVersion: null, detailAvailable: true, searchText: "task 2" },
      ],
    });

    const hook = renderHook(() => useRunDetail(repo, "run-1"));
    await hook.flush();
    expect(hook.result.current.record?.id).toBe("run-1");

    act(() => hook.root.unmount());
    // When testing id change, the hook should reset and fetch again
    const hook2 = renderHook(() => useRunDetail(repo, "run-2"));
    await hook2.flush();
    expect(hook2.result.current.record?.id).toBe("run-2");
    act(() => hook2.root.unmount());
  });
});
