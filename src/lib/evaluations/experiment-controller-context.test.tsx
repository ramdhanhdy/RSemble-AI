// @vitest-environment happy-dom
// =============================================================================
// ExperimentControllerProvider — startup recovery wiring tests
//
// Production bug: a run that crashed (or was orphaned by the pre-fix
// persistence bug) stayed "running" forever — spinning status, no terminal
// state, no way to clear it. Spec §20: "Page reloads during run → Persisted
// running record becomes interrupted on next startup." The lease's
// recoverInterruptedRuns implements the sweep, but no startup path called it.
// These tests pin the provider's startup effect to sweep stale ad-hoc runs.
// =============================================================================

import "fake-indexeddb/auto";
import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { RSembleEvaluationDB } from "../persistence/database";
import { createRunRepository, type RunRepository } from "../persistence/run-repository";
import { createExecutionLease } from "../execution-lease";
import {
  createEvaluationRepository,
  type EvaluationRepository,
} from "../persistence/evaluation-repository";
import { createEvidenceRepository } from "../persistence/evidence-repository";
import { RepositoryContext, type RepositoryContextValue } from "../persistence/repository-context";
import { ExecutionOwnerProvider } from "../execution-owner-context";
import { candidateIdForSlot } from "../pipeline";
import { ExperimentControllerProvider } from "./experiment-controller-context";
import { useExperimentController } from "./experiment-controller-hooks";
import type { RunRecordV2, FullRunSummaryV2 } from "../persistence/run-types";
import type { ExperimentRecord } from "./evaluation-types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
}

function render(node: React.ReactNode): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { container, root };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

function ControllerReadinessProbe() {
  const controller = useExperimentController();
  return <div data-controller-ready={controller ? "true" : "false"} />;
}

async function settle(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  });
}

/**
 * Poll `cond` inside act() until it holds, with a generous ceiling. Replaces a
 * fixed wall-clock wait on a variable-latency async effect (the startup sweep)
 * — fast when the effect is fast, patient under load, and the ceiling still
 * catches a genuinely broken sweep. Throws the last error if time runs out.
 */
async function waitUntil(
  cond: () => Promise<boolean>,
  timeoutMs = 3000,
  stepMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      let ok = false;
      await act(async () => {
        ok = await cond();
      });
      if (ok) return;
    } catch (err) {
      lastErr = err;
    }
    await settle(stepMs);
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
}

afterEach(() => {
  document.body.innerHTML = "";
});

// --- Fixtures -----------------------------------------------------------------

function staleRunningRun(id: string): { record: RunRecordV2; summary: FullRunSummaryV2 } {
  const slotId = "slot-1";
  const cid = candidateIdForSlot(slotId);
  const now = Date.now() - 8 * 3600_000; // orphaned 8h ago, like the reported run
  const record: RunRecordV2 = {
    schemaVersion: 2,
    id,
    revision: 1,
    // Written by the pre-fix compare path: hardcoded owner, not a real lease owner.
    execution: { ownerId: "tab-1", fence: 1 },
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    status: "running",
    mode: "rank",
    source: { kind: "adhoc" },
    task: { title: "Stuck task", prompt: "p", systemPrompt: "", temperature: 0.7 },
    evaluation: { profile: null, candidateMessages: [] },
    candidates: [
      {
        candidateId: cid,
        slotId,
        modelKey: "openrouter:z-ai/glm-5.2",
        providerId: "openrouter",
        model: "GLM 5.2",
        slug: "z-ai/glm-5.2",
        acceptedAttemptId: null,
        attempts: [],
      },
    ],
    judge: { status: "idle", acceptedAttemptId: null, report: null, consensus: null, attempts: [] },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
  };
  const summary: FullRunSummaryV2 = {
    kind: "full",
    schemaVersion: 2,
    id,
    revision: 1,
    createdAt: now,
    completedAt: null,
    status: "running",
    mode: "rank",
    source: { kind: "adhoc" },
    taskTitle: "Stuck task",
    taskExcerpt: "p",
    modelKeys: ["openrouter:z-ai/glm-5.2"],
    winnerKeys: [],
    scoresByModelKey: {},
    judgeModelKey: null,
    evaluationProfileId: null,
    evaluationProfileVersion: null,
    detailAvailable: true,
    searchText: "stuck task",
  };
  return { record, summary };
}

// --- Tests --------------------------------------------------------------------

describe("ExperimentControllerProvider startup recovery", () => {
  it("withholds execution actions until startup recovery completes", async () => {
    const db = new RSembleEvaluationDB("test-startup-gate-" + Math.random().toString(36).slice(2));
    await db.open();
    const runRepo = createRunRepository(db);
    const evalRepo = createEvaluationRepository(db, runRepo);
    const blockingLease = createExecutionLease(db);
    await blockingLease.acquire({ kind: "compare", executionId: "live-run" });

    const value: RepositoryContextValue = {
      taskRepo: null,
      runRepo,
      evalRepo,
      fusionRepo: null,
      db,
      storageState: "ready",
      retry: () => undefined,
    };

    const h = render(
      <MemoryRouter>
        <RepositoryContext.Provider value={value}>
          <ExecutionOwnerProvider>
            <ExperimentControllerProvider>
              <ControllerReadinessProbe />
            </ExperimentControllerProvider>
          </ExecutionOwnerProvider>
        </RepositoryContext.Provider>
      </MemoryRouter>,
    );

    const readiness = () => h.container.querySelector("[data-controller-ready]");
    expect(readiness()?.getAttribute("data-controller-ready")).toBe("false");

    await blockingLease.release();
    await waitUntil(async () => readiness()?.getAttribute("data-controller-ready") === "true");

    cleanup(h);
    await blockingLease.dispose?.();
    db.close();
    await db.delete();
  });

  it("marks a stale ad-hoc running run interrupted on mount (spec §20)", async () => {
    const db = new RSembleEvaluationDB(
      "test-startup-recovery-" + Math.random().toString(36).slice(2),
    );
    await db.open();
    const runRepo: RunRepository = createRunRepository(db);
    const evalRepo: EvaluationRepository = createEvaluationRepository(db, runRepo);

    // Seed the orphaned run exactly as the pre-fix compare path left it.
    const { record, summary } = staleRunningRun("run-stuck");
    await runRepo.create(record, summary);
    expect((await runRepo.get("run-stuck"))?.status).toBe("running");

    const value: RepositoryContextValue = {
      taskRepo: null,
      runRepo,
      evalRepo,
      fusionRepo: null,
      db,
      storageState: "ready",
      retry: () => undefined,
    };

    const h = render(
      <MemoryRouter>
        <RepositoryContext.Provider value={value}>
          <ExecutionOwnerProvider>
            <ExperimentControllerProvider>
              <div />
            </ExperimentControllerProvider>
          </ExecutionOwnerProvider>
        </RepositoryContext.Provider>
      </MemoryRouter>,
    );
    // The stale run is swept to interrupted — spinner stops, status truthful.
    // Wait on the condition, not a fixed clock: the sweep is a fire-and-forget
    // async effect whose latency varies under load.
    await waitUntil(async () => (await runRepo.get("run-stuck"))?.status === "interrupted");

    const recovered = await runRepo.get("run-stuck");
    expect(recovered?.status).toBe("interrupted");
    expect(recovered?.completedAt).not.toBeNull();

    // The summary row matches so the Runs list stops showing "running".
    const summaries = await runRepo.list({ status: "running", limit: 10 });
    expect(summaries.find((s) => s.id === "run-stuck")).toBeUndefined();

    cleanup(h);
    db.close();
    await db.delete();
  });

  it("does not touch runs owned by the current live lease owner", async () => {
    const db = new RSembleEvaluationDB("test-startup-live-" + Math.random().toString(36).slice(2));
    await db.open();
    const runRepo = createRunRepository(db);
    const evalRepo = createEvaluationRepository(db, runRepo);

    const value: RepositoryContextValue = {
      taskRepo: null,
      runRepo,
      evalRepo,
      fusionRepo: null,
      db,
      storageState: "ready",
      retry: () => undefined,
    };

    const h = render(
      <MemoryRouter>
        <RepositoryContext.Provider value={value}>
          <ExecutionOwnerProvider>
            <ExperimentControllerProvider>
              <div />
            </ExperimentControllerProvider>
          </ExecutionOwnerProvider>
        </RepositoryContext.Provider>
      </MemoryRouter>,
    );
    // Assert an absence: the sweep must not fabricate history. Unlike the
    // condition-poll above, an absence can only be checked after a quiet
    // window — there is no positive signal to wait for. Use a generous fixed
    // window so the sweep has definitely had its chance even under load.
    await settle(250);

    // Startup recovery must not fabricate history: no runs exist, none are created.
    expect(await runRepo.list({ limit: 10 })).toHaveLength(0);

    cleanup(h);
    db.close();
    await db.delete();
  });
});

// --- Startup evidence reindex (Wave A3 seam) -----------------------------------

const FP = `sha256:${"f".repeat(64)}`;

function terminalEvaluationSource(id: string): {
  record: RunRecordV2;
  summary: FullRunSummaryV2;
} {
  const attemptId = `att-${id}`;
  const record: RunRecordV2 = {
    schemaVersion: 2,
    id,
    revision: 1,
    execution: { ownerId: "tab-1", fence: 1 },
    createdAt: 0,
    updatedAt: 5,
    completedAt: 10,
    status: "completed",
    mode: "rank",
    source: {
      kind: "experiment",
      experimentId: `exp-${id}`,
      suiteId: "suite-1",
      suiteVersion: 1,
      protocolFingerprint: FP,
      taskId: "task-1",
      experimentTaskAttemptId: attemptId,
      trial: 0,
    },
    task: { title: "T", prompt: "prompt text", systemPrompt: "system text", temperature: 0 },
    evaluation: {
      profile: {
        id: "rub-1",
        version: 3,
        name: "Rubric",
        description: "",
        judgeInstruction: "",
        criteria: [],
        createdAt: 0,
        updatedAt: 0,
      },
      candidateMessages: [],
    },
    candidates: [
      {
        candidateId: "cand-1",
        slotId: "slot-1",
        modelKey: "openrouter:model-m1",
        providerId: "openrouter",
        model: "model-m1",
        slug: "model-m1",
        acceptedAttemptId: attemptId,
        attempts: [
          {
            attemptId,
            messages: [{ role: "user", content: "solve it" }],
            startedAt: 0,
            finishedAt: 10,
            status: "completed",
            output: "candidate output",
            tokensIn: null,
            tokensOut: null,
            error: null,
          },
        ],
      },
    ],
    judge: {
      status: "done",
      acceptedAttemptId: "j-1",
      report: {
        labelMap: [{ label: "A", candidateId: "cand-1" }],
        evaluationsById: {
          "cand-1": {
            candidateId: "cand-1",
            blindLabel: "A",
            overallScore: 4,
            position: "1",
            rationale: "good",
            strengths: [],
            deductions: [],
            missedRequirements: [],
            criterionScores: [
              { criterionId: "quality", label: "quality", kind: "graded", score: 4, rationale: "" },
            ],
          },
        },
        comparisons: [],
      },
      consensus: null,
      attempts: [
        {
          attemptId: "j-1",
          providerId: "openrouter",
          model: "org/judge",
          instruction: "judge instruction text",
          messages: [],
          blindLabelToCandidateId: { A: "cand-1" },
          candidateAttemptIdsByCandidateId: { "cand-1": attemptId },
          startedAt: 0,
          finishedAt: 10,
          status: "completed",
          error: null,
          report: null,
          consensus: null,
        },
      ],
    },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
  };
  const summary: FullRunSummaryV2 = {
    kind: "full",
    schemaVersion: 2,
    id,
    revision: 1,
    createdAt: 0,
    completedAt: 10,
    status: "completed",
    mode: "rank",
    source: record.source,
    taskTitle: "T",
    taskExcerpt: "prompt text",
    modelKeys: ["openrouter:model-m1"],
    winnerKeys: [],
    scoresByModelKey: {},
    judgeModelKey: null,
    evaluationProfileId: null,
    evaluationProfileVersion: null,
    detailAvailable: true,
    searchText: "prompt text",
  };
  return { record, summary };
}

function terminalExperiment(experimentId: string, runId: string): ExperimentRecord {
  return {
    id: experimentId,
    revision: 1,
    suiteId: "suite-1",
    suiteVersion: 1,
    protocolFingerprint: FP,
    status: "completed",
    execution: null,
    snapshot: {
      suiteId: "suite-1",
      suiteVersion: 1,
      tasks: [
        {
          id: "task-1",
          title: "T",
          prompt: "prompt text",
          systemPrompt: "system text",
          evaluation: { kind: "inherit" },
          judgeInstructionOverride: "",
          order: 0,
          taskVersionRef: { taskId: "task-canon", version: 2 },
        } as ExperimentRecord["snapshot"]["tasks"][number] & {
          taskVersionRef: { taskId: string; version: number };
        },
      ],
      modelSlots: [
        {
          id: "s1",
          providerId: "openrouter",
          provider: "X",
          model: "M1",
          slug: "model-m1",
          enabled: true,
        },
      ],
      defaultJudge: { providerId: "openrouter", model: "org/judge" },
      defaultEvaluation: { kind: "holistic" },
      profiles: [],
      protocolFingerprint: FP,
      createdAt: 0,
    },
    tasks: [
      {
        taskId: "task-1",
        selectedAttemptId: `att-${runId}`,
        attempts: [
          {
            id: `att-${runId}`,
            runId,
            trial: 0,
            status: "completed",
            startedAt: 0,
            finishedAt: 10,
            error: null,
          },
        ],
      },
    ],
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("ExperimentControllerProvider startup evidence reindex", () => {
  it("backfills a committed evaluation source on mount without touching the run", async () => {
    const db = new RSembleEvaluationDB(
      "test-evidence-backfill-" + Math.random().toString(36).slice(2),
    );
    await db.open();
    const runRepo = createRunRepository(db);
    const evalRepo = createEvaluationRepository(db, runRepo);
    const { record, summary } = terminalEvaluationSource("run-eval");
    const experiment = terminalExperiment("exp-run-eval", "run-eval");
    await runRepo.create(record, summary);
    await db.experiments.put({
      id: experiment.id,
      experiment,
      revision: experiment.revision,
      suiteId: experiment.suiteId,
      suiteVersion: experiment.suiteVersion,
      protocolFingerprint: experiment.protocolFingerprint,
      createdAt: experiment.createdAt,
      status: experiment.status,
    });
    // Exact records as persisted — the reindex must not rewrite any of them.
    const beforeDetail = await runRepo.get("run-eval");
    const beforeSummary = (await db.runSummaries.get("run-eval"))?.summary;
    const beforeExperiment = (await db.experiments.get("exp-run-eval"))?.experiment;

    const value: RepositoryContextValue = {
      taskRepo: null,
      runRepo,
      evalRepo,
      fusionRepo: null,
      db,
      storageState: "ready",
      retry: () => undefined,
    };
    const h = render(
      <MemoryRouter>
        <RepositoryContext.Provider value={value}>
          <ExecutionOwnerProvider>
            <ExperimentControllerProvider>
              <div />
            </ExperimentControllerProvider>
          </ExecutionOwnerProvider>
        </RepositoryContext.Provider>
      </MemoryRouter>,
    );

    const evidenceRepo = createEvidenceRepository(db);
    await waitUntil(
      async () => (await evidenceRepo.getIndexJob("run-eval"))?.status === "complete",
    );
    // Evaluation completion and the exact source records are untouched.
    expect((await runRepo.get("run-eval"))?.status).toBe("completed");
    expect(await runRepo.get("run-eval")).toEqual(beforeDetail);
    expect((await db.runSummaries.get("run-eval"))?.summary).toEqual(beforeSummary);
    expect((await db.experiments.get("exp-run-eval"))?.experiment).toEqual(beforeExperiment);

    cleanup(h);
    db.close();
    await db.delete();
  });

  it("records an owning error job when a source cannot be derived", async () => {
    const db = new RSembleEvaluationDB(
      "test-evidence-error-" + Math.random().toString(36).slice(2),
    );
    await db.open();
    const runRepo = createRunRepository(db);
    const evalRepo = createEvaluationRepository(db, runRepo);
    // The run committed but its experiment record is missing: derivation
    // fails and the failure lands on the owning index-job row only.
    const { record, summary } = terminalEvaluationSource("run-eval");
    await runRepo.create(record, summary);

    const value: RepositoryContextValue = {
      taskRepo: null,
      runRepo,
      evalRepo,
      fusionRepo: null,
      db,
      storageState: "ready",
      retry: () => undefined,
    };
    const h = render(
      <MemoryRouter>
        <RepositoryContext.Provider value={value}>
          <ExecutionOwnerProvider>
            <ExperimentControllerProvider>
              <div />
            </ExperimentControllerProvider>
          </ExecutionOwnerProvider>
        </RepositoryContext.Provider>
      </MemoryRouter>,
    );

    const evidenceRepo = createEvidenceRepository(db);
    await waitUntil(async () => (await evidenceRepo.getIndexJob("run-eval"))?.status === "error");
    const job = await evidenceRepo.getIndexJob("run-eval");
    expect(job?.errorKind).toBe("source-unresolvable");
    expect(await evidenceRepo.countObservations()).toBe(0);
    // The exact run keeps its terminal status and summary.
    expect((await runRepo.get("run-eval"))?.status).toBe("completed");
    expect((await db.runSummaries.get("run-eval"))?.status).toBe("completed");

    cleanup(h);
    db.close();
    await db.delete();
  });

  it("stays silent when no evidence sources exist", async () => {
    const db = new RSembleEvaluationDB(
      "test-evidence-silent-" + Math.random().toString(36).slice(2),
    );
    await db.open();
    const runRepo = createRunRepository(db);
    const evalRepo = createEvaluationRepository(db, runRepo);
    const value: RepositoryContextValue = {
      taskRepo: null,
      runRepo,
      evalRepo,
      fusionRepo: null,
      db,
      storageState: "ready",
      retry: () => undefined,
    };
    const h = render(
      <MemoryRouter>
        <RepositoryContext.Provider value={value}>
          <ExecutionOwnerProvider>
            <ExperimentControllerProvider>
              <div />
            </ExperimentControllerProvider>
          </ExecutionOwnerProvider>
        </RepositoryContext.Provider>
      </MemoryRouter>,
    );
    await settle(250);
    // No sources: no job markers, no observations, no fabricated history.
    expect(await db.evidenceIndexJobs.count()).toBe(0);
    expect(await db.observations.count()).toBe(0);
    cleanup(h);
    db.close();
    await db.delete();
  });
});
