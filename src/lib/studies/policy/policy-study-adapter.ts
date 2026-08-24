// =============================================================================
// RSemble AI — Policy Study adapter (spec §5, plan Task 6)
//
// Bridges the generic first-party study substrate (StudyRepository,
// LabAssetRepository, registered `policy` payload) to the proven staged
// methodology (stage A/B/C, pair-screening, MPID, holdout, pool-adequacy,
// recipe-sensitivity, confirmation, cost, retry/recovery, blindness, playbook)
// that lives in `src/lib/evaluations/fusion-*`.
//
// The methodology is REUSED, not rewritten: its pure stage functions and
// method-domain vocabulary (Fusion Recipe family, Fusion Result, stage
// results, headroom, MPID) stay intact. This adapter is the single `policy`
// registration seam that:
//   - projects reusable Lab assets (LabRecipeVersion, ModelPoolVersion) into
//     the method-domain types the methodology expects;
//   - enforces the registered-payload boundary so unknown kinds / schema
//     versions are rejected BEFORE any provider call;
//   - maps the methodology's Fusion Playbook output back into the generic
//     PolicyReportPayload persisted by StudyRepository;
//   - drives the generic study lifecycle (create draft → start → seal with a
//     playbook) through StudyRepository, so Policy Studies own their trials,
//     observations, and playbook on the canonical Lab stores.
//
// "Fusion" remains a method term (Fusion Recipe, Fusion Result, recipe
// family). "Fusion Study" as an ownership concept is gone — the study is a
// Policy Study (`kind: "policy"`) that tests fusion as one of four policies.
// =============================================================================
import type { CriticRef } from "../../providers/types";
import type { ModelSlot } from "../../../studio-data";
import type { RubricSnapshot, EvaluationSuite } from "../../evaluations/evaluation-types";
import type { RunRecordV2 } from "../../persistence/run-types";
import type {
  FusionAttempt,
  FusionTrial,
  FusionPlaybook,
  FusionPlaybookRow,
  FusionRecipeRef,
  FusionRecipeVersion,
  FusionStudy,
  EvaluationObservation,
  FusionStudyKind,
  PoolAdequacyOutcome,
  PoolManifestRef,
  PoolManifestVersion,
  StageCResult,
  SuiteSnapshotRef,
} from "../../evaluations/fusion-study-types";
import {
  createFusionStudyController,
  type FusionPolicyExecutor,
} from "../../evaluations/fusion-study-controller";
import { runFusionStudy } from "../../evaluations/fusion-study-orchestration";
import { runConfirmationStudy as runMethodConfirmationStudy } from "../../evaluations/fusion-confirmation";
import { InMemoryFusionStudyRepository } from "../../persistence/fusion-study-repository";
import type { LabAssetRepository } from "../../persistence/lab-asset-repository";
import type { StudyRepository } from "../../persistence/study-repository";
import type { LabRecipeVersion } from "../lab-recipe-types";
import type { ModelPoolVersion } from "../model-pool-types";
import { getStudyTypeRegistration, isRegisteredStudyKind } from "../study-registry";
import { fingerprintStudyValue } from "../study-fingerprint";
import type { StudyAttempt, StudyArtifactRef } from "../study-types";
import type { EvaluationSourceResolver } from "../../evidence/derive-observations";
import { hashArtifactContent } from "../../evaluations/protocol-fingerprint";
import {
  POLICY_DEFINITION_SCHEMA_VERSION,
  POLICY_MEASUREMENT_SCHEMA_VERSION,
  POLICY_REPORT_SCHEMA_VERSION,
  POLICY_STUDY_KIND,
  POLICY_TRIAL_PAYLOAD_SCHEMA_VERSION,
  isPolicyStudyDefinition,
  policyStudyRegistration,
  type ExactModelConfigurationRef,
  type PolicyKind,
  type PolicyMeasurementPayload,
  type PolicyPlaybookRow,
  type PolicyRecommendation,
  type PolicyReportPayload,
  type PolicyStudyDefinition,
  type PolicyStudyObservation,
  type PolicyStudyRecord,
  type PolicyStudyTrial,
  type PolicyTrialPayload,
} from "./policy-study-types";

// --- Asset projections (Lab ↔ method) ----------------------------------------

/**
 * Project a stored Lab Recipe Version into the method-domain FusionRecipeVersion
 * the staged methodology consumes. The Lab asset carries canonicalPayload /
 * digest / kind / createdAt for content-addressing and tamper detection; the
 * methodology only needs the recipe-family / prompt / judge-analysis /
 * rubric-access / verification / synthesizer material fields. This is a pure,
 * lossless projection of those material fields.
 */
export function labRecipeToMethodRecipe(lab: LabRecipeVersion): FusionRecipeVersion {
  return {
    id: lab.recipeId,
    version: lab.version,
    recipeFamily: lab.recipeFamily,
    promptVersion: lab.promptVersion,
    judgeAnalysisMode: lab.judgeAnalysisMode,
    rubricAccess: lab.rubricAccess,
    verification: lab.verification,
    synthesizer: lab.synthesizer,
  };
}

/** A method-domain FusionRecipeRef from a stored Lab Recipe Version. */
export function labRecipeToMethodRef(lab: LabRecipeVersion): FusionRecipeRef {
  return { id: lab.recipeId, version: lab.version };
}

/**
 * Project a stored Model Pool Version into the method-domain PoolManifestVersion
 * the staged methodology consumes. Drops canonicalPayload / digest (Lab
 * content-addressing metadata the methodology does not read).
 */
export function labPoolToMethodPool(lab: ModelPoolVersion): PoolManifestVersion {
  return {
    id: lab.poolId,
    version: lab.version,
    core: lab.core,
    challengers: lab.challengers,
    diversityChecklist: lab.diversityChecklist,
    rationale: lab.rationale,
    supersedesVersion: lab.supersedesVersion,
    createdAt: lab.createdAt,
  };
}

/** A method-domain PoolManifestRef from a stored Model Pool Version. */
export function labPoolToMethodRef(lab: ModelPoolVersion): PoolManifestRef {
  return { id: lab.poolId, version: lab.version };
}

// --- Lab asset loading --------------------------------------------------------

export interface PolicyStudyAssets {
  /** Method-domain recipes projected from the stored Lab Recipe Versions. */
  recipes: FusionRecipeVersion[];
  /** Method-domain pool projected from the stored Model Pool Version. */
  pool: PoolManifestVersion;
}

/**
 * Load and project the Lab assets pinned by a PolicyStudyDefinition. Throws if
 * any pinned recipe version or the model-pool version is missing from the Lab
 * asset store — this is the adapter-level F1 guard (the repository also guards
 * at trial create/seal).
 */
export async function loadPolicyStudyAssets(
  labAssetRepo: LabAssetRepository,
  definition: PolicyStudyDefinition,
): Promise<PolicyStudyAssets> {
  const poolVersion = await labAssetRepo.getPoolVersion(
    definition.modelPool.poolId,
    definition.modelPool.version,
  );
  if (!poolVersion) {
    throw new Error(
      `Model pool ${definition.modelPool.poolId} v${definition.modelPool.version} not found in Lab assets.`,
    );
  }
  const recipes: FusionRecipeVersion[] = [];
  for (const ref of definition.fusionRecipes) {
    const labRecipe = await labAssetRepo.getRecipeVersion(ref.recipeId, ref.version);
    if (!labRecipe) {
      throw new Error(`Recipe ${ref.recipeId} v${ref.version} not found in Lab assets.`);
    }
    recipes.push(labRecipeToMethodRecipe(labRecipe));
  }
  return { recipes, pool: labPoolToMethodPool(poolVersion) };
}

// --- Registered-payload boundary (unknown kind/schema blocked pre-call) -------

/**
 * Assert that a study definition is backed by a registered study type with a
 * matching schema version. Unknown kinds / schema versions are rejected BEFORE
 * any provider call (spec §4.1 — only `policy` is registered; this is not a
 * user-authored schema system). Throws on rejection.
 */
export function assertRegisteredDefinition(definition: PolicyStudyDefinition): void {
  if (!isRegisteredStudyKind(POLICY_STUDY_KIND)) {
    throw new Error(`Study kind "${POLICY_STUDY_KIND}" is not registered.`);
  }
  const reg = getStudyTypeRegistration(POLICY_STUDY_KIND);
  if (!reg) {
    throw new Error(`Study kind "${POLICY_STUDY_KIND}" is not registered.`);
  }
  if (reg.schemaVersion !== POLICY_DEFINITION_SCHEMA_VERSION) {
    throw new Error(
      `Registered definition schema version ${reg.schemaVersion} does not match expected ${POLICY_DEFINITION_SCHEMA_VERSION}.`,
    );
  }
  if (!policyStudyRegistration.validateDefinition(definition)) {
    throw new Error("Policy study definition failed registered validation.");
  }
}
/**
 * Reject an unknown payload kind or schema version before a provider call. The
 * executor port calls this before dispatching any paid run so an unregistered
 * payload shape can never reach a provider.
 */
export function assertRegisteredPayloadKind(kind: string, schemaVersion: number): void {
  if (!isRegisteredStudyKind(kind)) {
    throw new Error(`Unknown study kind "${kind}" — rejected before provider call.`);
  }
  const reg = getStudyTypeRegistration(kind);
  if (!reg || reg.schemaVersion !== schemaVersion) {
    throw new Error(
      `Unknown payload schema version ${schemaVersion} for kind "${kind}" — rejected before provider call.`,
    );
  }
}

// --- Playbook mapping (Fusion Playbook → generic PolicyReportPayload) ---------

function fusionRowToPolicyRow(row: FusionPlaybookRow): PolicyPlaybookRow {
  return {
    policy: row.policy as PolicyKind,
    configuration: row.configuration,
    meanOutcome: row.score,
    lift: row.lift,
    costMultiplier: row.costMultiplier,
    confidence: row.confidence,
  };
}

function fusionRecommendationToPolicy(rec: FusionPlaybook["recommendation"]): PolicyRecommendation {
  if (rec.kind === "do_not_fuse") {
    return { kind: "do_not_fuse", rationale: rec.rationale };
  }
  return {
    kind: "adopt",
    policy: rec.policy as PolicyKind,
    configuration: rec.configuration,
    rationale: rec.rationale,
  };
}
function poolAdequacyToPolicy(a: PoolAdequacyOutcome): PolicyReportPayload["poolAdequacy"] {
  return {
    probed: a.probed,
    outcome: a.outcome === "confirmed" ? "confirmed" : "unconfirmed",
    note: a.note && a.note.trim().length > 0 ? a.note : "Pool adequacy not probed.",
  };
}
/**
 * Derive the recipe-sensitivity finding from a Stage C result. When Stage C
 * ran, `checked` is true and the note records whether any ranking was
 * overturned (recipe-sensitive). When Stage C did not run, the finding is
 * `checked: false` with an explicit note.
 */
export function recipeSensitivityFromStageC(stageC: StageCResult | null): {
  checked: boolean;
  note: string;
} {
  if (!stageC) {
    return { checked: false, note: "Stage C recipe-sensitivity spot check not run." };
  }
  const overturned = stageC.spotChecks.filter((s) => s.overturned);
  if (overturned.length === 0) {
    return {
      checked: true,
      note: "Stage C spot check ran; no ranking was overturned by the runner-up recipe.",
    };
  }
  const families = overturned.map((s) => s.runnerUpFamily).join(", ");
  return {
    checked: true,
    note: `Stage C flagged recipe-sensitive ranking(s) overturned by: ${families}.`,
  };
}

/**
 * Map a methodology Fusion Playbook into the generic PolicyReportPayload the
 * StudyRepository persists. `supportingTrialIds` / `supportingObservationIds`
 * are sourced from the methodology run so the generic playbook carries exact
 * Trial/Observation refs (spec §5 — exact supporting refs).
 */
export function fusionPlaybookToPolicyReport(
  pb: FusionPlaybook,
  definitionFingerprint: string,
  stageC: StageCResult | null,
  supportingTrialIds: string[],
  supportingObservationIds: string[],
): PolicyReportPayload {
  return {
    studyId: pb.studyId,
    definitionFingerprint,
    rows: pb.rows.map(fusionRowToPolicyRow),
    recommendation: fusionRecommendationToPolicy(pb.recommendation),
    poolAdequacy: poolAdequacyToPolicy(pb.poolAdequacy),
    recipeSensitivity: recipeSensitivityFromStageC(stageC),
    claimLevel: pb.claimLevel,
    conclusion: pb.conclusion,
    supportingTrialIds,
    supportingObservationIds,
    reportSchemaVersion: POLICY_REPORT_SCHEMA_VERSION,
    createdAt: pb.createdAt,
  };
}

// --- Study handle construction ------------------------------------------------

/**
 * Resolve a pinned ExactModelConfigurationRef into the provider/model CriticRef
 * the methodology's executor port consumes. The Policy Study pins
 * content-addressed model configurations; at orchestration time the executor
 * resolves each to its provider/model. Tests supply a deterministic map.
 */
export type JudgeResolver = (ref: ExactModelConfigurationRef) => CriticRef;

/**
 * Build the in-memory method-domain FusionStudy handle the staged methodology
 * drives. The handle is NOT the persisted record — the persisted record is the
 * generic PolicyStudyRecord owned by StudyRepository. The handle carries the
 * method-domain refs (suite, pool, recipes, judges) the methodology reads.
 */
export function buildMethodStudyHandle(args: {
  record: PolicyStudyRecord;
  assets: PolicyStudyAssets;
  judge1: CriticRef;
  judge2: CriticRef;
  kind: FusionStudyKind;
}): FusionStudy {
  const { record, assets, judge1, judge2, kind } = args;
  const suiteRef: SuiteSnapshotRef = {
    suiteId: record.definition.workload.taskSetId,
    suiteVersion: record.definition.workload.version,
    protocolFingerprint: record.definition.protocolFingerprint,
  };
  const poolRef: PoolManifestRef = { id: assets.pool.id, version: assets.pool.version };
  const recipeRefs: FusionRecipeRef[] = assets.recipes.map((r) => ({
    id: r.id,
    version: r.version,
  }));
  return {
    id: record.id,
    revision: record.revision,
    kind,
    suiteRef,
    poolRef,
    judge1,
    judge2,
    recipeRefs,
    stageResults: { stageA: null, stageB: null, stageC: null },
    playbookRef: null,
    confirmationOf: record.confirmationOf,
    claimLevel: record.claimLevel,
    status: "in_progress",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
// --- Method → Lab lineage mapping (spec §4.3, §5) ----------------------------

/**
 * Resolves a method-domain CriticRef (providerId + model) back to the
 * canonical ExactModelConfigurationRef the generic Lab stores require. The
 * judgeResolver goes Lab → method; this is the inverse for candidate members
 * and synthesizers. Required when the adapter persists method-domain trials
 * onto StudyRepository.
 */
export type ModelConfigResolver = (critic: CriticRef) => ExactModelConfigurationRef | null;

/** Default resolver: returns null (cannot resolve). Production wiring supplies one. */
const nullModelConfigResolver: ModelConfigResolver = () => null;

/**
 * Narrow read-only run lookup used to resolve a method trial's
 * `children.candidateRunId` into a full StudyArtifactRef. Runs are only ever
 * surfaced through this port when they are genuine single-model candidate
 * runs — see `isCandidateStudyRun`.
 */
export interface StudyCandidateRunResolver {
  getRun(runId: string): Promise<RunRecordV2 | null>;
}

/**
 * Whether a stored run is a genuine single-model candidate run that may be
 * surfaced as a candidate artifact ref / eligibility source — as opposed to a
 * Lab-authored synthesis / Fusion / Refine artifact run, which is policy
 * evidence and must never be treated as a single-model candidate (spec §9).
 */
export function isCandidateStudyRun(run: RunRecordV2): boolean {
  return run.source.kind === "adhoc" || run.source.kind === "experiment";
}

/**
 * Resolve one single-model candidate run record into a full StudyArtifactRef.
 * Returns null — skipping rather than inventing — when any required fact is
 * missing or ambiguous: the run must be a genuine candidate run (never a
 * Lab-authored synthesis / Fusion / Refine artifact), and it must carry
 * exactly one accepted candidate whose accepted attempt completed with an
 * output to hash (spec §9, Run 21 F1).
 */
export function candidateArtifactRefFromRun(run: RunRecordV2): StudyArtifactRef | null {
  if (!isCandidateStudyRun(run)) return null;
  const accepted = run.candidates.filter((c) => c.acceptedAttemptId !== null);
  if (accepted.length !== 1) return null;
  const candidate = accepted[0];
  const acceptedAttemptId = candidate.acceptedAttemptId!;
  const attempt = candidate.attempts.find(
    (a) => a.attemptId === acceptedAttemptId && a.status === "completed",
  );
  const output = attempt?.output;
  if (!output) return null;
  const contentHash = hashArtifactContent(output);
  if (!/^sha256:[0-9a-f]{64}$/.test(contentHash)) return null;
  return { runId: run.id, attemptId: acceptedAttemptId, contentHash };
}

/** Alias of the evidence-adapter resolver contract, re-exported for wiring call sites. */
export type { EvaluationSourceResolver as StudySourceResolver };

/**
 * Build a recipeId+version → digest lookup from a PolicyStudyDefinition's
 * pinned recipe refs. Used when mapping method-domain FusionRecipeRef (which
 * carries no digest) to the digest-bearing PolicyTrialPayload.recipeRef.
 */
function recipeDigestLookup(definition: PolicyStudyDefinition): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of definition.fusionRecipes) {
    map.set(`${r.recipeId}:${r.version}`, r.digest);
  }
  return map;
}

/**
 * Map a method-domain FusionTrial into a generic PolicyStudyTrial for
 * persistence on StudyRepository. Candidate slots and synthesizer are
 * resolved to ExactModelConfigurationRef via the modelConfigResolver; the
 * recipe digest is looked up from the study definition. Artifact refs are
 * mapped from the trial's synthesisArtifact child (spec §4.3).
 */
async function fusionTrialToPolicyTrial(
  t: FusionTrial,
  studyId: string,
  modelConfigResolver: ModelConfigResolver,
  recipeDigests: Map<string, string>,
  runResolver: StudyCandidateRunResolver | null,
): Promise<PolicyStudyTrial> {
  const members: ExactModelConfigurationRef[] = [];
  for (const slot of t.candidateConfig.slots) {
    const mc = modelConfigResolver({ providerId: slot.providerId, model: slot.model });
    if (!mc) {
      throw new Error(
        `Cannot resolve candidate ${slot.providerId}:${slot.model} to an exact model configuration.`,
      );
    }
    members.push(mc);
  }

  let synthesizer: ExactModelConfigurationRef | null = null;
  if (t.synthesizer) {
    const mc = modelConfigResolver(t.synthesizer);
    if (!mc) {
      throw new Error(
        `Cannot resolve synthesizer ${t.synthesizer.providerId}:${t.synthesizer.model} to an exact model configuration.`,
      );
    }
    synthesizer = mc;
  }

  let recipeRef: { recipeId: string; version: number; digest: string } | null = null;
  if (t.recipe) {
    const digest = recipeDigests.get(`${t.recipe.id}:${t.recipe.version}`);
    if (!digest) {
      throw new Error(`Recipe ${t.recipe.id} v${t.recipe.version} digest not found.`);
    }
    recipeRef = { recipeId: t.recipe.id, version: t.recipe.version, digest };
  }

  const payload: PolicyTrialPayload = {
    policy: t.policy as PolicyKind,
    stage: t.stage,
    candidateConfig: { members },
    recipeRef,
    synthesizer,
  };

  const artifactRefs: StudyArtifactRef[] = [];
  if (t.children.synthesisArtifact) {
    const sa = t.children.synthesisArtifact;
    artifactRefs.push({
      runId: sa.runId,
      attemptId: sa.fusionAttemptId,
      contentHash: sa.contentHash,
    });
  }
  // F1 (Run 21): lossless candidate lineage — resolve children.candidateRunId
  // to a full StudyArtifactRef via run lookup. The synthesisArtifact ref above
  // already maps runId → attemptId + contentHash losslessly; the candidate
  // run reference loses attemptId + contentHash unless we look the run up.
  // Missing/ambiguous facts skip the ref — they are never invented (spec §9).
  if (t.children.candidateRunId && runResolver) {
    const run = await runResolver.getRun(t.children.candidateRunId);
    if (run) {
      const candidateRef = candidateArtifactRefFromRun(run);
      if (candidateRef) artifactRefs.push(candidateRef);
    }
  }

  return {
    id: t.id,
    studyId,
    payloadKind: "policy",
    payloadSchemaVersion: POLICY_TRIAL_PAYLOAD_SCHEMA_VERSION,
    payloadFingerprint: fingerprintStudyValue(payload),
    payload,
    status: t.status,
    sampleIndex: t.sampleIndex,
    artifactRefs,
    observationIds: [],
    policyCost: t.cost.policy,
    experimentalCost: t.cost.experimental,
    createdAt: t.createdAt,
    sealedAt: t.sealedAt,
  };
}

/**
 * Map a method-domain EvaluationObservation into a generic
 * PolicyStudyObservation for persistence on StudyRepository. The judge
 * CriticRef is resolved to ExactModelConfigurationRef via the
 * modelConfigResolver (spec §4.3).
 */
function fusionObservationToPolicyObservation(
  o: EvaluationObservation,
  studyId: string,
  modelConfigResolver: ModelConfigResolver,
): PolicyStudyObservation {
  const judge = modelConfigResolver(o.judge);
  if (!judge) {
    throw new Error(
      `Cannot resolve judge ${o.judge.providerId}:${o.judge.model} to an exact model configuration.`,
    );
  }
  const payload: PolicyMeasurementPayload = {
    judge,
    overallScore: o.overallScore,
    tokensIn: o.tokensIn,
    tokensOut: o.tokensOut,
    error: o.error,
  };
  return {
    id: o.id,
    studyId,
    trialId: o.trialId,
    payloadKind: "policy_measurement",
    payloadSchemaVersion: POLICY_MEASUREMENT_SCHEMA_VERSION,
    payload,
    status: o.status,
    sourceRunId: o.runId,
    createdAt: o.startedAt,
    finishedAt: o.finishedAt,
  };
}

/**
 * Persist method-domain trials, attempts, and observations from a
 * FusionStudyRepository onto the canonical StudyRepository. Trials are
 * replayed in sampleIndex order: each trial is created (or linked via
 * createAttempt for successors), sealed if the method sealed it, then its
 * observations are appended. This gives the generic Lab stores durable
 * Trial/Attempt/Observation lineage with candidate artifact refs (spec §4.3,
 * §5).
 */
async function persistMethodLineage(
  studyRepo: StudyRepository,
  methodRepo: InMemoryFusionStudyRepository,
  studyId: string,
  modelConfigResolver: ModelConfigResolver,
  recipeDigests: Map<string, string>,
  runResolver: StudyCandidateRunResolver | null,
): Promise<void> {
  const methodTrials = await methodRepo.listTrials(studyId);
  const methodAttempts: FusionAttempt[] = await methodRepo.listTrialAttempts(studyId);
  const successorAttemptByToId = new Map(methodAttempts.map((a) => [a.toTrialId, a] as const));

  for (const mt of methodTrials) {
    const genericTrial = await fusionTrialToPolicyTrial(
      mt,
      studyId,
      modelConfigResolver,
      recipeDigests,
      runResolver,
    );
    // Always create in_progress; seal separately if the method sealed it.
    const inProgressTrial: PolicyStudyTrial = {
      ...genericTrial,
      status: "in_progress",
      sealedAt: null,
    };
    const attempt = successorAttemptByToId.get(mt.id);
    if (attempt) {
      // Successor trial — linked via createAttempt (atomic successor + link).
      const genericAttempt: StudyAttempt = {
        id: attempt.id,
        studyId,
        fromTrialId: attempt.fromTrialId,
        toTrialId: attempt.toTrialId,
        reason: attempt.reason,
        createdAt: attempt.createdAt,
      };
      await studyRepo.createAttempt(genericAttempt, inProgressTrial);
    } else {
      await studyRepo.createTrial(inProgressTrial);
    }
    if (mt.status === "sealed") {
      await studyRepo.sealTrial(mt.id, 0, mt.sealedAt ?? 0);
    }
    const methodObs = await methodRepo.listObservations(mt.id);
    for (const mo of methodObs) {
      const genericObs = fusionObservationToPolicyObservation(mo, studyId, modelConfigResolver);
      await studyRepo.appendObservation(genericObs);
    }
  }
}

// --- Adapter ------------------------------------------------------------------
export interface PolicyStudyAdapterDeps {
  studyRepo: StudyRepository;
  labAssetRepo: LabAssetRepository;
  /** Resolves pinned judge configs to provider/model refs for the executor. */
  judgeResolver: JudgeResolver;
  /** Mock in tests; live provider-backed in production. */
  executor: FusionPolicyExecutor;
  /**
   * Resolves method-domain CriticRef → canonical ExactModelConfigurationRef.
   * Required for persisting method trials/observations onto StudyRepository
   * (candidate members, synthesizer, observation judge). Defaults to a
   * null-returning resolver — supply one in production and lineage tests.
   */
  modelConfigResolver?: ModelConfigResolver;
  /**
   * Read-only run lookup used to resolve children.candidateRunId into a full
   * StudyArtifactRef (runId + attemptId + contentHash) when persisting method
   * lineage onto StudyRepository (F1). When absent, candidate refs are skipped
   * rather than invented.
   */
  runResolver?: StudyCandidateRunResolver;
  now?: () => number;
  generateId?: () => string;
}

export interface RunPolicyStudyInput {
  /** The created, started PolicyStudyRecord (status: in_progress). */
  record: PolicyStudyRecord;
  suite: EvaluationSuite;
  rubric: RubricSnapshot | null;
  stratificationTasks: number;
  tasksPerPairA: number;
  tasksPerPairB: number;
  tasksPerPairC: number;
  sequentialPairs: number;
  mpid: number;
  outsideChallengers?: ModelSlot[];
  alternateSynthesizer?: CriticRef | null;
}
export interface RunPolicyStudyResult {
  /** Generic playbook persisted to the canonical Lab store. */
  playbook: PolicyReportPayload;
  /** The sealed PolicyStudyRecord (status: completed). */
  sealedRecord: PolicyStudyRecord;
  /** Method-domain playbook produced by the methodology (for inspection). */
  methodPlaybook: FusionPlaybook;
  /** Method-domain study handle (with stage results) for confirmation runs. */
  methodStudy: FusionStudy;
  /** Generic trial ids that supported the playbook (resolve via listTrials). */
  supportingTrialIds: string[];
  /** Generic observation ids that supported the playbook (resolve via listObservations). */
  supportingObservationIds: string[];
}

/**
 * The Policy Study adapter: runs the staged methodology against generic Lab
 * assets and persists the generic study + playbook through StudyRepository.
 *
 * The methodology's trial/attempt/observation lifecycle runs against an
 * in-memory method-domain repository (the proven methodology's own lifecycle);
 * the durable Lab outputs — the PolicyStudyRecord lifecycle and the immutable
 * PolicyReportPayload playbook — are persisted to the canonical generic stores.
 * The four policies (`best_fixed`, `rank`, `fuse`, `refine`) remain treatments;
 * `do_not_fuse` remains a first-class recommendation, never a failure status.
 */
export class PolicyStudyAdapter {
  private readonly studyRepo: StudyRepository;
  private readonly labAssetRepo: LabAssetRepository;
  private readonly judgeResolver: JudgeResolver;
  private readonly executor: FusionPolicyExecutor;
  private readonly modelConfigResolver: ModelConfigResolver;
  private readonly runResolver: StudyCandidateRunResolver | null;
  private readonly now: () => number;
  private readonly generateId: () => string;

  constructor(deps: PolicyStudyAdapterDeps) {
    this.studyRepo = deps.studyRepo;
    this.labAssetRepo = deps.labAssetRepo;
    this.judgeResolver = deps.judgeResolver;
    this.executor = deps.executor;
    this.modelConfigResolver = deps.modelConfigResolver ?? nullModelConfigResolver;
    this.runResolver = deps.runResolver ?? null;
    this.now = deps.now ?? Date.now;
    this.generateId = deps.generateId ?? (() => crypto.randomUUID());
  }

  /**
   * Create a draft Policy Study record from a definition. Rejects unknown /
   * unregistered payloads before any write (spec §4.1). For confirmation
   * studies, pass the source exploration study id as `confirmationOf`.
   */
  async createStudy(
    definition: PolicyStudyDefinition,
    title: string,
    createdAt: number = this.now(),
    confirmationOf: string | null = null,
  ): Promise<PolicyStudyRecord> {
    assertRegisteredDefinition(definition);
    if (!isPolicyStudyDefinition(definition)) {
      throw new Error("Invalid policy study definition.");
    }
    // Confirmation linkage consistency (spec §4.2).
    if (definition.claimPlan === "confirmation" && !confirmationOf) {
      throw new Error("A confirmation study must reference its exploration source.");
    }
    if (definition.claimPlan === "exploration" && confirmationOf) {
      throw new Error("An exploration study cannot reference a confirmation source.");
    }
    const id = this.generateId();
    const record: PolicyStudyRecord = {
      id,
      revision: 0,
      kind: POLICY_STUDY_KIND,
      title,
      status: "draft",
      claimLevel: definition.claimPlan === "confirmation" ? "confirmed" : "exploratory",
      definitionSchemaVersion: POLICY_DEFINITION_SCHEMA_VERSION,
      definitionFingerprint: policyStudyRegistration.fingerprintDefinition(definition),
      definition,
      reportRef: null,
      confirmationOf,
      createdAt,
      updatedAt: createdAt,
      archivedAt: null,
    };
    await this.studyRepo.createStudy(record);
    return record;
  }

  /** Start the study (seals the definition fingerprint). */
  async startStudy(record: PolicyStudyRecord): Promise<PolicyStudyRecord> {
    const newRev = await this.studyRepo.startStudy(record.id, record.revision, this.now());
    return { ...record, revision: newRev, status: "in_progress", updatedAt: this.now() };
  }
  /**
   * Run the full staged methodology (Stage A → B → C → playbook) against the
   * Lab assets pinned by the study definition, then persist the generic
   * PolicyReportPayload playbook, the method-domain trial/attempt/observation
   * lineage onto the canonical StudyRepository, and seal the study. Returns
   * the generic playbook + the sealed record.
   */
  async runExplorationStudy(input: RunPolicyStudyInput): Promise<RunPolicyStudyResult> {
    const { record, suite, rubric } = input;
    if (record.status !== "in_progress") {
      throw new Error(`Policy study ${record.id} must be in_progress to run.`);
    }
    // Registered-payload boundary (spec §4.1, plan T6 RED): reject unknown
    // kind / schema version BEFORE any provider call.
    assertRegisteredDefinition(record.definition);
    assertRegisteredPayloadKind(record.kind, record.definitionSchemaVersion);

    // F1 (adapter-level): load + project Lab assets, rejecting missing refs.
    const assets = await loadPolicyStudyAssets(this.labAssetRepo, record.definition);
    const judge1 = this.judgeResolver(record.definition.judge1);
    const judge2 = this.judgeResolver(record.definition.judge2);

    // The methodology runs against its own in-memory lifecycle repo, seeded
    // with the projected Lab assets. Trials/observations/attempts and the
    // method-domain playbook are produced here; the durable generic playbook,
    // study seal, and trial/observation lineage are persisted to the canonical
    // Lab store below.
    const methodRepo = new InMemoryFusionStudyRepository();
    for (const recipe of assets.recipes) {
      await methodRepo.createRecipe(recipe);
    }
    await methodRepo.createPoolManifest(assets.pool);
    const handle = buildMethodStudyHandle({
      record,
      assets,
      judge1,
      judge2,
      kind: "exploration",
    });
    await methodRepo.createStudy(handle);

    const controller = createFusionStudyController({
      repo: methodRepo,
      generateId: this.generateId,
      now: this.now,
    });
    const methodPlaybook = await runFusionStudy(
      { controller, executor: this.executor, repo: methodRepo },
      {
        studyId: handle.id,
        suite,
        rubric,
        stratificationTasks: input.stratificationTasks,
        tasksPerPairA: input.tasksPerPairA,
        tasksPerPairB: input.tasksPerPairB,
        tasksPerPairC: input.tasksPerPairC,
        shortlistRule: {
          description: "H_synth ≥ 0.15 or H_select ≥ 0.25; top 5 by max headroom.",
          maxPairs: 5,
          minSynthesisHeadroom: 0.15,
          minSelectionHeadroom: 0.25,
        },
        sequentialPairs: input.sequentialPairs,
        mpid: input.mpid,
        outsideChallengers: input.outsideChallengers,
        alternateSynthesizer: input.alternateSynthesizer ?? null,
      },
    );

    // Persist method-domain trial/attempt/observation lineage onto the
    // canonical StudyRepository so Lab stores carry durable Trial/Attempt/
    // Observation refs with candidate artifact links (spec §4.3, §5).
    const recipeDigests = recipeDigestLookup(record.definition);
    await persistMethodLineage(
      this.studyRepo,
      methodRepo,
      record.id,
      this.modelConfigResolver,
      recipeDigests,
      this.runResolver,
    );

    // Supporting Trial/Observation refs — now generic ids that resolve via
    // studyRepo.listTrials / listObservations.
    const genericTrials = await this.studyRepo.listTrials(record.id);
    const supportingTrialIds = genericTrials.map((t) => t.id);
    const supportingObservationIds: string[] = [];
    for (const t of genericTrials) {
      for (const oid of t.observationIds) supportingObservationIds.push(oid);
    }

    // Stage C result for the recipe-sensitivity finding.
    const updatedStudy = await methodRepo.getStudy(handle.id);
    const stageC = updatedStudy?.stageResults.stageC ?? null;

    // Map to the generic PolicyReportPayload and persist on the canonical store.
    const playbook = fusionPlaybookToPolicyReport(
      methodPlaybook,
      record.definitionFingerprint,
      stageC,
      supportingTrialIds,
      supportingObservationIds,
    );
    const playbookId = "pb:sha256:" + fingerprintStudyValue(playbook).slice("sha256:".length);
    await this.studyRepo.createPlaybook(playbookId, playbook);

    // Seal the study with the playbook ref.
    const sealedRev = await this.studyRepo.sealStudy(
      record.id,
      record.revision,
      playbookId,
      this.now(),
    );
    const sealedRecord: PolicyStudyRecord = {
      ...record,
      revision: sealedRev,
      status: "completed",
      reportRef: playbookId,
      updatedAt: this.now(),
    };
    return {
      playbook,
      sealedRecord,
      methodPlaybook,
      methodStudy: updatedStudy ?? handle,
      supportingTrialIds,
      supportingObservationIds,
    };
  }

  /**
   * Run a confirmation study: evaluate the preselected configuration from a
   * completed exploration study on a fresh suite version's tasks, then
   * persist the confirmation trial/observation lineage and playbook onto the
   * canonical StudyRepository. The confirmation study record must be
   * in_progress and linked to its exploration source via confirmationOf
   * (spec §5).
   */
  async runConfirmationStudy(input: {
    record: PolicyStudyRecord;
    sourceRecord: PolicyStudyRecord;
    sourceMethodStudy: FusionStudy;
    sourceMethodPlaybook: FusionPlaybook;
    suite: EvaluationSuite;
    rubric: RubricSnapshot | null;
    tasksPerPair: number;
    mpid: number;
  }): Promise<RunPolicyStudyResult> {
    const { record, sourceRecord, sourceMethodStudy, sourceMethodPlaybook, suite, rubric } = input;
    if (record.status !== "in_progress") {
      throw new Error(`Policy study ${record.id} must be in_progress to run.`);
    }
    // Registered-payload boundary (spec §4.1).
    assertRegisteredDefinition(record.definition);
    assertRegisteredPayloadKind(record.kind, record.definitionSchemaVersion);

    const assets = await loadPolicyStudyAssets(this.labAssetRepo, record.definition);
    const judge1 = this.judgeResolver(record.definition.judge1);
    const judge2 = this.judgeResolver(record.definition.judge2);

    // Seed the method-domain repo with the source study + playbook (for
    // runConfirmationStudy to read) and the confirmation study handle.
    const methodRepo = new InMemoryFusionStudyRepository();
    for (const recipe of assets.recipes) {
      await methodRepo.createRecipe(recipe);
    }
    await methodRepo.createPoolManifest(assets.pool);
    await methodRepo.createStudy(sourceMethodStudy);
    await methodRepo.createPlaybook(sourceMethodPlaybook);
    const confirmHandle = buildMethodStudyHandle({
      record,
      assets,
      judge1,
      judge2,
      kind: "confirmation",
    });
    await methodRepo.createStudy(confirmHandle);

    const controller = createFusionStudyController({
      repo: methodRepo,
      generateId: this.generateId,
      now: this.now,
    });
    const outcome = await runMethodConfirmationStudy(
      { controller, executor: this.executor, repo: methodRepo },
      {
        sourceStudyId: sourceRecord.id,
        confirmationStudyId: confirmHandle.id,
        suite,
        rubric,
        tasksPerPair: input.tasksPerPair,
        mpid: input.mpid,
      },
    );

    // Persist confirmation trial/observation lineage onto the canonical store.
    const recipeDigests = recipeDigestLookup(record.definition);
    await persistMethodLineage(
      this.studyRepo,
      methodRepo,
      record.id,
      this.modelConfigResolver,
      recipeDigests,
      this.runResolver,
    );

    const genericTrials = await this.studyRepo.listTrials(record.id);
    const supportingTrialIds = genericTrials.map((t) => t.id);
    const supportingObservationIds: string[] = [];
    for (const t of genericTrials) {
      for (const oid of t.observationIds) supportingObservationIds.push(oid);
    }

    const updatedConfirmStudy = await methodRepo.getStudy(confirmHandle.id);
    const playbook = fusionPlaybookToPolicyReport(
      outcome.playbook,
      record.definitionFingerprint,
      null,
      supportingTrialIds,
      supportingObservationIds,
    );
    const playbookId = "pb:sha256:" + fingerprintStudyValue(playbook).slice("sha256:".length);
    await this.studyRepo.createPlaybook(playbookId, playbook);

    const sealedRev = await this.studyRepo.sealStudy(
      record.id,
      record.revision,
      playbookId,
      this.now(),
    );
    const sealedRecord: PolicyStudyRecord = {
      ...record,
      revision: sealedRev,
      status: "completed",
      reportRef: playbookId,
      updatedAt: this.now(),
    };
    return {
      playbook,
      sealedRecord,
      methodPlaybook: outcome.playbook,
      methodStudy: updatedConfirmStudy ?? confirmHandle,
      supportingTrialIds,
      supportingObservationIds,
    };
  }
}

// Re-export the registration fingerprint helper for callers that build records
// outside the adapter (e.g. migration code).
export function policyDefinitionFingerprint(definition: PolicyStudyDefinition): string {
  return policyStudyRegistration.fingerprintDefinition(definition);
}

export { fingerprintStudyValue };
