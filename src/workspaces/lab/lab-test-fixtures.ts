// Shared factories for Research Lab UI tests (Task 8). Not product code.
import {
  POLICY_DEFINITION_SCHEMA_VERSION,
  POLICY_REPORT_SCHEMA_VERSION,
  type PolicyReportPayload,
  type PolicyStudyDefinition,
  type PolicyStudyRecord,
} from "../../lib/studies/policy/policy-study-types";
import { fingerprintStudyValue } from "../../lib/studies/study-fingerprint";
import {
  canonicalRecipePayload,
  recipeDigest,
  type LabRecipeRecord,
  type LabRecipeVersion,
} from "../../lib/studies/lab-recipe-types";
import {
  canonicalPoolPayload,
  poolDigest,
  type ModelPoolRecord,
  type ModelPoolVersion,
} from "../../lib/studies/model-pool-types";
import type { CriticRef } from "../../lib/providers/types";
import type { ModelSlot } from "../../studio-data";

export const DIGEST = `sha256:${"a".repeat(64)}`;
export const PROTOCOL_FP = `sha256:${"b".repeat(64)}`;
export const MC1 = `mc:sha256:${"0".repeat(64)}`;
export const MC2 = `mc:sha256:${"1".repeat(64)}`;

export function makeDefinition(
  overrides: Partial<PolicyStudyDefinition> = {},
): PolicyStudyDefinition {
  return {
    workload: { taskSetId: "ts1", version: 6, manifestDigest: DIGEST },
    modelPool: { poolId: "pool-1", version: 4, digest: DIGEST },
    fusionRecipes: [{ recipeId: "recipe-1", version: 3, digest: DIGEST }],
    judge1: { id: MC1 },
    judge2: { id: MC2 },
    rubric: { rubricId: "rub1", version: 2 },
    protocolFingerprint: PROTOCOL_FP,
    policies: ["best_fixed", "rank", "fuse", "refine"],
    stageProtocolVersion: 1,
    claimPlan: "exploration",
    ...overrides,
  };
}

export function makeStudyRecord(overrides: Partial<PolicyStudyRecord> = {}): PolicyStudyRecord {
  const definition = overrides.definition ?? makeDefinition();
  return {
    id: "study-1",
    revision: 0,
    kind: "policy",
    title: "Pair screening on holdout",
    status: "draft",
    claimLevel: "exploratory",
    definitionSchemaVersion: POLICY_DEFINITION_SCHEMA_VERSION,
    reportRef: null,
    confirmationOf: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    archivedAt: null,
    ...overrides,
    definition,
    definitionFingerprint: fingerprintStudyValue(definition),
  };
}

export function makePlaybook(overrides: Partial<PolicyReportPayload> = {}): PolicyReportPayload {
  return {
    studyId: "study-1",
    definitionFingerprint: fingerprintStudyValue(makeDefinition()),
    rows: [
      {
        policy: "fuse",
        configuration: "A × C",
        meanOutcome: 0.81,
        lift: 0.11,
        costMultiplier: 2.6,
        confidence: "medium",
      },
    ],
    recommendation: {
      kind: "do_not_fuse",
      rationale: "Rank matches Fuse within MPID at lower cost.",
    },
    poolAdequacy: { probed: true, outcome: "confirmed", note: "Challenger failed." },
    recipeSensitivity: { checked: true, note: "Stable across prompt variants." },
    claimLevel: "exploratory",
    conclusion: "Rank A+C when cost matters; do not use fusion for routine runs.",
    supportingTrialIds: ["trial-1"],
    supportingObservationIds: ["obs-1"],
    reportSchemaVersion: POLICY_REPORT_SCHEMA_VERSION,
    createdAt: 4_000,
    ...overrides,
  };
}

const SYNTH: CriticRef = { providerId: "openrouter", model: "acme/synth-1" };

function slot(id: string, slug: string): ModelSlot {
  return { id, providerId: "openrouter", provider: "Test", model: id, slug, enabled: true };
}

export function makeRecipeRecord(
  id = "recipe-1",
  overrides: Partial<LabRecipeRecord> = {},
): LabRecipeRecord {
  return {
    id,
    kind: "fusion",
    name: "Blind Raw",
    description: "Anonymized candidates only.",
    latestVersion: 1,
    revision: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    archivedAt: null,
    ...overrides,
  };
}

export function makeRecipeVersion(
  recipeId = "recipe-1",
  version = 1,
  overrides: Partial<LabRecipeVersion> = {},
): LabRecipeVersion {
  const content = {
    recipeFamily: "BlindRaw" as const,
    promptVersion: "blind-raw-v1",
    judgeAnalysisMode: "none" as const,
    rubricAccess: false,
    verification: false,
    synthesizer: SYNTH,
  };
  const merged = { ...content, ...overrides };
  const payload = {
    recipeFamily: merged.recipeFamily,
    promptVersion: merged.promptVersion,
    judgeAnalysisMode: merged.judgeAnalysisMode,
    rubricAccess: merged.rubricAccess,
    verification: merged.verification,
    synthesizer: merged.synthesizer,
  };
  return {
    recipeId,
    version,
    kind: "fusion",
    createdAt: 1_000 + version,
    ...overrides,
    ...payload,
    canonicalPayload: canonicalRecipePayload(payload),
    digest: recipeDigest(payload),
  };
}

export function makePoolRecord(
  id = "pool-1",
  overrides: Partial<ModelPoolRecord> = {},
): ModelPoolRecord {
  return {
    id,
    name: "Diversity pool A",
    purpose: "Stage B pair screening.",
    latestVersion: 1,
    revision: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    archivedAt: null,
    ...overrides,
  };
}

export function makePoolVersion(
  poolId = "pool-1",
  version = 1,
  overrides: Partial<ModelPoolVersion> = {},
): ModelPoolVersion {
  const content = {
    core: [slot("s1", "p/m1"), slot("s2", "p/m2"), slot("s3", "p/m3")],
    challengers: [slot("ch1", "q/m7"), slot("ch2", "q/m8")],
    diversityChecklist: ["independent families"],
    rationale: "Coverage across families.",
    supersedesVersion: null as number | null,
  };
  const merged = { ...content, ...overrides };
  const payload = {
    core: merged.core,
    challengers: merged.challengers,
    diversityChecklist: merged.diversityChecklist,
    rationale: merged.rationale,
    supersedesVersion: merged.supersedesVersion,
  };
  return {
    poolId,
    version,
    createdAt: 1_000 + version,
    ...overrides,
    ...payload,
    canonicalPayload: canonicalPoolPayload(payload),
    digest: poolDigest(payload),
  };
}
