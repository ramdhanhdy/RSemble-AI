// =============================================================================
// RSemble AI — Model configuration canonicalization (spec §3.1)
//
// Canonicalizes the provider/model identity observed for one execution window
// into a ModelConfigurationSnapshot:
//
//  - resolves ONLY stored facts — unknown resolved versions remain null;
//  - completeness is exact (model + version) / rolling_alias (model known,
//    version unknown) / partial (nothing resolved);
//  - the id is `mc:sha256:<hex>` over the canonical serialization of the
//    identity fields (sorted keys, so key permutation cannot change it);
//  - credentials, headers, tokens, and secret-shaped values are omitted from
//    runtimeSettings before anything is hashed or exposed;
//  - date-window updates extend observedTo without changing identity; a
//    duplicate id with non-identical canonical content is a collision error,
//    never last-write-wins;
//  - there is no marketing-name rollup: identity comes exclusively from
//    provider/model identity fields, never display names or labels.
// =============================================================================

import { canonicalJsonString, hashArtifactContent } from "../evaluations/protocol-fingerprint";
import { isJsonScalar, EVIDENCE_PROHIBITED_KEYS } from "./evidence-validation";
import type {
  IdentityCompleteness,
  JsonScalar,
  ModelConfigurationSnapshot,
} from "./evidence-types";

/** Matches the credential-shape check used elsewhere in the workbench. */
const CREDENTIAL_LIKE_VALUE = /^(sk-|AIza|Bearer\s)/i;

export interface ModelConfigurationInput {
  providerId: string;
  requestedModel: string;
  resolvedModel?: string | null;
  resolvedVersion?: string | null;
  reasoningRequested?: string | null;
  reasoningEffective?: string | null;
  toolScaffoldSignature?: string | null;
  runtimeSettings?: Record<string, JsonScalar>;
  observedAt: number;
}

export type ModelConfigurationResult =
  | { ok: true; snapshot: ModelConfigurationSnapshot }
  | { ok: false; reason: string };

/** Identity-relevant fields of a snapshot, in canonical (sorted-key) form. */
export type ModelConfigurationIdentityFields = Pick<
  ModelConfigurationSnapshot,
  | "providerId"
  | "requestedModel"
  | "resolvedModel"
  | "resolvedVersion"
  | "reasoningRequested"
  | "reasoningEffective"
  | "toolScaffoldSignature"
  | "runtimeSettings"
>;

/**
 * Canonical serialization of the identity fields. Observation windows and the
 * derived completeness kind are intentionally excluded: extending a window or
 * recomputing a derived field must never change identity.
 */
export function canonicalModelConfigurationJson(s: ModelConfigurationIdentityFields): string {
  return canonicalJsonString({
    providerId: s.providerId,
    requestedModel: s.requestedModel,
    resolvedModel: s.resolvedModel,
    resolvedVersion: s.resolvedVersion,
    reasoningRequested: s.reasoningRequested,
    reasoningEffective: s.reasoningEffective,
    toolScaffoldSignature: s.toolScaffoldSignature,
    runtimeSettings: s.runtimeSettings,
  });
}

/** Collision-checked content fingerprint for a configuration's identity fields. */
export function computeModelConfigurationId(s: ModelConfigurationIdentityFields): string {
  return `mc:${hashArtifactContent(canonicalModelConfigurationJson(s))}`;
}

/** Collision error: duplicate id with non-identical canonical content (spec §5). */
export class ModelConfigurationCollisionError extends Error {
  constructor(
    public readonly id: string,
    public readonly canonicalExisting: string,
    public readonly canonicalIncoming: string,
  ) {
    super(
      `Model configuration collision: id ${id} is shared by non-identical canonical content. ` +
        `This is corruption, not last-write-wins.`,
    );
    this.name = "ModelConfigurationCollisionError";
  }
}

/** Deep-check: identical ids MUST carry identical canonical content. */
export function assertConfigurationContentMatches(
  existing: ModelConfigurationSnapshot,
  incoming: ModelConfigurationSnapshot,
): void {
  if (existing.id !== incoming.id) return; // Distinct identities — no collision possible.
  const a = canonicalModelConfigurationJson(existing);
  const b = canonicalModelConfigurationJson(incoming);
  if (a !== b) throw new ModelConfigurationCollisionError(existing.id, a, b);
}

export function configurationsCollide(
  existing: ModelConfigurationSnapshot,
  incoming: ModelConfigurationSnapshot,
): boolean {
  try {
    assertConfigurationContentMatches(existing, incoming);
    return false;
  } catch (err) {
    if (err instanceof ModelConfigurationCollisionError) return true;
    throw err;
  }
}

function normalizeNullable(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v;
  return null;
}

/**
 * Sanitize runtime settings: omit prohibited keys, secret-shaped string
 * values, and non-scalar entries. Sanitization happens BEFORE hashing so a
 * secret can never influence or leak through the canonical identity.
 */
function sanitizeRuntimeSettings(settings: Record<string, unknown>): Record<string, JsonScalar> {
  const out: Record<string, JsonScalar> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (EVIDENCE_PROHIBITED_KEYS.has(key)) continue;
    if (!isJsonScalar(value)) continue;
    if (typeof value === "string" && CREDENTIAL_LIKE_VALUE.test(value)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Canonicalize observed model configuration facts. Pure: resolves only what
 * the input carries; unknown versions remain null. Returns a failure reason
 * for incoherent input instead of inventing facts.
 */
export function canonicalizeModelConfiguration(
  input: ModelConfigurationInput,
): ModelConfigurationResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, reason: "Model configuration input is required." };
  }
  const providerId = normalizeNullable(input.providerId);
  const requestedModel = normalizeNullable(input.requestedModel);
  if (providerId === null) return { ok: false, reason: "providerId must be a non-blank string." };
  if (requestedModel === null) {
    return { ok: false, reason: "requestedModel must be a non-blank string." };
  }
  const resolvedModel = normalizeNullable(input.resolvedModel);
  const resolvedVersion = normalizeNullable(input.resolvedVersion);
  if (resolvedVersion !== null && resolvedModel === null) {
    return {
      ok: false,
      reason: "resolvedVersion requires a resolvedModel — a version without a model is incoherent.",
    };
  }
  if (typeof input.observedAt !== "number" || !Number.isFinite(input.observedAt) || input.observedAt < 0) {
    return { ok: false, reason: "observedAt must be a non-negative epoch ms." };
  }

  let identityCompleteness: IdentityCompleteness;
  if (resolvedModel !== null && resolvedVersion !== null) {
    identityCompleteness = "exact";
  } else if (resolvedModel !== null) {
    identityCompleteness = "rolling_alias";
  } else {
    identityCompleteness = "partial";
  }

  const fields: ModelConfigurationIdentityFields = {
    providerId,
    requestedModel,
    resolvedModel,
    resolvedVersion,
    reasoningRequested: normalizeNullable(input.reasoningRequested),
    reasoningEffective: normalizeNullable(input.reasoningEffective),
    toolScaffoldSignature: normalizeNullable(input.toolScaffoldSignature),
    runtimeSettings: sanitizeRuntimeSettings(
      (input.runtimeSettings ?? {}) as Record<string, unknown>,
    ),
  };

  const snapshot: ModelConfigurationSnapshot = {
    ...fields,
    id: computeModelConfigurationId(fields),
    observedFrom: input.observedAt,
    observedTo: input.observedAt,
    identityCompleteness,
  };
  return { ok: true, snapshot };
}

/**
 * Date-window update: same identity observed again. Extends observedTo only;
 * identity never changes. Out-of-order observations before the window start
 * are rejected — that ordering is a caller bug or tampering.
 */
export function extendConfigurationWindow(
  snapshot: ModelConfigurationSnapshot,
  observedAt: number,
): ModelConfigurationSnapshot {
  if (typeof observedAt !== "number" || !Number.isFinite(observedAt) || observedAt < 0) {
    throw new RangeError("observedAt must be a non-negative epoch ms.");
  }
  if (observedAt < snapshot.observedFrom) {
    throw new RangeError(
      `Out-of-order observation ${observedAt} precedes the window start ${snapshot.observedFrom}.`,
    );
  }
  return { ...snapshot, observedTo: Math.max(snapshot.observedTo, observedAt) };
}
