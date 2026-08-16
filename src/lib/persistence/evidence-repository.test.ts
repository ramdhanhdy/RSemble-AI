// =============================================================================
// RSemble AI — Evidence repository contract tests (spec §5, §10, §13)
//
// Exercises both the Dexie-backed evidence repository and the in-memory
// parity implementation against the same behavioral contract:
//
//  - idempotent unique observation source key (six-part key, spec §5);
//  - conflicting duplicate with non-identical content is a corruption error,
//    never last-write-wins;
//  - model-configuration identity with window extension and collision abort;
//  - eligibility decision revisions (append-only per rule version) and active
//    decision resolution;
//  - source/model/task queries and deterministic paginated listing;
//  - evidence index jobs with CAS/source-revision behavior (no regressions at
//    a fixed revision; revision bumps re-trigger; error rows are retryable);
//  - classified storage failures and payload validation (no raw candidate
//    output, no secret-bearing keys anywhere).
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RSembleEvaluationDB, StorageError, type EvidenceObservationRow } from "./database";
import {
  EvidenceCorruptionError,
  createEvidenceRepository,
  InMemoryEvidenceRepository,
  type EvidenceIndexJob,
  type EvidenceIndexJobSummary,
  type EvidenceRepository,
} from "./evidence-repository";
import { canonicalizeModelConfiguration } from "../evidence/model-configuration";
import {
  canonicalObservationJson,
  observationIdFor,
  observationSourceKey,
} from "../evidence/evidence-validation";
import {
  EVIDENCE_RULE_VERSION,
  classifyEligibility,
  type EligibilityInput,
} from "../evidence/evidence-eligibility";
import type {
  EligibilityDecision,
  ExecutedVerifierOutcome,
  Observation,
} from "../evidence/evidence-types";

function makeModelConfiguration(idSeed: string, observedAt = 1000) {
  const r = canonicalizeModelConfiguration({
    providerId: "openrouter",
    requestedModel: `org/model-${idSeed}`,
    resolvedModel: "org/model-resolved",
    resolvedVersion: "2025-06-01",
    reasoningRequested: "high",
    reasoningEffective: "medium",
    toolScaffoldSignature: null,
    runtimeSettings: { temperature: 0.7 },
    observedAt,
  });
  if (!r.ok) throw new Error(r.reason);
  return r.snapshot;
}

function makeObservation(seed: string, overrides: Partial<Observation> = {}): Observation {
  const base: Observation = {
    id: "",
    sourceKind: "evaluation",
    sourceResultId: `run-${seed}`,
    executionLineageId: `eval:exp-${seed}:task-1`,
    runId: `run-${seed}`,
    sourceTaskCellId: `exp-${seed}:task-1:openrouter:model-${seed}`,
    taskId: "task-1",
    taskVersion: 2,
    taskInstanceId: `inst-${seed}`,
    taskFamilyId: null,
    modelConfigurationId: `mc:sha256:${"1".repeat(64)}`,
    candidateAttemptId: `att-${seed}`,
    assessmentRef: {
      judgeAttemptId: `judge-att-${seed}`,
      judgeProviderId: "openrouter",
      judgeModel: "org/judge",
      blindLabelMapping: { A: `cand-${seed}` },
      candidateAttemptIdsByCandidateId: { [`cand-${seed}`]: `att-${seed}` },
      rubricRef: { id: "rub-1", version: 3 },
      verifierRef: null,
      verifierOutcome: null,
    },
    protocolFingerprint: `sha256:${"2".repeat(64)}`,
    rubricRef: { id: "rub-1", version: 3 },
    evaluatorSnapshot: {
      kind: "model_judge",
      providerId: "openrouter",
      model: "org/judge",
      resolvedVersion: null,
      instructionDigest: `sha256:${"3".repeat(64)}`,
      reasoningEffort: "high",
      toolScaffoldSignature: null,
    },
    verifierSnapshot: null,
    outcome: {
      judgeAccepted: true,
      overallScore: 4,
      criterionValues: [{ criterionId: "c1", value: 4 }],
      verifierPassed: null,
    },
    observedAt: 1000,
    observationSchemaVersion: 1,
    ...overrides,
  };
  if (base.id === "") base.id = observationIdFor(base);
  return base;
}

function makeDecision(observation: Observation, ruleVersion = EVIDENCE_RULE_VERSION) {
  const input: EligibilityInput = {
    observation,
    canonicalTaskResolved: true,
    candidateInputComplete: true,
    candidateSelectedCompleted: true,
    assessmentSelectedCompleted: true,
    verifierState: "not_declared",
    frozenVerifierVersion: false,
    humanVerificationAuthorized: false,
    rubricResolved: true,
    protocolComplete: true,
    configurationState: "rolling_alias",
    fullPairCoverage: true,
    fullTaskSetCoverage: true,
    reusedCandidateAssessment: false,
    undeclaredRepeat: false,
    sourceCorrupt: false,
    sourceLegacyLimited: false,
    anchorDesignated: false,
    comparabilityCohortId: `sha256:${"5".repeat(64)}`,
    decidedAt: 2000,
  };
  return { ...classifyEligibility(input), ruleVersion };
}

function makeJob(overrides: Partial<EvidenceIndexJob> = {}): EvidenceIndexJob {
  return {
    sourceResultId: "run-a",
    sourceKind: "evaluation",
    status: "queued",
    ruleVersion: EVIDENCE_RULE_VERSION,
    sourceRevision: 1,
    updatedAt: 10,
    errorKind: null,
    errorMessage: null,
    summary: null,
    ...overrides,
  };
}

function makeVerifierOutcome(
  runId = "run-a",
  overrides: Partial<ExecutedVerifierOutcome> = {},
): ExecutedVerifierOutcome {
  return {
    taskId: "task-1",
    modelKey: "openrouter:model-m1",
    runId,
    kind: "exact_match",
    configurationDigest: `sha256:${"7".repeat(64)}`,
    verifierRef: { id: "ver-1", version: 2 },
    passed: true,
    executedAt: 5,
    ...overrides,
  };
}

interface RepoHarness {
  repo: EvidenceRepository;
  close?: () => Promise<void>;
}

type RepoFactory = () => Promise<RepoHarness>;

const dexieFactory: RepoFactory = async () => {
  const db = new RSembleEvaluationDB(`evidence-repo-test-${Math.random().toString(36).slice(2)}`);
  await db.open();
  return {
    repo: createEvidenceRepository(db),
    close: async () => db.close(),
  };
};

const memoryFactory: RepoFactory = async () => ({ repo: new InMemoryEvidenceRepository() });

// --- Contract suite -----------------------------------------------------------

function runContract(name: string, makeHarness: RepoFactory) {
  describe(`EvidenceRepository contract (${name})`, () => {
    let harness: RepoHarness;
    beforeEach(async () => {
      harness = await makeHarness();
    });
    afterEach(async () => {
      await harness.close?.();
    });

    describe("model configurations", () => {
      it("creates, extends, and reports unchanged windows without identity drift", async () => {
        const { repo } = harness;
        const snap = makeModelConfiguration("a", 1000);
        await expect(repo.putModelConfiguration(snap)).resolves.toBe("created");
        const same = makeModelConfiguration("a", 2000);
        await expect(repo.putModelConfiguration(same)).resolves.toBe("extended");
        const stored = await repo.getModelConfiguration(snap.id);
        expect(stored?.observedFrom).toBe(1000);
        expect(stored?.observedTo).toBe(2000);
        // Same window again: no write, no change.
        await expect(repo.putModelConfiguration(makeModelConfiguration("a", 1500))).resolves.toBe(
          "unchanged",
        );
        expect((await repo.getModelConfiguration(snap.id))?.observedTo).toBe(2000);
        const listed = await repo.listModelConfigurations();
        expect(listed).toHaveLength(1);
        expect(listed[0].id).toBe(snap.id);
      });

      it("aborts with a corruption error when the same id carries different identity content", async () => {
        const { repo } = harness;
        const a = makeModelConfiguration("a");
        await repo.putModelConfiguration(a);
        // Same id, tampered identity fields (simulated hash collision).
        const tampered = { ...a, resolvedVersion: "2026-01-01" };
        await expect(repo.putModelConfiguration(tampered)).rejects.toBeInstanceOf(
          EvidenceCorruptionError,
        );
        // The stored row is untouched.
        const stored = await repo.getModelConfiguration(a.id);
        expect(stored?.resolvedVersion).toBe("2025-06-01");
      });

      it("rejects snapshots carrying prohibited keys in runtime settings", async () => {
        const { repo } = harness;
        const snap = makeModelConfiguration("sec");
        snap.runtimeSettings = { apiKey: "sk-secret" };
        await expect(repo.putModelConfiguration(snap)).rejects.toBeInstanceOf(StorageError);
        const err = await repo.putModelConfiguration(snap).catch((e) => e);
        expect((err as StorageError).kind).toBe("validation");
        expect(await repo.listModelConfigurations()).toHaveLength(0);
      });
    });

    describe("observations", () => {
      it("is idempotent under the six-part source key", async () => {
        const { repo } = harness;
        const o = makeObservation("1");
        await expect(repo.putObservation(o)).resolves.toBe("created");
        await expect(repo.putObservation({ ...o })).resolves.toBe("existing");
        await expect(repo.countObservations()).resolves.toBe(1);
        expect(await repo.getObservation(o.id)).toEqual(o);
        const byKey = await repo.findObservationBySourceKey(observationSourceKey(o));
        expect(byKey).toEqual(o);
      });

      it("rejects a duplicate source key with non-identical content as corruption, never last-write-wins", async () => {
        const { repo } = harness;
        const o = makeObservation("2");
        await repo.putObservation(o);
        // Same source key, different canonical content (e.g. changed outcome).
        const conflicting = { ...o, outcome: { ...o.outcome, overallScore: 5 } };
        expect(observationSourceKey(conflicting)).toBe(observationSourceKey(o));
        await expect(repo.putObservation(conflicting)).rejects.toBeInstanceOf(
          EvidenceCorruptionError,
        );
        const stored = await repo.getObservation(o.id);
        expect(stored?.outcome.overallScore).toBe(4);
        await expect(repo.countObservations()).resolves.toBe(1);
      });

      it("rejects payloads carrying prohibited keys or raw candidate output", async () => {
        const { repo } = harness;
        const withSecret = {
          ...makeObservation("3"),
          runtimeSettings: { apiKey: "sk-secret" },
        } as unknown as Observation;
        await expect(repo.putObservation(withSecret)).rejects.toBeInstanceOf(StorageError);
        const withOutput = {
          ...makeObservation("4"),
          candidateOutput: "raw model text",
        } as unknown as Observation;
        await expect(repo.putObservation(withOutput)).rejects.toBeInstanceOf(StorageError);
        const withMessages = {
          ...makeObservation("5"),
          candidateMessages: [{ role: "user", content: "hi" }],
        } as unknown as Observation;
        await expect(repo.putObservation(withMessages)).rejects.toBeInstanceOf(StorageError);
        await expect(repo.countObservations()).resolves.toBe(0);
      });

      it("supports source, task, and model-configuration queries", async () => {
        const { repo } = harness;
        const a = makeObservation("a");
        const b = makeObservation("b", { modelConfigurationId: `mc:sha256:${"9".repeat(64)}` });
        const c = makeObservation("c", { taskId: "task-9" });
        const d = makeObservation("d", {
          sourceKind: "comparison",
          modelConfigurationId: a.modelConfigurationId,
        });
        await repo.putObservation(a);
        await repo.putObservation(b);
        await repo.putObservation(c);
        await repo.putObservation(d);
        const bySource = await repo.listObservationsBySource("evaluation", a.sourceResultId);
        expect(bySource.map((o) => o.id)).toEqual([a.id]);
        const byTask = await repo.listObservationsByTask("task-9");
        expect(byTask.map((o) => o.id)).toEqual([c.id]);
        const byConfig = await repo.listObservationsByModelConfiguration(a.modelConfigurationId);
        expect(new Set(byConfig.map((o) => o.id))).toEqual(new Set([a.id, c.id, d.id]));
      });

      it("paginates deterministically with a total count", async () => {
        const { repo } = harness;
        const rows = Array.from({ length: 7 }, (_, i) =>
          makeObservation(String(i), { observedAt: 1000 + i }),
        );
        for (const o of rows) await repo.putObservation(o);
        const page1 = await repo.listObservations({ limit: 3, offset: 0 });
        expect(page1.total).toBe(7);
        expect(page1.items.map((o) => o.id)).toEqual(
          [6, 5, 4].map((i) => rows[i].id), // newest first, deterministic
        );
        const page2 = await repo.listObservations({ limit: 3, offset: 3 });
        expect(page2.items.map((o) => o.id)).toEqual([3, 2, 1].map((i) => rows[i].id));
        const page3 = await repo.listObservations({ limit: 3, offset: 6 });
        expect(page3.items.map((o) => o.id)).toEqual([rows[0].id]);
        const filtered = await repo.listObservations({ taskId: "task-1", limit: 10 });
        expect(filtered.total).toBe(7);
      });

      it("treats an invalid observation id as validation corruption", async () => {
        const { repo } = harness;
        const o = { ...makeObservation("6"), id: "obs:sha256:ffff" };
        await expect(repo.putObservation(o)).rejects.toBeInstanceOf(StorageError);
        const err = await repo.putObservation(o).catch((e) => e);
        expect((err as StorageError).kind).toBe("validation");
      });
    });

    describe("eligibility decisions", () => {
      it("appends rule revisions and resolves the active decision", async () => {
        const { repo } = harness;
        const o = makeObservation("7");
        await repo.putObservation(o);
        const d1 = { ...makeDecision(o), ruleVersion: 1, status: "excluded" as const };
        const d2 = { ...makeDecision(o), ruleVersion: 2, status: "eligible" as const };
        await repo.putDecision(d1);
        await repo.putDecision(d2);
        const revisions = await repo.listDecisionRevisions(o.id);
        expect(revisions.map((d) => d.ruleVersion)).toEqual([1, 2]);
        const active = await repo.getActiveDecision(o.id);
        expect(active?.ruleVersion).toBe(2);
        expect(active?.status).toBe("eligible");
        expect(await repo.getDecision(o.id, 1)).toEqual(d1);
        const activeBySource = await repo.listActiveDecisions({ sourceResultId: o.sourceResultId });
        expect(activeBySource).toHaveLength(1);
        expect(activeBySource[0].observationId).toBe(o.id);
      });

      it("is idempotent for the same decision and rejects conflicting content at one rule version", async () => {
        const { repo } = harness;
        const o = makeObservation("8");
        await repo.putObservation(o);
        const d = makeDecision(o);
        await repo.putDecision(d);
        await repo.putDecision({ ...d });
        expect(await repo.listDecisionRevisions(o.id)).toHaveLength(1);
        const conflicting = { ...d, status: "excluded" as const };
        await expect(repo.putDecision(conflicting)).rejects.toBeInstanceOf(EvidenceCorruptionError);
      });

      it("does not change observation counts when decisions are recomputed", async () => {
        const { repo } = harness;
        const o = makeObservation("9");
        await repo.putObservation(o);
        await repo.putDecision(makeDecision(o));
        await repo.putDecision({ ...makeDecision(o), ruleVersion: 3 });
        await expect(repo.countObservations()).resolves.toBe(1);
        expect(await repo.listDecisionRevisions(o.id)).toHaveLength(2);
      });

      it("rejects decisions carrying extra or prohibited fields", async () => {
        const { repo } = harness;
        const o = makeObservation("dec-extra");
        await repo.putObservation(o);
        const withSecret = {
          ...makeDecision(o),
          apiKey: "sk-secret",
        } as unknown as EligibilityDecision;
        await expect(repo.putDecision(withSecret)).rejects.toBeInstanceOf(StorageError);
        const withUnknown = { ...makeDecision(o), extraField: 1 } as unknown as EligibilityDecision;
        await expect(repo.putDecision(withUnknown)).rejects.toBeInstanceOf(StorageError);
        expect(await repo.listDecisionRevisions(o.id)).toHaveLength(0);
      });
    });

    describe("evidence index jobs", () => {
      it("creates and reads job rows", async () => {
        const { repo } = harness;
        const job = makeJob();
        await expect(repo.putIndexJob(job)).resolves.toBe("created");
        expect(await repo.getIndexJob("run-a")).toEqual(job);
        await expect(repo.putIndexJob(job)).resolves.toBe("unchanged");
      });

      it("rejects stale source revisions (CAS)", async () => {
        const { repo } = harness;
        await repo.putIndexJob(makeJob({ status: "complete", sourceRevision: 3 }));
        await expect(
          repo.putIndexJob(makeJob({ status: "queued", sourceRevision: 2 })),
        ).rejects.toBeInstanceOf(StorageError);
        const err = await repo
          .putIndexJob(makeJob({ status: "queued", sourceRevision: 2 }))
          .catch((e) => e);
        expect((err as StorageError).kind).toBe("conflict");
        // The completed marker is preserved.
        expect((await repo.getIndexJob("run-a"))?.sourceRevision).toBe(3);
      });

      it("a source revision bump re-triggers indexing", async () => {
        const { repo } = harness;
        await repo.putIndexJob(makeJob({ status: "complete", sourceRevision: 1 }));
        await expect(
          repo.putIndexJob(makeJob({ status: "queued", sourceRevision: 2 })),
        ).resolves.toBe("updated");
        const job = await repo.getIndexJob("run-a");
        expect(job?.status).toBe("queued");
        expect(job?.sourceRevision).toBe(2);
      });

      it("never regresses a complete marker at the same revision (duplicate events)", async () => {
        const { repo } = harness;
        await repo.putIndexJob(makeJob({ status: "complete", sourceRevision: 1 }));
        await expect(
          repo.putIndexJob(makeJob({ status: "queued", sourceRevision: 1 })),
        ).resolves.toBe("unchanged");
        expect((await repo.getIndexJob("run-a"))?.status).toBe("complete");
      });

      it("allows error rows to be re-queued for retry at the same revision", async () => {
        const { repo } = harness;
        await repo.putIndexJob(
          makeJob({ status: "error", sourceRevision: 1, errorKind: "quota", errorMessage: "full" }),
        );
        await expect(
          repo.putIndexJob(makeJob({ status: "queued", sourceRevision: 1 })),
        ).resolves.toBe("updated");
        expect((await repo.getIndexJob("run-a"))?.status).toBe("queued");
      });

      it("advances queued -> running -> complete within one revision", async () => {
        const { repo } = harness;
        await repo.putIndexJob(makeJob({ status: "queued", sourceRevision: 1 }));
        await expect(
          repo.putIndexJob(makeJob({ status: "running", sourceRevision: 1 })),
        ).resolves.toBe("updated");
        await expect(
          repo.putIndexJob(makeJob({ status: "complete", sourceRevision: 1 })),
        ).resolves.toBe("updated");
        expect((await repo.getIndexJob("run-a"))?.status).toBe("complete");
      });

      it("lists jobs by status", async () => {
        const { repo } = harness;

        await repo.putIndexJob(makeJob({ sourceResultId: "run-1" }));
        await repo.putIndexJob(makeJob({ sourceResultId: "run-2", status: "complete" }));
        await repo.putIndexJob(
          makeJob({ sourceResultId: "run-3", status: "error", errorKind: "unavailable" }),
        );
        const queued = await repo.listIndexJobs({ status: "queued" });
        expect(queued.map((j) => j.sourceResultId)).toEqual(["run-1"]);
        const errored = await repo.listIndexJobs({ status: "error" });
        expect(errored).toHaveLength(1);
        expect(errored[0].errorKind).toBe("unavailable");
      });

      it("rejects jobs with non-string secret-bearing error fields", async () => {
        const { repo } = harness;
        const secretMessage = {
          ...makeJob(),
          errorMessage: { apiKey: "sk-x" } as unknown as string,
        };
        await expect(repo.putIndexJob(secretMessage)).rejects.toBeInstanceOf(StorageError);
        const err = await repo.putIndexJob(secretMessage).catch((e) => e);
        expect((err as StorageError).kind).toBe("validation");
        await expect(
          repo.putIndexJob({
            ...makeJob(),
            errorKind: { apiKey: "sk-x" } as unknown as string,
          }),
        ).rejects.toBeInstanceOf(StorageError);
        await expect(repo.getIndexJob("run-a")).resolves.toBeNull();
      });

      it("rejects summaries carrying prohibited keys or malformed counts", async () => {
        const { repo } = harness;
        await expect(
          repo.putIndexJob({
            ...makeJob(),
            summary: {
              observationCount: 1,
              gapCount: 0,
              limitationCount: 0,
              integrityIssues: [],
              apiKey: "sk-y",
            } as unknown as EvidenceIndexJobSummary,
          }),
        ).rejects.toBeInstanceOf(StorageError);
        await expect(
          repo.putIndexJob({
            ...makeJob(),
            summary: {
              observationCount: "one",
              gapCount: 0,
              limitationCount: 0,
              integrityIssues: [],
            } as unknown as EvidenceIndexJobSummary,
          }),
        ).rejects.toBeInstanceOf(StorageError);
      });
    });

    describe("verifier outcomes", () => {
      it("persists executed outcomes idempotently and lists them deterministically", async () => {
        const { repo } = harness;
        await expect(
          repo.putVerifierOutcome(makeVerifierOutcome("run-a", { executedAt: 5 })),
        ).resolves.toBe("created");
        await expect(
          repo.putVerifierOutcome(makeVerifierOutcome("run-a", { executedAt: 5 })),
        ).resolves.toBe("existing");
        await repo.putVerifierOutcome(makeVerifierOutcome("run-a", { executedAt: 10 }));
        await repo.putVerifierOutcome(makeVerifierOutcome("run-b", { executedAt: 7 }));
        const listed = await repo.listVerifierOutcomes({});
        expect(listed.map((o) => `${o.runId}:${o.executedAt}`)).toEqual([
          "run-a:5",
          "run-b:7",
          "run-a:10",
        ]);
      });

      it("scopes listing by task, model, and lineage run ids", async () => {
        const { repo } = harness;
        await repo.putVerifierOutcome(makeVerifierOutcome("run-a", { executedAt: 5 }));
        await repo.putVerifierOutcome(
          makeVerifierOutcome("run-a", { modelKey: "openrouter:other", executedAt: 6 }),
        );
        await repo.putVerifierOutcome(makeVerifierOutcome("run-b", { executedAt: 7 }));
        await repo.putVerifierOutcome(
          makeVerifierOutcome("run-b", { taskId: "task-9", executedAt: 8 }),
        );
        const byRun = await repo.listVerifierOutcomes({ runIds: ["run-a"] });
        expect(byRun.map((o) => o.modelKey)).toEqual(["openrouter:model-m1", "openrouter:other"]);
        const byCell = await repo.listVerifierOutcomes({
          taskId: "task-1",
          modelKey: "openrouter:model-m1",
          runIds: ["run-a", "run-b"],
        });
        expect(byCell.map((o) => `${o.runId}:${o.executedAt}`)).toEqual(["run-a:5", "run-b:7"]);
      });

      it("rejects malformed outcomes, kind none, unknown kinds, and prohibited keys", async () => {
        const { repo } = harness;
        const base = makeVerifierOutcome("run-a");
        await expect(
          repo.putVerifierOutcome({ ...base, kind: "none" } as ExecutedVerifierOutcome),
        ).rejects.toBeInstanceOf(StorageError);
        await expect(
          repo.putVerifierOutcome({ ...base, kind: "vibes" } as unknown as ExecutedVerifierOutcome),
        ).rejects.toBeInstanceOf(StorageError);
        await expect(
          repo.putVerifierOutcome({ ...base, configurationDigest: "not-a-digest" }),
        ).rejects.toBeInstanceOf(StorageError);
        await expect(repo.putVerifierOutcome({ ...base, executedAt: -1 })).rejects.toBeInstanceOf(
          StorageError,
        );
        await expect(
          repo.putVerifierOutcome({ ...base, verifierRef: { id: "", version: 1 } }),
        ).rejects.toBeInstanceOf(StorageError);
        await expect(
          repo.putVerifierOutcome({
            ...base,
            apiKey: "sk-x",
          } as unknown as ExecutedVerifierOutcome),
        ).rejects.toBeInstanceOf(StorageError);
        expect(await repo.listVerifierOutcomes({})).toHaveLength(0);
      });

      it("treats a non-identical outcome at the same composite id as corruption", async () => {
        const { repo } = harness;
        await repo.putVerifierOutcome(makeVerifierOutcome("run-a", { executedAt: 5 }));
        await expect(
          repo.putVerifierOutcome(makeVerifierOutcome("run-a", { executedAt: 5, passed: false })),
        ).rejects.toBeInstanceOf(EvidenceCorruptionError);
        const listed = await repo.listVerifierOutcomes({});
        expect(listed).toHaveLength(1);
        expect(listed[0].passed).toBe(true);
      });
    });

    describe("stale-running recovery", () => {
      it("re-queues only running jobs at or past the stale boundary", async () => {
        const { repo } = harness;
        await repo.putIndexJob(
          makeJob({ sourceResultId: "run-stale", status: "running", updatedAt: 1000 }),
        );
        // Boundary: exactly updatedAt + timeout == now counts as stale.
        await repo.putIndexJob(
          makeJob({ sourceResultId: "run-boundary", status: "running", updatedAt: 1001 }),
        );
        await repo.putIndexJob(
          makeJob({ sourceResultId: "run-queued", status: "queued", updatedAt: 0 }),
        );
        await repo.putIndexJob(
          makeJob({ sourceResultId: "run-complete", status: "complete", updatedAt: 0 }),
        );
        await repo.putIndexJob(
          makeJob({
            sourceResultId: "run-error",
            status: "error",
            updatedAt: 0,
            errorKind: "quota",
            errorMessage: "full",
          }),
        );
        const recovered = await repo.recoverStaleIndexJobs({ staleTimeoutMs: 5000, now: 6000 });
        expect(recovered).toEqual(["run-stale"]);
        expect((await repo.getIndexJob("run-stale"))?.status).toBe("queued");
        expect((await repo.getIndexJob("run-boundary"))?.status).toBe("running");
        expect((await repo.getIndexJob("run-queued"))?.status).toBe("queued");
        expect((await repo.getIndexJob("run-complete"))?.status).toBe("complete");
        expect((await repo.getIndexJob("run-error"))?.status).toBe("error");
      });

      it("recovers a stranded job exactly once and is idempotent", async () => {
        const { repo } = harness;
        await repo.putIndexJob(makeJob({ status: "running", updatedAt: 1000 }));
        expect(await repo.recoverStaleIndexJobs({ staleTimeoutMs: 5000, now: 6000 })).toEqual([
          "run-a",
        ]);
        // A repeated recovery finds no stale running marker and rewrites nothing.
        expect(await repo.recoverStaleIndexJobs({ staleTimeoutMs: 5000, now: 6000 })).toEqual([]);
        expect(await repo.recoverStaleIndexJobs({ staleTimeoutMs: 5000, now: 9000 })).toEqual([]);
        expect((await repo.getIndexJob("run-a"))?.status).toBe("queued");
      });

      it("rejects invalid recovery arguments", async () => {
        const { repo } = harness;
        await expect(
          repo.recoverStaleIndexJobs({ staleTimeoutMs: -1, now: 1000 }),
        ).rejects.toBeInstanceOf(StorageError);
        await expect(
          repo.recoverStaleIndexJobs({ staleTimeoutMs: Number.NaN, now: 1000 }),
        ).rejects.toBeInstanceOf(StorageError);
        await expect(
          repo.recoverStaleIndexJobs({ staleTimeoutMs: 1000, now: Number.NaN }),
        ).rejects.toBeInstanceOf(StorageError);
      });
    });

    describe("index job claims", () => {
      it("claims a queued job atomically and exclusively for one owner", async () => {
        const { repo } = harness;
        await repo.putIndexJob(makeJob({ status: "queued" }));
        const claimed = await repo.claimIndexJob({
          sourceResultId: "run-a",
          ownerId: "tab-a",
          updatedAt: 100,
        });
        expect(claimed).toMatchObject({ status: "running", sourceResultId: "run-a" });
        // A second owner cannot claim the same running job.
        expect(
          await repo.claimIndexJob({ sourceResultId: "run-a", ownerId: "tab-b", updatedAt: 101 }),
        ).toBeNull();
        // A generic queued put never downgrades a claimed running marker.
        await expect(repo.putIndexJob(makeJob({ status: "queued" }))).resolves.toBe("unchanged");
        expect((await repo.getIndexJob("run-a"))?.status).toBe("running");
      });

      it("cannot claim a missing, running, or complete row", async () => {
        const { repo } = harness;
        expect(
          await repo.claimIndexJob({ sourceResultId: "run-a", ownerId: "tab-a", updatedAt: 1 }),
        ).toBeNull();
        await repo.putIndexJob(makeJob({ status: "running" }));
        expect(
          await repo.claimIndexJob({ sourceResultId: "run-a", ownerId: "tab-a", updatedAt: 2 }),
        ).toBeNull();
        await repo.putIndexJob(makeJob({ status: "complete" }));
        expect(
          await repo.claimIndexJob({ sourceResultId: "run-a", ownerId: "tab-a", updatedAt: 3 }),
        ).toBeNull();
      });

      it("a heartbeat refreshes only the current owner's marker", async () => {
        const { repo } = harness;
        await repo.putIndexJob(makeJob({ status: "queued" }));
        await repo.claimIndexJob({ sourceResultId: "run-a", ownerId: "tab-a", updatedAt: 1000 });
        expect(
          await repo.heartbeatIndexJob({ sourceResultId: "run-a", ownerId: "tab-b", updatedAt: 1100 }),
        ).toBe(false);
        expect(
          await repo.heartbeatIndexJob({ sourceResultId: "run-a", ownerId: "tab-a", updatedAt: 1100 }),
        ).toBe(true);
        expect((await repo.getIndexJob("run-a"))?.updatedAt).toBe(1100);
      });

      it("only the current owner can finalize, and finalization clears the claim", async () => {
        const { repo } = harness;
        await repo.putIndexJob(makeJob({ status: "queued" }));
        await repo.claimIndexJob({ sourceResultId: "run-a", ownerId: "tab-a", updatedAt: 1000 });
        const complete = makeJob({
          status: "complete",
          updatedAt: 1200,
          summary: {
            observationCount: 1,
            gapCount: 0,
            limitationCount: 0,
            integrityIssues: [],
          },
        });
        // A non-owner cannot finalize the running claim.
        await expect(
          repo.finalizeIndexJob({ sourceResultId: "run-a", ownerId: "tab-b", job: complete }),
        ).resolves.toBe("lost");
        expect((await repo.getIndexJob("run-a"))?.status).toBe("running");
        await expect(
          repo.finalizeIndexJob({ sourceResultId: "run-a", ownerId: "tab-a", job: complete }),
        ).resolves.toBe("finalized");
        expect((await repo.getIndexJob("run-a"))?.status).toBe("complete");
        // The claim is cleared: the old owner can no longer heartbeat or finalize.
        expect(
          await repo.heartbeatIndexJob({ sourceResultId: "run-a", ownerId: "tab-a", updatedAt: 1300 }),
        ).toBe(false);
        await expect(
          repo.finalizeIndexJob({ sourceResultId: "run-a", ownerId: "tab-a", job: complete }),
        ).resolves.toBe("lost");
      });

      it("stale recovery clears ownership so a new owner can claim, and the old owner cannot", async () => {
        const { repo } = harness;
        await repo.putIndexJob(makeJob({ status: "queued" }));
        await repo.claimIndexJob({ sourceResultId: "run-a", ownerId: "tab-a", updatedAt: 1000 });
        // Tab A crashed: at t=7000 the marker is stale and recovery re-queues it.
        expect(await repo.recoverStaleIndexJobs({ staleTimeoutMs: 5000, now: 7000 })).toEqual([
          "run-a",
        ]);
        expect((await repo.getIndexJob("run-a"))?.status).toBe("queued");
        // A new owner claims the recovered job.
        const claimed = await repo.claimIndexJob({
          sourceResultId: "run-a",
          ownerId: "tab-b",
          updatedAt: 7100,
        });
        expect(claimed).toMatchObject({ status: "running" });
        // The old owner can neither heartbeat nor finalize after reassignment.
        expect(
          await repo.heartbeatIndexJob({ sourceResultId: "run-a", ownerId: "tab-a", updatedAt: 7200 }),
        ).toBe(false);
        await expect(
          repo.finalizeIndexJob({
            sourceResultId: "run-a",
            ownerId: "tab-a",
            job: makeJob({ status: "complete", updatedAt: 7200 }),
          }),
        ).resolves.toBe("lost");
        // The new owner still holds the claim and finalizes it.
        await expect(
          repo.finalizeIndexJob({
            sourceResultId: "run-a",
            ownerId: "tab-b",
            job: makeJob({ status: "complete", updatedAt: 7300 }),
          }),
        ).resolves.toBe("finalized");
        expect((await repo.getIndexJob("run-a"))?.status).toBe("complete");
      });

      it("finalize rejects non-terminal markers and stale revisions", async () => {
        const { repo } = harness;
        await repo.putIndexJob(makeJob({ status: "queued" }));
        await repo.claimIndexJob({ sourceResultId: "run-a", ownerId: "tab-a", updatedAt: 1000 });
        await expect(
          repo.finalizeIndexJob({
            sourceResultId: "run-a",
            ownerId: "tab-a",
            job: makeJob({ status: "running" }),
          }),
        ).rejects.toBeInstanceOf(StorageError);
        await expect(
          repo.finalizeIndexJob({
            sourceResultId: "run-a",
            ownerId: "tab-a",
            job: makeJob({ status: "complete", sourceRevision: 0 }),
          }),
        ).rejects.toBeInstanceOf(StorageError);
      });
    });

    describe("storage failure", () => {
      it("classifies closed-database failures as unavailable", async () => {
        if (!harness.close) return; // in-memory parity has no storage failures
        const { repo } = harness;
        const o = makeObservation("10");
        await repo.putObservation(o);
        await harness.close();
        const err = await repo.listObservations({}).catch((e) => e);
        expect(err).toBeInstanceOf(StorageError);
        expect((err as StorageError).kind).toBe("unavailable");
      });
    });
  });
}

runContract("dexie", dexieFactory);
runContract("in-memory", memoryFactory);

// --- Dexie-only corruption deep-check ----------------------------------------

describe("EvidenceRepository canonical content checks (dexie)", () => {
  it("compares canonical JSON, not object identity, for duplicate detection", async () => {
    const db = new RSembleEvaluationDB(
      `evidence-repo-canon-${Math.random().toString(36).slice(2)}`,
    );
    await db.open();
    try {
      const repo = createEvidenceRepository(db);
      const o = makeObservation("canon");
      await repo.putObservation(o);
      // Deep-equal but reordered object: canonical serialization must treat it
      // as identical (idempotent), never as a conflict.
      const reordered: Observation = JSON.parse(canonicalObservationJson(o)) as Observation;
      expect(reordered).not.toBe(o);
      await expect(repo.putObservation(reordered)).resolves.toBe("existing");
    } finally {
      db.close();
    }
  });
});

// --- Dexie-only schema backstop -----------------------------------------------

describe("Evidence schema unique sourceKey backstop (dexie)", () => {
  it("rejects a second row with the same sourceKey at the database level", async () => {
    const db = new RSembleEvaluationDB(`evidence-schema-${Math.random().toString(36).slice(2)}`);
    await db.open();
    try {
      const row = (id: string): EvidenceObservationRow => ({
        id,
        sourceKey: "K",
        sourceKind: "evaluation",
        sourceResultId: "run-x",
        sourceTaskCellId: "cell-x",
        taskId: "task-x",
        taskInstanceId: "inst-x",
        modelConfigurationId: `mc:sha256:${"0".repeat(64)}`,
        observedAt: 1,
        observation: {},
      });
      await db.observations.put(row("a"));
      // Bypassing the repository: the schema itself must reject the duplicate.
      const err = await db.observations.put(row("b")).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).toBe("ConstraintError");
      expect(await db.observations.count()).toBe(1);
    } finally {
      db.close();
    }
  });
});
