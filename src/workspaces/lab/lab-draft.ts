import {
  POLICY_DEFINITION_SCHEMA_VERSION,
  POLICY_KINDS,
  type ExactModelConfigurationRef,
  type PolicyStudyDefinition,
  type PolicyStudyRecord,
} from "../../lib/studies/policy/policy-study-types";
import { fingerprintStudyValue } from "../../lib/studies/study-fingerprint";
import { computeModelConfigurationId } from "../../lib/evidence/model-configuration";
import type { CriticRef } from "../../lib/providers/types";

export const PLACEHOLDER_DIGEST = `sha256:${"c".repeat(64)}`;
export const PLACEHOLDER_MC_1 = `mc:sha256:${"d".repeat(64)}`;
export const PLACEHOLDER_MC_2 = `mc:sha256:${"e".repeat(64)}`;

/** The staged protocol's predeclared minimum practical important difference. */
export const PREDECLARED_MPID = 0.2;
export const STAGE_PROTOCOL_VERSION = 1;

/**
 * Content fingerprint of the pinned staged protocol (stage protocol version,
 * predeclared MPID, fixed four policies). Deterministic — every draft pins the
 * same protocol fingerprint until the protocol itself changes.
 */
export function draftProtocolFingerprint(): string {
  return fingerprintStudyValue({
    stageProtocolVersion: STAGE_PROTOCOL_VERSION,
    mpid: PREDECLARED_MPID,
    policies: [...POLICY_KINDS],
  });
}

/**
 * Resolve a provider/model identity to its exact, content-addressed model
 * configuration ref (`mc:sha256:<hex>`). Only provider/model identity fields
 * feed the hash — credentials and runtime settings never do. Used by the
 * draft editor (judge pickers) and by the execution wiring that resolves the
 * same refs back to provider calls.
 */
export function exactModelConfigRefFor(critic: CriticRef): ExactModelConfigurationRef {
  return {
    id: computeModelConfigurationId({
      providerId: critic.providerId,
      requestedModel: critic.model,
      resolvedModel: null,
      resolvedVersion: null,
      reasoningRequested: null,
      reasoningEffective: null,
      toolScaffoldSignature: null,
      runtimeSettings: {},
    }),
  };
}

export function generateLabId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Build a confirmation-plan draft from a completed exploratory study
 * (Fable §6.9 footer action). Inherits every pin — the claim plan flips to
 * confirmation and the record links its source; the editor then requires a
 * fresh Task Set Version before sealing.
 */
export function confirmationDraftFrom(
  source: PolicyStudyRecord,
  now: number,
  id = generateLabId("study"),
): PolicyStudyRecord {
  const definition: PolicyStudyDefinition = { ...source.definition, claimPlan: "confirmation" };
  return {
    id,
    revision: 0,
    kind: "policy",
    title: `Confirm: ${source.title}`,
    status: "draft",
    claimLevel: "confirmed",
    definitionSchemaVersion: source.definitionSchemaVersion,
    definitionFingerprint: fingerprintStudyValue(definition),
    definition,
    reportRef: null,
    confirmationOf: source.id,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

export function draftPolicyStudyDefinition(workload?: {
  taskSetId: string;
  version: number;
  manifestDigest?: string;
}): PolicyStudyDefinition {
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
    protocolFingerprint: draftProtocolFingerprint(),
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
