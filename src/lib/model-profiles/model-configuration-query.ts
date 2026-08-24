// =============================================================================
// RSemble AI — model-configuration-query.ts (Child 07 Task 2, GREEN)
//
// Safe derived catalog summaries over the existing Child 04 EvidenceRepository.
// Pure query: reads configurations, observations, and active eligibility
// decisions; writes nothing back. One catalog entry per exact
// ModelConfigurationSnapshot — distinct identity fields (provider route,
// requested/resolved model/version, reasoning requested/effective, tool-scaffold
// signature, sanitized runtime settings) keep configurations separate even
// when provider + marketing slug look similar.
//
// Contract (Child 07 spec §4.1–4.2, §7.1, plan Task 2):
//  - Deterministic catalog entries: modelConfigurationId, provider/requested/
//    resolved identity, identity completeness, observed window, observation
//    count, eligible profile-evidence count, latest activity, and the identity
//    metadata needed to expose meaningful configuration changes.
//  - Rolling-alias and partial-identity entries are labelled, never silently
//    promoted to exact or merged into a timeless model.
//  - No universal scores, ranks, best-model semantics, or persistent derived
//    profile state. No implicit exact-configuration merging.
//  - Reuses the existing EvidenceRepository; does not create a new storage
//    authority. Does not implement selection, coverage aggregation, UI, or a
//    rollup store.
//
// This module is pure with respect to source state: the only side effect is
// reading from the injected repository.
// =============================================================================

import type { EvidenceRepository } from "../persistence/evidence-repository";
import type {
  IdentityCompleteness,
  JsonScalar,
  ModelConfigurationSnapshot,
} from "../evidence/evidence-types";

// --- Catalog entry ------------------------------------------------------------

/**
 * One safe derived summary for an exact model configuration. Mirrors the live
 * {@link ModelConfigurationSnapshot} identity fields verbatim (no synthesis),
 * plus deterministic derived counts over the repository's observations and
 * active eligibility decisions.
 */
export interface ModelConfigurationCatalogEntry {
  modelConfigurationId: string;
  providerId: string;
  requestedModel: string;
  resolvedModel: string | null;
  resolvedVersion: string | null;
  reasoningRequested: string | null;
  reasoningEffective: string | null;
  toolScaffoldSignature: string | null;
  runtimeSettings: Record<string, JsonScalar>;
  identityCompleteness: IdentityCompleteness;
  /** Observed execution window from the stored snapshot (authority). */
  observedFrom: number;
  observedTo: number;
  /** Number of observations indexed to this configuration. */
  observationCount: number;
  /** Observations whose active eligibility decision allows
   *  `within_model_profile` (eligible profile-evidence). */
  eligibleProfileEvidenceCount: number;
  /** Most recent observation timestamp, or the snapshot window start when the
   *  configuration has no observations yet. */
  latestActivity: number;
}

// --- Query filter -------------------------------------------------------------

/**
 * Optional filters that restrict the catalog without inventing configurations.
 * `modelConfigurationIds` supports an explicit rollup member view: only the
 * named exact configurations are listed, never implicitly merged.
 */
export interface ModelConfigurationCatalogQuery {
  providerIds?: readonly string[];
  requestedModels?: readonly string[];
  identityCompleteness?: readonly IdentityCompleteness[];
  /** Explicit member configuration ids (e.g. a resolved rollup member list). */
  modelConfigurationIds?: readonly string[];
  /** Inclusive window; a configuration is included when its observed window
   *  overlaps [observedFrom, observedTo]. */
  observedFrom?: number | null;
  observedTo?: number | null;
}

// --- Receipt ------------------------------------------------------------------

export interface ModelConfigurationCatalogReceipt {
  generatedAt: number;
  configurationCount: number;
  totalObservations: number;
  totalEligibleProfileEvidence: number;
}

export interface ModelConfigurationCatalogResult {
  entries: ModelConfigurationCatalogEntry[];
  receipt: ModelConfigurationCatalogReceipt;
}

// --- Deterministic ordering ---------------------------------------------------

/**
 * Canonical sort key for one entry. Identity fields first (provider, requested
 * model, resolved model/version, reasoning policy, tool-scaffold signature),
 * then the configuration id as the final stable tiebreak. Null identity
 * fields sort as the empty string so partial/rolling entries are placed
 * deterministically relative to exact ones.
 */
function catalogSortKey(entry: ModelConfigurationCatalogEntry): string {
  return [
    entry.providerId,
    entry.requestedModel,
    entry.resolvedModel ?? "",
    entry.resolvedVersion ?? "",
    entry.reasoningRequested ?? "",
    entry.reasoningEffective ?? "",
    entry.toolScaffoldSignature ?? "",
    entry.modelConfigurationId,
  ].join("\u0000");
}

function compareEntries(
  a: ModelConfigurationCatalogEntry,
  b: ModelConfigurationCatalogEntry,
): number {
  return catalogSortKey(a).localeCompare(catalogSortKey(b));
}

// --- Filters ------------------------------------------------------------------

function toSet(values: readonly string[] | undefined): Set<string> | null {
  if (values === undefined) return null;
  return new Set(values);
}

function windowOverlaps(
  cfg: ModelConfigurationSnapshot,
  from: number | null | undefined,
  to: number | null | undefined,
): boolean {
  if (from === undefined && to === undefined) return true;
  const qFrom = from ?? -Infinity;
  const qTo = to ?? Infinity;
  return cfg.observedFrom <= qTo && cfg.observedTo >= qFrom;
}

function passesFilters(
  cfg: ModelConfigurationSnapshot,
  query: ModelConfigurationCatalogQuery | undefined,
  providerSet: Set<string> | null,
  requestedSet: Set<string> | null,
  completenessSet: Set<IdentityCompleteness> | null,
  idSet: Set<string> | null,
): boolean {
  if (providerSet !== null && !providerSet.has(cfg.providerId)) return false;
  if (requestedSet !== null && !requestedSet.has(cfg.requestedModel)) return false;
  if (completenessSet !== null && !completenessSet.has(cfg.identityCompleteness)) return false;
  if (idSet !== null && !idSet.has(cfg.id)) return false;
  if (!windowOverlaps(cfg, query?.observedFrom, query?.observedTo)) return false;
  return true;
}

// --- Entry builder ------------------------------------------------------------

function entryFromSnapshot(
  cfg: ModelConfigurationSnapshot,
  observationCount: number,
  eligibleProfileEvidenceCount: number,
  latestActivity: number,
): ModelConfigurationCatalogEntry {
  return {
    modelConfigurationId: cfg.id,
    providerId: cfg.providerId,
    requestedModel: cfg.requestedModel,
    resolvedModel: cfg.resolvedModel,
    resolvedVersion: cfg.resolvedVersion,
    reasoningRequested: cfg.reasoningRequested,
    reasoningEffective: cfg.reasoningEffective,
    toolScaffoldSignature: cfg.toolScaffoldSignature,
    runtimeSettings: { ...cfg.runtimeSettings },
    identityCompleteness: cfg.identityCompleteness,
    observedFrom: cfg.observedFrom,
    observedTo: cfg.observedTo,
    observationCount,
    eligibleProfileEvidenceCount,
    latestActivity,
  };
}

// --- Public query -------------------------------------------------------------

/**
 * Build a safe derived catalog of exact model configurations over the existing
 * Child 04 EvidenceRepository. Reads only; writes nothing back. Deterministic
 * and permutation-invariant. Never merges distinct configurations.
 */
export async function queryModelConfigurationCatalog(
  repo: EvidenceRepository,
  query?: ModelConfigurationCatalogQuery,
  now: number = Date.now(),
): Promise<ModelConfigurationCatalogResult> {
  const providerSet = toSet(query?.providerIds);
  const requestedSet = toSet(query?.requestedModels);
  const completenessSet =
    query?.identityCompleteness === undefined ? null : new Set(query.identityCompleteness);
  const idSet = toSet(query?.modelConfigurationIds);

  const configurations = await repo.listModelConfigurations();
  const filtered = configurations.filter((cfg) =>
    passesFilters(cfg, query, providerSet, requestedSet, completenessSet, idSet),
  );

  const entries: ModelConfigurationCatalogEntry[] = [];
  let totalObservations = 0;
  let totalEligibleProfileEvidence = 0;

  for (const cfg of filtered) {
    const observations = await repo.listObservationsByModelConfiguration(cfg.id);
    let eligibleProfileEvidenceCount = 0;
    let latestActivity = cfg.observedFrom;
    for (const obs of observations) {
      if (obs.observedAt > latestActivity) latestActivity = obs.observedAt;
      const decision = await repo.getActiveDecision(obs.id);
      if (decision && decision.allowedUses.includes("within_model_profile")) {
        eligibleProfileEvidenceCount += 1;
      }
    }
    entries.push(
      entryFromSnapshot(cfg, observations.length, eligibleProfileEvidenceCount, latestActivity),
    );
    totalObservations += observations.length;
    totalEligibleProfileEvidence += eligibleProfileEvidenceCount;
  }

  entries.sort(compareEntries);

  return {
    entries,
    receipt: {
      generatedAt: now,
      configurationCount: entries.length,
      totalObservations,
      totalEligibleProfileEvidence,
    },
  };
}
