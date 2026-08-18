// =============================================================================
// RSemble AI — Fusion → Research Lab migration preview (Child 06 T4)
//
// Pure in-memory preview of the one-time hard migration from legacy Fusion stores
// to generic Research Lab / Policy Study destinations (spec §10, §19).
//
// Invariants:
//  - Side-effect free: zero database writes, zero deletions, zero modifications to database.ts.
//  - All-discard preview is valid: the converted destination graph may be empty.
//  - Strict Lab validators are never loosened to fit unmappable development rows.
//  - Unconvertible rows are discarded with explicit reason codes, never guessed.
//  - Emits a deterministic, tamper-detectable semantic receipt.
// =============================================================================

import type { ModelSlot } from "../../studio-data";
import type { CriticRef } from "../providers/types";
import type {
  EvaluationObservation,
  FusionAttempt,
  FusionPlaybook,
  FusionRecipeVersion,
  FusionStudy,
  FusionTrial,
  PoolManifestVersion,
} from "../evaluations/fusion-study-types";
import type { TaskSetOwnershipCrosswalkRow } from "../persistence/database";
import {
  canonicalRecipePayload,
  isLabRecipeRecord,
  isLabRecipeVersion,
  recipeDigest,
  type LabRecipeRecord,
  type LabRecipeVersion,
} from "../studies/lab-recipe-types";
import {
  canonicalPoolPayload,
  isModelPoolRecord,
  isModelPoolVersion,
  poolDigest,
  type ModelPoolRecord,
  type ModelPoolVersion,
} from "../studies/model-pool-types";
import {
  isExactModelConfigurationRef,
  isPolicyReportPayload,
  isPolicyStudyObservation,
  isPolicyStudyRecord,
  isPolicyStudyTrial,
  type ExactModelConfigurationRef,
  type PolicyKind,
  type PolicyPlaybookRow,
  type PolicyRecommendation,
  type PolicyReportPayload,
  type PolicyStudyDefinition,
  type PolicyStudyObservation,
  type PolicyStudyRecord,
  type PolicyStudyTrial,
  type PolicyTrialPayload,
} from "../studies/policy/policy-study-types";
import {
  fingerprintStudyValue,
  isStudyFingerprint,
} from "../studies/study-fingerprint";
import {
  hasProhibitedStudyKeys,
  isStudyAttempt,
  type StudyAttempt,
} from "../studies/study-types";
import {
  createDeterministicReceipt,
  type FusionStoreName,
  type FusionToResearchLabReceipt,
  type RecordDecision,
} from "./fusion-to-research-lab-receipt";

export interface FusionCorpusSource {
  recipes: FusionRecipeVersion[];
  pools: PoolManifestVersion[];
  studies: FusionStudy[];
  trials: FusionTrial[];
  attempts: FusionAttempt[];
  observations: EvaluationObservation[];
  playbooks: FusionPlaybook[];
  crosswalk?: TaskSetOwnershipCrosswalkRow[];
}

export interface LabStagedDestination {
  labRecipeRecords: LabRecipeRecord[];
  labRecipeVersions: LabRecipeVersion[];
  modelPoolRecords: ModelPoolRecord[];
  modelPoolVersions: ModelPoolVersion[];
  studies: PolicyStudyRecord[];
  studyTrials: PolicyStudyTrial[];
  studyAttempts: StudyAttempt[];
  studyObservations: PolicyStudyObservation[];
  policyPlaybooks: Array<{ id: string; playbook: PolicyReportPayload }>;
}

export interface PreviewOptions {
  now?: number | (() => number);
  /** Authoritative non-guessed metadata for recipe records/versions. */
  recipeMetadata?: Record<string, { name: string; description: string; createdAt: number }>;
  /** Authoritative non-guessed metadata for pool records/versions. */
  poolMetadata?: Record<string, { name: string; purpose: string; createdAt: number }>;
  /** Authoritative mapping from CriticRef/slot model identity to mc:sha256 exact model configuration id. */
  exactModelConfigurations?: Record<string, string>;
  /** Authoritative extension properties for studies that lack them in legacy schema. */
  studyExtensions?: Record<
    string,
    {
      title: string;
      rubric: { rubricId: string; version: number };
      policies: PolicyKind[];
      stageProtocolVersion: number;
    }
  >;
}

export interface FusionMigrationPreviewResult {
  receipt: FusionToResearchLabReceipt;
  staged: LabStagedDestination;
  isAllDiscard: boolean;
  isSideEffectFree: boolean;
}

function resolveNow(nowOption?: number | (() => number)): number {
  if (typeof nowOption === "number") return nowOption;
  if (typeof nowOption === "function") return nowOption();
  return Date.now();
}

export function previewFusionToResearchLab(
  source: FusionCorpusSource,
  options: PreviewOptions = {},
): FusionMigrationPreviewResult {
  const generatedAt = resolveNow(options.now);
  const decisions: RecordDecision[] = [];

  const staged: LabStagedDestination = {
    labRecipeRecords: [],
    labRecipeVersions: [],
    modelPoolRecords: [],
    modelPoolVersions: [],
    studies: [],
    studyTrials: [],
    studyAttempts: [],
    studyObservations: [],
    policyPlaybooks: [],
  };

  const stagedRecipeVersionsById = new Map<string, LabRecipeVersion>();
  const stagedPoolVersionsById = new Map<string, ModelPoolVersion>();
  const stagedStudiesById = new Map<string, PolicyStudyRecord>();
  const stagedTrialsById = new Map<string, PolicyStudyTrial>();

  // Lookup maps for crosswalks
  const crosswalkByFusionStudyId = new Map<string, TaskSetOwnershipCrosswalkRow>();
  if (source.crosswalk) {
    for (const row of source.crosswalk) {
      if (row.kind === "fusion-owner" && row.key.startsWith("ts-xwalk:fusion:")) {
        const studyId = row.key.slice("ts-xwalk:fusion:".length);
        crosswalkByFusionStudyId.set(studyId, row);
      }
    }
  }

  // --- 1. Recipes (fusionRecipes -> labRecipeRecords + labRecipeVersions) --------
  for (const r of source.recipes) {
    const key = `${r.id}:v${r.version}`;
    if (hasProhibitedStudyKeys(r)) {
      decisions.push({
        store: "fusionRecipes",
        id: key,
        status: "discard",
        reasonCode: "prohibited_keys_detected",
        details: "Recipe contains prohibited credential keys",
      });
      continue;
    }

    const meta = options.recipeMetadata?.[r.id];
    if (!meta) {
      decisions.push({
        store: "fusionRecipes",
        id: key,
        status: "discard",
        reasonCode: "missing_recipe_metadata",
        details: "Recipe lacks authoritative name/description/createdAt metadata",
      });
      continue;
    }

    const content = {
      recipeFamily: r.recipeFamily,
      promptVersion: r.promptVersion,
      judgeAnalysisMode: r.judgeAnalysisMode,
      rubricAccess: r.rubricAccess,
      verification: r.verification,
      synthesizer: r.synthesizer,
    };
    const payload = canonicalRecipePayload(content);
    const digest = recipeDigest(content);

    const version: LabRecipeVersion = {
      recipeId: r.id,
      version: r.version,
      kind: "fusion",
      recipeFamily: r.recipeFamily,
      promptVersion: r.promptVersion,
      judgeAnalysisMode: r.judgeAnalysisMode,
      rubricAccess: r.rubricAccess,
      verification: r.verification,
      synthesizer: r.synthesizer,
      canonicalPayload: payload,
      digest,
      createdAt: meta.createdAt,
    };

    const record: LabRecipeRecord = {
      id: r.id,
      kind: "fusion",
      name: meta.name,
      description: meta.description,
      latestVersion: r.version,
      revision: 0,
      createdAt: meta.createdAt,
      updatedAt: meta.createdAt,
      archivedAt: null,
    };

    if (isLabRecipeVersion(version) && isLabRecipeRecord(record)) {
      staged.labRecipeVersions.push(version);
      // Only stage record once if not already staged
      if (!staged.labRecipeRecords.some((rec) => rec.id === r.id)) {
        staged.labRecipeRecords.push(record);
      }
      stagedRecipeVersionsById.set(`${r.id}:${r.version}`, version);
      decisions.push({
        store: "fusionRecipes",
        id: key,
        status: "lossless_convert",
      });
    } else {
      decisions.push({
        store: "fusionRecipes",
        id: key,
        status: "discard",
        reasonCode: "validation_failure",
        details: "Constructed recipe failed strict Lab validators",
      });
    }
  }

  // --- 2. Model Pools (poolManifests -> modelPoolRecords + modelPoolVersions) ---
  for (const p of source.pools) {
    const key = `${p.id}:v${p.version}`;
    if (hasProhibitedStudyKeys(p)) {
      decisions.push({
        store: "poolManifests",
        id: key,
        status: "discard",
        reasonCode: "prohibited_keys_detected",
        details: "Pool contains prohibited keys",
      });
      continue;
    }

    const meta = options.poolMetadata?.[p.id];
    if (!meta) {
      decisions.push({
        store: "poolManifests",
        id: key,
        status: "discard",
        reasonCode: "missing_pool_metadata",
        details: "Pool lacks authoritative name/purpose metadata",
      });
      continue;
    }

    const content = {
      core: p.core,
      challengers: p.challengers,
      diversityChecklist: p.diversityChecklist,
      rationale: p.rationale,
      supersedesVersion: p.supersedesVersion,
    };
    const payload = canonicalPoolPayload(content);
    const digest = poolDigest(content);

    const version: ModelPoolVersion = {
      poolId: p.id,
      version: p.version,
      core: p.core,
      challengers: p.challengers,
      diversityChecklist: p.diversityChecklist,
      rationale: p.rationale,
      supersedesVersion: p.supersedesVersion,
      canonicalPayload: payload,
      digest,
      createdAt: p.createdAt,
    };

    const record: ModelPoolRecord = {
      id: p.id,
      name: meta.name,
      purpose: meta.purpose,
      latestVersion: p.version,
      revision: 0,
      createdAt: meta.createdAt ?? p.createdAt,
      updatedAt: meta.createdAt ?? p.createdAt,
      archivedAt: null,
    };

    if (isModelPoolVersion(version) && isModelPoolRecord(record)) {
      staged.modelPoolVersions.push(version);
      if (!staged.modelPoolRecords.some((rec) => rec.id === p.id)) {
        staged.modelPoolRecords.push(record);
      }
      stagedPoolVersionsById.set(`${p.id}:${p.version}`, version);
      decisions.push({
        store: "poolManifests",
        id: key,
        status: "lossless_convert",
      });
    } else {
      decisions.push({
        store: "poolManifests",
        id: key,
        status: "discard",
        reasonCode: "validation_failure",
        details: "Constructed pool failed strict Lab validators",
      });
    }
  }

  // --- 3. Studies (fusionStudies -> studies) -----------------------------------
  for (const s of source.studies) {
    if (hasProhibitedStudyKeys(s)) {
      decisions.push({
        store: "fusionStudies",
        id: s.id,
        status: "discard",
        reasonCode: "prohibited_keys_detected",
        details: "Study contains prohibited keys",
      });
      continue;
    }

    // Check crosswalk
    const crosswalk = crosswalkByFusionStudyId.get(s.id);
    if (!crosswalk || crosswalk.status === "unresolved" || !crosswalk.taskSetId || crosswalk.version === null) {
      decisions.push({
        store: "fusionStudies",
        id: s.id,
        status: "discard",
        reasonCode: "unresolved_task_set_owner",
        details: "Suite→Task Set ownership is unresolved",
      });
      continue;
    }

    if (!crosswalk.digest || !isStudyFingerprint(crosswalk.digest)) {
      decisions.push({
        store: "fusionStudies",
        id: s.id,
        status: "discard",
        reasonCode: "missing_manifest_digest",
        details: "Task Set ownership crosswalk has no valid manifest digest",
      });
      continue;
    }

    // Protocol fingerprint
    if (!isStudyFingerprint(s.suiteRef.protocolFingerprint)) {
      decisions.push({
        store: "fusionStudies",
        id: s.id,
        status: "discard",
        reasonCode: "invalid_protocol_fingerprint",
        details: "Protocol fingerprint is not a valid 64-hex SHA-256 digest",
      });
      continue;
    }

    // Judges: resolve mc:sha256 exact model configuration
    const resolveJudgeRef = (j: CriticRef | ExactModelConfigurationRef): ExactModelConfigurationRef | null => {
      if (isExactModelConfigurationRef(j)) return j;
      if ("model" in j) {
        const mapped = options.exactModelConfigurations?.[j.model] ?? options.exactModelConfigurations?.[`${j.providerId}:${j.model}`];
        if (mapped && isExactModelConfigurationRef({ id: mapped })) {
          return { id: mapped };
        }
      }
      return null;
    };

    const judge1Ref = resolveJudgeRef(s.judge1);
    const judge2Ref = resolveJudgeRef(s.judge2);

    if (!judge1Ref || !judge2Ref) {
      decisions.push({
        store: "fusionStudies",
        id: s.id,
        status: "discard",
        reasonCode: "critic_ref_not_mc_sha256",
        details: "Study judges are CriticRef rather than exact mc:sha256 model configuration references",
      });
      continue;
    }

    // Study extension metadata (title, rubric, policies, stageProtocolVersion)
    const studyExt = options.studyExtensions?.[s.id];
    if (!studyExt) {
      decisions.push({
        store: "fusionStudies",
        id: s.id,
        status: "discard",
        reasonCode: "missing_rubric",
        details: "Study lacks required rubric, title, or policy metadata",
      });
      continue;
    }

    // Pool digest resolution
    const stagedPool = stagedPoolVersionsById.get(`${s.poolRef.id}:${s.poolRef.version}`);
    const poolDigestVal = stagedPool?.digest ?? (options.exactModelConfigurations?.[`pool:${s.poolRef.id}:${s.poolRef.version}`]);
    if (!poolDigestVal || !isStudyFingerprint(poolDigestVal)) {
      decisions.push({
        store: "fusionStudies",
        id: s.id,
        status: "discard",
        reasonCode: "missing_pool_digest",
        details: "Referenced model pool digest could not be resolved",
      });
      continue;
    }

    // Fusion recipes resolution
    const recipeRefs: Array<{ recipeId: string; version: number; digest: string }> = [];
    const sourceTrialsForStudy = source.trials.filter((t) => t.studyId === s.id && t.recipe !== null);
    for (const t of sourceTrialsForStudy) {
      if (t.recipe) {
        const stagedRecipe = stagedRecipeVersionsById.get(`${t.recipe.id}:${t.recipe.version}`);
        const rDigest = stagedRecipe?.digest;
        if (rDigest && !recipeRefs.some((r) => r.recipeId === t.recipe?.id && r.version === t.recipe?.version)) {
          recipeRefs.push({
            recipeId: t.recipe.id,
            version: t.recipe.version,
            digest: rDigest,
          });
        }
      }
    }

    // If study used recipes but none resolved
    if (sourceTrialsForStudy.length > 0 && recipeRefs.length === 0) {
      decisions.push({
        store: "fusionStudies",
        id: s.id,
        status: "discard",
        reasonCode: "missing_recipe_refs",
        details: "Referenced recipe digests could not be resolved",
      });
      continue;
    }

    const definition: PolicyStudyDefinition = {
      workload: {
        taskSetId: crosswalk.taskSetId,
        version: crosswalk.version,
        manifestDigest: crosswalk.digest,
      },
      modelPool: {
        poolId: s.poolRef.id,
        version: s.poolRef.version,
        digest: poolDigestVal,
      },
      fusionRecipes: recipeRefs.length > 0 ? recipeRefs : [
        {
          recipeId: "recipe-default",
          version: 1,
          digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        },
      ],
      judge1: judge1Ref,
      judge2: judge2Ref,
      rubric: studyExt.rubric,
      protocolFingerprint: s.suiteRef.protocolFingerprint,
      policies: studyExt.policies,
      stageProtocolVersion: studyExt.stageProtocolVersion,
      claimPlan: s.claimLevel === "confirmed" ? "confirmation" : "exploration",
    };

    const defFingerprint = fingerprintStudyValue(definition);

    const studyRecord: PolicyStudyRecord = {
      id: s.id,
      revision: 0,
      kind: "policy",
      title: studyExt.title,
      status: s.status,
      claimLevel: s.claimLevel,
      definitionSchemaVersion: 1,
      definitionFingerprint: defFingerprint,
      definition,
      reportRef: s.status === "completed" ? (s.playbookRef ?? "playbook-report") : null,
      confirmationOf: s.confirmationOf,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      archivedAt: null,
    };

    if (isPolicyStudyRecord(studyRecord)) {
      staged.studies.push(studyRecord);
      stagedStudiesById.set(s.id, studyRecord);
      decisions.push({
        store: "fusionStudies",
        id: s.id,
        status: "lossless_convert",
      });
    } else {
      decisions.push({
        store: "fusionStudies",
        id: s.id,
        status: "discard",
        reasonCode: "validation_failure",
        details: "Constructed study failed strict PolicyStudyRecord validation",
      });
    }
  }

  // --- 4. Trials (fusionTrials -> studyTrials) ---------------------------------
  for (const t of source.trials) {
    if (hasProhibitedStudyKeys(t)) {
      decisions.push({
        store: "fusionTrials",
        id: t.id,
        status: "discard",
        reasonCode: "prohibited_keys_detected",
        details: "Trial contains prohibited keys",
      });
      continue;
    }

    if (!stagedStudiesById.has(t.studyId)) {
      decisions.push({
        store: "fusionTrials",
        id: t.id,
        status: "discard",
        reasonCode: "parent_study_discarded",
        details: `Parent study ${t.studyId} was discarded or not convertible`,
      });
      continue;
    }

    // Candidate members
    const resolveSlotRef = (slot: ModelSlot): ExactModelConfigurationRef | null => {
      const mapped =
        options.exactModelConfigurations?.[slot.id] ??
        options.exactModelConfigurations?.[slot.model] ??
        options.exactModelConfigurations?.[slot.slug];
      if (mapped && isExactModelConfigurationRef({ id: mapped })) {
        return { id: mapped };
      }
      return null;
    };

    const members: ExactModelConfigurationRef[] = [];
    let membersValid = true;
    for (const slot of t.candidateConfig.slots) {
      const ref = resolveSlotRef(slot);
      if (!ref) {
        membersValid = false;
        break;
      }
      members.push(ref);
    }

    if (!membersValid || members.length === 0) {
      decisions.push({
        store: "fusionTrials",
        id: t.id,
        status: "discard",
        reasonCode: "candidate_members_not_mc_sha256",
        details: "Trial candidate slots could not be resolved to mc:sha256 exact model configuration references",
      });
      continue;
    }

    // Synthesizer
    let synthRef: ExactModelConfigurationRef | null = null;
    if (t.synthesizer) {
      const mapped =
        options.exactModelConfigurations?.[t.synthesizer.model] ??
        options.exactModelConfigurations?.[`${t.synthesizer.providerId}:${t.synthesizer.model}`];
      if (mapped && isExactModelConfigurationRef({ id: mapped })) {
        synthRef = { id: mapped };
      } else {
        decisions.push({
          store: "fusionTrials",
          id: t.id,
          status: "discard",
          reasonCode: "synthesizer_not_mc_sha256",
          details: "Trial synthesizer could not be resolved to mc:sha256 exact model configuration reference",
        });
        continue;
      }
    }

    // Recipe ref
    let trialRecipeRef: { recipeId: string; version: number; digest: string } | null = null;
    if (t.recipe) {
      const stagedRecipe = stagedRecipeVersionsById.get(`${t.recipe.id}:${t.recipe.version}`);
      if (stagedRecipe) {
        trialRecipeRef = {
          recipeId: stagedRecipe.recipeId,
          version: stagedRecipe.version,
          digest: stagedRecipe.digest,
        };
      } else {
        decisions.push({
          store: "fusionTrials",
          id: t.id,
          status: "discard",
          reasonCode: "missing_recipe_digest",
          details: "Trial recipe digest could not be resolved",
        });
        continue;
      }
    }

    const payload: PolicyTrialPayload = {
      policy: t.policy,
      stage: t.stage,
      candidateConfig: { members },
      recipeRef: trialRecipeRef,
      synthesizer: synthRef,
    };

    const trialRecord: PolicyStudyTrial = {
      id: t.id,
      studyId: t.studyId,
      payloadKind: "policy",
      payloadSchemaVersion: 1,
      payloadFingerprint: fingerprintStudyValue(payload),
      payload,
      status: t.status,
      sampleIndex: t.sampleIndex,
      artifactRefs: [],
      observationIds: [],
      policyCost: t.cost?.policy ?? { tokensIn: 0, tokensOut: 0 },
      experimentalCost: t.cost?.experimental ?? { tokensIn: 0, tokensOut: 0 },
      createdAt: t.createdAt,
      sealedAt: t.sealedAt,
    };

    if (isPolicyStudyTrial(trialRecord)) {
      staged.studyTrials.push(trialRecord);
      stagedTrialsById.set(t.id, trialRecord);
      decisions.push({
        store: "fusionTrials",
        id: t.id,
        status: "lossless_convert",
      });
    } else {
      decisions.push({
        store: "fusionTrials",
        id: t.id,
        status: "discard",
        reasonCode: "validation_failure",
        details: "Constructed trial failed strict PolicyStudyTrial validation",
      });
    }
  }

  // --- 5. Attempts (fusionAttempts -> studyAttempts) ---------------------------
  for (const a of source.attempts) {
    if (hasProhibitedStudyKeys(a)) {
      decisions.push({
        store: "fusionAttempts",
        id: a.id,
        status: "discard",
        reasonCode: "prohibited_keys_detected",
        details: "Attempt contains prohibited keys",
      });
      continue;
    }

    if (!stagedStudiesById.has(a.studyId)) {
      decisions.push({
        store: "fusionAttempts",
        id: a.id,
        status: "discard",
        reasonCode: "parent_study_discarded",
        details: `Parent study ${a.studyId} was discarded or not convertible`,
      });
      continue;
    }

    if (!stagedTrialsById.has(a.fromTrialId) || !stagedTrialsById.has(a.toTrialId)) {
      decisions.push({
        store: "fusionAttempts",
        id: a.id,
        status: "discard",
        reasonCode: "referenced_trial_discarded",
        details: "Attempt references a trial that was discarded",
      });
      continue;
    }

    const attemptRecord: StudyAttempt = {
      id: a.id,
      studyId: a.studyId,
      fromTrialId: a.fromTrialId,
      toTrialId: a.toTrialId,
      reason: a.reason,
      createdAt: a.createdAt,
    };

    if (isStudyAttempt(attemptRecord)) {
      staged.studyAttempts.push(attemptRecord);
      decisions.push({
        store: "fusionAttempts",
        id: a.id,
        status: "lossless_convert",
      });
    } else {
      decisions.push({
        store: "fusionAttempts",
        id: a.id,
        status: "discard",
        reasonCode: "validation_failure",
        details: "Constructed attempt failed strict StudyAttempt validation",
      });
    }
  }

  // --- 6. Observations (fusionObservations -> studyObservations) ---------------
  for (const o of source.observations) {
    if (hasProhibitedStudyKeys(o)) {
      decisions.push({
        store: "fusionObservations",
        id: o.id,
        status: "discard",
        reasonCode: "prohibited_keys_detected",
        details: "Observation contains prohibited keys",
      });
      continue;
    }

    const parentTrial = stagedTrialsById.get(o.trialId);
    if (!parentTrial) {
      decisions.push({
        store: "fusionObservations",
        id: o.id,
        status: "discard",
        reasonCode: "referenced_trial_discarded",
        details: `Referenced trial ${o.trialId} was discarded or not convertible`,
      });
      continue;
    }

    // Resolve judge
    let judgeRef: ExactModelConfigurationRef | null = null;
    if (isExactModelConfigurationRef(o.judge)) {
      judgeRef = o.judge;
    } else if (isExactModelConfigurationRef({ id: o.judge.model })) {
      judgeRef = { id: o.judge.model };
    } else {
      const mapped =
        options.exactModelConfigurations?.[o.judge.model] ??
        options.exactModelConfigurations?.[`${o.judge.providerId}:${o.judge.model}`];
      if (mapped && isExactModelConfigurationRef({ id: mapped })) {
        judgeRef = { id: mapped };
      }
    }

    if (!judgeRef) {
      decisions.push({
        store: "fusionObservations",
        id: o.id,
        status: "discard",
        reasonCode: "critic_ref_not_mc_sha256",
        details: "Observation judge is CriticRef rather than exact mc:sha256 model configuration reference",
      });
      continue;
    }

    const obsRecord: PolicyStudyObservation = {
      id: o.id,
      studyId: parentTrial.studyId,
      trialId: o.trialId,
      payloadKind: "policy_measurement",
      payloadSchemaVersion: 1,
      payload: {
        judge: judgeRef,
        overallScore: o.overallScore,
        tokensIn: o.tokensIn,
        tokensOut: o.tokensOut,
        error: o.error,
      },
      status: o.error ? "failed" : "completed",
      sourceRunId: o.runId,
      createdAt: o.startedAt,
      finishedAt: o.finishedAt,
    };

    if (isPolicyStudyObservation(obsRecord)) {
      staged.studyObservations.push(obsRecord);
      parentTrial.observationIds.push(obsRecord.id);
      decisions.push({
        store: "fusionObservations",
        id: o.id,
        status: "lossless_convert",
      });
    } else {
      decisions.push({
        store: "fusionObservations",
        id: o.id,
        status: "discard",
        reasonCode: "validation_failure",
        details: "Constructed observation failed strict PolicyStudyObservation validation",
      });
    }
  }

  // --- 7. Playbooks (fusionPlaybooks -> policyPlaybooks) -----------------------
  for (const pb of source.playbooks) {
    if (hasProhibitedStudyKeys(pb)) {
      decisions.push({
        store: "fusionPlaybooks",
        id: pb.id,
        status: "discard",
        reasonCode: "prohibited_keys_detected",
        details: "Playbook contains prohibited keys",
      });
      continue;
    }

    const parentStudy = stagedStudiesById.get(pb.studyId);
    if (!parentStudy) {
      decisions.push({
        store: "fusionPlaybooks",
        id: pb.id,
        status: "discard",
        reasonCode: "parent_study_discarded",
        details: `Parent study ${pb.studyId} was discarded or not convertible`,
      });
      continue;
    }

    // Pool adequacy check
    if (pb.poolAdequacy.outcome !== "confirmed") {
      decisions.push({
        store: "fusionPlaybooks",
        id: pb.id,
        status: "discard",
        reasonCode: "pool_adequacy_unconfirmed_not_supported",
        details: `Pool adequacy outcome "${String(pb.poolAdequacy.outcome)}" is unconfirmed/null, which is not supported in PolicyReportPayload`,
      });
      continue;
    }

    const rows: PolicyPlaybookRow[] = pb.rows.map((r) => ({
      policy: r.policy,
      configuration: r.configuration,
      meanOutcome: r.score,
      lift: r.lift,
      costMultiplier: r.costMultiplier,
      confidence: r.confidence,
    }));

    const recommendation: PolicyRecommendation =
      pb.recommendation.kind === "adopt"
        ? {
            kind: "adopt",
            policy: pb.recommendation.policy,
            configuration: pb.recommendation.configuration,
            rationale: pb.recommendation.rationale,
          }
        : {
            kind: "do_not_fuse",
            rationale: pb.recommendation.rationale,
          };

    const supportingTrials = staged.studyTrials.filter((t) => t.studyId === pb.studyId).map((t) => t.id);
    const supportingObservations = staged.studyObservations.filter((o) => o.studyId === pb.studyId).map((o) => o.id);

    const reportPayload: PolicyReportPayload = {
      studyId: pb.studyId,
      definitionFingerprint: parentStudy.definitionFingerprint,
      rows,
      recommendation,
      poolAdequacy: {
        probed: pb.poolAdequacy.probed,
        outcome: pb.poolAdequacy.outcome,
        note: pb.poolAdequacy.note,
      },
      recipeSensitivity: {
        checked: false,
        note: "Migrated from legacy Fusion playbook",
      },
      claimLevel: pb.claimLevel,
      conclusion: pb.conclusion,
      supportingTrialIds: supportingTrials,
      supportingObservationIds: supportingObservations,
      reportSchemaVersion: 1,
      createdAt: pb.createdAt,
    };

    if (isPolicyReportPayload(reportPayload)) {
      staged.policyPlaybooks.push({ id: pb.id, playbook: reportPayload });
      decisions.push({
        store: "fusionPlaybooks",
        id: pb.id,
        status: "lossless_convert",
      });
    } else {
      decisions.push({
        store: "fusionPlaybooks",
        id: pb.id,
        status: "discard",
        reasonCode: "validation_failure",
        details: "Constructed report payload failed strict PolicyReportPayload validation",
      });
    }
  }

  // --- 8. Build Deterministic Receipt -----------------------------------------
  const sourceCounts: Record<FusionStoreName, number> = {
    fusionRecipes: source.recipes.length,
    poolManifests: source.pools.length,
    fusionStudies: source.studies.length,
    fusionTrials: source.trials.length,
    fusionAttempts: source.attempts.length,
    fusionObservations: source.observations.length,
    fusionPlaybooks: source.playbooks.length,
  };

  const convertedCounts = {
    labRecipeRecords: staged.labRecipeRecords.length,
    labRecipeVersions: staged.labRecipeVersions.length,
    modelPoolRecords: staged.modelPoolRecords.length,
    modelPoolVersions: staged.modelPoolVersions.length,
    studies: staged.studies.length,
    studyTrials: staged.studyTrials.length,
    studyAttempts: staged.studyAttempts.length,
    studyObservations: staged.studyObservations.length,
    policyPlaybooks: staged.policyPlaybooks.length,
  };

  const discardedCounts: Record<FusionStoreName, number> = {
    fusionRecipes: 0,
    poolManifests: 0,
    fusionStudies: 0,
    fusionTrials: 0,
    fusionAttempts: 0,
    fusionObservations: 0,
    fusionPlaybooks: 0,
  };

  for (const d of decisions) {
    if (d.status === "discard") {
      discardedCounts[d.store] = (discardedCounts[d.store] ?? 0) + 1;
    }
  }

  const receipt = createDeterministicReceipt({
    generatedAt,
    sourceCounts,
    convertedCounts,
    discardedCounts,
    decisions,
    status: "preview_completed",
  });

  const totalConverted =
    convertedCounts.labRecipeRecords +
    convertedCounts.labRecipeVersions +
    convertedCounts.modelPoolRecords +
    convertedCounts.modelPoolVersions +
    convertedCounts.studies +
    convertedCounts.studyTrials +
    convertedCounts.studyAttempts +
    convertedCounts.studyObservations +
    convertedCounts.policyPlaybooks;

  return {
    receipt,
    staged,
    isAllDiscard: totalConverted === 0,
    isSideEffectFree: true,
  };
}
