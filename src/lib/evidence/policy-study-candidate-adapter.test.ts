// =============================================================================
// policy-study-candidate-adapter.test.ts — candidate eligibility without inflation
// (spec §9, lines 271-288; implementation plan Task 7)
//
// RED behaviors tested here:
//  - complete exact single-model candidate qualifies under ordinary Task/
//    protocol/configuration/assessment rules;
//  - same candidate Run/attempt referenced by multiple trials/studies yields
//    one immutable source Observation identity;
//  - incomplete/ambiguous/unresolved/protocol-incomparable candidates are
//    ineligible with explicit reasons;
//  - StudyObservation, rank selection, Fusion Result, Refined Result, playbook
//    row, policy score, and report never become model evidence profile inputs;
//  - no attempt/trial/study-weighted inflation;
//  - source-to-Observation reindex wiring processes only eligible candidates.
// =============================================================================

import { describe, expect, it } from "vitest";
import { InMemoryEvidenceRepository } from "../persistence/evidence-repository";
import { InMemoryStudyRepository } from "../persistence/study-repository";
import {
  adaptPolicyStudy,
  adaptStudyCandidateRun,
  assertNotPolicyOutput,
  isPolicyOutputEvidence,
  PolicyOutputEvidenceError,
  qualifyStudyCandidateObservation,
} from "./policy-study-candidate-adapter";
import type {
  EvaluationTask,
  EvaluationRubric,
  ExperimentRecord,
} from "../evaluations/evaluation-types";
import type { RunRecordV2, JudgeAttemptRecord, PersistedCandidate } from "../persistence/run-types";
import type { StudyTrial, StudyObservation } from "../studies/study-types";
import type {
  PolicyStudyDefinition,
  PolicyStudyRecord,
  PolicyTrialPayload,
  PolicyMeasurementPayload,
  PolicyReportPayload,
} from "../studies/policy/policy-study-types";
import { fingerprintStudyValue } from "../studies/study-fingerprint";
import { countEvidence, type EvidenceLedgerRow } from "./evidence-counting";
import type { EvaluationSourceResolver } from "./derive-observations";

// --- Fixtures -----------------------------------------------------------------

const FP = `sha256:${"a".repeat(64)}`;
const DIGEST_64 = `sha256:${"b".repeat(64)}`;

function candidate(
  id: string,
  modelKey: string,
  opts: {
    accepted?: boolean;
    output?: string;
    resolvedModel?: string | null;
    resolvedVersion?: string | null;
    failed?: boolean;
  } = {},
): PersistedCandidate {
  const [providerId, model] = modelKey.split(":");
  const attemptId = `att-${id}`;
  const cand = {
    candidateId: id,
    slotId: `slot-${id}`,
    modelKey,
    providerId,
    model,
    slug: model,
    acceptedAttemptId: opts.accepted === false ? null : attemptId,
    resolvedIdentity: {
      resolvedModel: opts.resolvedModel !== undefined ? opts.resolvedModel : model,
      resolvedVersion: opts.resolvedVersion !== undefined ? opts.resolvedVersion : "v1",
    },
    attempts: [
      {
        attemptId,
        messages: [{ role: "user", content: "solve" }],
        startedAt: 0,
        finishedAt: 10,
        status: opts.failed ? ("failed" as const) : ("completed" as const),
        output: opts.output !== undefined ? opts.output : "candidate output text",
        tokensIn: 100,
        tokensOut: 50,
        error: opts.failed ? { message: "generation failed" } : null,
      },
    ],
  };
  return cand as unknown as PersistedCandidate;
}

function judgeAttempt(attemptId: string, candId: string): JudgeAttemptRecord {
  return {
    attemptId,
    providerId: "openrouter",
    model: "org/judge",
    instruction: "judge instruction",
    messages: [],
    blindLabelToCandidateId: { A: candId },
    candidateAttemptIdsByCandidateId: { [candId]: `att-${candId}` },
    startedAt: 0,
    finishedAt: 10,
    status: "completed",
    error: null,
    report: {
      labelMap: [{ label: "A", candidateId: candId }],
      evaluationsById: {
        [candId]: {
          candidateId: candId,
          blindLabel: "A",
          overallScore: 4.5,
          position: "1",
          rationale: "solid",
          strengths: [],
          deductions: [],
          missedRequirements: [],
          criterionScores: [
            {
              criterionId: "correctness",
              label: "correctness",
              kind: "graded",
              score: 4.5,
              rationale: "",
            },
          ],
        },
      },
      comparisons: [],
    },
    consensus: null,
  };
}

function makeRun(overrides: Partial<RunRecordV2> = {}): RunRecordV2 {
  const candId = "cand-1";
  const run: RunRecordV2 = {
    schemaVersion: 2,
    id: "run-cand-1",
    revision: 1,
    execution: { ownerId: "owner-1", fence: 1 },
    createdAt: 1000,
    updatedAt: 1010,
    completedAt: 1010,
    status: "completed",
    mode: "rank",
    source: {
      kind: "experiment",
      experimentId: "exp-lab-1",
      suiteId: "suite-lab-1",
      suiteVersion: 1,
      protocolFingerprint: FP,
      taskId: "task-1",
      experimentTaskAttemptId: "att-1",
      trial: 0,
    },
    task: {
      title: "Task 1",
      prompt: "calculate 2 + 2",
      systemPrompt: "be exact",
      temperature: 0,
    },
    evaluation: {
      profile: {
        id: "rubric-1",
        version: 1,
        name: "Rubric",
        description: "",
        judgeInstruction: "",
        criteria: [],
        createdAt: 0,
        updatedAt: 0,
      } as EvaluationRubric,
      candidateMessages: [],
    },
    candidates: [candidate(candId, "openrouter:model-a")],
    judge: {
      status: "done",
      acceptedAttemptId: "jatt-1",
      report: judgeAttempt("jatt-1", candId).report,
      consensus: null,
      attempts: [judgeAttempt("jatt-1", candId)],
    },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
    ...overrides,
  };
  return run;
}

function makeExperiment(overrides: Partial<ExperimentRecord> = {}): ExperimentRecord {
  return {
    id: "exp-lab-1",
    revision: 1,
    suiteId: "suite-lab-1",
    suiteVersion: 1,
    protocolFingerprint: FP,
    status: "completed",
    createdAt: 1000,
    updatedAt: 1010,
    execution: null,
    snapshot: {
      suiteId: "suite-lab-1",
      suiteVersion: 1,
      tasks: [
        {
          id: "task-1",
          title: "Task 1",
          prompt: "calculate 2 + 2",
          systemPrompt: "be exact",
          evaluation: { kind: "inherit" },
          judgeInstructionOverride: "",
          order: 0,
          taskVersionRef: { taskId: "task-canon-1", version: 1 },
        } as EvaluationTask & { taskVersionRef: { taskId: string; version: number } },
      ],
      modelSlots: [
        {
          id: "s1",
          providerId: "openrouter",
          provider: "OpenRouter",
          model: "model-a",
          slug: "model-a",
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
        selectedAttemptId: "att-1",
        attempts: [
          {
            id: "att-1",
            trial: 0,
            runId: "run-cand-1",
            status: "completed",
            startedAt: 1000,
            finishedAt: 1010,
            error: null,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function makeStudyRecord(overrides: Partial<PolicyStudyRecord> = {}): PolicyStudyRecord {
  const claimPlan = overrides.claimLevel === "confirmed" ? "confirmation" : "exploration";
  const status = overrides.status ?? "in_progress";
  const definition: PolicyStudyDefinition = {
    workload: { taskSetId: "task-set-1", version: 1, manifestDigest: DIGEST_64 },
    modelPool: { poolId: "pool-1", version: 1, digest: DIGEST_64 },
    fusionRecipes: [{ recipeId: "recipe-1", version: 1, digest: DIGEST_64 }],
    judge1: { id: "mc:sha256:" + "c".repeat(64) },
    judge2: { id: "mc:sha256:" + "d".repeat(64) },
    rubric: { rubricId: "rubric-1", version: 1 },
    protocolFingerprint: FP,
    policies: ["best_fixed", "rank", "fuse", "refine"],
    stageProtocolVersion: 1,
    claimPlan,
  };
  const fp = fingerprintStudyValue(definition);
  return {
    id: "study-1",
    revision: 0,
    kind: "policy",
    title: "Policy Study 1",
    status,
    claimLevel: overrides.claimLevel ?? "exploratory",
    definitionSchemaVersion: 1,
    definitionFingerprint: fp,
    definition,
    reportRef: status === "completed" ? (overrides.reportRef ?? "report-1") : null,
    confirmationOf:
      overrides.claimLevel === "confirmed" ? (overrides.confirmationOf ?? "study-parent") : null,
    createdAt: 1000,
    updatedAt: 2000,
    archivedAt: null,
    ...overrides,
  };
}

function makeStudyTrial(
  studyId: string,
  trialId: string,
  policy: "best_fixed" | "rank" | "fuse" | "refine",
  candidateRunId: string,
): StudyTrial<PolicyTrialPayload> {
  const payload: PolicyTrialPayload = {
    policy,
    stage: "A",
    candidateConfig: {
      members: [{ id: "mc:sha256:" + "e".repeat(64) }],
    },
    recipeRef: policy === "fuse" ? { recipeId: "recipe-1", version: 1, digest: DIGEST_64 } : null,
    synthesizer:
      policy === "fuse" || policy === "refine" ? { id: "mc:sha256:" + "f".repeat(64) } : null,
  };
  const fp = fingerprintStudyValue(payload);
  return {
    id: trialId,
    studyId,
    payloadKind: "policy",
    payloadSchemaVersion: 1,
    payloadFingerprint: fp,
    payload,
    status: "in_progress",
    sampleIndex: 0,
    artifactRefs: [
      {
        runId: candidateRunId,
        attemptId: "att-cand-1",
        contentHash: DIGEST_64,
      },
    ],
    observationIds: [`obs-${trialId}`],
    policyCost: { tokensIn: 100, tokensOut: 50 },
    experimentalCost: { tokensIn: 150, tokensOut: 75 },
    createdAt: 1000,
    sealedAt: null,
  };
}

function makeStudyObservation(
  studyId: string,
  trialId: string,
): StudyObservation<PolicyMeasurementPayload> {
  return {
    id: `obs-${trialId}`,
    studyId,
    trialId,
    payloadKind: "policy_measurement",
    payloadSchemaVersion: 1,
    payload: {
      judge: { id: "mc:sha256:" + "c".repeat(64) },
      overallScore: 0.92,
      tokensIn: 200,
      tokensOut: 100,
      error: null,
    },
    status: "completed",
    sourceRunId: "run-holdout-1",
    createdAt: 1500,
    finishedAt: 1600,
  };
}

// --- Tests --------------------------------------------------------------------

describe("policy-study-candidate-adapter", () => {
  describe("Happy path: qualify single-model candidate", () => {
    it("qualifies a complete exact single-model candidate as a canonical Observation", () => {
      const run = makeRun();
      const result = qualifyStudyCandidateObservation({
        candidateRun: run,
        candidateId: "cand-1",
        identity: {
          taskId: "task-canon-1",
          taskVersion: 1,
          taskInstanceId: "inst:sha256:task-inst-1",
          taskFamilyId: null,
          inputComplete: true,
        },
        resolveModelConfiguration: () => ({
          resolvedModel: "model-a",
          resolvedVersion: "2026-08-01",
        }),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.observation.id).toMatch(/^obs:sha256:[0-9a-f]{64}$/);
      expect(result.observation.sourceKind).toBe("evaluation");
      expect(result.observation.sourceResultId).toBe(run.id);
      expect(result.observation.taskId).toBe("task-canon-1");
      expect(result.observation.taskVersion).toBe(1);
      expect(result.observation.outcome.judgeAccepted).toBe(true);
      expect(result.observation.outcome.overallScore).toBe(4.5);
      expect(result.decision.status).toBe("eligible");
      expect(result.decision.evidenceClass).toBe("comparable");
      expect(result.snapshot.identityCompleteness).toBe("exact");
    });
  });

  describe("One identity across multiple trials and studies (Anti-inflation)", () => {
    it("yields identical Observation ID across multiple trials referencing the same candidate run", async () => {
      const run = makeRun();
      const experiment = makeExperiment();
      const evidenceRepo = new InMemoryEvidenceRepository();
      const resolver: EvaluationSourceResolver = {
        getRun: async (id) => (id === run.id ? run : null),
        getExperiment: async (id) => (id === experiment.id ? experiment : null),
      };

      const deps = {
        evidenceRepo,
        resolver,
        resolveModelConfiguration: () => ({
          resolvedModel: "model-a",
          resolvedVersion: "2026-08-01",
        }),
      };

      // Trial 1: best_fixed references run-cand-1
      const res1 = await adaptStudyCandidateRun(deps, {
        candidateRunId: run.id,
        studyId: "study-1",
        trialIds: ["trial-best-fixed"],
      });
      expect(res1.status).toBe("complete");
      expect(res1.observationCount).toBe(1);
      expect(await evidenceRepo.countObservations()).toBe(1);

      const firstObs = (await evidenceRepo.listObservations({})).items[0];

      // Trial 2: rank references the SAME run-cand-1
      const res2 = await adaptStudyCandidateRun(deps, {
        candidateRunId: run.id,
        studyId: "study-1",
        trialIds: ["trial-rank"],
      });
      expect(res2.status).toBe("complete");
      expect(res2.reusedCount).toBe(1);
      // Repo observation count MUST remain 1 (no inflation!)
      expect(await evidenceRepo.countObservations()).toBe(1);

      // Trial 3: fuse references the SAME run-cand-1
      const res3 = await adaptStudyCandidateRun(deps, {
        candidateRunId: run.id,
        studyId: "study-1",
        trialIds: ["trial-fuse"],
      });
      expect(res3.status).toBe("complete");
      expect(res3.reusedCount).toBe(1);
      expect(await evidenceRepo.countObservations()).toBe(1);

      // Trial 4: refine references the SAME run-cand-1
      const res4 = await adaptStudyCandidateRun(deps, {
        candidateRunId: run.id,
        studyId: "study-1",
        trialIds: ["trial-refine"],
      });
      expect(res4.status).toBe("complete");
      expect(res4.reusedCount).toBe(1);
      expect(await evidenceRepo.countObservations()).toBe(1);

      const lastObs = (await evidenceRepo.listObservations({})).items[0];
      expect(lastObs.id).toBe(firstObs.id);
    });

    it("yields identical Observation ID when referenced by multiple different studies", async () => {
      const run = makeRun();
      const experiment = makeExperiment();
      const evidenceRepo = new InMemoryEvidenceRepository();
      const studyRepo = new InMemoryStudyRepository();

      const resolver: EvaluationSourceResolver = {
        getRun: async (id) => (id === run.id ? run : null),
        getExperiment: async (id) => (id === experiment.id ? experiment : null),
      };

      // Study 1 (Exploration) with 2 trials
      const study1 = makeStudyRecord({ id: "study-exploratory", status: "in_progress" });
      await studyRepo.createStudy(study1);
      await studyRepo.createTrial(
        makeStudyTrial("study-exploratory", "trial-1-bf", "best_fixed", run.id),
      );
      await studyRepo.createTrial(
        makeStudyTrial("study-exploratory", "trial-1-fuse", "fuse", run.id),
      );

      // Study 2 (Confirmation) with 1 trial referencing the SAME candidate run
      const study2 = makeStudyRecord({
        id: "study-confirmed",
        status: "in_progress",
        claimLevel: "confirmed",
        confirmationOf: "study-exploratory",
      });
      await studyRepo.createStudy(study2);
      await studyRepo.createTrial(
        makeStudyTrial("study-confirmed", "trial-2-bf", "best_fixed", run.id),
      );

      // Adapt Study 1
      const adapt1 = await adaptPolicyStudy({
        studyId: "study-exploratory",
        studyRepo,
        evidenceRepo,
        resolver,
        resolveModelConfiguration: () => ({
          resolvedModel: "model-a",
          resolvedVersion: "2026-08-01",
        }),
      });
      expect(adapt1.status).toBe("complete");
      expect(adapt1.observationsCreated).toBe(1);
      expect(await evidenceRepo.countObservations()).toBe(1);

      // Adapt Study 2 (Confirmation)
      const adapt2 = await adaptPolicyStudy({
        studyId: "study-confirmed",
        studyRepo,
        evidenceRepo,
        resolver,
        resolveModelConfiguration: () => ({
          resolvedModel: "model-a",
          resolvedVersion: "2026-08-01",
        }),
      });
      expect(adapt2.status).toBe("complete");
      expect(adapt2.observationsReused).toBe(1);
      expect(adapt2.observationsCreated).toBe(0);
      expect(await evidenceRepo.countObservations()).toBe(1);
    });

    it("evidence counting on multiple trials referencing same candidate run does not inflate sample count", () => {
      // Create ledger rows simulating 4 trials in a study that point to the same candidate attempt
      const rows: EvidenceLedgerRow[] = [
        {
          lineageCellKey: "cell-model-a",
          taskId: "task-canon-1",
          taskVersion: 1,
          taskInstanceId: "inst-1",
          modelConfigurationId: "mc:sha256:" + "e".repeat(64),
          sequence: 1,
          candidateAttemptId: "att-cand-1",
          reusedCandidateOutput: false,
          declaredReplicate: false,
          assessmentEventId: "jatt-1",
          attemptIds: ["att-cand-1"],
        },
        // Reused in second trial (rank)
        {
          lineageCellKey: "cell-model-a",
          taskId: "task-canon-1",
          taskVersion: 1,
          taskInstanceId: "inst-1",
          modelConfigurationId: "mc:sha256:" + "e".repeat(64),
          sequence: 1,
          candidateAttemptId: "att-cand-1",
          reusedCandidateOutput: true,
          declaredReplicate: false,
          assessmentEventId: "jatt-1",
          attemptIds: ["att-cand-1"],
        },
      ];

      const counts = countEvidence({
        rows,
        declaredPairs: [],
      });

      expect(counts.activeObservationCount).toBe(1);
      expect(counts.responseSampleCount).toBe(1);
      expect(counts.replicateCount).toBe(0);
    });
  });

  describe("Ineligible candidate handling with explicit reasons", () => {
    it("rejects candidate when canonical task identity is unresolved", () => {
      const run = makeRun();
      const result = qualifyStudyCandidateObservation({
        candidateRun: run,
        candidateId: "cand-1",
        identity: null, // Unresolved canonical identity
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.limitationCode).toBe("canonical_task_unresolved");
    });

    it("rejects candidate when instance input (prompt) is empty", () => {
      const run = makeRun({ task: { title: "T", prompt: "  ", systemPrompt: "", temperature: 0 } });
      const result = qualifyStudyCandidateObservation({
        candidateRun: run,
        candidateId: "cand-1",
        identity: {
          taskId: "task-canon-1",
          taskVersion: 1,
          taskInstanceId: "inst-1",
          taskFamilyId: null,
          inputComplete: false,
        },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.limitationCode).toBe("instance_input_incomplete");
    });

    it("rejects candidate when candidate generation failed or output is missing", () => {
      const run = makeRun({
        candidates: [candidate("cand-1", "openrouter:model-a", { failed: true, output: "" })],
      });
      const result = qualifyStudyCandidateObservation({
        candidateRun: run,
        candidateId: "cand-1",
        identity: {
          taskId: "task-canon-1",
          taskVersion: 1,
          taskInstanceId: "inst-1",
          taskFamilyId: null,
          inputComplete: true,
        },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.limitationCode).toBe("candidate_missing_or_failed");
    });

    it("rejects candidate when judge assessment is missing or unaccepted", () => {
      const run = makeRun({
        judge: {
          status: "done",
          acceptedAttemptId: null, // No accepted judge attempt
          report: null,
          consensus: null,
          attempts: [],
        },
      });
      const result = qualifyStudyCandidateObservation({
        candidateRun: run,
        candidateId: "cand-1",
        identity: {
          taskId: "task-canon-1",
          taskVersion: 1,
          taskInstanceId: "inst-1",
          taskFamilyId: null,
          inputComplete: true,
        },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.limitationCode).toBe("assessment_missing_or_failed");
    });

    it("qualifies rolling-alias candidate with model_version_unreported limitation", () => {
      const run = makeRun();
      const result = qualifyStudyCandidateObservation({
        candidateRun: run,
        candidateId: "cand-1",
        identity: {
          taskId: "task-canon-1",
          taskVersion: 1,
          taskInstanceId: "inst-1",
          taskFamilyId: null,
          inputComplete: true,
        },
        resolveModelConfiguration: () => ({
          resolvedModel: "model-a",
          resolvedVersion: null, // Unversioned rolling alias
        }),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.decision.reasonCodes).toContain("model_version_unreported");
      expect(result.decision.evidenceClass).toBe("comparable");
    });

    it("qualifies partial configuration candidate with model_configuration_incomplete limitation", () => {
      const run = makeRun();
      const result = qualifyStudyCandidateObservation({
        candidateRun: run,
        candidateId: "cand-1",
        identity: {
          taskId: "task-canon-1",
          taskVersion: 1,
          taskInstanceId: "inst-1",
          taskFamilyId: null,
          inputComplete: true,
        },
        resolveModelConfiguration: () => ({
          resolvedModel: null, // Unknown resolved model -> partial
          resolvedVersion: null,
        }),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.decision.reasonCodes).toContain("model_configuration_incomplete");
      expect(result.decision.evidenceClass).toBe("exploratory");
    });

    it("qualifies candidate with missing rubric as rubric_unresolved", () => {
      const run = makeRun({
        evaluation: { profile: null, candidateMessages: [] },
      });
      const result = qualifyStudyCandidateObservation({
        candidateRun: run,
        candidateId: "cand-1",
        identity: {
          taskId: "task-canon-1",
          taskVersion: 1,
          taskInstanceId: "inst-1",
          taskFamilyId: null,
          inputComplete: true,
        },
        resolveModelConfiguration: () => ({
          resolvedModel: "model-a",
          resolvedVersion: "2026-08-01",
        }),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.decision.reasonCodes).toContain("rubric_unresolved");
      expect(result.decision.evidenceClass).toBe("exploratory");
    });

    it("qualifies candidate with invalid protocol fingerprint as protocol_incomplete", () => {
      const run = makeRun({
        source: {
          kind: "experiment",
          experimentId: "exp-1",
          suiteId: "suite-1",
          suiteVersion: 1,
          protocolFingerprint: "invalid-fp",
          taskId: "task-1",
          experimentTaskAttemptId: "att-1",
          trial: 0,
        },
      });
      const result = qualifyStudyCandidateObservation({
        candidateRun: run,
        candidateId: "cand-1",
        identity: {
          taskId: "task-canon-1",
          taskVersion: 1,
          taskInstanceId: "inst-1",
          taskFamilyId: null,
          inputComplete: true,
        },
        resolveModelConfiguration: () => ({
          resolvedModel: "model-a",
          resolvedVersion: "2026-08-01",
        }),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.decision.reasonCodes).toContain("protocol_incomplete");
      expect(result.decision.evidenceClass).toBe("exploratory");
    });
  });

  describe("Policy outputs NEVER become model evidence", () => {
    it("detects and rejects StudyObservation (policy measurement)", () => {
      const studyObs = makeStudyObservation("study-1", "trial-1");
      expect(isPolicyOutputEvidence(studyObs)).toBe(true);
      expect(() => assertNotPolicyOutput(studyObs)).toThrow(PolicyOutputEvidenceError);
    });

    it("detects and rejects synthesis artifact (Fusion Result)", () => {
      const fusionArtifact = {
        runId: "run-fuse-1",
        fusionAttemptId: "fa-1",
        contentHash: DIGEST_64,
        policy: "fuse",
      };
      expect(isPolicyOutputEvidence(fusionArtifact)).toBe(true);
      expect(() => assertNotPolicyOutput(fusionArtifact)).toThrow(PolicyOutputEvidenceError);
    });

    it("detects and rejects refined artifact (Refined Result)", () => {
      const refineArtifact = {
        runId: "run-refine-1",
        fusionAttemptId: "ra-1",
        contentHash: DIGEST_64,
        policy: "refine",
      };
      expect(isPolicyOutputEvidence(refineArtifact)).toBe(true);
      expect(() => assertNotPolicyOutput(refineArtifact)).toThrow(PolicyOutputEvidenceError);
    });

    it("detects and rejects rank selection winner", () => {
      const rankSelection = {
        winnerCandidateId: "cand-1",
        policy: "rank",
        rationale: "winner selected by rank judge",
      };
      expect(isPolicyOutputEvidence(rankSelection)).toBe(true);
      expect(() => assertNotPolicyOutput(rankSelection)).toThrow(PolicyOutputEvidenceError);
    });

    it("detects and rejects Policy Playbook rows and reports", () => {
      const playbookRow = {
        policy: "fuse",
        configuration: "recipe-1",
        meanOutcome: 0.85,
        lift: 0.15,
        costMultiplier: 1.8,
        confidence: "high",
      };
      expect(isPolicyOutputEvidence(playbookRow)).toBe(true);
      expect(() => assertNotPolicyOutput(playbookRow)).toThrow(PolicyOutputEvidenceError);

      const report: PolicyReportPayload = {
        studyId: "study-1",
        definitionFingerprint: DIGEST_64,
        rows: [playbookRow as never],
        recommendation: {
          kind: "adopt",
          policy: "fuse",
          configuration: "recipe-1",
          rationale: "strong",
        },
        poolAdequacy: { probed: true, outcome: "confirmed", note: "adequate" },
        recipeSensitivity: { checked: true, note: "stable" },
        claimLevel: "exploratory",
        conclusion: "fuse outperforms best fixed",
        supportingTrialIds: ["trial-1"],
        supportingObservationIds: ["obs-trial-1"],
        reportSchemaVersion: 1,
        createdAt: 2000,
      };
      expect(isPolicyOutputEvidence(report)).toBe(true);
      expect(() => assertNotPolicyOutput(report)).toThrow(PolicyOutputEvidenceError);
    });

    it("adaptPolicyStudy skips policy measurements and extracts only candidate runs", async () => {
      const run = makeRun();
      const experiment = makeExperiment();
      const evidenceRepo = new InMemoryEvidenceRepository();
      const studyRepo = new InMemoryStudyRepository();

      const study = makeStudyRecord({ id: "study-with-obs", status: "in_progress" });
      await studyRepo.createStudy(study);

      const trial = makeStudyTrial("study-with-obs", "trial-1", "fuse", run.id);
      await studyRepo.createTrial(trial);
      await studyRepo.sealTrial("trial-1", 0, 2000);

      // Append Lab-owned policy measurement
      const obs = makeStudyObservation("study-with-obs", "trial-1");
      await studyRepo.appendObservation(obs);

      const resolver: EvaluationSourceResolver = {
        getRun: async (id) => (id === run.id ? run : null),
        getExperiment: async (id) => (id === experiment.id ? experiment : null),
      };

      const result = await adaptPolicyStudy({
        studyId: "study-with-obs",
        studyRepo,
        evidenceRepo,
        resolver,
        resolveModelConfiguration: () => ({
          resolvedModel: "model-a",
          resolvedVersion: "2026-08-01",
        }),
      });

      expect(result.status).toBe("complete");
      expect(result.policyOutputsSkipped).toBeGreaterThanOrEqual(1);
      expect(result.observationsCreated).toBe(1);

      // Ensure that the stored observation in evidenceRepo is the single-model candidate observation,
      // NOT the policy measurement!
      const storedObs = (await evidenceRepo.listObservations({})).items;
      expect(storedObs).toHaveLength(1);
      expect(storedObs[0].id).toMatch(/^obs:sha256:/);
      expect(storedObs[0].sourceResultId).toBe(run.id);
    });

    it("adaptPolicyStudy excludes synthesis/Fusion/Refine runIds from candidate adaptation (F2)", async () => {
      const candidateRun = makeRun();
      const synthesisRun = makeRun();
      synthesisRun.id = "run-synthesis-1";
      const experiment = makeExperiment();
      const evidenceRepo = new InMemoryEvidenceRepository();
      const studyRepo = new InMemoryStudyRepository();

      const study = makeStudyRecord({ id: "study-f2", status: "in_progress" });
      await studyRepo.createStudy(study);

      const trial = makeStudyTrial("study-f2", "trial-f2", "fuse", candidateRun.id);
      // Mirror the generic lineage shape the policy adapter persists: the
      // candidate run resolves to a full StudyArtifactRef and the synthesis
      // artifact is stored alongside it (runId + attemptId + contentHash).
      trial.artifactRefs.push({
        runId: synthesisRun.id,
        // Method-stamped synthesis attempt id for this trial (artifactFor).
        attemptId: "fa-trial-f2",
        contentHash: DIGEST_64,
      });
      await studyRepo.createTrial(trial);

      const getRunCalls: string[] = [];
      const resolver: EvaluationSourceResolver = {
        getRun: async (id) => {
          getRunCalls.push(id);
          if (id === candidateRun.id) return candidateRun;
          if (id === synthesisRun.id) return synthesisRun;
          return null;
        },
        getExperiment: async (id) => (id === experiment.id ? experiment : null),
      };

      const result = await adaptPolicyStudy({
        studyId: "study-f2",
        studyRepo,
        evidenceRepo,
        resolver,
        resolveModelConfiguration: () => ({
          resolvedModel: "model-a",
          resolvedVersion: "2026-08-01",
        }),
      });

      expect(result.status).toBe("complete");
      // The synthesis run was skipped, not adapted as a candidate.
      expect(result.candidateRunsProcessed).toBe(1);
      expect(result.candidateRunsSkipped).toBe(1);
      // The synthesis run was never looked up for derivation; only the
      // candidate run is resolved (adapt + internal re-derivation may look it
      // up more than once).
      expect(getRunCalls.length).toBeGreaterThanOrEqual(1);
      expect(new Set(getRunCalls)).toEqual(new Set([candidateRun.id]));
      // Exactly one canonical Observation, sourced from the candidate run.
      const storedObs = (await evidenceRepo.listObservations({})).items;
      expect(storedObs).toHaveLength(1);
      expect(storedObs[0].sourceResultId).toBe(candidateRun.id);
    });
  });
});
