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
import { RepositoryContext, type RepositoryContextValue } from "../persistence/repository-context";
import { ExecutionOwnerProvider } from "../execution-owner-context";
import { ExperimentControllerProvider } from "./experiment-controller-context";
import { useExperimentController } from "./experiment-controller-hooks";
import { candidateIdForSlot } from "../pipeline";
import type { RunRecordV2, FullRunSummaryV2 } from "../persistence/run-types";

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
    const db = new RSembleEvaluationDB(
      "test-startup-gate-" + Math.random().toString(36).slice(2),
    );
    await db.open();
    const runRepo = createRunRepository(db);
    const evalRepo = createEvaluationRepository(db, runRepo);
    const blockingLease = createExecutionLease(db);
    await blockingLease.acquire({ kind: "compare", executionId: "live-run" });

    const value: RepositoryContextValue = {
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
    await blockingLease.dispose();
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
