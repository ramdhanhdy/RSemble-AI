import { canonicalJsonString, hashArtifactContent } from "../evaluations/protocol-fingerprint";

export const MODEL_ROLLUP_AGGREGATION_POLICY = "stratified_only" as const;
export type ModelRollupAggregationPolicy = typeof MODEL_ROLLUP_AGGREGATION_POLICY;

export interface ModelRollupRecord {
  id: string;
  name: string;
  latestVersion: number;
  revision: number;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface ModelRollupVersion {
  rollupId: string;
  version: number;
  name: string;
  memberConfigurationIds: string[];
  aggregationPolicy: ModelRollupAggregationPolicy;
  memberManifestDigest: string;
  createdAt: number;
}

export type ModelRollupVersionInput = Omit<ModelRollupVersion, "memberManifestDigest">;

export interface ResolvedModelRollupManifest {
  rollupId: string;
  version: number;
  aggregationPolicy: ModelRollupAggregationPolicy;
  name: string;
  memberConfigurationIds: string[];
  createdAt: number;
}

const MODEL_CONFIGURATION_ID = /^mc:sha256:[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RECORD_KEYS = [
  "id",
  "name",
  "latestVersion",
  "revision",
  "createdAt",
  "updatedAt",
  "archivedAt",
] as const;
const VERSION_KEYS = [
  "rollupId",
  "version",
  "name",
  "memberConfigurationIds",
  "aggregationPolicy",
  "memberManifestDigest",
  "createdAt",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function timestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function computeModelRollupMemberManifestDigest(value: ModelRollupVersionInput): string {
  return hashArtifactContent(
    canonicalJsonString({
      rollupId: value.rollupId,
      version: value.version,
      name: value.name,
      memberConfigurationIds: value.memberConfigurationIds,
      aggregationPolicy: value.aggregationPolicy,
      createdAt: value.createdAt,
    }),
  );
}

export function createModelRollupVersion(input: ModelRollupVersionInput): ModelRollupVersion {
  const version: ModelRollupVersion = {
    ...input,
    memberConfigurationIds: [...input.memberConfigurationIds],
    memberManifestDigest: computeModelRollupMemberManifestDigest(input),
  };
  if (!isModelRollupVersion(version)) {
    throw new Error("Invalid Model Rollup version");
  }
  return version;
}

export function isModelRollupRecord(value: unknown): value is ModelRollupRecord {
  if (!isRecord(value) || !hasOnlyKeys(value, RECORD_KEYS)) return false;
  return (
    nonBlank(value.id) &&
    nonBlank(value.name) &&
    positiveInteger(value.latestVersion) &&
    nonNegativeInteger(value.revision) &&
    timestamp(value.createdAt) &&
    timestamp(value.updatedAt) &&
    value.updatedAt >= value.createdAt &&
    (value.archivedAt === null ||
      (timestamp(value.archivedAt) && value.archivedAt >= value.createdAt))
  );
}

export function isModelRollupVersion(value: unknown): value is ModelRollupVersion {
  if (!isRecord(value) || !hasOnlyKeys(value, VERSION_KEYS)) return false;
  if (
    !nonBlank(value.rollupId) ||
    !positiveInteger(value.version) ||
    !nonBlank(value.name) ||
    value.aggregationPolicy !== MODEL_ROLLUP_AGGREGATION_POLICY ||
    !timestamp(value.createdAt) ||
    typeof value.memberManifestDigest !== "string" ||
    !DIGEST.test(value.memberManifestDigest) ||
    !Array.isArray(value.memberConfigurationIds) ||
    value.memberConfigurationIds.length === 0 ||
    !value.memberConfigurationIds.every(
      (member): member is string =>
        typeof member === "string" && MODEL_CONFIGURATION_ID.test(member),
    ) ||
    new Set(value.memberConfigurationIds).size !== value.memberConfigurationIds.length
  ) {
    return false;
  }
  return (
    computeModelRollupMemberManifestDigest(value as unknown as ModelRollupVersionInput) ===
    value.memberManifestDigest
  );
}

export function modelRollupVersionToResolvedManifest(
  version: ModelRollupVersion,
): ResolvedModelRollupManifest {
  if (!isModelRollupVersion(version)) throw new Error("Invalid Model Rollup version");
  return {
    rollupId: version.rollupId,
    version: version.version,
    aggregationPolicy: version.aggregationPolicy,
    name: version.name,
    memberConfigurationIds: [...version.memberConfigurationIds],
    createdAt: version.createdAt,
  };
}
