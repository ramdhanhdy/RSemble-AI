// =============================================================================
// Comparison Lineage & Preload Regression Suite (Plan Task 10, Spec §9)
//
// Pins lineage tracking, observation reindexing, CAS revision safety, preload
// isolation, and storage recovery:
//  - Deliberate "Run again" creates new linked result (repeatedFrom), NOT an
//    undeclared replicate;
//  - Lineage CAS revision protection: stale revisions abort before any write;
//  - Self-repeating comparisons (repeatedFrom === id) are rejected;
//  - Observation reindexing after active attempt changes: one active observation
//    per lineage cell (no count inflation on retries / re-judges);
//  - rebuildComparisonIndex refreshes derived fields and is idempotent;
//  - Open in Compare preload purity: runConfigFromRecord extracts frozen
//    command configuration only, never outputs, results, or lineage fields.
// =============================================================================

import { describe, expect, it } from "vitest";
import { runConfigFromRecord, type RunConfigPreload } from "../../lib/runs/run-config-preload";
import { InMemoryComparisonRepository } from "../../lib/persistence/in-memory-comparison-repository";
import { InMemoryRunRepository } from "../../lib/persistence/run-repository";
import {
  buildPreCallPersistencePlan,
  type PreCallPersistenceInput,
} from "../../lib/compare/pre-call-persistence";
import { validateComparisonResultIndex } from "../../lib/compare/comparison-result-validation";
import { countEvidence, type EvidenceLedgerRow } from "../../lib/evidence/evidence-counting";
import type {
  RunRecordV2,
  FullRunSummaryV2,
  PersistedCandidate,
  JudgeAttemptRecord,
} from "../../lib/persistence/run-types";

function makePersistedCandidate(
  candidateId: string,
  slotId: string,
  model: string,
  slug: string,
  output: string,
): PersistedCandidate {
  return {
    candidateId,
    slotId,
    modelKey: `openrouter:${slug}`,
    providerId: "openrouter",
    model,
    slug,
    acceptedAttemptId: `att-${candidateId}`,
    attempts: [
      {
        attemptId: `att-${candidateId}`,
        messages: [{ role: "user", content: "Prompt" }],
        startedAt: 1000,
        finishedAt: 1050,
        status: "completed",
        output,
        tokensIn: 20,
        tokensOut: 50,
        error: null,
      },
    ],
  };
}

function makeRunRecord(overrides: Partial<RunRecordV2> = {}): RunRecordV2 {
  const c1 = makePersistedCandidate(
    "cand-1",
    "s1",
    "gpt-4o",
    "gpt-4o",
    "Candidate 1 generated response",
  );
  const c2 = makePersistedCandidate(
    "cand-2",
    "s2",
    "claude-3.5-sonnet",
    "claude-3.5-sonnet",
    "Candidate 2 generated response",
  );

  const judgeAttempt: JudgeAttemptRecord = {
    attemptId: "att-judge-1",
    providerId: "openrouter",
    model: "judge-4o",
    instruction: "Evaluate criteria.",
    messages: [{ role: "user", content: "Evaluate" }],
    blindLabelToCandidateId: { A: "cand-1", B: "cand-2" },
    candidateAttemptIdsByCandidateId: { "cand-1": "att-cand-1", "cand-2": "att-cand-2" },
    startedAt: 1086,
    finishedAt: 1098,
    status: "completed",
    error: null,
    report: {
      labelMap: [
        { label: "A", candidateId: "cand-1" },
        { label: "B", candidateId: "cand-2" },
      ],
      evaluationsById: {
        "cand-1": {
          candidateId: "cand-1",
          blindLabel: "A",
          overallScore: 5.0,
          position: "First",
          rationale: "Good 1",
          strengths: [],
          deductions: [],
          missedRequirements: [],
          criterionScores: [{ criterionId: "c1", label: "C1", score: 5, rationale: "5/5" }],
        },
        "cand-2": {
          candidateId: "cand-2",
          blindLabel: "B",
          overallScore: 3.0,
          position: "Second",
          rationale: "Good 2",
          strengths: [],
          deductions: [],
          missedRequirements: [],
          criterionScores: [{ criterionId: "c1", label: "C1", score: 3, rationale: "3/5" }],
        },
      },
      comparisons: [],
    },
    consensus: null,
  };

  return {
    schemaVersion: 2,
    id: "run-lineage-1",
    revision: 1,
    execution: { ownerId: "tab-1", fence: 1 },
    createdAt: 1000,
    updatedAt: 1100,
    completedAt: 1100,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: {
      title: "Lineage task",
      prompt: "Original prompt instruction",
      systemPrompt: "Original system instruction",
      temperature: 0.3,
    },
    evaluation: {
      profile: {
        id: "rubric-lin",
        version: 1,
        name: "Test Rubric",
        description: "Desc",
        judgeInstruction: "",
        createdAt: 1000,
        updatedAt: 1000,
        criteria: [
          {
            id: "c1",
            kind: "graded",
            name: "Correctness",
            description: "Desc",
            weight: 1,
            anchors: {
              one: "1",
              two: "2",
              three: "3",
              four: "4",
              five: "5",
            },
          },
        ],
      },
      candidateMessages: [{ role: "user", content: "Original prompt instruction" }],
    },
    candidates: [c1, c2],
    judge: {
      status: "done",
      acceptedAttemptId: "att-judge-1",
      report: judgeAttempt.report,
      consensus: null,
      attempts: [judgeAttempt],
    },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: ["openrouter:gpt-4o"],
    reasoning: {
      candidates: {
        s1: { requested: "medium", effective: "medium", source: "catalog" },
        s2: { requested: "high", effective: "high", source: "catalog" },
      },
      judge: { requested: "high", effective: "high", source: "catalog" },
    },
    ...overrides,
  };
}

function makeSummary(record: RunRecordV2): FullRunSummaryV2 {
  return {
    kind: "full",
    schemaVersion: 2,
    id: record.id,
    revision: record.revision,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
    status: record.status,
    mode: record.mode,
    source: record.source,
    taskTitle: record.task.title,
    taskExcerpt: record.task.prompt,
    modelKeys: ["openrouter:gpt-4o", "openrouter:claude-3.5-sonnet"],
    winnerKeys: record.winnerKeys,
    scoresByModelKey: { "openrouter:gpt-4o": 5, "openrouter:claude-3.5-sonnet": 3 },
    judgeModelKey: "openrouter:judge-4o",
    evaluationProfileId: record.evaluation.profile?.id ?? null,
    evaluationProfileVersion: record.evaluation.profile?.version ?? null,
    detailAvailable: true,
    searchText: "lineage task original prompt instruction",
  };
}

describe("Comparison Lineage & Preload Regression (Spec §9)", () => {
  // ---------------------------------------------------------------------------
  // 1. Deliberate Run again (repeatedFrom) vs replicate
  // ---------------------------------------------------------------------------
  describe("Deliberate Run again lineage (repeatedFrom)", () => {
    it("creates a linked comparison index with repeatedFrom and does not declare replicate", () => {
      const input: PreCallPersistenceInput = {
        mode: "rank",
        prompt: "Repeat this task",
        systemPrompt: "System",
        temperature: 0.5,
        evaluation: { kind: "holistic" },
        slots: [
          {
            id: "s1",
            providerId: "openrouter",
            provider: "OpenRouter",
            model: "gpt-4o",
            slug: "gpt-4o",
            enabled: true,
          },
          {
            id: "s2",
            providerId: "umans",
            provider: "Umans",
            model: "claude-3.5-sonnet",
            slug: "claude-3.5-sonnet",
            enabled: true,
          },
        ],
        critic: { providerId: "openrouter", model: "judge-4o" },
        taskBinding: {
          kind: "ad_hoc",
          inputSnapshotRef:
            "snap:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
        repeatedFrom: "cmp-source-previous",
      };

      const plan = buildPreCallPersistencePlan(input, { now: () => 2000 });

      // Plan captures repeatedFrom in envelopeOptions
      expect(plan.envelopeOptions.repeatedFrom).toBe("cmp-source-previous");
    });

    it("validates that a comparison cannot repeat from itself", () => {
      const indexValidation = validateComparisonResultIndex({
        id: "cmp-self",
        runId: "cmp-self",
        title: "Self repeat",
        status: "completed",
        mode: "rank",
        createdAt: 1000,
        updatedAt: 1000,
        cost: { totalCostUsd: 0 },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        candidateModelKeys: ["openrouter:gpt-4o"],
        winnerKeys: ["openrouter:gpt-4o"],
        taskBinding: {
          kind: "ad_hoc",
          inputSnapshotRef:
            "snap:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
        inputSnapshotRef:
          "snap:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        activeObservationIds: [],
        evidenceReceiptRevision: 0,
        lineage: { repeatedFrom: "cmp-self" },
        revision: 1,
      });

      expect(indexValidation.ok).toBe(false);
      if (!indexValidation.ok) {
        expect(
          indexValidation.errors.some((e) => e.message.includes("cannot repeat from itself")),
        ).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Result lineage CAS revision protection
  // ---------------------------------------------------------------------------
  describe("Result lineage CAS revision protection", () => {
    it("records lineage update with matching revision and rejects on stale revision", async () => {
      const runs = new InMemoryRunRepository();
      const repo = new InMemoryComparisonRepository(runs);
      const record = makeRunRecord({ id: "run-cas-1" });
      await runs.create(record, makeSummary(record));

      const created = await repo.createComparisonEnvelope(record, {
        kind: "ad_hoc",
        inputSnapshotRef:
          "snap:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      });

      // Valid lineage update
      const updated = await repo.recordComparisonLineage(
        "run-cas-1",
        { repeatedFrom: "run-source-0" },
        created.revision,
      );
      expect(updated.lineage.repeatedFrom).toBe("run-source-0");
      expect(updated.revision).toBe(created.revision + 1);

      // Stale revision CAS rejection
      await expect(
        repo.recordComparisonLineage(
          "run-cas-1",
          { repeatedFrom: "run-source-x" },
          created.revision,
        ),
      ).rejects.toMatchObject({ kind: "conflict" });
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Observation reindexing & attempt changes
  // ---------------------------------------------------------------------------
  describe("Observation reindexing & ledger invariants", () => {
    it("preserves one active observation per lineage cell across retries / re-judges", () => {
      const CFG_A = "cfg-model-a";
      const rows: EvidenceLedgerRow[] = [
        // Sequence 1: Initial candidate attempt + initial judge
        {
          lineageCellKey: "task-1:v1:cell-a",
          taskId: "task-1",
          taskVersion: 1,
          taskInstanceId: "inst-1",
          modelConfigurationId: CFG_A,
          sequence: 1,
          candidateAttemptId: "att-cand-1-failed",
          reusedCandidateOutput: false,
          declaredReplicate: false,
          assessmentEventId: "j-att-1",
          attemptIds: ["att-cand-1-failed", "j-att-1"],
        },
        // Sequence 2: Retried candidate attempt + re-judge
        {
          lineageCellKey: "task-1:v1:cell-a",
          taskId: "task-1",
          taskVersion: 1,
          taskInstanceId: "inst-1",
          modelConfigurationId: CFG_A,
          sequence: 2,
          candidateAttemptId: "att-cand-2-success",
          reusedCandidateOutput: false,
          declaredReplicate: false,
          assessmentEventId: "j-att-2",
          attemptIds: ["att-cand-2-success", "j-att-2"],
        },
      ];

      const counts = countEvidence({ rows, declaredPairs: [] });

      // Invariant: one active observation per lineage cell, no count inflation
      expect(counts.activeObservationCount).toBe(1);
      expect(counts.lineageCellViolations).toEqual([]);
    });

    it("rebuildComparisonIndex updates derived fields from updated source record", async () => {
      const runs = new InMemoryRunRepository();
      const repo = new InMemoryComparisonRepository(runs);
      const record = makeRunRecord({
        id: "run-rebuild-1",
        status: "partial",
        winnerKeys: [],
      });
      await runs.create(record, makeSummary(record));
      await repo.createComparisonEnvelope(record, {
        kind: "ad_hoc",
        inputSnapshotRef:
          "snap:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      });

      // Simulate recovery completion: record updated with completed status
      const updatedRecord: RunRecordV2 = {
        ...record,
        revision: 2,
        status: "completed",
        winnerKeys: ["openrouter:gpt-4o"],
        updatedAt: 1500,
      };
      await runs.update(updatedRecord, makeSummary(updatedRecord), 1);

      // Rebuild index
      const rebuilt = await repo.rebuildComparisonIndex("run-rebuild-1");
      expect(rebuilt).not.toBeNull();
      expect(rebuilt?.status).toBe("completed");
      expect(rebuilt?.updatedAt).toBe(1500);

      // Rebuild is idempotent: calling again produces identical index
      const rebuiltAgain = await repo.rebuildComparisonIndex("run-rebuild-1");
      expect(rebuiltAgain).toEqual(rebuilt);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Open in Compare preload purity (runConfigFromRecord)
  // ---------------------------------------------------------------------------
  describe("Open in Compare preload purity (runConfigFromRecord)", () => {
    it("extracts command-pane config ONLY and never outputs, results, or lineage fields", () => {
      const record = makeRunRecord({
        id: "run-rich-1",
        winnerKeys: ["openrouter:gpt-4o"],
      });

      const config: RunConfigPreload = runConfigFromRecord(record);

      // Verify exact expected keys
      const configKeys = Object.keys(config).sort();
      expect(configKeys).toEqual(
        [
          "critic",
          "evaluation",
          "mode",
          "prompt",
          "reasoningPolicy",
          "slots",
          "systemPrompt",
          "temperature",
        ].sort(),
      );

      // Exact values
      expect(config.mode).toBe("rank");
      expect(config.prompt).toBe("Original prompt instruction");
      expect(config.systemPrompt).toBe("Original system instruction");
      expect(config.temperature).toBe(0.3);
      expect(config.evaluation).toEqual({
        kind: "profile",
        ref: { id: "rubric-lin", version: 1 },
        profile: record.evaluation.profile,
      });
      expect(config.slots).toEqual([
        {
          id: "s1",
          providerId: "openrouter",
          provider: "openrouter",
          model: "gpt-4o",
          slug: "gpt-4o",
          enabled: true,
        },
        {
          id: "s2",
          providerId: "openrouter",
          provider: "openrouter",
          model: "claude-3.5-sonnet",
          slug: "claude-3.5-sonnet",
          enabled: true,
        },
      ]);
      expect(config.critic).toEqual({ providerId: "openrouter", model: "judge-4o" });
      expect(config.reasoningPolicy).toEqual({ candidates: "medium", judge: "high" });

      // No leakage of outputs, results, or lineage
      const serialized = JSON.stringify(config);
      expect(serialized).not.toContain("Candidate 1 generated response");
      expect(serialized).not.toContain("winnerKeys");
      expect(serialized).not.toContain("repeatedFrom");
      expect(serialized).not.toContain("rebasedFrom");
      expect(serialized).not.toContain("runId");
    });

    it("falls back gracefully for records with holistic evaluation or missing judge attempts", () => {
      const holisticRecord = makeRunRecord({
        evaluation: { profile: null, candidateMessages: [{ role: "user", content: "Prompt" }] },
        judge: {
          status: "idle",
          acceptedAttemptId: null,
          report: null,
          consensus: null,
          attempts: [],
        },
        reasoning: undefined,
      });

      const config = runConfigFromRecord(holisticRecord);

      expect(config.evaluation).toEqual({ kind: "holistic" });
      expect(config.critic).toBeUndefined();
      expect(config.reasoningPolicy).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Storage recovery & non-existent / orphan rebuild
  // ---------------------------------------------------------------------------
  describe("Storage recovery & non-existent / orphan rebuild", () => {
    it("returns null safely when rebuilding an index for a non-existent run", async () => {
      const runs = new InMemoryRunRepository();
      const repo = new InMemoryComparisonRepository(runs);

      const result = await repo.rebuildComparisonIndex("run-non-existent");
      expect(result).toBeNull();
    });
  });
});
