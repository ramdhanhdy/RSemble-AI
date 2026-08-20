// =============================================================================
// RSemble AI — model-profile-loader-test-seed.ts (Child 07 Task 8)
//
// Minimal non-test seed helper for the model-profile-loader focused tests and
// the model-profile-worker unit tests. Builds a small valid acceptance-shaped
// corpus (2 task families × 6 tasks, judged scores + verifier pass/fail
// outcomes, 2 model configurations for paired comparison) against the real
// in-memory repositories, so the worker compute and loader delegation can be
// exercised without pulling in the full models-acceptance.test.tsx suite.
//
// This is test support for the loader's focused tests; it holds no product
// logic and is not imported by production code.
// =============================================================================

import { InMemoryEvidenceRepository } from "../../lib/persistence/evidence-repository";
import { InMemoryTaskRepository } from "../../lib/persistence/in-memory-task-repository";
import { QUERY_ELIGIBILITY_RULE_VERSION } from "../../lib/model-profiles/model-evidence-query";
import { observationIdFor } from "../../lib/evidence/evidence-validation";
import type {
  AssessmentRef,
  EligibilityDecision,
  Observation,
} from "../../lib/evidence/evidence-types";

export interface SeededCorpus {
  evidenceRepo: InMemoryEvidenceRepository;
  taskRepo: InMemoryTaskRepository;
  configAId: string;
  configBId: string;
}

const COHORT_CODE = `sha256:${"a".repeat(64)}`;

async function createFixtureTask(repo: InMemoryTaskRepository, id: string): Promise<void> {
  const now = Date.now();
  await repo.createTask(
    {
      id,
      latestVersion: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      origin: "authored",
      revision: 0,
    },
    {
      taskId: id,
      version: 1,
      title: id,
      objective: `Fixture objective for ${id}.`,
      candidateInstruction: `Complete ${id}.`,
      defaultContextManifest: [],
      responseContract: null,
      taskVerifierRef: null,
      source: { kind: "authored", legacyScopeKey: null, note: null },
      createdAt: now,
    },
  );
}

function makeAssessmentRef(options: {
  judgeAttemptId: string;
  candidateAttemptId: string;
  rubricRef?: AssessmentRef["rubricRef"];
  verifier?: { taskId: string; modelKey: string; passed: boolean };
}): AssessmentRef {
  const candidateId = "candidate";
  return {
    judgeAttemptId: options.judgeAttemptId,
    judgeProviderId: "openai",
    judgeModel: "gpt-5.6-sol",
    blindLabelMapping: { A: candidateId },
    candidateAttemptIdsByCandidateId: { [candidateId]: options.candidateAttemptId },
    rubricRef: options.rubricRef ?? null,
    verifierRef: options.verifier ? { id: "ver-code", version: 1 } : null,
    verifierOutcome: options.verifier
      ? { ...options.verifier, executedAt: Date.parse("2026-07-10") }
      : null,
  };
}

async function putFixtureObservation(
  repo: InMemoryEvidenceRepository,
  observation: Omit<Observation, "id">,
): Promise<string> {
  const digest = `sha256:${"1".repeat(64)}`;
  const persisted: Observation = {
    id: "",
    ...observation,
    protocolFingerprint: digest,
    evaluatorSnapshot: {
      ...observation.evaluatorSnapshot,
      instructionDigest: digest,
    },
    verifierSnapshot: observation.verifierSnapshot
      ? { ...observation.verifierSnapshot, configurationDigest: digest }
      : null,
  };
  persisted.id = observationIdFor(persisted);
  await repo.putObservation(persisted);
  return persisted.id;
}

async function putDecision(
  repo: InMemoryEvidenceRepository,
  observationId: string,
  overrides: Partial<EligibilityDecision> = {},
): Promise<void> {
  await repo.putDecision({
    observationId,
    ruleVersion: QUERY_ELIGIBILITY_RULE_VERSION,
    status: "eligible",
    evidenceClass: "verified",
    allowedUses: ["within_model_profile", "paired_model_comparison"],
    comparabilityCohortId: COHORT_CODE,
    reasonCodes: ["canonical_task_resolved", "model_configuration_exact"],
    decidedAt: Date.now(),
    ...overrides,
  });
}

/**
 * Seeds a minimal acceptance-shaped corpus. Family `fam-code` carries verifier
 * pass/fail outcomes (pass-rate cohorts); family `fam-sum` carries judged
 * overall scores (judged-score cohorts). Config B overlaps on `fam-code` so a
 * paired comparison can be computed.
 */
export async function seedProfileTestCorpus(): Promise<SeededCorpus> {
  const taskRepo = new InMemoryTaskRepository();
  await taskRepo.createTaskFamily({
    id: "fam-code",
    name: "Code Transformation",
    description: "Code transformation tasks",
    parentFamilyId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archivedAt: null,
    revision: 1,
  });
  await taskRepo.createTaskFamily({
    id: "fam-sum",
    name: "Summarization",
    description: "Summarization tasks",
    parentFamilyId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archivedAt: null,
    revision: 1,
  });

  const taskIdsCode = ["t-code-1", "t-code-2", "t-code-3", "t-code-4", "t-code-5", "t-code-6"];
  const taskIdsSum = ["t-sum-1", "t-sum-2", "t-sum-3", "t-sum-4", "t-sum-5", "t-sum-6"];
  for (const tid of [...taskIdsCode, ...taskIdsSum]) {
    await createFixtureTask(taskRepo, tid);
    await taskRepo.assignTaskFamily({
      id: `asgn-${tid}`,
      taskId: tid,
      taskVersion: 1,
      familyId: tid.startsWith("t-code") ? "fam-code" : "fam-sum",
      isPrimary: false,
      createdAt: Date.now(),
      archivedAt: null,
      revision: 1,
    });
  }

  const evidenceRepo = new InMemoryEvidenceRepository();
  const configAId = "mc:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const configBId = "mc:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  for (const cfg of [
    {
      id: configAId,
      providerId: "openai",
      requestedModel: "gpt-5.6-sol",
      resolvedModel: "gpt-5.6-sol",
      resolvedVersion: "gpt-5.6-sol",
    },
    {
      id: configBId,
      providerId: "anthropic",
      requestedModel: "claude-haiku-4-5",
      resolvedModel: "claude-haiku-4-5-20251001",
      resolvedVersion: "20251001",
    },
  ]) {
    await evidenceRepo.putModelConfiguration({
      ...cfg,
      reasoningRequested: cfg.providerId === "openai" ? "high" : null,
      reasoningEffective: cfg.providerId === "openai" ? "high" : null,
      toolScaffoldSignature: "t-tools",
      runtimeSettings: {},
      identityCompleteness: "exact",
      observedFrom: Date.parse("2026-05-01"),
      observedTo: Date.parse("2026-08-01"),
    });
  }

  // Config A — fam-code: verifier pass/fail (5 pass, 1 fail).
  for (let i = 0; i < taskIdsCode.length; i++) {
    const tid = taskIdsCode[i];
    const passed = i < 5;
    const obsId = await putFixtureObservation(evidenceRepo, {
      sourceKind: "evaluation",
      sourceResultId: "eval-exec-1",
      executionLineageId: `lin-a-${tid}`,
      runId: "run-1",
      sourceTaskCellId: `cell-a-${tid}`,
      taskId: tid,
      taskVersion: 1,
      taskInstanceId: `inst-${tid}`,
      taskFamilyId: "fam-code",
      modelConfigurationId: configAId,
      candidateAttemptId: `cand-a-${tid}`,
      assessmentRef: makeAssessmentRef({
        judgeAttemptId: `judg-a-${tid}`,
        candidateAttemptId: `cand-a-${tid}`,
        verifier: { taskId: tid, modelKey: "openai:gpt-5.6-sol", passed },
      }),
      rubricRef: null,
      evaluatorSnapshot: {
        kind: "model_judge",
        providerId: "openai",
        model: "gpt-5.6-sol",
        resolvedVersion: "gpt-5.6-sol",
        instructionDigest: "inst-1",
        reasoningEffort: null,
        toolScaffoldSignature: null,
      },
      verifierSnapshot: {
        kind: "unit_tests",
        configurationDigest: "digest-1",
        verifierRef: { id: "ver-code", version: 1 },
      },
      outcome: { judgeAccepted: true, verifierPassed: passed, overallScore: null, criterionValues: [] },
      observedAt: Date.parse("2026-07-10") + i * 1000,
      observationSchemaVersion: 1,
    });
    await putDecision(evidenceRepo, obsId);
  }

  // Config A — fam-sum: judged overall scores.
  const scores = [80, 85, 90, 75, 88, 92];
  for (let i = 0; i < taskIdsSum.length; i++) {
    const tid = taskIdsSum[i];
    const obsId = await putFixtureObservation(evidenceRepo, {
      sourceKind: "evaluation",
      sourceResultId: "eval-exec-1",
      executionLineageId: `lin-a-${tid}`,
      runId: "run-1",
      sourceTaskCellId: `cell-a-${tid}`,
      taskId: tid,
      taskVersion: 1,
      taskInstanceId: `inst-${tid}`,
      taskFamilyId: "fam-sum",
      modelConfigurationId: configAId,
      candidateAttemptId: `cand-a-${tid}`,
      assessmentRef: makeAssessmentRef({
        judgeAttemptId: `judg-a-${tid}`,
        candidateAttemptId: `cand-a-${tid}`,
        rubricRef: { id: "rub-sum", version: 1 },
      }),
      rubricRef: { id: "rub-sum", version: 1 },
      evaluatorSnapshot: {
        kind: "model_judge",
        providerId: "openai",
        model: "gpt-5.6-sol",
        resolvedVersion: "gpt-5.6-sol",
        instructionDigest: "inst-1",
        reasoningEffort: null,
        toolScaffoldSignature: null,
      },
      verifierSnapshot: null,
      outcome: { judgeAccepted: true, verifierPassed: null, overallScore: scores[i], criterionValues: [] },
      observedAt: Date.parse("2026-07-12") + i * 1000,
      observationSchemaVersion: 1,
    });
    await putDecision(evidenceRepo, obsId);
  }

  // Config B — fam-code: verifier pass/fail (4 pass, 2 fail) for paired comparison.
  for (let i = 0; i < taskIdsCode.length; i++) {
    const tid = taskIdsCode[i];
    const passed = i < 4;
    const obsId = await putFixtureObservation(evidenceRepo, {
      sourceKind: "evaluation",
      sourceResultId: "eval-exec-1",
      executionLineageId: `lin-b-${tid}`,
      runId: "run-1",
      sourceTaskCellId: `cell-b-${tid}`,
      taskId: tid,
      taskVersion: 1,
      taskInstanceId: `inst-${tid}`,
      taskFamilyId: "fam-code",
      modelConfigurationId: configBId,
      candidateAttemptId: `cand-b-${tid}`,
      assessmentRef: makeAssessmentRef({
        judgeAttemptId: `judg-b-${tid}`,
        candidateAttemptId: `cand-b-${tid}`,
        verifier: { taskId: tid, modelKey: "anthropic:claude-haiku-4-5", passed },
      }),
      rubricRef: null,
      evaluatorSnapshot: {
        kind: "model_judge",
        providerId: "openai",
        model: "gpt-5.6-sol",
        resolvedVersion: "gpt-5.6-sol",
        instructionDigest: "inst-1",
        reasoningEffort: null,
        toolScaffoldSignature: null,
      },
      verifierSnapshot: {
        kind: "unit_tests",
        configurationDigest: "digest-1",
        verifierRef: { id: "ver-code", version: 1 },
      },
      outcome: { judgeAccepted: true, verifierPassed: passed, overallScore: null, criterionValues: [] },
      observedAt: Date.parse("2026-07-11") + i * 1000,
      observationSchemaVersion: 1,
    });
    await putDecision(evidenceRepo, obsId);
  }

  return { evidenceRepo, taskRepo, configAId, configBId };
}
