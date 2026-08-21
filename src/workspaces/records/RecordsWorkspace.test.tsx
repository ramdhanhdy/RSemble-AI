// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { createRecordsRepository } from "../../lib/records/records-repository";
import { RepositoryContext } from "../../lib/persistence/repository-context";
import { InMemoryComparisonRepository } from "../../lib/persistence/in-memory-comparison-repository";
import { InMemoryRunRepository } from "../../lib/persistence/run-repository";
import type { FullRunSummaryV2, RunRecordV2 } from "../../lib/persistence/run-types";
import { RecordsWorkspace } from "../RecordsWorkspace";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function stubMatchMedia(desktop: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: desktop && query.includes("1024"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

function summary(id: string, createdAt: number): FullRunSummaryV2 {
  return {
    kind: "full",
    schemaVersion: 2,
    id,
    revision: 0,
    createdAt,
    completedAt: createdAt + 1_000,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    taskTitle: `Task ${id}`,
    taskExcerpt: "Exact input",
    modelKeys: ["openrouter:qwen3.8-max"],
    winnerKeys: [],
    scoresByModelKey: {},
    judgeModelKey: null,
    evaluationProfileId: null,
    evaluationProfileVersion: null,
    detailAvailable: true,
    searchText: `task ${id} exact input openrouter:qwen3.8-max`,
  };
}

function record(id: string, createdAt: number): RunRecordV2 {
  return {
    schemaVersion: 2,
    id,
    revision: 0,
    execution: { ownerId: "test", fence: 1 },
    createdAt,
    updatedAt: createdAt + 1_000,
    completedAt: createdAt + 1_000,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: { title: `Task ${id}`, prompt: "Exact input", systemPrompt: "", temperature: 0.2 },
    evaluation: { profile: null, candidateMessages: [] },
    candidates: [],
    judge: { status: "idle", acceptedAttemptId: null, report: null, consensus: null, attempts: [] },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
  };
}

async function setup(path: string, desktop = true, withComparison = false) {
  stubMatchMedia(desktop);
  const runRepo = new InMemoryRunRepository();
  await runRepo.create(record("run-1", 1_000), summary("run-1", 1_000));
  const comparisonRepo = withComparison ? new InMemoryComparisonRepository(runRepo) : null;
  if (comparisonRepo) {
    const exactRun = await runRepo.get("run-1");
    if (!exactRun) throw new Error("Run fixture missing");
    await comparisonRepo.createComparisonEnvelope(exactRun, {
      kind: "ad_hoc",
      inputSnapshotRef: "input-1",
    });
  }
  const recordsRepo = createRecordsRepository({
    runRepo,
    comparisonRepo,
    evaluationRepo: null,
    studyRepo: null,
    evidenceRepo: null,
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <RepositoryContext.Provider
        value={{
          runRepo,
          recordsRepo,
          evalRepo: null,
          fusionRepo: null,
          taskRepo: null,
          db: null,
          storageState: "ready",
          retry: () => undefined,
        }}
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/records" element={<RecordsWorkspace />} />
            <Route path="/records/:recordType/:recordId" element={<RecordsWorkspace />} />
          </Routes>
        </MemoryRouter>
      </RepositoryContext.Provider>,
    );
  });
  for (let index = 0; index < 5; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  return { container, root, runRepo };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("RecordsWorkspace", () => {
  it("renders the full typed list with exactly six filters and archive actions in the footer", async () => {
    const harness = await setup("/records");
    expect(harness.container.querySelector("h1")?.textContent).toBe("Records");
    expect(harness.container.querySelectorAll("[data-filter]")).toHaveLength(6);
    expect(harness.container.querySelector("[data-record-type='task-execution']")).not.toBeNull();
    expect(
      harness.container.querySelector("a[href='/records/task-execution/run-1']"),
    ).not.toBeNull();
    expect(
      harness.container.querySelector("#import-data [data-action='export-v3']"),
    ).not.toBeNull();
    act(() => harness.root.unmount());
  });

  it("shows semantic and exact records as distinct rows with owner and exact-link cues", async () => {
    const harness = await setup("/records", true, true);
    expect(harness.container.querySelectorAll("[data-record-row]")).toHaveLength(2);
    const semantic = harness.container.querySelector("[data-record-type='comparison']");
    const exact = harness.container.querySelector("[data-record-type='task-execution']");
    expect(semantic?.textContent).toContain("Comparison");
    expect(semantic?.textContent).toContain("in Compare");
    expect(semantic?.querySelector("a[href='/compare/results/run-1']")).not.toBeNull();
    expect(semantic?.querySelector("a[href='/records/comparison/run-1']")).not.toBeNull();
    expect(exact?.textContent).toContain("Task Execution");
    act(() => harness.root.unmount());
  });
  it("reuses the exact RunDetail document at the canonical route", async () => {
    const harness = await setup("/records/task-execution/run-1");
    expect(harness.container.querySelector("[data-run-detail]")).not.toBeNull();
    expect(harness.container.querySelector("[data-section='timeline']")).not.toBeNull();
    expect(harness.container.querySelector("[data-section='task-config']")).not.toBeNull();
    act(() => harness.root.unmount());
  });

  it("renders typed unknown-ID recovery rather than an empty shell", async () => {
    const harness = await setup("/records/task-execution/missing");
    expect(harness.container.querySelector("[data-record-not-found]")).not.toBeNull();
    expect(harness.container.textContent).toContain("Search Records for similar IDs");
    expect(harness.container.textContent).toContain("Open Records");
    expect(harness.container.textContent).toContain("Import data");
    expect(harness.container.textContent).toContain("Records are device-local");
    act(() => harness.root.unmount());
  });

  it("uses route-based detail with a Back to Records band below 1024px", async () => {
    const harness = await setup("/records/task-execution/run-1", false);
    expect(harness.container.querySelector("a[href='/records']")?.textContent).toContain(
      "Back to Records",
    );
    expect(harness.container.querySelector("[data-run-detail]")).not.toBeNull();
    act(() => harness.root.unmount());
  });
});
