// =============================================================================
// RSemble AI — model-configuration-query.test.ts (Child 07 Task 2, RED → GREEN)
//
// Catalog summary tests: safe derived list summaries over the existing Child 04
// EvidenceRepository. Exact configurations, rolling aliases, and partial
// identities stay distinct — never merged because provider + marketing slug
// look similar. Deterministic, no universal scores/ranks, no persistent
// derived profile state.
//
// Contract under test (Child 07 spec §4.1–4.2, §7.1, plan Task 2):
//  - One catalog entry per exact ModelConfigurationSnapshot; distinct identity
//    fields (reasoning requested/effective, tool-scaffold signature, provider
//    route, resolved model/version, runtime settings) keep configurations
//    separate even when provider + requestedModel look alike.
//  - Rolling-alias and partial-identity entries are labelled, never silently
//    promoted to exact or merged into a timeless model.
//  - Each entry carries: modelConfigurationId, provider/requested/resolved
//    identity, identity completeness, observed window, observation count,
//    eligible profile-evidence count, latest activity, and the identity
//    metadata needed to expose meaningful configuration changes.
//  - Deterministic, permutation-invariant ordering; no implicit merge.
//  - Filters restrict the catalog without inventing configurations.
//  - No universal score, rank, or best-model semantics; no persistent derived
//    profile state is written.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  MILESTONE_A_GOLDEN,
  milestoneAObservations,
  milestoneADecisions,
} from "./__fixtures__/milestone-a-golden";

import {
  queryModelConfigurationCatalog,
  type ModelConfigurationCatalogEntry,
  type ModelConfigurationCatalogQuery,
} from "./model-configuration-query";
import {
  InMemoryEvidenceRepository,
  type EvidenceRepository,
} from "../persistence/evidence-repository";
import type {
  EligibilityDecision,
  ModelConfigurationSnapshot,
  Observation,
} from "../evidence/evidence-types";

// --- Fixture seeding ----------------------------------------------------------

const CFG = MILESTONE_A_GOLDEN.configurations;
const EXACT_ALPHA = CFG.exactAlpha;
const EXACT_ALPHA_LOW_REASONING = CFG.exactAlphaLowReasoning;
const EXACT_ALPHA_TOOLS = CFG.exactAlphaTools;
const EXACT_BETA = CFG.exactBeta;
const ROLLING_ALPHA = CFG.rollingAlpha;
const PARTIAL_LEGACY = CFG.partialLegacy;

const ALL_CONFIGS: ModelConfigurationSnapshot[] = [
  EXACT_ALPHA,
  EXACT_ALPHA_LOW_REASONING,
  EXACT_ALPHA_TOOLS,
  EXACT_BETA,
  ROLLING_ALPHA,
  PARTIAL_LEGACY,
];

async function seedRepo(): Promise<EvidenceRepository> {
  const repo = new InMemoryEvidenceRepository();
  for (const cfg of ALL_CONFIGS) {
    await repo.putModelConfiguration(cfg);
  }
  for (const obs of milestoneAObservations()) {
    await repo.putObservation(obs);
  }
  for (const decision of milestoneADecisions()) {
    await repo.putDecision(decision);
  }
  return repo;
}

function entryFor(
  entries: ModelConfigurationCatalogEntry[],
  id: string,
): ModelConfigurationCatalogEntry {
  const found = entries.find((e) => e.modelConfigurationId === id);
  if (!found) throw new Error(`no catalog entry for ${id}`);
  return found;
}

function withinModelProfileDecisionCount(
  observations: Observation[],
  decisions: EligibilityDecision[],
): number {
  const byObs = new Map(decisions.map((d) => [d.observationId, d]));
  return observations.filter((o) => {
    const d = byObs.get(o.id);
    return !!d && d.allowedUses.includes("within_model_profile");
  }).length;
}

// --- Tests --------------------------------------------------------------------

describe("model-configuration catalog — exact configurations stay unmerged", () => {
  it("produces one entry per stored exact configuration (no implicit merge)", async () => {
    const repo = await seedRepo();
    const { entries } = await queryModelConfigurationCatalog(repo);

    expect(entries).toHaveLength(ALL_CONFIGS.length);
    const ids = entries.map((e) => e.modelConfigurationId);
    for (const cfg of ALL_CONFIGS) {
      expect(ids).toContain(cfg.id);
    }
    // No duplicate ids.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps reasoning-policy variants distinct even with identical provider + model", async () => {
    const repo = await seedRepo();
    const { entries } = await queryModelConfigurationCatalog(repo);

    const alpha = entryFor(entries, EXACT_ALPHA.id);
    const lowReasoning = entryFor(entries, EXACT_ALPHA_LOW_REASONING.id);

    expect(alpha.modelConfigurationId).not.toBe(lowReasoning.modelConfigurationId);
    expect(alpha.providerId).toBe(lowReasoning.providerId);
    expect(alpha.requestedModel).toBe(lowReasoning.requestedModel);
    expect(alpha.resolvedModel).toBe(lowReasoning.resolvedModel);
    expect(alpha.resolvedVersion).toBe(lowReasoning.resolvedVersion);
    // The identity difference that keeps them separate:
    expect(alpha.reasoningRequested).toBe("high");
    expect(lowReasoning.reasoningRequested).toBe("low");
    expect(alpha.reasoningEffective).toBe("high");
    expect(lowReasoning.reasoningEffective).toBe("low");
  });

  it("keeps tool-scaffold variants distinct even with identical reasoning", async () => {
    const repo = await seedRepo();
    const { entries } = await queryModelConfigurationCatalog(repo);

    const alpha = entryFor(entries, EXACT_ALPHA.id);
    const tools = entryFor(entries, EXACT_ALPHA_TOOLS.id);

    expect(alpha.modelConfigurationId).not.toBe(tools.modelConfigurationId);
    expect(alpha.providerId).toBe(tools.providerId);
    expect(alpha.requestedModel).toBe(tools.requestedModel);
    expect(alpha.reasoningRequested).toBe(tools.reasoningRequested);
    expect(alpha.toolScaffoldSignature).toBeNull();
    expect(tools.toolScaffoldSignature).toBe("scaffold:json-tools:v1");
  });

  it("keeps provider-route variants distinct", async () => {
    const repo = await seedRepo();
    const { entries } = await queryModelConfigurationCatalog(repo);

    const alpha = entryFor(entries, EXACT_ALPHA.id);
    const beta = entryFor(entries, EXACT_BETA.id);

    expect(alpha.providerId).toBe("openrouter");
    expect(beta.providerId).toBe("anthropic");
    expect(alpha.requestedModel).toBe("org/alpha");
    expect(beta.requestedModel).toBe("claude-x");
  });
});

describe("model-configuration catalog — rolling aliases and partial identities", () => {
  it("labels rolling-alias identity completeness and keeps unknown resolved version", async () => {
    const repo = await seedRepo();
    const { entries } = await queryModelConfigurationCatalog(repo);
    const rolling = entryFor(entries, ROLLING_ALPHA.id);

    expect(rolling.identityCompleteness).toBe("rolling_alias");
    expect(rolling.resolvedModel).toBe("org/alpha");
    expect(rolling.resolvedVersion).toBeNull();
    // Never promoted to exact, never merged with the exact alpha configuration.
    expect(rolling.modelConfigurationId).not.toBe(EXACT_ALPHA.id);
  });

  it("labels partial identity completeness with unresolved model/version", async () => {
    const repo = await seedRepo();
    const { entries } = await queryModelConfigurationCatalog(repo);
    const partial = entryFor(entries, PARTIAL_LEGACY.id);

    expect(partial.identityCompleteness).toBe("partial");
    expect(partial.resolvedModel).toBeNull();
    expect(partial.resolvedVersion).toBeNull();
    expect(partial.reasoningRequested).toBeNull();
    expect(partial.reasoningEffective).toBeNull();
  });

  it("never merges a rolling alias with an exact configuration that shares provider + resolved model", async () => {
    const repo = await seedRepo();
    const { entries } = await queryModelConfigurationCatalog(repo);

    const rolling = entryFor(entries, ROLLING_ALPHA.id);
    const exact = entryFor(entries, EXACT_ALPHA.id);

    // Same provider, same resolved model — but the rolling alias has a
    // different requested slug ("org/alpha-latest") and no resolved version.
    expect(rolling.providerId).toBe(exact.providerId);
    expect(rolling.resolvedModel).toBe(exact.resolvedModel);
    expect(rolling.requestedModel).not.toBe(exact.requestedModel);
    expect(rolling.modelConfigurationId).not.toBe(exact.modelConfigurationId);
    expect(rolling.identityCompleteness).not.toBe(exact.identityCompleteness);
  });
});

describe("model-configuration catalog — observed window, counts, latest activity", () => {
  it("reports the configuration observed window from the stored snapshot", async () => {
    const repo = await seedRepo();
    const { entries } = await queryModelConfigurationCatalog(repo);
    const alpha = entryFor(entries, EXACT_ALPHA.id);

    expect(alpha.observedFrom).toBe(EXACT_ALPHA.observedFrom);
    expect(alpha.observedTo).toBe(EXACT_ALPHA.observedTo);
  });

  it("counts observations per configuration from the repository", async () => {
    const repo = await seedRepo();
    const { entries } = await queryModelConfigurationCatalog(repo);
    const alpha = entryFor(entries, EXACT_ALPHA.id);

    const observations = await repo.listObservationsByModelConfiguration(EXACT_ALPHA.id);
    expect(alpha.observationCount).toBe(observations.length);
    expect(alpha.observationCount).toBeGreaterThan(0);
  });

  it("counts eligible profile-evidence as observations whose active decision allows within_model_profile", async () => {
    const repo = await seedRepo();
    const { entries } = await queryModelConfigurationCatalog(repo);
    const alpha = entryFor(entries, EXACT_ALPHA.id);

    const observations = await repo.listObservationsByModelConfiguration(EXACT_ALPHA.id);
    const expected = withinModelProfileDecisionCount(observations, milestoneADecisions());
    expect(alpha.eligibleProfileEvidenceCount).toBe(expected);
    expect(alpha.eligibleProfileEvidenceCount).toBeLessThanOrEqual(alpha.observationCount);
  });

  it("reports latest activity as the most recent observation timestamp", async () => {
    const repo = await seedRepo();
    const { entries } = await queryModelConfigurationCatalog(repo);
    const alpha = entryFor(entries, EXACT_ALPHA.id);

    const observations = await repo.listObservationsByModelConfiguration(EXACT_ALPHA.id);
    const maxObservedAt = observations.reduce((m, o) => Math.max(m, o.observedAt), -Infinity);
    expect(alpha.latestActivity).toBe(maxObservedAt);
  });

  it("reports zero counts and the snapshot window for a configuration with no observations", async () => {
    const repo = new InMemoryEvidenceRepository();
    await repo.putModelConfiguration(EXACT_BETA);
    const { entries } = await queryModelConfigurationCatalog(repo);
    const beta = entryFor(entries, EXACT_BETA.id);

    expect(beta.observationCount).toBe(0);
    expect(beta.eligibleProfileEvidenceCount).toBe(0);
    expect(beta.latestActivity).toBe(EXACT_BETA.observedFrom);
    expect(beta.observedFrom).toBe(EXACT_BETA.observedFrom);
    expect(beta.observedTo).toBe(EXACT_BETA.observedTo);
  });
});

describe("model-configuration catalog — identity metadata exposes changes", () => {
  it("carries every identity field needed to surface a meaningful configuration change", async () => {
    const repo = await seedRepo();
    const { entries } = await queryModelConfigurationCatalog(repo);
    const alpha = entryFor(entries, EXACT_ALPHA.id);

    // Identity fields mirror the live snapshot verbatim (no synthesis).
    expect(alpha.providerId).toBe(EXACT_ALPHA.providerId);
    expect(alpha.requestedModel).toBe(EXACT_ALPHA.requestedModel);
    expect(alpha.resolvedModel).toBe(EXACT_ALPHA.resolvedModel);
    expect(alpha.resolvedVersion).toBe(EXACT_ALPHA.resolvedVersion);
    expect(alpha.reasoningRequested).toBe(EXACT_ALPHA.reasoningRequested);
    expect(alpha.reasoningEffective).toBe(EXACT_ALPHA.reasoningEffective);
    expect(alpha.toolScaffoldSignature).toBe(EXACT_ALPHA.toolScaffoldSignature);
    expect(alpha.runtimeSettings).toEqual(EXACT_ALPHA.runtimeSettings);
    expect(alpha.identityCompleteness).toBe(EXACT_ALPHA.identityCompleteness);
  });

  it("does not invent resolved versions, reasoning settings, or tool signatures", async () => {
    const repo = await seedRepo();
    const { entries } = await queryModelConfigurationCatalog(repo);
    const partial = entryFor(entries, PARTIAL_LEGACY.id);

    expect(partial.resolvedModel).toBeNull();
    expect(partial.resolvedVersion).toBeNull();
    expect(partial.reasoningRequested).toBeNull();
    expect(partial.reasoningEffective).toBeNull();
    expect(partial.toolScaffoldSignature).toBeNull();
  });
});

describe("model-configuration catalog — deterministic ordering", () => {
  it("orders entries deterministically and permutation-invariantly", async () => {
    const repo = await seedRepo();
    const a = await queryModelConfigurationCatalog(repo);
    const b = await queryModelConfigurationCatalog(repo);

    expect(b.entries.map((e) => e.modelConfigurationId)).toEqual(
      a.entries.map((e) => e.modelConfigurationId),
    );
  });

  it("sorts by provider, requested model, resolved identity, then configuration id", async () => {
    const repo = await seedRepo();
    const { entries } = await queryModelConfigurationCatalog(repo);

    const sortKey = (e: ModelConfigurationCatalogEntry) =>
      [
        e.providerId,
        e.requestedModel,
        e.resolvedModel ?? "",
        e.resolvedVersion ?? "",
        e.reasoningRequested ?? "",
        e.reasoningEffective ?? "",
        e.toolScaffoldSignature ?? "",
        e.modelConfigurationId,
      ].join("\u0000");

    const expected = [...entries].sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
    expect(entries.map((e) => e.modelConfigurationId)).toEqual(
      expected.map((e) => e.modelConfigurationId),
    );
  });
});

describe("model-configuration catalog — filters restrict without inventing", () => {
  it("filters by provider id", async () => {
    const repo = await seedRepo();
    const query: ModelConfigurationCatalogQuery = { providerIds: ["anthropic"] };
    const { entries } = await queryModelConfigurationCatalog(repo, query);

    expect(entries.every((e) => e.providerId === "anthropic")).toBe(true);
    expect(entries.map((e) => e.modelConfigurationId)).toEqual([EXACT_BETA.id]);
  });

  it("filters by requested model", async () => {
    const repo = await seedRepo();
    const query: ModelConfigurationCatalogQuery = { requestedModels: ["org/alpha-latest"] };
    const { entries } = await queryModelConfigurationCatalog(repo, query);

    expect(entries.map((e) => e.modelConfigurationId)).toEqual([ROLLING_ALPHA.id]);
  });

  it("filters by identity completeness (rolling aliases only)", async () => {
    const repo = await seedRepo();
    const query: ModelConfigurationCatalogQuery = { identityCompleteness: ["rolling_alias"] };
    const { entries } = await queryModelConfigurationCatalog(repo, query);

    expect(entries.map((e) => e.modelConfigurationId)).toEqual([ROLLING_ALPHA.id]);
  });

  it("filters by explicit member configuration ids (rollup member view, no implicit merge)", async () => {
    const repo = await seedRepo();
    const query: ModelConfigurationCatalogQuery = {
      modelConfigurationIds: [EXACT_ALPHA.id, EXACT_BETA.id],
    };
    const { entries } = await queryModelConfigurationCatalog(repo, query);

    expect(entries.map((e) => e.modelConfigurationId).sort()).toEqual(
      [EXACT_ALPHA.id, EXACT_BETA.id].sort(),
    );
  });

  it("filters by observed window (configuration snapshot window overlaps the request)", async () => {
    const repo = await seedRepo();
    // A window that only overlaps the partial-legacy configuration's late window.
    const lateStart = PARTIAL_LEGACY.observedFrom;
    const query: ModelConfigurationCatalogQuery = {
      observedFrom: lateStart,
      observedTo: lateStart + 1,
    };
    const { entries } = await queryModelConfigurationCatalog(repo, query);
    expect(entries.map((e) => e.modelConfigurationId)).toContain(PARTIAL_LEGACY.id);
  });

  it("returns an empty list (not a fabricated entry) when no configuration matches", async () => {
    const repo = await seedRepo();
    const query: ModelConfigurationCatalogQuery = { providerIds: ["no-such-provider"] };
    const { entries } = await queryModelConfigurationCatalog(repo, query);
    expect(entries).toEqual([]);
  });
});

describe("model-configuration catalog — receipt and no persistent state", () => {
  it("produces a receipt with deterministic totals and a generated timestamp", async () => {
    const repo = await seedRepo();
    const { receipt, entries } = await queryModelConfigurationCatalog(repo, undefined, 123);

    expect(receipt.generatedAt).toBe(123);
    expect(receipt.configurationCount).toBe(entries.length);
    expect(receipt.totalObservations).toBe(entries.reduce((s, e) => s + e.observationCount, 0));
    expect(receipt.totalEligibleProfileEvidence).toBe(
      entries.reduce((s, e) => s + e.eligibleProfileEvidenceCount, 0),
    );
  });

  it("does not write any persistent derived profile state back to the repository", async () => {
    const repo = await seedRepo();
    const before = await repo.listModelConfigurations();
    await queryModelConfigurationCatalog(repo, undefined, 123);
    const after = await repo.listModelConfigurations();

    expect(after.map((c) => c.id).sort()).toEqual(before.map((c) => c.id).sort());
    expect(await repo.countObservations()).toBe(milestoneAObservations().length);
  });

  it("never exposes a universal score, rank, or best-model field", async () => {
    const repo = await seedRepo();
    const { entries, receipt } = await queryModelConfigurationCatalog(repo);

    const forbidden = [
      "score",
      "rank",
      "bestModel",
      "best",
      "leaderboard",
      "universalScore",
      "capabilityScore",
    ];
    for (const entry of entries) {
      for (const key of forbidden) {
        expect((entry as unknown as Record<string, unknown>)[key]).toBeUndefined();
      }
    }
    for (const key of forbidden) {
      expect((receipt as unknown as Record<string, unknown>)[key]).toBeUndefined();
    }
  });
});
