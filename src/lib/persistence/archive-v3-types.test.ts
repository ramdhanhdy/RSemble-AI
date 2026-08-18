// =============================================================================
// RSemble AI — Archive v3 contract tests (Child 06 Task 11)
//
// Tests pure archive v3 contracts, types, schema/entity counts, manifest,
// validators, digests, ordering, reference-graph constraints, duplicate checks,
// prohibited-content checks, and rejection of unknown keys (e.g. legacy fusion).
// Tests deterministic legacy Fusion archive detection and receipt format (REV-2/REV-3).
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  ARCHIVE_V3_FORMAT_VERSION,
  ARCHIVE_V3_STORAGE_VERSION,
  ARCHIVE_V3_COLLECTION_KEYS,
  computeArchiveV3PayloadDigest,
  detectLegacyFusionArchive,
  isWorkbenchArchiveV3,
  validateArchiveV3,
  type ArchiveV3EntityCounts,
  type ArchiveV3LabPayload,
  type WorkbenchArchiveV3,
} from "./archive-v3-types";
import {
  buildValidArchiveV3Fixture,
  cloneArchiveV3,
  makeValidLabPayload,
} from "./archive-v3-fixtures";

describe("archive v3 — constants and structure", () => {
  it("defines format version 3 and storage version 1", () => {
    expect(ARCHIVE_V3_FORMAT_VERSION).toBe(3);
    expect(ARCHIVE_V3_STORAGE_VERSION).toBe(1);
  });

  it("contains all 10 canonical collection keys without any fusion key", () => {
    expect(ARCHIVE_V3_COLLECTION_KEYS).toEqual([
      "manifest",
      "runs",
      "rubrics",
      "suites",
      "experiments",
      "tasks",
      "taskSets",
      "evidence",
      "comparisons",
      "lab",
    ]);
    expect(ARCHIVE_V3_COLLECTION_KEYS).not.toContain("fusion");
  });
});

describe("validateArchiveV3 — happy path fixture validation", () => {
  it("validates a fully populated valid archive v3 fixture", () => {
    const fixture = buildValidArchiveV3Fixture();
    const result = validateArchiveV3(fixture);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(isWorkbenchArchiveV3(fixture)).toBe(true);
  });

  it("computes a deterministic sha256 payload digest that matches manifest", () => {
    const fixture = buildValidArchiveV3Fixture();
    const digest = computeArchiveV3PayloadDigest(fixture);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(fixture.manifest.payloadDigest).toBe(digest);
  });
});

describe("validateArchiveV3 — manifest & count integrity", () => {
  it("rejects when formatVersion is not 3", () => {
    const fixture = cloneArchiveV3(buildValidArchiveV3Fixture());
    const manifest = fixture.manifest as Record<string, unknown>;
    manifest.formatVersion = 2;
    fixture.manifest.payloadDigest = computeArchiveV3PayloadDigest(fixture);
    const result = validateArchiveV3(fixture);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.includes("formatVersion"))).toBe(true);
  });

  it("rejects when an entity count does not match the actual array length", () => {
    const fixture = cloneArchiveV3(buildValidArchiveV3Fixture());
    fixture.manifest.counts.labRecipeRecords += 1;
    const result = validateArchiveV3(fixture);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.includes("manifest.counts.labRecipeRecords"))).toBe(true);
  });

  it("rejects when payload digest is tampered", () => {
    const fixture = cloneArchiveV3(buildValidArchiveV3Fixture());
    fixture.manifest.payloadDigest = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
    const result = validateArchiveV3(fixture);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.includes("payloadDigest"))).toBe(true);
  });
});

describe("validateArchiveV3 — REV-2 deleted stores stay deleted", () => {
  it("rejects if any legacy fusion key is attached at top level", () => {
    const fixture = cloneArchiveV3(buildValidArchiveV3Fixture());
    const raw: Record<string, unknown> = fixture;
    raw.fusion = { recipes: [] };
    const result = validateArchiveV3(fixture);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("legacy") || e.message.includes("fusion") || e.field.includes("fusion"))).toBe(true);
  });
});

describe("detectLegacyFusionArchive — REV-3 rejection with receipt", () => {
  it("detects v2 archive containing non-empty legacy fusion collections", () => {
    const legacyV2Archive = {
      manifest: {
        formatVersion: 2,
        storageVersion: 1,
        exportedAt: 1000,
        producer: "rsemble-ai",
        counts: {
          runSummaries: 0,
          runDetails: 0,
          rubricIdentities: 0,
          rubricVersions: 0,
          suites: 0,
          experiments: 0,
          fusionRecipes: 1,
          fusionPlaybooks: 1,
          taskRecords: 0,
          taskVersions: 0,
          taskArtifacts: 0,
          taskArtifactBytes: 0,
          taskInstances: 0,
          taskFamilies: 0,
          taskFamilyAssignments: 0,
          taskFamilyRelations: 0,
          taskFacetAnnotations: 0,
          taskMigrationCrosswalks: 0,
        },
        payloadDigest: "sha256:abcd",
        disclosure: { scope: "local", notes: null },
      },
      runs: { summaries: [], details: [] },
      rubrics: { identities: [], versions: [] },
      suites: [],
      experiments: [],
      fusion: {
        recipes: [{ id: "r1", version: 1, name: "Legacy Recipe" }],
        poolManifests: [],
        studies: [],
        trials: [],
        attempts: [],
        observations: [],
        playbooks: [{ id: "p1", studyId: "s1" }],
      },
      tasks: {
        tasks: [],
        taskVersions: [],
        taskArtifacts: [],
        taskArtifactBytes: [],
        taskInstances: [],
        taskFamilies: [],
        taskFamilyAssignments: [],
        taskFamilyRelations: [],
        taskFacetAnnotations: [],
        taskMigrationCrosswalks: [],
      },
    };

    const receipt = detectLegacyFusionArchive(legacyV2Archive, "legacy-backup.json");
    expect(receipt).not.toBeNull();
    expect(receipt!.format).toBe("unsupported_fusion_archive_shape");
    expect(receipt!.rejectedCollections).toContain("fusionRecipes");
    expect(receipt!.rejectedCollections).toContain("fusionPlaybooks");
    expect(receipt!.sourceLabel).toBe("legacy-backup.json");
    expect(typeof receipt!.rejectedAt).toBe("number");
    expect(receipt!.reason).toContain("retired Fusion Study collections");
  });

  it("returns null for valid v3 archive", () => {
    const fixture = buildValidArchiveV3Fixture();
    const receipt = detectLegacyFusionArchive(fixture, "v3.json");
    expect(receipt).toBeNull();
  });

  it("returns null for clean non-fusion v2 archive with empty fusion collections", () => {
    const nonFusionV2 = {
      manifest: {
        formatVersion: 2,
        storageVersion: 1,
        counts: {
          fusionRecipes: 0,
          fusionPoolManifests: 0,
          fusionStudies: 0,
          fusionTrials: 0,
          fusionAttempts: 0,
          fusionObservations: 0,
          fusionPlaybooks: 0,
        },
      },
      fusion: {
        recipes: [],
        poolManifests: [],
        studies: [],
        trials: [],
        attempts: [],
        observations: [],
        playbooks: [],
      },
    };
    const receipt = detectLegacyFusionArchive(nonFusionV2, "clean-v2.json");
    expect(receipt).toBeNull();
  });
});

describe("validateArchiveV3 — prohibited content scan", () => {
  it("rejects credentials embedded in Lab Recipe fields", () => {
    const fixture = cloneArchiveV3(buildValidArchiveV3Fixture());
    const record: Record<string, unknown> = fixture.lab.recipeRecords[0];
    record.apiKey = "sk-prohibited-key-123456";
    const result = validateArchiveV3(fixture);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("prohibited"))).toBe(true);
  });

  it("rejects credentials embedded in Policy Study definition", () => {
    const fixture = cloneArchiveV3(buildValidArchiveV3Fixture());
    const def: Record<string, unknown> = fixture.lab.studies[0].definition;
    def.secret = "sk-prohibited-key-123456";
    const result = validateArchiveV3(fixture);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("prohibited"))).toBe(true);
  });
});

describe("validateArchiveV3 — reference graph validation", () => {
  it("rejects when study definition references a non-existent model pool version", () => {
    const fixture = cloneArchiveV3(buildValidArchiveV3Fixture());
    fixture.lab.studies[0].definition.modelPool.poolId = "missing-pool";
    fixture.manifest.payloadDigest = computeArchiveV3PayloadDigest(fixture);
    const result = validateArchiveV3(fixture);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.includes("lab.studies"))).toBe(true);
  });

  it("rejects when study trial references a non-existent study", () => {
    const fixture = cloneArchiveV3(buildValidArchiveV3Fixture());
    fixture.lab.trials[0].studyId = "missing-study";
    fixture.manifest.payloadDigest = computeArchiveV3PayloadDigest(fixture);
    const result = validateArchiveV3(fixture);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.includes("lab.trials"))).toBe(true);
  });

  it("rejects when study attempt references identical fromTrialId and toTrialId", () => {
    const fixture = cloneArchiveV3(buildValidArchiveV3Fixture());
    if (fixture.lab.attempts.length > 0) {
      fixture.lab.attempts[0].toTrialId = fixture.lab.attempts[0].fromTrialId;
      fixture.manifest.payloadDigest = computeArchiveV3PayloadDigest(fixture);
      const result = validateArchiveV3(fixture);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("lab.attempts"))).toBe(true);
    }
  });

  it("rejects when recipe version digest does not match recomputed digest", () => {
    const fixture = cloneArchiveV3(buildValidArchiveV3Fixture());
    fixture.lab.recipeVersions[0].digest = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
    fixture.manifest.payloadDigest = computeArchiveV3PayloadDigest(fixture);
    const result = validateArchiveV3(fixture);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.includes("lab.recipeVersions"))).toBe(true);
  });
});
