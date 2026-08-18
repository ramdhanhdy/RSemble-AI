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
import type {
  FusionPlaybook,
  FusionPlaybookRow,
  FusionRecipeRef,
  FusionRecipeVersion,
  FusionStudy,
  FusionStudyKind,
  PoolAdequacyOutcome,
  PoolManifestRef,
  PoolManifestVersion,
  StageCResult,
  SuiteSnapshotRef,
} from "../../evaluations/fusion-study-types";
import type { FusionPolicyExecutor } from "../../evaluations/fusion-study-controller";
import { createFusionStudyController } from "../../evaluations/fusion-study-controller";
import { runFusionStudy } from "../../evaluations/fusion-study-orchestration";
import { InMemoryFusionStudyRepository } from "../../persistence/fusion-study-repository";
import type { LabAssetRepository } from "../../persistence/lab-asset-repository";
import type { StudyRepository } from "../../persistence/study-repository";
import type { LabRecipeVersion } from "../lab-recipe-types";
import type { ModelPoolVersion } from "../model-pool-types";
import { getStudyTypeRegistration, isRegisteredStudyKind } from "../study-registry";
import { fingerprintStudyValue } from "../study-fingerprint";
import {
  POLICY_DEFINITION_SCHEMA_VERSION,
  POLICY_REPORT_SCHEMA_VERSION,
  POLICY_STUDY_KIND,
  isPolicyStudyDefinition,
  policyStudyRegistration,
  type ExactModelConfigurationRef,
  type PolicyKind,
  type PolicyPlaybookRow,
  type PolicyRecommendation,
  type PolicyReportPayload,
  type PolicyStudyDefinition,
  type PolicyStudyRecord,
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
      throw new Error(
        `Recipe ${ref.recipeId} v${ref.version} not found in Lab assets.`,
      );
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
    outcome: a.outcome === "confirmed" ? "confirmed" : "rejected",
    note: a.note,
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
    claimLevel: record.claimLevel,
    confirmationOf: record.confirmationOf,
    status: "in_progress",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

// --- Adapter ------------------------------------------------------------------

export interface PolicyStudyAdapterDeps {
  studyRepo: StudyRepository;
  labAssetRepo: LabAssetRepository;
  /** Resolves pinned judge configs to provider/model refs for the executor. */
  judgeResolver: JudgeResolver;
  /** Mock in tests; live provider-backed in production. */
  executor: FusionPolicyExecutor;
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
  /** Method-domain trial ids that supported the playbook. */
  supportingTrialIds: string[];
  /** Method-domain observation ids that supported the playbook. */
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
  private readonly now: () => number;
  private readonly generateId: () => string;

  constructor(deps: PolicyStudyAdapterDeps) {
    this.studyRepo = deps.studyRepo;
    this.labAssetRepo = deps.labAssetRepo;
    this.judgeResolver = deps.judgeResolver;
    this.executor = deps.executor;
    this.now = deps.now ?? Date.now;
    this.generateId = deps.generateId ?? (() => crypto.randomUUID());
  }

  /**
   * Create a draft Policy Study record from a definition. Rejects unknown /
   * unregistered payloads before any write (spec §4.1).
   */
  async createStudy(
    definition: PolicyStudyDefinition,
    title: string,
    createdAt: number = this.now(),
  ): Promise<PolicyStudyRecord> {
    assertRegisteredDefinition(definition);
    if (!isPolicyStudyDefinition(definition)) {
      throw new Error("Invalid policy study definition.");
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
      confirmationOf: null,
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
   * PolicyReportPayload playbook and seal the study. Returns the generic
   * playbook + the sealed record.
   */
  async runExplorationStudy(input: RunPolicyStudyInput): Promise<RunPolicyStudyResult> {
    const { record, suite, rubric } = input;
    if (record.status !== "in_progress") {
      throw new Error(`Policy study ${record.id} must be in_progress to run.`);
    }
    // F1 (adapter-level): load + project Lab assets, rejecting missing refs.
    const assets = await loadPolicyStudyAssets(this.labAssetRepo, record.definition);
    const judge1 = this.judgeResolver(record.definition.judge1);
    const judge2 = this.judgeResolver(record.definition.judge2);

    // The methodology runs against its own in-memory lifecycle repo, seeded
    // with the projected Lab assets. Trials/observations/attempts and the
    // method-domain playbook are produced here; the durable generic playbook +
    // study seal are persisted to the canonical Lab store below.
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
          description:
            "H_synth ≥ 0.15 or H_select ≥ 0.25; top 5 by max headroom.",
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

    // Supporting Trial/Observation refs from the methodology run.
    const trials = await methodRepo.listTrials(handle.id);
    const supportingTrialIds = trials.map((t) => t.id);
    const supportingObservationIds: string[] = [];
    for (const t of trials) {
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
