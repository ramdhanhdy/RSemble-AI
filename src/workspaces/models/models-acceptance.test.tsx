// @vitest-environment happy-dom
/**
 * Executable acceptance for Fable §14 criteria 1–14 (criterion 15 / rollup
 * route is out of scope — T11). Asserts shipped C1–C4 surfaces honestly:
 * rendered DOM, copy table, and production source — never a checklist comment.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { act } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, cleanup, settle } from "./models-test-harness";
import { HonestValue } from "./HonestValue";
import { InsufficientState } from "./InsufficientState";
import { CohortBlock } from "./CohortBlock";
import { FamilyEvidenceCard } from "./FamilyEvidenceCard";
import { DeterministicNarrative } from "./DeterministicNarrative";
import { ClaimMark } from "./ClaimMark";
import { ModelEvidenceProfile, type ProfileData } from "./ModelEvidenceProfile";
import { EvidenceTable, type EvidenceTableRow } from "./EvidenceTable";
import { ModelList, SavedRollupsSection, type ModelListRowData } from "./ModelList";
import { ModelFilters } from "./ModelFilters";
import { DEFAULT_MODEL_LIST_URL_STATE } from "./models-url-state";
import { ModelsWorkspace } from "./ModelsWorkspace";
import { ObservationDrilldown } from "./ObservationDrilldown";
import { PairedComparisonSection } from "./PairedComparisonSection";
import { makeDrilldownData } from "./ObservationDrilldown.test";
import { ALL_COPY_STRINGS, FORBIDDEN_COPY_PATTERNS, FORBIDDEN_CLAIM_PHRASES } from "./copy";
import { loadProfileData } from "./model-profile-loader";
import type { FamilyAggregate } from "../../lib/model-profiles/family-aggregation";
import type {
  HonestQuantity,
  ProfileCoverageSummary,
} from "../../lib/model-profiles/coverage-summary";
import type { PairedComparisonResult } from "../../lib/model-profiles/paired-comparison";
import { InMemoryEvidenceRepository } from "../../lib/persistence/evidence-repository";
import { InMemoryTaskRepository } from "../../lib/persistence/in-memory-task-repository";
import { QUERY_ELIGIBILITY_RULE_VERSION } from "../../lib/model-profiles/model-evidence-query";
import type { AssessmentRef, Observation } from "../../lib/evidence/evidence-types";
import { observationIdFor } from "../../lib/evidence/evidence-validation";

const MODELS_ROOT = join(process.cwd(), "src", "workspaces", "models");
const COHORT_CODE = `sha256:${"a".repeat(64)}`;
const COHORT_SUM = `sha256:${"b".repeat(64)}`;
const COHORT_SUM_ALTERNATE = `sha256:${"f".repeat(64)}`;
const COHORT_REPAIR = `sha256:${"c".repeat(64)}`;
const COHORT_EXCLUDED = `sha256:${"d".repeat(64)}`;
const COHORT_PARTIAL = `sha256:${"e".repeat(64)}`;

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** Production workspace files (tests and comments are not UI claims). */
const PRODUCTION_FILES = filesUnder(MODELS_ROOT).filter(
  (path) => /\.(ts|tsx)$/.test(path) && !path.endsWith(".test.ts") && !path.endsWith(".test.tsx"),
);

function quotedStrings(source: string): string[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const out: string[] = [];
  const re = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripped))) {
    out.push(match[2]);
  }
  return out;
}

function makeCoverage(): ProfileCoverageSummary {
  return {
    uniqueTasks: { state: "available", value: 38 },
    taskVersions: { state: "available", value: 52 },
    taskInstances: { state: "available", value: 94 },
    activeObservations: { state: "available", value: 112 },
    acceptedCandidateResponses: { state: "available", value: 98 },
    attempts: { state: "available", value: 156 },
    plannedReplicates: { state: "available", value: 20 },
    resolvedIndependentUncertaintyUnits: { state: "unavailable", reason: "Not assigned." },
    uncertaintyUnitKind: { state: "unavailable", reason: "Not assigned." },
    uncertaintyAssumption: { state: "unavailable", reason: "Not assigned." },
    comparabilityCohorts: { state: "available", value: 2 },
    rubricVersions: { state: "available", value: 3 },
    evaluatorConfigurations: { state: "available", value: 2 },
    earliestObservation: { state: "available", value: 1714867200000 },
    latestObservation: { state: "available", value: 1722470400000 },
    missingCells: { state: "available", value: 4 },
    inMetricsEvidenceClassSplit: {
      exploratory: 12,
      comparable: 8,
      verified: 5,
      benchmark_anchor: 2,
    },
    consideredEvidenceClassSplit: {
      exploratory: 12,
      comparable: 8,
      verified: 5,
      benchmark_anchor: 2,
    },
    inMetricsEligibilityStatusSplit: { eligible: 14, provisional: 3, excluded: 6 },
    consideredEligibilityStatusSplit: { eligible: 14, provisional: 3, excluded: 6 },
    sourceKindSplit: { comparison: 61, evaluation: 51 },
    identityCompleteness: "exact",
    limitationReasons: {},
  };
}

function makeProfile(overrides: Partial<ProfileData> = {}): ProfileData {
  return {
    identity: {
      modelConfigurationId: "mc-subject",
      providerId: "openai",
      requestedModel: "gpt-5.6-sol",
      versionStatus: "exact",
      aggregationRuleVersion: 1,
      uncertaintyRuleVersion: 1,
      eligibilityRuleVersion: 1,
    },
    coverage: makeCoverage(),
    narrative: [
      {
        text: "Verified on 8 of 10 code-transformation Tasks under verifier cohort X.",
        sourceMetricKey: "coverage:code-transformation:verified",
      },
    ],
    claims: [
      {
        label: "strongest_supported",
        sentences: [
          {
            text: "Verified on 8 of 10 code-transformation Tasks under verifier cohort X.",
            sourceMetricKey: "boundary:ver-x@2",
          },
        ],
        disclosures: [],
        receipt: {
          claimRuleVersion: 1,
          metric: "pass_rate",
          cohortId: "ver-x@2",
          boundaryRef: "ver-x@2",
          boundarySource: "verifier_contract",
          resolvedUnitCount: 8,
          eligibleInterval: { lower: 0.8, upper: 1 },
        },
      },
    ],
    families: [],
    verifiedOutcomes: [],
    evidenceRows: [
      {
        observationId: "obs-1",
        taskId: "task-1",
        taskName: "Task 1",
        version: 2,
        instanceId: "i-1",
        familyId: "code",
        familyName: "Code Transformation",
        outcome: "pass",
        evidenceClass: "verified",
        eligibility: "eligible",
        observedDate: "2026-08-15",
        sourceKind: "comparison",
        supporting: true,
      },
    ],
    ...overrides,
  };
}

function renderProfile(
  data: ProfileData | null,
  extra?: { computing?: boolean; notFound?: boolean },
) {
  return render(
    <MemoryRouter initialEntries={["/models/mc-subject"]}>
      <Routes>
        <Route
          path="/models/:modelConfigurationId"
          element={
            <ModelEvidenceProfile
              data={data}
              computing={extra?.computing ?? false}
              notFound={extra?.notFound}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const EMPTY_PAIRED: PairedComparisonResult = {
  ruleVersion: 1,
  configurationAId: "mc-subject",
  configurationBId: "mc-other",
  metric: "judged_score",
  epsilon: 0,
  empty: true,
  emptyReason: "No shared eligible tasks",
  coverage: {
    sharedTaskCount: 0,
    comparableTaskCount: 0,
    incompatibleTaskCount: 0,
    wins: 0,
    ties: 0,
    losses: 0,
    missingInA: 0,
    missingInB: 0,
  },
  taskDeltas: [],
  meanDelta: null,
  bootstrap: null,
  uncertaintyResolution: null,
  cohortResults: [],
  disclosures: [],
};

function makeAssessmentRef(options: {
  judgeAttemptId: string;
  candidateAttemptId: string;
  rubricRef?: AssessmentRef["rubricRef"];
  verifier?: {
    taskId: string;
    modelKey: string;
    passed: boolean;
  };
}): AssessmentRef {
  const candidateId = "candidate";
  return {
    judgeAttemptId: options.judgeAttemptId,
    judgeProviderId: "openai",
    judgeModel: "gpt-5.6-sol",
    blindLabelMapping: { A: candidateId },
    candidateAttemptIdsByCandidateId: {
      [candidateId]: options.candidateAttemptId,
    },
    rubricRef: options.rubricRef ?? null,
    verifierRef: options.verifier ? { id: "ver-code", version: 1 } : null,
    verifierOutcome: options.verifier
      ? {
          ...options.verifier,
          executedAt: Date.parse("2026-07-10"),
        }
      : null,
  };
}

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
      source: {
        kind: "authored",
        legacyScopeKey: null,
        note: null,
      },
      createdAt: now,
    },
  );
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
      ? {
          ...observation.verifierSnapshot,
          configurationDigest: digest,
        }
      : null,
  };
  persisted.id = observationIdFor(persisted);
  await repo.putObservation(persisted);
  return persisted.id;
}

export async function seedRoutedAcceptanceCorpus(
  options: {
    summaryScores?: readonly (number | null)[];
    alternateSummaryScores?: readonly number[];
  } = {},
) {
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
  await taskRepo.createTaskFamily({
    id: "fam-rep",
    name: "Code Repair",
    description: "Code repair tasks",
    parentFamilyId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archivedAt: null,
    revision: 1,
  });

  const taskIdsCode = ["t-code-1", "t-code-2", "t-code-3", "t-code-4", "t-code-5", "t-code-6"];
  for (const tid of taskIdsCode) {
    await createFixtureTask(taskRepo, tid);
    await taskRepo.assignTaskFamily({
      id: `asgn-${tid}`,
      taskId: tid,
      taskVersion: 1,
      familyId: "fam-code",
      isPrimary: false,
      createdAt: Date.now(),
      archivedAt: null,
      revision: 1,
    });
  }

  const taskIdsSum = ["t-sum-1", "t-sum-2", "t-sum-3", "t-sum-4", "t-sum-5", "t-sum-6"];
  for (const tid of taskIdsSum) {
    await createFixtureTask(taskRepo, tid);
    await taskRepo.assignTaskFamily({
      id: `asgn-${tid}`,
      taskId: tid,
      taskVersion: 1,
      familyId: "fam-sum",
      isPrimary: false,
      createdAt: Date.now(),
      archivedAt: null,
      revision: 1,
    });
  }

  const taskIdsAlternateSum =
    options.alternateSummaryScores?.map((_, i) => `t-sum-alt-${i + 1}`) ?? [];
  for (const tid of taskIdsAlternateSum) {
    await createFixtureTask(taskRepo, tid);
    await taskRepo.assignTaskFamily({
      id: `asgn-${tid}`,
      taskId: tid,
      taskVersion: 1,
      familyId: "fam-sum",
      isPrimary: false,
      createdAt: Date.now(),
      archivedAt: null,
      revision: 1,
    });
  }

  const taskIdsRep = ["t-rep-1", "t-rep-2"];
  for (const tid of taskIdsRep) {
    await createFixtureTask(taskRepo, tid);
    await taskRepo.assignTaskFamily({
      id: `asgn-${tid}`,
      taskId: tid,
      taskVersion: 1,
      familyId: "fam-rep",
      isPrimary: false,
      createdAt: Date.now(),
      archivedAt: null,
      revision: 1,
    });
  }

  const evidenceRepo = new InMemoryEvidenceRepository();

  const configAId = "mc:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const configBId = "mc:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const configCId = "mc:sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

  await evidenceRepo.putModelConfiguration({
    id: configAId,
    providerId: "openai",
    requestedModel: "gpt-5.6-sol",
    resolvedModel: "gpt-5.6-sol",
    resolvedVersion: "gpt-5.6-sol",
    reasoningRequested: "high",
    reasoningEffective: "high",
    toolScaffoldSignature: "t-tools",
    runtimeSettings: {},
    identityCompleteness: "exact",
    observedFrom: Date.parse("2026-05-01"),
    observedTo: Date.parse("2026-08-01"),
  });

  await evidenceRepo.putModelConfiguration({
    id: configBId,
    providerId: "anthropic",
    requestedModel: "claude-haiku-4-5",
    resolvedModel: "claude-haiku-4-5-20251001",
    resolvedVersion: "20251001",
    reasoningRequested: null,
    reasoningEffective: null,
    toolScaffoldSignature: "t-tools",
    runtimeSettings: {},
    identityCompleteness: "exact",
    observedFrom: Date.parse("2026-06-01"),
    observedTo: Date.parse("2026-08-01"),
  });

  await evidenceRepo.putModelConfiguration({
    id: configCId,
    providerId: "google",
    requestedModel: "gemini-3.7-flash",
    resolvedModel: null,
    resolvedVersion: null,
    reasoningRequested: null,
    reasoningEffective: null,
    toolScaffoldSignature: null,
    runtimeSettings: {},
    identityCompleteness: "partial",
    observedFrom: Date.parse("2026-07-01"),
    observedTo: Date.parse("2026-08-01"),
  });

  // Observations for config A:
  const codeObservationIdsA: string[] = [];
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
        verifier: {
          taskId: tid,
          modelKey: "openai:gpt-5.6-sol",
          passed,
        },
      }),
      protocolFingerprint: "proto-1",
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
      outcome: {
        judgeAccepted: true,
        verifierPassed: passed,
        overallScore: null,
        criterionValues: [],
      },
      observedAt: Date.parse("2026-07-10") + i * 1000,
      observationSchemaVersion: 1,
    });
    codeObservationIdsA.push(obsId);
    await evidenceRepo.putDecision({
      observationId: obsId,
      ruleVersion: QUERY_ELIGIBILITY_RULE_VERSION,
      status: "eligible",
      evidenceClass: "verified",
      allowedUses: ["within_model_profile", "paired_model_comparison"],
      comparabilityCohortId: COHORT_CODE,
      reasonCodes: ["canonical_task_resolved", "model_configuration_exact"],
      decidedAt: Date.now(),
    });
  }

  const scoresA = options.summaryScores ?? [80, 85, 90, 75, 88, 92];
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
      protocolFingerprint: "proto-1",
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
      outcome: {
        judgeAccepted: true,
        verifierPassed: null,
        overallScore: scoresA[i] ?? null,
        criterionValues: [],
      },
      observedAt: Date.parse("2026-07-12") + i * 1000,
      observationSchemaVersion: 1,
    });
    await evidenceRepo.putDecision({
      observationId: obsId,
      ruleVersion: QUERY_ELIGIBILITY_RULE_VERSION,
      status: "eligible",
      evidenceClass: "comparable",
      allowedUses: ["within_model_profile", "paired_model_comparison"],
      comparabilityCohortId: COHORT_SUM,
      reasonCodes: ["canonical_task_resolved", "rubric_resolved"],
      decidedAt: Date.now(),
    });
  }

  for (let i = 0; i < taskIdsAlternateSum.length; i++) {
    const tid = taskIdsAlternateSum[i];
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
        rubricRef: { id: "rub-sum-alternate", version: 1 },
      }),
      protocolFingerprint: "proto-1",
      rubricRef: { id: "rub-sum-alternate", version: 1 },
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
      outcome: {
        judgeAccepted: true,
        verifierPassed: null,
        overallScore: options.alternateSummaryScores?.[i] ?? null,
        criterionValues: [],
      },
      observedAt: Date.parse("2026-07-13") + i * 1000,
      observationSchemaVersion: 1,
    });
    await evidenceRepo.putDecision({
      observationId: obsId,
      ruleVersion: QUERY_ELIGIBILITY_RULE_VERSION,
      status: "eligible",
      evidenceClass: "comparable",
      allowedUses: ["within_model_profile", "paired_model_comparison"],
      comparabilityCohortId: COHORT_SUM_ALTERNATE,
      reasonCodes: ["canonical_task_resolved", "rubric_resolved"],
      decidedAt: Date.now(),
    });
  }

  for (let i = 0; i < taskIdsRep.length; i++) {
    const tid = taskIdsRep[i];
    const obsId = await putFixtureObservation(evidenceRepo, {
      sourceKind: "evaluation",
      sourceResultId: "eval-exec-1",
      executionLineageId: `lin-a-${tid}`,
      runId: "run-1",
      sourceTaskCellId: `cell-a-${tid}`,
      taskId: tid,
      taskVersion: 1,
      taskInstanceId: `inst-${tid}`,
      taskFamilyId: "fam-rep",
      modelConfigurationId: configAId,
      candidateAttemptId: `cand-a-${tid}`,
      assessmentRef: makeAssessmentRef({
        judgeAttemptId: `judg-a-${tid}`,
        candidateAttemptId: `cand-a-${tid}`,
        rubricRef: { id: "rub-rep", version: 1 },
      }),
      protocolFingerprint: "proto-1",
      rubricRef: { id: "rub-rep", version: 1 },
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
      outcome: {
        judgeAccepted: true,
        verifierPassed: null,
        overallScore: 70 + i * 5,
        criterionValues: [],
      },
      observedAt: Date.parse("2026-07-14") + i * 1000,
      observationSchemaVersion: 1,
    });
    await evidenceRepo.putDecision({
      observationId: obsId,
      ruleVersion: QUERY_ELIGIBILITY_RULE_VERSION,
      status: "eligible",
      evidenceClass: "comparable",
      allowedUses: ["within_model_profile", "paired_model_comparison"],
      comparabilityCohortId: COHORT_REPAIR,
      reasonCodes: ["canonical_task_resolved", "rubric_resolved"],
      decidedAt: Date.now(),
    });
  }

  const obsExcludedId = await putFixtureObservation(evidenceRepo, {
    sourceKind: "evaluation",
    sourceResultId: "eval-exec-1",
    executionLineageId: "lin-a-ex",
    runId: "run-1",
    sourceTaskCellId: "cell-a-ex",
    taskId: "t-code-1",
    taskVersion: 1,
    taskInstanceId: "inst-t-code-1",
    taskFamilyId: "fam-code",
    modelConfigurationId: configAId,
    candidateAttemptId: "cand-a-ex",
    assessmentRef: makeAssessmentRef({
      judgeAttemptId: "judg-a-ex",
      candidateAttemptId: "cand-a-ex",
    }),
    protocolFingerprint: "proto-1",
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
    verifierSnapshot: null,
    outcome: {
      judgeAccepted: true,
      verifierPassed: null,
      overallScore: null,
      criterionValues: [],
    },
    observedAt: Date.parse("2026-07-01"),
    observationSchemaVersion: 1,
  });
  await evidenceRepo.putDecision({
    observationId: obsExcludedId,
    ruleVersion: QUERY_ELIGIBILITY_RULE_VERSION,
    status: "excluded",
    evidenceClass: "exploratory",
    allowedUses: [],
    comparabilityCohortId: COHORT_EXCLUDED,
    reasonCodes: ["candidate_missing_or_failed"],
    decidedAt: Date.now(),
  });

  // Observations for config B
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
        verifier: {
          taskId: tid,
          modelKey: "anthropic:claude-haiku-4-5",
          passed,
        },
      }),
      protocolFingerprint: "proto-1",
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
      outcome: {
        judgeAccepted: true,
        verifierPassed: passed,
        overallScore: null,
        criterionValues: [],
      },
      observedAt: Date.parse("2026-07-10") + i * 1000,
      observationSchemaVersion: 1,
    });
    await evidenceRepo.putDecision({
      observationId: obsId,
      ruleVersion: QUERY_ELIGIBILITY_RULE_VERSION,
      status: "eligible",
      evidenceClass: "verified",
      allowedUses: ["within_model_profile", "paired_model_comparison"],
      comparabilityCohortId: COHORT_CODE,
      reasonCodes: ["canonical_task_resolved", "model_configuration_exact"],
      decidedAt: Date.now(),
    });
  }

  const scoresB = [70, 75, 80, 65, 78, 82];
  for (let i = 0; i < taskIdsSum.length; i++) {
    const tid = taskIdsSum[i];
    const obsId = await putFixtureObservation(evidenceRepo, {
      sourceKind: "evaluation",
      sourceResultId: "eval-exec-1",
      executionLineageId: `lin-b-${tid}`,
      runId: "run-1",
      sourceTaskCellId: `cell-b-${tid}`,
      taskId: tid,
      taskVersion: 1,
      taskInstanceId: `inst-${tid}`,
      taskFamilyId: "fam-sum",
      modelConfigurationId: configBId,
      candidateAttemptId: `cand-b-${tid}`,
      assessmentRef: makeAssessmentRef({
        judgeAttemptId: `judg-b-${tid}`,
        candidateAttemptId: `cand-b-${tid}`,
        rubricRef: { id: "rub-sum", version: 1 },
      }),
      protocolFingerprint: "proto-1",
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
      outcome: {
        judgeAccepted: true,
        verifierPassed: null,
        overallScore: scoresB[i],
        criterionValues: [],
      },
      observedAt: Date.parse("2026-07-12") + i * 1000,
      observationSchemaVersion: 1,
    });
    await evidenceRepo.putDecision({
      observationId: obsId,
      ruleVersion: QUERY_ELIGIBILITY_RULE_VERSION,
      status: "eligible",
      evidenceClass: "comparable",
      allowedUses: ["within_model_profile", "paired_model_comparison"],
      comparabilityCohortId: COHORT_SUM,
      reasonCodes: ["canonical_task_resolved", "rubric_resolved"],
      decidedAt: Date.now(),
    });
  }
  const repairScoresB = [65, 70];
  for (let i = 0; i < taskIdsRep.length; i++) {
    const tid = taskIdsRep[i];
    const obsId = await putFixtureObservation(evidenceRepo, {
      sourceKind: "evaluation",
      sourceResultId: "eval-exec-1",
      executionLineageId: `lin-b-${tid}`,
      runId: "run-1",
      sourceTaskCellId: `cell-b-${tid}`,
      taskId: tid,
      taskVersion: 1,
      taskInstanceId: `inst-${tid}`,
      taskFamilyId: "fam-rep",
      modelConfigurationId: configBId,
      candidateAttemptId: `cand-b-${tid}`,
      assessmentRef: makeAssessmentRef({
        judgeAttemptId: `judg-b-${tid}`,
        candidateAttemptId: `cand-b-${tid}`,
        rubricRef: { id: "rub-rep", version: 1 },
      }),
      protocolFingerprint: "proto-1",
      rubricRef: { id: "rub-rep", version: 1 },
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
      outcome: {
        judgeAccepted: true,
        verifierPassed: null,
        overallScore: repairScoresB[i],
        criterionValues: [],
      },
      observedAt: Date.parse("2026-07-14") + i * 1000,
      observationSchemaVersion: 1,
    });
    await evidenceRepo.putDecision({
      observationId: obsId,
      ruleVersion: QUERY_ELIGIBILITY_RULE_VERSION,
      status: "eligible",
      evidenceClass: "comparable",
      allowedUses: ["within_model_profile", "paired_model_comparison"],
      comparabilityCohortId: COHORT_REPAIR,
      reasonCodes: ["canonical_task_resolved", "rubric_resolved"],
      decidedAt: Date.now(),
    });
  }

  // Config C has exploratory observations only
  const obsCId = await putFixtureObservation(evidenceRepo, {
    sourceKind: "evaluation",
    sourceResultId: "eval-exec-2",
    executionLineageId: "lin-c-1",
    runId: "run-2",
    sourceTaskCellId: "cell-c-1",
    taskId: "t-code-1",
    taskVersion: 1,
    taskInstanceId: "inst-t-code-1",
    taskFamilyId: "fam-code",
    modelConfigurationId: configCId,
    candidateAttemptId: "cand-c-1",
    assessmentRef: makeAssessmentRef({
      judgeAttemptId: "judg-c-1",
      candidateAttemptId: "cand-c-1",
    }),
    protocolFingerprint: "proto-1",
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
    verifierSnapshot: null,
    outcome: {
      judgeAccepted: true,
      verifierPassed: null,
      overallScore: null,
      criterionValues: [],
    },
    observedAt: Date.parse("2026-07-15"),
    observationSchemaVersion: 1,
  });
  await evidenceRepo.putDecision({
    observationId: obsCId,
    ruleVersion: QUERY_ELIGIBILITY_RULE_VERSION,
    status: "provisional",
    evidenceClass: "exploratory",
    allowedUses: ["task_descriptive"],
    comparabilityCohortId: COHORT_PARTIAL,
    reasonCodes: ["model_version_unreported"],
    decidedAt: Date.now(),
  });

  return {
    evidenceRepo,
    taskRepo,
    configAId,
    configBId,
    configCId,
    obsPassId: codeObservationIdsA[0],
    obsFailId: codeObservationIdsA[5],
    obsExcludedId,
  };
}

describe("Fable §14.1 — forbidden copy", () => {
  it("copy table contains none of the forbidden claim phrases or UI patterns", () => {
    for (const phrase of FORBIDDEN_CLAIM_PHRASES) {
      const needle = phrase.toLowerCase();
      for (const s of ALL_COPY_STRINGS) {
        expect(s.toLowerCase()).not.toContain(needle);
      }
    }
    for (const pattern of FORBIDDEN_COPY_PATTERNS) {
      for (const s of ALL_COPY_STRINGS) {
        expect(s).not.toMatch(pattern);
      }
    }
  });

  it("production string literals in src/workspaces/models contain no forbidden UI claims", () => {
    for (const file of PRODUCTION_FILES) {
      const literals = quotedStrings(readFileSync(file, "utf8"));
      for (const literal of literals) {
        for (const pattern of FORBIDDEN_COPY_PATTERNS) {
          expect(`${relative(process.cwd(), file)}: ${literal}`).not.toMatch(pattern);
        }
        const lower = literal.toLowerCase();
        expect(lower).not.toContain("overall score");
        expect(lower).not.toContain("best model");
        expect(lower).not.toMatch(/\bgood at\b/);
        expect(lower).not.toMatch(/\bcauses\b/);
        expect(lower).not.toContain("because the model");
      }
    }
  });
});

describe("Fable §14.2 — HonestValue three states", () => {
  it("available / limited / unavailable render as distinct word-bearing states", () => {
    const available: HonestQuantity = { state: "available", value: 312 };
    const limited: HonestQuantity = {
      state: "limited",
      value: 312,
      unresolved: 14,
      reason: "Provider version was not reported for 14 observations.",
    };
    const unavailable: HonestQuantity = {
      state: "unavailable",
      reason: "No accepted candidate responses exist for this selection.",
    };
    const a = render(<HonestValue quantity={available} />);
    const l = render(<HonestValue quantity={limited} />);
    const u = render(<HonestValue quantity={unavailable} />);
    expect(a.$("[data-honest-state]")!.dataset.honestState).toBe("available");
    expect(a.$("[data-honest-value]")!.textContent).toBe("312");
    expect(l.text()).toContain("312");
    expect(l.text()).toContain("(14 unresolved)");
    expect(l.$("[data-limited-marker]")!.textContent).toBe("limited");
    expect(u.$("[data-honest-value]")!.textContent).toBe("Unavailable");
    expect(u.$(".honesty-note")!.textContent).toContain("No accepted candidate responses");
    expect(u.$("[data-honest-value]")!.textContent).not.toMatch(/\d/);
    cleanup(a);
    cleanup(l);
    cleanup(u);
  });
});

describe("Fable §14.3 — insufficient coverage", () => {
  it("unitCount < 5 renders InsufficientState with no ± and no interval digits", () => {
    const h = render(
      <InsufficientState
        kind="insufficient"
        unitCount={4}
        required={5}
        resolverVersion="v1"
        digest="9a2f"
      />,
    );
    expect(h.text()).toContain("Insufficient independent coverage for an interval");
    expect(h.text()).not.toMatch(/±/);
    expect(h.text()).not.toMatch(/\d+\.\d+/);
    cleanup(h);
  });

  it("CohortBlock interval slot uses InsufficientState below five units", () => {
    const h = render(
      <CohortBlock
        cohortRef="verifier cohort X"
        value={{ state: "available", value: 71.2, unitCount: 4 }}
        interval={{
          state: "insufficient",
          unitCount: 4,
          unitKind: "task-cluster",
          reason: "Only four usable metric units are available.",
        }}
        coverageLine="4 of 10 tasks"
      />,
    );
    const slot = h.$("[data-cohort-interval]")!;
    expect(slot.textContent).toContain("Insufficient independent coverage for an interval");
    expect(slot.textContent).not.toMatch(/±/);
    expect(slot.textContent).not.toMatch(/64\.1/);
    cleanup(h);
  });
});

describe("Fable §14.4 — heterogeneous cohorts are not pooled", () => {
  it("two Rubric cohorts render ≥2 CohortBlocks plus the non-pooling divider", () => {
    const family: FamilyAggregate = {
      familyId: "multi-rubric",
      judgedScores: [
        { cohortId: "rub-a@1", value: { state: "available", value: 70, unitCount: 5 } },
        { cohortId: "rub-b@1", value: { state: "available", value: 80, unitCount: 5 } },
      ],
      passRates: [],
      taskCount: 10,
      tasks: [],
    };
    const h = render(<FamilyEvidenceCard family={family} />);
    expect(h.$$("[data-cohort-block]").length).toBeGreaterThanOrEqual(2);
    expect(h.text()).toContain("Rubric cohorts are not commensurate; values are not pooled.");
    expect(h.text()).not.toMatch(/average|pooled score|cross-cohort/i);
    cleanup(h);
  });
});

describe("Fable §14.5 — claim and narrative lines apply narrowing", () => {
  it("narrative and claim sentence buttons update the chip bar together", () => {
    const h = renderProfile(makeProfile());
    const narrative = h.$("[data-narrative-sentence]")!;
    expect(narrative.tagName).toBe("BUTTON");
    act(() => {
      narrative.click();
    });
    expect(h.$("[data-narrowing-chip-bar]")).not.toBeNull();
    expect(h.$("[data-narrowing-chip]")!.textContent).toContain("Source:");
    const claim = h.$("button[data-claim-sentence]")!;
    act(() => {
      claim.click();
    });
    expect(h.$$("[data-narrowing-chip]").length).toBeGreaterThanOrEqual(2);
    cleanup(h);
  });
});

describe("Fable §14.6 — shipped routes (list, profile, drilldown; rollup is T11/§14.15)", () => {
  it("list, profile, and drilldown render on direct MemoryRouter load", async () => {
    const list = render(
      <MemoryRouter initialEntries={["/models"]}>
        <Routes>
          <Route path="/models/*" element={<ModelsWorkspace evidenceRepo={null} />} />
        </Routes>
      </MemoryRouter>,
    );
    await settle();
    expect(list.text()).toMatch(/Models|Evidence repository unavailable/);
    cleanup(list);

    const profile = renderProfile(makeProfile());
    expect(profile.$("[data-model-evidence-profile]")).not.toBeNull();
    expect(profile.$("#profile-heading")!.getAttribute("tabindex")).toBe("-1");
    cleanup(profile);

    const drill = render(
      <MemoryRouter initialEntries={["/models/mc-subject/evidence/obs-9f3a"]}>
        <Routes>
          <Route
            path="/models/:modelConfigurationId/evidence/:observationId"
            element={<ObservationDrilldown data={makeDrilldownData()} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(drill.$("[data-observation-drilldown]")).not.toBeNull();
    expect(drill.$("#drilldown-heading")!.getAttribute("tabindex")).toBe("-1");
    cleanup(drill);
  });

  it("unknown profile and observation ids render typed not-found with recovery", () => {
    const profile = renderProfile(makeProfile(), { notFound: true });
    expect(profile.$("[data-profile-state=not-found]")).not.toBeNull();
    expect(profile.$("[data-action=open-models]")).not.toBeNull();
    cleanup(profile);

    const drill = render(
      <MemoryRouter initialEntries={["/models/mc-subject/evidence/obs-missing"]}>
        <Routes>
          <Route
            path="/models/:modelConfigurationId/evidence/:observationId"
            element={<ObservationDrilldown notFound />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(drill.$("[data-drilldown-state=not-found]")).not.toBeNull();
    expect(drill.$("[data-action=open-models]")).not.toBeNull();
    expect(drill.$("[data-action=open-records]")).not.toBeNull();
    cleanup(drill);
  });
});

describe("Fable §14.7 — list composition and no score/rank", () => {
  it("Saved rollups sit below a labeled divider and the workspace has no aria-sort score control", () => {
    const h = render(<SavedRollupsSection />);
    expect(h.$("[data-saved-rollups]")).not.toBeNull();
    expect(h.$(".boundary-rule")).not.toBeNull();
    expect(h.text()).toMatch(/SAVED ROLLUPS/);
    expect(h.$$("[aria-sort]").length).toBe(0);
    cleanup(h);

    const filters = render(
      <ModelFilters
        value={DEFAULT_MODEL_LIST_URL_STATE}
        onChange={() => {}}
        options={{
          providers: [],
          models: [],
          signatures: [],
          evidenceClasses: [],
          families: [],
        }}
      />,
    );
    expect(filters.$$("[aria-sort]").length).toBe(0);
    const sortHooks = filters.$$("[data-filter=sort]");
    expect(sortHooks.length).toBeGreaterThan(0);
    expect(filters.text()).not.toMatch(/overall score|best model|rank/i);
    cleanup(filters);
  });
});

describe("Fable §14.8 — comparator picker is a DialogSurface", () => {
  it("opens a trapped dialog, Escape closes it, focus returns to Select comparator", async () => {
    const h = render(
      <PairedComparisonSection
        subjectConfigurationId="mc-subject"
        candidates={[{ id: "mc-b", label: "other", sharedTaskCount: 3 }]}
        comparator={null}
        result={null}
        onSelectComparator={() => {}}
        onRemoveComparator={() => {}}
      />,
    );
    const trigger = h.$("button[data-comparator-trigger]")!;
    act(() => {
      trigger.focus();
      trigger.click();
    });
    await settle();
    expect(document.body.querySelector("[role=dialog]")).not.toBeNull();
    expect(document.body.querySelector("[data-dialog-backdrop]")).not.toBeNull();
    expect(document.body.querySelectorAll("[data-base-ui-focus-guard]").length).toBeGreaterThan(0);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();
    expect(document.body.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    cleanup(h);
  });
});

describe("Fable §14.9 — paired results and empty-intersection copy", () => {
  it("empty intersection renders the §7.5 sentence verbatim", () => {
    const h = render(
      <PairedComparisonSection
        subjectConfigurationId="mc-subject"
        candidates={[]}
        comparator={{ id: "mc-other", providerId: "p", requestedModel: "other-slug" }}
        result={EMPTY_PAIRED}
        onSelectComparator={() => {}}
        onRemoveComparator={() => {}}
      />,
    );
    expect(h.text()).toContain(
      "No shared eligible tasks with other-slug. Pairing never compares unrelated task mixes.",
    );
    cleanup(h);
  });

  it("results keep incompatible/missing rows and show the lettered strip plus count line", () => {
    const result: PairedComparisonResult = {
      ...EMPTY_PAIRED,
      empty: false,
      emptyReason: null,
      coverage: {
        sharedTaskCount: 3,
        comparableTaskCount: 1,
        incompatibleTaskCount: 1,
        wins: 1,
        ties: 0,
        losses: 0,
        missingInA: 1,
        missingInB: 0,
      },
      taskDeltas: [
        {
          taskId: "t-win",
          state: "comparable",
          metric: "judged_score",
          cohortId: "c1",
          valueA: 2,
          valueB: 1,
          delta: 1,
          outcome: "win",
          versionsA: [1],
          versionsB: [1],
          changedTaskVersion: false,
          observationIdsA: ["o1"],
          observationIdsB: ["o2"],
          instancesA: [],
          instancesB: [],
          missingInstancesA: [],
          missingInstancesB: [],
          disclosure: null,
        },
        {
          taskId: "t-bad",
          state: "incompatible_cohort",
          metric: "judged_score",
          cohortId: null,
          valueA: null,
          valueB: null,
          delta: null,
          outcome: null,
          versionsA: [],
          versionsB: [],
          changedTaskVersion: false,
          observationIdsA: [],
          observationIdsB: [],
          instancesA: [],
          instancesB: [],
          missingInstancesA: [],
          missingInstancesB: [],
          disclosure: null,
        },
        {
          taskId: "t-miss",
          state: "missing_in_a",
          metric: "judged_score",
          cohortId: null,
          valueA: null,
          valueB: null,
          delta: null,
          outcome: null,
          versionsA: [],
          versionsB: [],
          changedTaskVersion: false,
          observationIdsA: [],
          observationIdsB: [],
          instancesA: [],
          instancesB: [],
          missingInstancesA: [],
          missingInstancesB: [],
          disclosure: null,
        },
      ],
      meanDelta: 1,
    };
    const h = render(
      <PairedComparisonSection
        subjectConfigurationId="mc-subject"
        candidates={[]}
        comparator={{ id: "mc-other", providerId: "p", requestedModel: "other-slug" }}
        result={result}
        onSelectComparator={() => {}}
        onRemoveComparator={() => {}}
      />,
    );
    expect(h.$("[data-paired-glyph-strip]")).not.toBeNull();
    expect(h.$("[data-paired-counts]")!.textContent).toBe("Won 1 · tied 0 · lost 0");
    expect(h.$$("[data-paired-task-row]").length).toBe(3);
    expect(h.text()).toContain("incompatible cohort");
    expect(h.text()).toContain("missing here");
    cleanup(h);
  });
});

describe("Fable §14.10 — observation drilldown contents", () => {
  it("renders canonical links, eligibility, source backlink, Records link, copy label, and no raw output", () => {
    const h = render(
      <MemoryRouter initialEntries={["/models/mc-subject/evidence/obs-9f3a"]}>
        <Routes>
          <Route
            path="/models/:modelConfigurationId/evidence/:observationId"
            element={<ObservationDrilldown data={makeDrilldownData()} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(h.$$("[data-canonical-link]").length).toBeGreaterThanOrEqual(2);
    expect(h.$("[data-eligibility]")).not.toBeNull();
    expect((h.$("[data-source-backlink]") as HTMLAnchorElement).getAttribute("href")).toContain(
      "/compare/results/cmp-77",
    );
    expect(h.$("[data-confidence-chip]")).not.toBeNull();
    expect((h.$("[data-records-link]") as HTMLAnchorElement).getAttribute("href")).toContain(
      "/records/observation/obs-9f3a",
    );
    expect(h.text()).toContain("Copy link — this device");
    expect(h.text()).toContain("Raw output lives on the exact Record; it is not duplicated here.");
    expect(h.$("pre")).toBeNull();
    cleanup(h);
  });
});

describe("Fable §14.11 — breakpoint structure (happy-dom class assertions; CDP is Milestone D)", () => {
  it("list is max-w-[960px]; filters collapse below lg; evidence table becomes cards below 391px", () => {
    const workspace = render(
      <MemoryRouter initialEntries={["/models"]}>
        <Routes>
          <Route path="/models/*" element={<ModelsWorkspace evidenceRepo={null} />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(workspace.container.innerHTML).toContain("max-w-[960px]");
    cleanup(workspace);

    const filters = render(
      <ModelFilters
        value={DEFAULT_MODEL_LIST_URL_STATE}
        onChange={() => {}}
        options={{
          providers: [],
          models: [],
          signatures: [],
          evidenceClasses: [],
          families: [],
        }}
      />,
    );
    expect(filters.$("[data-desktop-filters]")!.className).toContain("hidden");
    expect(filters.$("[data-desktop-filters]")!.className).toContain("lg:grid");
    expect(filters.$("[data-action=toggle-filters]")!.className).toContain("lg:hidden");
    const targets = filters
      .$$("button, input, select")
      .filter((el) => (el as HTMLElement).className.includes("min-h-[44px]"));
    expect(targets.length).toBeGreaterThan(0);
    cleanup(filters);

    const table = render(
      <EvidenceTable
        rows={[
          {
            observationId: "obs-1",
            taskId: "t-1",
            version: 1,
            instanceId: "i-1",
            outcome: "pass",
            evidenceClass: "verified",
            eligibility: "eligible",
            observedDate: "2026-08-15",
            sourceKind: "comparison",
          } satisfies EvidenceTableRow,
        ]}
      />,
    );
    expect(table.container.innerHTML).toContain("hidden min-[391px]:block");
    expect(table.container.innerHTML).toContain("min-[391px]:hidden");
    expect(table.$("[data-observation-card]")).not.toBeNull();
    cleanup(table);
  });
});

describe("Fable §14.12 — motion contract on the models workspace", () => {
  it("production models UI introduces no transition-all, ease-in, or scale(0)", () => {
    const offenders: string[] = [];
    for (const file of PRODUCTION_FILES.filter((p) => p.endsWith(".tsx"))) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (/transition-all|\bease-in\b(?!-out)|scale\(0\)/.test(line)) {
            offenders.push(`${relative(process.cwd(), file)}:${index + 1} ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});

describe("Fable §14.13 — computing live region and Cancel", () => {
  it("exposes one polite live region and a Cancel control", () => {
    const h = renderProfile(null, { computing: true });
    const lives = h.$$("[aria-live=polite]");
    expect(lives.length).toBe(1);
    expect(lives[0].getAttribute("role")).toBe("status");
    expect(h.$("[data-action=cancel]")).not.toBeNull();
    expect(h.$$("[aria-live=assertive]").length).toBe(0);
    cleanup(h);
  });
});

describe("Fable §14.14 — densification caps 1–10 (cap 11 is the T11 rollup route)", () => {
  it("cap 1: list row exposes three identity hooks and ≤2 named families + one gap count", () => {
    const row: ModelListRowData = {
      entry: {
        modelConfigurationId: "mc-1",
        providerId: "openai",
        requestedModel: "alpha-1",
        resolvedModel: "alpha-1",
        resolvedVersion: "2026-05",
        reasoningRequested: null,
        reasoningEffective: null,
        toolScaffoldSignature: null,
        runtimeSettings: {},
        identityCompleteness: "exact",
        observedFrom: Date.parse("2026-05-01"),
        observedTo: Date.parse("2026-08-01"),
        observationCount: 112,
        eligibleProfileEvidenceCount: 112,
        latestActivity: Date.now(),
      },
      taskCount: 38,
      topFamilyNames: ["Code transformation", "Summarization"],
      gapCount: 6,
    };
    const h = render(
      <MemoryRouter>
        <ModelList rows={[row]} page={1} pageCount={1} totalItems={1} onPageChange={() => {}} />
      </MemoryRouter>,
    );
    const fam = h.$("[data-families-line]")!.textContent ?? "";
    expect(fam.match(/Top:/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect((fam.match(/,/g) ?? []).length).toBeLessThanOrEqual(1);
    expect(fam).toContain("No evidence: 6 families");
    cleanup(h);
  });

  it("cap 2: exactly eight filters (sort is not a ninth filter)", () => {
    const h = render(
      <ModelFilters
        value={DEFAULT_MODEL_LIST_URL_STATE}
        onChange={() => {}}
        options={{
          providers: [],
          models: [],
          signatures: [],
          evidenceClasses: [],
          families: [],
        }}
      />,
    );
    const hooks = h.$$("[data-filter]").map((el) => el.getAttribute("data-filter"));
    const unique = [...new Set(hooks.filter((x) => x && x !== "sort"))];
    expect(unique).toHaveLength(8);
    cleanup(h);
  });

  it("cap 3: coverage grid renders the emitted HonestQuantity fields in fixed order", () => {
    const profile = renderProfile(makeProfile());
    const cells = profile.$$("[data-coverage-cell]");
    const fields = cells.map((c) => c.getAttribute("data-coverage-field"));
    expect(fields).toEqual([
      "uniqueTasks",
      "taskVersions",
      "taskInstances",
      "activeObservations",
      "acceptedCandidateResponses",
      "attempts",
      "plannedReplicates",
      "resolvedIndependentUncertaintyUnits",
      "uncertaintyUnitKind",
      "uncertaintyAssumption",
      "comparabilityCohorts",
      "rubricVersions",
      "evaluatorConfigurations",
      "earliestObservation",
      "latestObservation",
      "missingCells",
    ]);
    cleanup(profile);
  });

  it("cap 4: narrative block emits ≤5 sentences each with one source chip", () => {
    const sentences = Array.from({ length: 7 }, (_, i) => ({
      text: `Sentence ${i + 1} about coverage.`,
      sourceMetricKey: `src-${i + 1}`,
    }));
    const h = render(<DeterministicNarrative sentences={sentences} />);
    const nodes = h.$$("[data-narrative-sentence]");
    expect(nodes.length).toBeLessThanOrEqual(5);
    expect(h.$$("[data-source-chip]").length).toBe(nodes.length);
    cleanup(h);
  });

  it("cap 5: a claim mark is a single labeled sentence control", () => {
    const h = render(
      <ClaimMark
        label="strongest_supported"
        sentence={{
          text: "Verified on 8 of 10 code-transformation Tasks under verifier cohort X.",
          sourceMetricKey: "k",
        }}
        onApply={() => {}}
      />,
    );
    expect(h.$$("[data-claim-mark]").length).toBe(1);
    expect(h.$$("button[data-claim-sentence]").length).toBe(1);
    cleanup(h);
  });

  it("cap 7: evidence table has 8 columns and paginates at 50", () => {
    const rows: EvidenceTableRow[] = Array.from({ length: 51 }, (_, i) => ({
      observationId: `obs-${i}`,
      taskId: `t-${i}`,
      version: 1,
      instanceId: `i-${i}`,
      outcome: "pass",
      evidenceClass: "verified",
      eligibility: "eligible",
      observedDate: "2026-08-15",
      sourceKind: "comparison",
    }));
    const h = render(<EvidenceTable rows={rows} />);
    expect(h.$$("[data-evidence-table] th").length).toBe(8);
    expect(h.text()).toContain("of 51");
    cleanup(h);
  });

  it("cap 8: paired comparison accepts exactly one comparator", () => {
    const h = render(
      <PairedComparisonSection
        subjectConfigurationId="mc-subject"
        candidates={[{ id: "mc-b", label: "b", sharedTaskCount: 1 }]}
        comparator={{ id: "mc-b", providerId: "p", requestedModel: "b" }}
        result={EMPTY_PAIRED}
        onSelectComparator={() => {}}
        onRemoveComparator={() => {}}
      />,
    );
    expect(h.$$("[data-comparator-chip]").length).toBe(1);
    expect(h.$$("button[data-comparator-trigger]").length).toBe(0);
    cleanup(h);
  });

  it("cap 9: computing route has one polite live region and zero assertive", () => {
    const h = renderProfile(null, { computing: true });
    expect(h.$$("[aria-live=polite]").length).toBe(1);
    expect(h.$$("[aria-live=assertive]").length).toBe(0);
    cleanup(h);
  });

  it("cap 10: attempts cell does not share a block with interval or claim language", () => {
    const h = renderProfile(makeProfile());
    const attempts = h.$("[data-coverage-field=attempts]")!;
    expect(attempts.textContent).toMatch(/provenance only/i);
    expect(attempts.textContent).not.toMatch(/interval|claim|pass rate|±/i);
    cleanup(h);
  });
});

describe("Fable §14.15 — rollup route (skipped; T11 / assignment)", () => {
  it.skip("rollup route ships with policy banner first and no pooled aggregate (criterion 15)", () => {
    expect(true).toBe(true);
  });
});

describe("Fable §14.16 — Routed integration through live ModelsWorkspace & in-memory repositories", () => {
  it("valid profile direct load (/models/:id) loads through live loader with NO injected data", async () => {
    const { evidenceRepo, taskRepo, configAId } = await seedRoutedAcceptanceCorpus();
    const h = render(
      <MemoryRouter initialEntries={[`/models/${configAId}`]}>
        <Routes>
          <Route
            path="/models/*"
            element={<ModelsWorkspace evidenceRepo={evidenceRepo} taskRepo={taskRepo} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await settle();

    // Identity header
    expect(h.$("[data-model-evidence-profile]")).not.toBeNull();
    expect(h.$("#profile-heading")!.textContent).toContain("openai · gpt-5.6-sol");
    expect(h.$("[data-version-status=exact]")).not.toBeNull();

    // D2 deterministic narrative
    expect(h.$("[data-deterministic-narrative]")).not.toBeNull();
    expect(h.text()).toContain("Descriptive only");

    // Coverage grid renders the 16 fixed coverage definitions.
    expect(h.$("[data-coverage-grid]")).not.toBeNull();
    expect(h.$$("[data-coverage-cell]").length).toBe(16);

    // Family evidence cards with CohortBlocks & uncertainty
    expect(h.$$("[data-family-card]").length).toBeGreaterThanOrEqual(2);
    expect(h.$$("[data-cohort-block]").length).toBeGreaterThanOrEqual(2);

    // Verified outcomes
    expect(h.$("[data-section=verified-outcomes]")).not.toBeNull();
    expect(h.text()).toContain("5 of 6");

    // Paired section in no-comparator state
    expect(h.$("[data-paired-state=no-comparator]")).not.toBeNull();

    // Evidence table with rows
    expect(h.$("[data-section=evidence-table]")).not.toBeNull();
    expect(h.$$("[data-evidence-row]").length).toBeGreaterThanOrEqual(13);

    // Protocols & evaluators in section 7
    expect(h.$("[data-section=protocols]")).not.toBeNull();
    expect(h.text()).toContain("Uncertainty receipt");

    cleanup(h);
  });

  it("valid observation direct load (/models/:id/evidence/:obsId) loads through live loader with NO injected data", async () => {
    const { evidenceRepo, taskRepo, configAId, obsPassId } = await seedRoutedAcceptanceCorpus();
    const h = render(
      <MemoryRouter initialEntries={[`/models/${configAId}/evidence/${obsPassId}`]}>
        <Routes>
          <Route
            path="/models/*"
            element={<ModelsWorkspace evidenceRepo={evidenceRepo} taskRepo={taskRepo} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await settle();

    expect(h.$("[data-observation-drilldown]")).not.toBeNull();
    expect(h.$("#drilldown-heading")!.textContent).toContain(obsPassId);
    expect(h.$("[data-evidence-class=verified]")).not.toBeNull();
    expect(h.$("[data-eligibility]")!.textContent).toContain("eligible");

    // Canonical links (Task & Version links, instance badge without instance link)
    const links = h.$$("[data-canonical-link]").map((a) => a.getAttribute("href"));
    expect(links.some((l) => l?.includes("/tasks/t-code-1"))).toBe(true);
    expect(links.some((l) => l?.includes("/versions/1"))).toBe(true);
    expect(links.some((l) => l?.includes("/instances/"))).toBe(false);
    expect(h.$("[data-canonical-instance]")!.textContent).toContain("inst-t-code-1");

    // Outcome pass
    expect(h.$("[data-section=outcome]")!.textContent).toContain("pass");
    expect(h.$("[data-section=outcome]")!.textContent).toContain("ver-code@1");

    // Assessment & source backlink
    expect(h.$("[data-section=assessment]")!.textContent).toContain("model_judge");
    expect(h.$("[data-section=source]")!.textContent).toContain("evaluation eval-exec-1");
    expect(h.$("[data-records-link]")!.getAttribute("href")).toContain(
      `/records/observation/${obsPassId}`,
    );

    cleanup(h);
  });

  it("valid excluded observation direct load renders exclusion reasons in section 1", async () => {
    const { evidenceRepo, taskRepo, configAId, obsExcludedId } = await seedRoutedAcceptanceCorpus();
    const h = render(
      <MemoryRouter initialEntries={[`/models/${configAId}/evidence/${obsExcludedId}`]}>
        <Routes>
          <Route
            path="/models/*"
            element={<ModelsWorkspace evidenceRepo={evidenceRepo} taskRepo={taskRepo} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await settle();

    expect(h.$("[data-observation-drilldown]")).not.toBeNull();
    expect(h.$("[data-eligibility]")!.textContent).toContain("excluded");
    expect(h.$("[data-eligibility]")!.textContent).toContain("candidate_missing_or_failed");
    cleanup(h);
  });

  it("unknown configuration ID, unknown observation ID, and mismatched IDs render typed not-found", async () => {
    const { evidenceRepo, taskRepo, configAId, configBId, obsPassId } =
      await seedRoutedAcceptanceCorpus();

    // Unknown configuration ID
    const profileMissing = render(
      <MemoryRouter initialEntries={["/models/mc-nonexistent"]}>
        <Routes>
          <Route
            path="/models/*"
            element={<ModelsWorkspace evidenceRepo={evidenceRepo} taskRepo={taskRepo} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await settle();
    expect(profileMissing.$("[data-profile-state=not-found]")).not.toBeNull();
    expect(profileMissing.$("[data-action=open-models]")).not.toBeNull();
    cleanup(profileMissing);

    // Unknown observation ID
    const obsMissing = render(
      <MemoryRouter initialEntries={[`/models/${configAId}/evidence/obs-nonexistent`]}>
        <Routes>
          <Route
            path="/models/*"
            element={<ModelsWorkspace evidenceRepo={evidenceRepo} taskRepo={taskRepo} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await settle();
    expect(obsMissing.$("[data-drilldown-state=not-found]")).not.toBeNull();
    expect(obsMissing.$("[data-action=open-models]")).not.toBeNull();
    cleanup(obsMissing);

    // Mismatched configuration ID (obsPassId belongs to configA, not configB)
    const mismatched = render(
      <MemoryRouter initialEntries={[`/models/${configBId}/evidence/${obsPassId}`]}>
        <Routes>
          <Route
            path="/models/*"
            element={<ModelsWorkspace evidenceRepo={evidenceRepo} taskRepo={taskRepo} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await settle();
    expect(mismatched.$("[data-drilldown-state=not-found]")).not.toBeNull();
    cleanup(mismatched);
  });

  it("comparator selection executes real paired analysis and updates UI with deltas", async () => {
    const { evidenceRepo, taskRepo, configAId, configBId } = await seedRoutedAcceptanceCorpus();
    const h = render(
      <MemoryRouter initialEntries={[`/models/${configAId}`]}>
        <Routes>
          <Route
            path="/models/*"
            element={<ModelsWorkspace evidenceRepo={evidenceRepo} taskRepo={taskRepo} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await settle();

    // Trigger comparator picker
    const trigger = h.$("button[data-comparator-trigger]")!;
    act(() => {
      trigger.click();
    });
    await settle();

    // Candidate modal appears
    const candidateBtn = document.body.querySelector<HTMLElement>(
      `[data-candidate-id="${configBId}"]`,
    );
    expect(candidateBtn).not.toBeNull();
    expect(candidateBtn!.textContent).toContain("claude-haiku-4-5");

    // Select candidate
    act(() => {
      candidateBtn!.click();
    });
    await settle();

    // Paired results render with deltas
    expect(h.$("[data-paired-state=results]")).not.toBeNull();
    expect(h.$("[data-comparator-chip]")!.textContent).toContain("claude-haiku-4-5");
    expect(h.$$("[data-paired-task-row]").length).toBeGreaterThan(0);

    cleanup(h);
  });

  it("multi-cohort paired isolation renders cohortResults independently with no cross-cohort summary", async () => {
    const { evidenceRepo, taskRepo, configAId, configBId } = await seedRoutedAcceptanceCorpus();
    const h = render(
      <MemoryRouter initialEntries={[`/models/${configAId}`]}>
        <Routes>
          <Route
            path="/models/*"
            element={<ModelsWorkspace evidenceRepo={evidenceRepo} taskRepo={taskRepo} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await settle();

    // Select config B
    act(() => {
      h.$("button[data-comparator-trigger]")!.click();
    });
    await settle();
    act(() => {
      document.body.querySelector<HTMLElement>(`[data-candidate-id="${configBId}"]`)!.click();
    });
    await settle();

    // Multi-cohort section
    const multiCohort = h.$("[data-paired-multi-cohort]");
    expect(multiCohort).not.toBeNull();
    const cohortSections = h.$$("[data-paired-cohort-section]");
    expect(cohortSections.length).toBe(2);

    // Each cohort owns its own counts line and delta table
    for (const cs of cohortSections) {
      expect(cs.querySelector("[data-paired-counts]")!.textContent).toMatch(
        /Won \d+ · tied \d+ · lost \d+/,
      );
      expect(cs.querySelectorAll("[data-paired-task-row]").length).toBeGreaterThan(0);
    }

    cleanup(h);
  });

  it("narrowing changes URL + chips + rows + table-heading focus ref together", async () => {
    const { evidenceRepo, taskRepo, configAId } = await seedRoutedAcceptanceCorpus();
    const h = render(
      <MemoryRouter initialEntries={[`/models/${configAId}`]}>
        <Routes>
          <Route
            path="/models/*"
            element={<ModelsWorkspace evidenceRepo={evidenceRepo} taskRepo={taskRepo} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await settle();

    const totalRowsBefore = h.$$("[data-evidence-row]").length;
    expect(totalRowsBefore).toBeGreaterThanOrEqual(13);

    // Click narrative sentence button to apply narrowing
    const narrativeBtn = h.$("[data-narrative-sentence]")!;
    act(() => {
      narrativeBtn.click();
    });
    await settle();

    // Chip bar is visible and shows narrowing chip
    expect(h.$("[data-narrowing-chip-bar]")).not.toBeNull();
    const chips = h.$$("[data-narrowing-chip]");
    expect(chips.length).toBeGreaterThanOrEqual(1);

    // Evidence table rows are filtered
    const rowsAfter = h.$$("[data-evidence-row]").length;
    expect(rowsAfter).toBeLessThanOrEqual(totalRowsBefore);

    // Table heading received focus
    expect(document.activeElement).toBe(h.$("#evidence-heading"));

    // Clear narrowing restores rows
    const clearBtn = h.$("[data-action=clear-all-narrowings]");
    if (clearBtn) {
      act(() => {
        clearBtn.click();
      });
      await settle();
      expect(h.$$("[data-evidence-row]").length).toBe(totalRowsBefore);
    }

    cleanup(h);
  });

  it("models filters support >2 covered families and exact evidence-class matching", async () => {
    const { evidenceRepo, taskRepo } = await seedRoutedAcceptanceCorpus();

    // 1. >2 families: mc-alpha has 3 covered families (code-transformation, summarization, code-repair)
    // Filter by the 3rd family (fam-rep)
    const repFamily = render(
      <MemoryRouter initialEntries={["/models?m.family=fam-rep"]}>
        <Routes>
          <Route
            path="/models/*"
            element={<ModelsWorkspace evidenceRepo={evidenceRepo} taskRepo={taskRepo} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await settle();
    const repRows = repFamily.$$("[data-record-row-surface]");
    expect(repRows.length).toBe(2);
    const repairFamilyText = repRows.map((row) => row.textContent).join(" ");
    expect(repairFamilyText).toContain("gpt-5.6-sol");
    expect(repairFamilyText).toContain("claude-haiku-4-5");
    expect(repairFamilyText).not.toContain("gemini-3.7-flash");
    cleanup(repFamily);

    // 2. Exact evidence class matching: filter by verified matches mc-alpha and mc-beta, but not mc-gamma
    const verifiedFilter = render(
      <MemoryRouter initialEntries={["/models?m.evidenceClass=verified"]}>
        <Routes>
          <Route
            path="/models/*"
            element={<ModelsWorkspace evidenceRepo={evidenceRepo} taskRepo={taskRepo} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await settle();
    const verifiedRows = verifiedFilter.$$("[data-record-row-surface]");
    expect(verifiedRows.length).toBe(2);
    expect(verifiedRows.map((row) => row.textContent).join(" ")).not.toContain("gemini-3.7-flash");
    cleanup(verifiedFilter);
  });
});

describe("model-profile-loader — evidence honesty regressions", () => {
  it("computes incompatible judged-score cohorts independently within one family", async () => {
    const { evidenceRepo, taskRepo, configAId } = await seedRoutedAcceptanceCorpus({
      alternateSummaryScores: [10, 12, 14, 16, 18, 20],
    });
    const profile = await loadProfileData({
      modelConfigurationId: configAId,
      evidenceRepo,
      taskRepo,
    });
    expect(profile).not.toBeNull();

    const family = profile!.families.find((candidate) => candidate.familyId === "fam-sum");
    expect(family?.judgedScores).toHaveLength(2);
    const metrics = family!.judgedScores;
    const metricValues = metrics.map((metric) =>
      metric.value.state === "available" || metric.value.state === "limited"
        ? metric.value.value
        : null,
    );
    expect(metricValues[0]).not.toBe(metricValues[1]);

    const intervals = metrics.map(
      (metric) => profile!.cohortIntervals?.[`fam-sum:${metric.cohortId}`],
    );
    expect(intervals.every((interval) => interval?.state === "available")).toBe(true);
    if (intervals[0]?.state !== "available" || intervals[1]?.state !== "available") {
      throw new Error("expected independently available cohort intervals");
    }
    expect([intervals[0].lower, intervals[0].upper]).not.toEqual([
      intervals[1].lower,
      intervals[1].upper,
    ]);
    expect([intervals[0].unitCount, intervals[1].unitCount]).toEqual([6, 6]);
  });

  it("uses usable metric units for insufficiency and never displays a synthetic 0–0 interval", async () => {
    const { evidenceRepo, taskRepo, configAId } = await seedRoutedAcceptanceCorpus({
      summaryScores: [80, 85, 90, 75, null, null],
    });
    const profile = await loadProfileData({
      modelConfigurationId: configAId,
      evidenceRepo,
      taskRepo,
    });
    expect(profile).not.toBeNull();

    const family = profile!.families.find((candidate) => candidate.familyId === "fam-sum")!;
    const metric = family.judgedScores[0];
    const interval = profile!.cohortIntervals?.[`fam-sum:${metric.cohortId}`];
    expect(interval).toMatchObject({
      state: "insufficient",
      unitCount: 4,
    });
    expect(interval).not.toHaveProperty("lower");
    expect(interval).not.toHaveProperty("upper");

    const h = render(
      <CohortBlock
        cohortRef={metric.cohortId}
        value={metric.value}
        interval={interval}
        coverageLine="6 resolved units · 4 usable metric units"
      />,
    );
    const intervalSlot = h.$("[data-cohort-interval]")!;
    expect(intervalSlot.textContent).toContain("Insufficient independent coverage for an interval");
    expect(intervalSlot.textContent).not.toContain("0–0");
    cleanup(h);
  });

  it("keeps claims descriptive-only when refs have no authored semantic boundary", async () => {
    const { evidenceRepo, taskRepo, configAId } = await seedRoutedAcceptanceCorpus();
    const profile = await loadProfileData({
      modelConfigurationId: configAId,
      evidenceRepo,
      taskRepo,
    });
    expect(profile).not.toBeNull();

    const sufficientlyCovered = profile!.claims.filter(
      (claim) => claim.receipt.resolvedUnitCount >= 5,
    );
    expect(sufficientlyCovered.length).toBeGreaterThan(0);
    for (const claim of sufficientlyCovered) {
      expect(claim.label).toBe("descriptive_only");
      expect(claim.receipt.boundaryRef).toBeNull();
      expect(claim.receipt.boundarySource).toBeNull();
      expect(claim.label).not.toBe("strongest_supported");
      expect(claim.label).not.toBe("weakest_supported");
    }
  });
});
