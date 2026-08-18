import {
  POLICY_DEFINITION_SCHEMA_VERSION,
  type PolicyStudyDefinition,
  type PolicyStudyRecord,
} from "../../lib/studies/policy/policy-study-types";
import { fingerprintStudyValue } from "../../lib/studies/study-fingerprint";

export const PLACEHOLDER_DIGEST = `sha256:${"c".repeat(64)}`;
export const PLACEHOLDER_MC_1 = `mc:sha256:${"d".repeat(64)}`;
export const PLACEHOLDER_MC_2 = `mc:sha256:${"e".repeat(64)}`;

export function generateLabId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function draftPolicyStudyDefinition(
  workload?: { taskSetId: string; version: number; manifestDigest?: string },
): PolicyStudyDefinition {
  return {
    workload: {
      taskSetId: workload?.taskSetId ?? "unspecified",
      version: workload?.version ?? 1,
      manifestDigest: workload?.manifestDigest ?? PLACEHOLDER_DIGEST,
    },
    modelPool: { poolId: "unspecified", version: 1, digest: PLACEHOLDER_DIGEST },
    fusionRecipes: [{ recipeId: "unspecified", version: 1, digest: PLACEHOLDER_DIGEST }],
    judge1: { id: PLACEHOLDER_MC_1 },
    judge2: { id: PLACEHOLDER_MC_2 },
    rubric: { rubricId: "unspecified", version: 1 },
    protocolFingerprint: PLACEHOLDER_DIGEST,
    policies: ["best_fixed", "rank", "fuse", "refine"],
    stageProtocolVersion: 1,
    claimPlan: "exploration",
  };
}

export function draftPolicyStudyRecord(
  title: string,
  definition: PolicyStudyDefinition,
  now: number,
  id = generateLabId("study"),
): PolicyStudyRecord {
  return {
    id,
    revision: 0,
    kind: "policy",
    title,
    status: "draft",
    claimLevel: "exploratory",
    definitionSchemaVersion: POLICY_DEFINITION_SCHEMA_VERSION,
    definitionFingerprint: fingerprintStudyValue(definition),
    definition,
    reportRef: null,
    confirmationOf: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}
