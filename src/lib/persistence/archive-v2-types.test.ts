// =============================================================================
// RSemble AI — Archive v2 contract tests (Child 02, Task 10A)
//
// Pure validation of the task-first archive v2 envelope: format/storage
// versions, deterministic entity counts, integrity digests, local-scope
// disclosure, duplicate IDs, missing references/artifacts, byte count/digest
// mismatch, prohibited credential/auth content, deterministic ordering, and
// complete reference graph validity. No database, no mutation, no UI.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  ARCHIVE_V2_COLLECTION_KEYS,
  ARCHIVE_V2_FORMAT_VERSION,
  ARCHIVE_V2_STORAGE_VERSION,
  computeArchiveV2PayloadDigest,
  isWorkbenchArchiveV2,
  validateArchiveV2,
  type WorkbenchArchiveV2,
} from "./archive-v2-types";
import {
  buildValidArchiveV2Fixture,
  cloneArchiveV2,
  credentialLikeText,
  PROHIBITED_KEY_SAMPLE,
} from "./archive-v2-fixtures";

// --- Valid baseline ----------------------------------------------------------

describe("archive v2 valid fixture", () => {
  it("is recognized by the type guard", () => {
    const archive = buildValidArchiveV2Fixture();
    expect(isWorkbenchArchiveV2(archive)).toBe(true);
  });

  it("passes full validation with no errors", () => {
    const result = validateArchiveV2(buildValidArchiveV2Fixture());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("declares the canonical format and storage versions", () => {
    const archive = buildValidArchiveV2Fixture();
    expect(archive.manifest.formatVersion).toBe(ARCHIVE_V2_FORMAT_VERSION);
    expect(archive.manifest.storageVersion).toBe(ARCHIVE_V2_STORAGE_VERSION);
  });

  it("is local-scope only", () => {
    const archive = buildValidArchiveV2Fixture();
    expect(archive.manifest.disclosure.scope).toBe("local");
  });

  it("carries every collection key", () => {
    const archive = buildValidArchiveV2Fixture();
    for (const key of ARCHIVE_V2_COLLECTION_KEYS) {
      expect(archive).toHaveProperty(key);
    }
  });

  it("payload digest is deterministic and matches manifest", () => {
    const archive = buildValidArchiveV2Fixture();
    const recomputed = computeArchiveV2PayloadDigest(archive);
    expect(recomputed).toBe(archive.manifest.payloadDigest);
    expect(recomputed).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

// --- Unknown versions --------------------------------------------------------

describe("archive v2 unknown versions", () => {
  it("rejects an unknown format version", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.manifest.formatVersion = 99;
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /formatVersion/.test(e.field))).toBe(true);
  });

  it("rejects an unknown storage version", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.manifest.storageVersion = 999;
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /storageVersion/.test(e.field))).toBe(true);
  });

  it("rejects a non-object input", () => {
    const result = validateArchiveV2("not-an-archive");
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects a missing collection", () => {
    const archive = buildValidArchiveV2Fixture();
    const { tasks: _omit, ...withoutTasks } = archive;
    const result = validateArchiveV2(withoutTasks);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /tasks/.test(e.field))).toBe(true);
  });
});

// --- Duplicate IDs -----------------------------------------------------------

describe("archive v2 duplicate IDs", () => {
  it("rejects duplicate task IDs", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    const dup = { ...archive.tasks.tasks[0] };
    archive.tasks.tasks.push(dup);
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /duplicate/i.test(e.message))).toBe(true);
  });

  it("rejects duplicate rubric version keys", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.rubrics.versions.push({ ...archive.rubrics.versions[0] });
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /duplicate/i.test(e.message))).toBe(true);
  });

  it("rejects duplicate fusion study IDs", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.fusion.studies.push({ ...archive.fusion.studies[0] });
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /duplicate/i.test(e.message))).toBe(true);
  });
});

// --- Missing references ------------------------------------------------------

describe("archive v2 missing references", () => {
  it("rejects a task version pointing at an unknown task", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.tasks.taskVersions[0].taskId = "no-such-task";
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown task/i.test(e.message))).toBe(true);
  });

  it("rejects a task instance pointing at an unknown task version", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.tasks.taskInstances[0].taskVersion = 77;
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown/i.test(e.message))).toBe(true);
  });

  it("rejects a rubric version pointing at an unknown rubric identity", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.rubrics.versions[0].id = "no-such-rubric";
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown rubric/i.test(e.message))).toBe(true);
  });

  it("rejects a fusion trial pointing at an unknown study", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.fusion.trials[0].studyId = "no-such-study";
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown study/i.test(e.message))).toBe(true);
  });

  it("rejects a fusion attempt pointing at an unknown study", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.fusion.attempts[0].studyId = "no-such-study";
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown study/i.test(e.message))).toBe(true);
  });

  it("rejects a fusion observation pointing at an unknown trial", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.fusion.observations[0].trialId = "no-such-trial";
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown trial/i.test(e.message))).toBe(true);
  });

  it("rejects a fusion playbook pointing at an unknown study", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.fusion.playbooks[0].studyId = "no-such-study";
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown study/i.test(e.message))).toBe(true);
  });

  it("rejects a family assignment pointing at an unknown family", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.tasks.taskFamilyAssignments[0].familyId = "no-such-family";
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown family/i.test(e.message))).toBe(true);
  });

  it("rejects a family relation pointing at an unknown family", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.tasks.taskFamilyRelations[0].toFamilyId = "no-such-family";
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown family/i.test(e.message))).toBe(true);
  });

  it("rejects a facet annotation supersession pointing at an unknown annotation", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.tasks.taskFacetAnnotations[0].supersedesId = "no-such-annotation";
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /supersede/i.test(e.message))).toBe(true);
  });

  it("rejects a migration crosswalk pointing at an unknown task version", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.tasks.taskMigrationCrosswalks[0].taskVersion = 88;
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown/i.test(e.message))).toBe(true);
  });

  it("rejects a context manifest artifact ref pointing at an unknown artifact", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.tasks.taskVersions[0].defaultContextManifest[0].artifactId = "no-such-artifact";
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown artifact/i.test(e.message))).toBe(true);
  });

  it("rejects an instance normalized input artifact ref pointing at an unknown artifact", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.tasks.taskInstances[0].normalizedInput.artifactIds = ["no-such-artifact"];
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown artifact/i.test(e.message))).toBe(true);
  });

  it("rejects a facet annotation with a non-null taskVersion pointing at an unknown task version", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.tasks.taskFacetAnnotations[0].taskVersion = 99;
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown task version/i.test(e.message))).toBe(true);
  });

  it("rejects a fusion attempt pointing at an unknown fromTrialId", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.fusion.attempts[0].fromTrialId = "no-such-trial";
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /fromTrialId.*unknown trial/i.test(e.message))).toBe(true);
  });

  it("rejects a fusion attempt pointing at an unknown toTrialId", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.fusion.attempts[0].toTrialId = "no-such-trial";
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /toTrialId.*unknown trial/i.test(e.message))).toBe(true);
  });

  it("rejects a study recipe ref pointing at an unknown recipe version", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.fusion.studies[0].recipeRefs = [{ id: "no-such-recipe", version: 1 }];
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown recipe/i.test(e.message))).toBe(true);
  });

  it("rejects a study pool ref pointing at an unknown pool manifest version", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.fusion.studies[0].poolRef = { id: "no-such-pool", version: 1 };
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown pool/i.test(e.message))).toBe(true);
  });

  it("rejects a trial recipe ref pointing at an unknown recipe version", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.fusion.trials[0].recipe = { id: "no-such-recipe", version: 1 };
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown recipe/i.test(e.message))).toBe(true);
  });

  it("rejects a trial pool ref pointing at an unknown pool manifest version", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.fusion.trials[0].poolRef = { id: "no-such-pool", version: 1 };
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown pool/i.test(e.message))).toBe(true);
  });

  it("rejects a study playbookRef pointing at an unknown playbook", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.fusion.studies[0].playbookRef = "no-such-playbook";
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown playbook/i.test(e.message))).toBe(true);
  });

  it("rejects a study confirmationOf pointing at an unknown study", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.fusion.studies[0].confirmationOf = "no-such-study";
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown study/i.test(e.message))).toBe(true);
  });

  it("rejects a trial observationIds entry pointing at an unknown observation", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.fusion.trials[0].observationIds = ["no-such-observation"];
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown observation/i.test(e.message))).toBe(true);
  });
});

// --- Missing artifacts / bytes ----------------------------------------------

describe("archive v2 artifact bytes", () => {
  it("rejects an artifact summary with no bytes entry", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.tasks.taskArtifactBytes = [];
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /missing bytes/i.test(e.message))).toBe(true);
  });

  it("rejects orphan artifact bytes with no matching summary", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.tasks.taskArtifactBytes.push({ id: "orphan-bytes", bytesBase64: "AA==" });
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /orphan/i.test(e.message))).toBe(true);
  });

  it("rejects a byte count mismatch", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.tasks.taskArtifacts[0].byteCount = 999;
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /byte count/i.test(e.message))).toBe(true);
  });

  it("rejects a content digest mismatch", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.tasks.taskArtifacts[0].contentDigest =
      "sha256:0000000000000000000000000000000000000000000000000000000000000000";
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /digest/i.test(e.message))).toBe(true);
  });
});

// --- Prohibited credential / auth content -----------------------------------

describe("archive v2 prohibited content", () => {
  it("rejects a prohibited credential key anywhere in the payload", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    Object.assign(archive.tasks.tasks[0], { [PROHIBITED_KEY_SAMPLE]: "anything" });
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /prohibited/i.test(e.message))).toBe(true);
  });

  it("rejects a credential-like value in indexed free text", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.tasks.taskVersions[0].title = credentialLikeText();
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /credential/i.test(e.message))).toBe(true);
  });
});

// --- Deterministic ordering --------------------------------------------------

describe("archive v2 deterministic ordering", () => {
  it("rejects unsorted tasks", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    const a = archive.tasks.tasks[0]; // id "task-1"
    const b: typeof a = { ...a, id: "task-0" };
    archive.tasks.tasks = [a, b]; // task-1 before task-0 → out of order
    // Give b its own version + crosswalk so only ordering is flagged.
    archive.tasks.taskVersions.push({ ...archive.tasks.taskVersions[0], taskId: "task-0" });
    archive.tasks.taskMigrationCrosswalks.push({
      ...archive.tasks.taskMigrationCrosswalks[0],
      taskId: "task-0",
      legacyScopeKey: "legacy:task-0",
    });
    syncManifest(archive);
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /order/i.test(e.message))).toBe(true);
  });
});

// --- Counts and digest integrity --------------------------------------------

describe("archive v2 manifest integrity", () => {
  it("rejects a counts mismatch", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.manifest.counts.tasks = 999;
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /count/i.test(e.message))).toBe(true);
  });

  it("rejects a payload digest mismatch", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.manifest.payloadDigest =
      "sha256:0000000000000000000000000000000000000000000000000000000000000000";
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /payload digest/i.test(e.message))).toBe(true);
  });
});

// --- Type guard --------------------------------------------------------------

describe("isWorkbenchArchiveV2", () => {
  it("returns false for v1 archives", () => {
    expect(isWorkbenchArchiveV2({ schemaVersion: 1 })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isWorkbenchArchiveV2(null)).toBe(false);
  });
});

// --- Task Set identity (Child 03 Task 11) ------------------------------------

describe("archive v2 Task Set identity", () => {
  it("rejects a prohibited credential key inside a Task Set record", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    Object.assign(archive.taskSets!.records[0], { [PROHIBITED_KEY_SAMPLE]: "anything" });
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /prohibited/i.test(e.message))).toBe(true);
  });

  it("rejects a credential-like value inside a Task Set version field", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    (archive.taskSets!.versions[0].members[0] as unknown as Record<string, unknown>).stratum =
      credentialLikeText();
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /credential/i.test(e.message))).toBe(true);
  });

  it("rejects a Task Set version whose member references an unknown task version", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.taskSets!.versions[0].members[0].taskVersionRef = { taskId: "task-1", version: 99 };
    syncManifest(archive);
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown task version/.test(e.message))).toBe(true);
  });

  it("rejects a duplicate Task Set record id", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.taskSets!.records.push({ ...archive.taskSets!.records[0] });
    syncManifest(archive);
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /duplicate/i.test(e.message))).toBe(true);
  });

  it("accepts an earlier-v2 envelope without the taskSets key (counts treated as zero)", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    delete archive.taskSets;
    archive.manifest.counts.taskSets = 0;
    archive.manifest.counts.taskSetVersions = 0;
    archive.manifest.counts.taskSetMaterializations = 0;
    archive.manifest.counts.taskSetOwnershipCrosswalks = 0;
    archive.manifest.payloadDigest = computeArchiveV2PayloadDigest(archive);
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
// --- Evidence payload (Child 04 Task 12) -------------------------------------

describe("archive v2 Evidence payload", () => {
  it("accepts a valid archive fixture carrying the evidence payload", () => {
    const archive = buildValidArchiveV2Fixture();
    expect(archive.evidence).toBeDefined();
    expect(archive.evidence?.modelConfigurations.length).toBe(1);
    expect(archive.evidence?.observations.length).toBe(1);
    expect(archive.evidence?.evidenceDecisions.length).toBe(1);
    expect(archive.evidence?.evidenceIndexJobs.length).toBe(1);
    expect(archive.evidence?.verifierOutcomes.length).toBe(1);
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a prohibited credential key inside a ModelConfiguration snapshot", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    (archive.evidence!.modelConfigurations[0].runtimeSettings as Record<string, unknown>)[
      PROHIBITED_KEY_SAMPLE
    ] = "secret-token";
    syncManifest(archive);
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /prohibited/i.test(e.message))).toBe(true);
  });

  it("rejects a credential-like value inside an Observation payload", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.evidence!.observations[0].sourceTaskCellId = `exp-1:task-1:${credentialLikeText()}`;
    syncManifest(archive);
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /credential/i.test(e.message))).toBe(true);
  });

  it("rejects raw candidate output or full judge rationale embedded in an Observation", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    Object.assign(archive.evidence!.observations[0], {
      candidateOutput: "raw candidate text should not be here",
    });
    syncManifest(archive);
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /raw content|prohibited|Observation/i.test(e.message))).toBe(
      true,
    );
  });

  it("rejects an Observation referencing an unknown task", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.evidence!.observations[0].taskId = "unknown-task";
    syncManifest(archive);
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown task/i.test(e.message))).toBe(true);
  });

  it("rejects an Observation referencing an unknown task version", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.evidence!.observations[0].taskVersion = 99;
    syncManifest(archive);
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown task version/i.test(e.message))).toBe(true);
  });

  it("rejects an Observation referencing an unknown modelConfiguration", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.evidence!.observations[0].modelConfigurationId =
      "mc:sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    syncManifest(archive);
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown model configuration/i.test(e.message))).toBe(true);
  });

  it("rejects an Observation referencing an unknown rubric version", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.evidence!.observations[0].rubricRef = { id: "rubric-1", version: 99 };
    syncManifest(archive);
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown rubric/i.test(e.message))).toBe(true);
  });

  it("rejects an EligibilityDecision referencing an unknown observation", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.evidence!.evidenceDecisions[0].observationId =
      "obs:sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    syncManifest(archive);
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown observation/i.test(e.message))).toBe(true);
  });

  it("rejects an ExecutedVerifierOutcome referencing an unknown run", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.evidence!.verifierOutcomes[0].runId = "unknown-run";
    syncManifest(archive);
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown run/i.test(e.message))).toBe(true);
  });

  it("rejects an ExecutedVerifierOutcome referencing an unknown task", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.evidence!.verifierOutcomes[0].taskId = "unknown-task";
    syncManifest(archive);
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /unknown task/i.test(e.message))).toBe(true);
  });

  it("rejects a duplicate ModelConfiguration id", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.evidence!.modelConfigurations.push({ ...archive.evidence!.modelConfigurations[0] });
    syncManifest(archive);
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /duplicate/i.test(e.message))).toBe(true);
  });

  it("rejects a duplicate Observation id", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.evidence!.observations.push({ ...archive.evidence!.observations[0] });
    syncManifest(archive);
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /duplicate/i.test(e.message))).toBe(true);
  });

  it("rejects a duplicate EligibilityDecision key", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    archive.evidence!.evidenceDecisions.push({ ...archive.evidence!.evidenceDecisions[0] });
    syncManifest(archive);
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /duplicate/i.test(e.message))).toBe(true);
  });

  it("rejects an out-of-order evidence collection", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    const mc1 = archive.evidence!.modelConfigurations[0];
    const mc2 = {
      ...mc1,
      id: "mc:sha256:0000000000000000000000000000000000000000000000000000000000000000",
    };
    archive.evidence!.modelConfigurations = [mc1, mc2]; // mc1 > mc2 so not sorted ascending
    syncManifest(archive);
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /deterministic order/i.test(e.message))).toBe(true);
  });

  it("accepts an earlier-v2 envelope without the evidence key (counts treated as zero)", () => {
    const archive = cloneArchiveV2(buildValidArchiveV2Fixture());
    delete archive.evidence;
    archive.manifest.counts.modelConfigurations = 0;
    archive.manifest.counts.observations = 0;
    archive.manifest.counts.evidenceDecisions = 0;
    archive.manifest.counts.evidenceIndexJobs = 0;
    archive.manifest.counts.verifierOutcomes = 0;
    archive.manifest.payloadDigest = computeArchiveV2PayloadDigest(archive);
    const result = validateArchiveV2(archive);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

// --- Helpers -----------------------------------------------------------------

/** Recompute counts and payload digest so a mutated fixture isolates one
 *  validation failure when desired. */
function syncManifest(archive: WorkbenchArchiveV2): void {
  archive.manifest.counts = {
    runSummaries: archive.runs.summaries.length,
    runDetails: archive.runs.details.length,
    rubricIdentities: archive.rubrics.identities.length,
    rubricVersions: archive.rubrics.versions.length,
    suites: archive.suites.length,
    experiments: archive.experiments.length,
    fusionRecipes: archive.fusion.recipes.length,
    poolManifests: archive.fusion.poolManifests.length,
    fusionStudies: archive.fusion.studies.length,
    fusionTrials: archive.fusion.trials.length,
    fusionAttempts: archive.fusion.attempts.length,
    fusionObservations: archive.fusion.observations.length,
    fusionPlaybooks: archive.fusion.playbooks.length,
    tasks: archive.tasks.tasks.length,
    taskVersions: archive.tasks.taskVersions.length,
    taskArtifacts: archive.tasks.taskArtifacts.length,
    taskArtifactBytes: archive.tasks.taskArtifactBytes.length,
    taskInstances: archive.tasks.taskInstances.length,
    taskFamilies: archive.tasks.taskFamilies.length,
    taskFamilyAssignments: archive.tasks.taskFamilyAssignments.length,
    taskFamilyRelations: archive.tasks.taskFamilyRelations.length,
    taskFacetAnnotations: archive.tasks.taskFacetAnnotations.length,
    taskMigrationCrosswalks: archive.tasks.taskMigrationCrosswalks.length,
    taskSets: archive.taskSets?.records.length ?? 0,
    taskSetVersions: archive.taskSets?.versions.length ?? 0,
    taskSetMaterializations: archive.taskSets?.materializations.length ?? 0,
    taskSetOwnershipCrosswalks: archive.taskSets?.ownershipCrosswalks.length ?? 0,
    modelConfigurations: archive.evidence?.modelConfigurations.length ?? 0,
    observations: archive.evidence?.observations.length ?? 0,
    evidenceDecisions: archive.evidence?.evidenceDecisions.length ?? 0,
    evidenceIndexJobs: archive.evidence?.evidenceIndexJobs.length ?? 0,
    verifierOutcomes: archive.evidence?.verifierOutcomes.length ?? 0,
  };
  archive.manifest.payloadDigest = computeArchiveV2PayloadDigest(archive);
}
