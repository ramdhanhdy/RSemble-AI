// @vitest-environment node
// =============================================================================
// RSemble AI — Cross-child invariant test suite (spec §6, Child 10 Task 10)
//
// Proves all 11 program invariants across the complete task-first corpus:
//
//  1. exact Run, Experiment, and Fusion Study evidence remains unchanged and reachable
//  2. all migrations/rebuilds are idempotent
//  3. retry/reuse/assessment counts do not inflate samples
//  4. incomplete evidence never creates complete standings/paired claims
//  5. profile claims disclose and drill down correctly
//  6. Search/Records/Attention preserve type and ownership
//  7. Records/Attention cannot execute
//  8. every legacy route/archive remains valid and Fusion Study owner adapters
//     preserve exact Task Set/version ownership
//  9. experimental Fusion observations never enter canonical Task Observation/profile counts
// 10. no universal score/index appears
// 11. no credential-shaped text appears in UI, logs, exports, or search documents
// =============================================================================

import "fake-indexeddb/auto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildDeterministicCorpus,
  CORPUS_DETERMINISTIC_NOW,
  DeterministicCorpus,
  DIGEST_A,
  DIGEST_B,
  MC_EXACT_ID,
  MC_ROLLING_ID,
} from "./fixtures/task-first-evidence/corpus";
import { RSembleEvaluationDB } from "../src/lib/persistence/database";
import { createRecordsRepository } from "../src/lib/records/records-repository";
import { resolveRecordOwner } from "../src/lib/records/record-owner";
import { createRunRepository } from "../src/lib/persistence/run-repository";
import { createEvaluationRepository } from "../src/lib/persistence/evaluation-repository";
import { createStudyRepository } from "../src/lib/persistence/study-repository";
import { createEvidenceRepository } from "../src/lib/persistence/evidence-repository";
import { createComparisonRepository } from "../src/lib/persistence/comparison-repository";
import {
  createMigrationRegistry,
  runMigrationRegistry,
  verifyMigrationState,
} from "../src/lib/persistence/migration-registry";
import { migrateEmbeddedLegacyTasks } from "../src/lib/persistence/canonical-task-migration";
import { migrateSuitesToTaskSets } from "../src/lib/persistence/task-set-migration";
import { migrateComparisonResults } from "../src/lib/persistence/comparison-result-migration";
import { ensureFusionToResearchLabMigration } from "../src/lib/migrations/fusion-to-research-lab";
import { countEvidence } from "../src/lib/evidence/evidence-counting";
import { computePairedEvidence } from "../src/lib/model-profiles/paired-comparison";
import {
  FORBIDDEN_CLAIM_PHRASES,
  buildProfileClaim,
  MIN_CLAIM_RESOLVED_UNITS,
  type ClaimCohortInput,
} from "../src/lib/model-profiles/profile-claims";
import {
  createDexieSearchSourceResolver,
  rebuildSearchIndex,
} from "../src/lib/search/search-reindex";
import { createSearchIndexRepository } from "../src/lib/persistence/search-index-repository";
import {
  CREDENTIAL_LIKE_INLINE,
  redactCredentialMaterial,
  validateArchiveV3,
} from "../src/lib/persistence/archive-v3-types";
import {
  exportWorkbenchArchiveV3,
  previewWorkbenchArchive,
  commitPreviewWorkbenchArchiveV2,
  commitPreviewWorkbenchArchiveV3,
} from "../src/lib/persistence/archive";
import {
  buildValidNonFusionArchiveV2Fixture,
} from "../src/lib/persistence/archive-v2-fixtures";
import { buildValidArchiveV3Fixture } from "../src/lib/persistence/archive-v3-fixtures";
import { EVIDENCE_PROHIBITED_KEYS } from "../src/lib/evidence/evidence-validation";
import { selectProfileObservations } from "../src/lib/model-profiles/profile-observation-selection";
import { canonicalizeModelEvidenceQuery } from "../src/lib/model-profiles/model-evidence-query";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("Cross-child invariant harness (spec §6)", () => {
  let db: RSembleEvaluationDB;
  let corpus: DeterministicCorpus;

  beforeEach(async () => {
    db = new RSembleEvaluationDB(`invariant-test-${Math.random().toString(36).slice(2)}`);
    await db.open();
    corpus = await buildDeterministicCorpus(db);
  });

  afterEach(async () => {
    if (db.isOpen()) {
      db.close();
      await db.delete();
    }
  });

  // ---------------------------------------------------------------------------
  // Invariant 1: Exact Run, Experiment, and Fusion Study evidence remains
  //              unchanged and reachable
  // ---------------------------------------------------------------------------
  describe("Invariant 1: Exact evidence unchanged and reachable", () => {
    it("retrieves exact RunRecordV2 with candidates, attempts, judge, and source lineage unaltered", async () => {
      const runRepo = createRunRepository(db);
      const fetchedRun = await runRepo.get("run-retry");

      expect(fetchedRun).not.toBeNull();
      expect(fetchedRun?.id).toBe("run-retry");
      expect(fetchedRun?.candidates[0].attempts).toHaveLength(2);
      expect(fetchedRun?.candidates[0].attempts[0].status).toBe("failed");
      expect(fetchedRun?.candidates[0].attempts[1].status).toBe("completed");
      expect(fetchedRun?.judge?.attempts).toHaveLength(2);
      expect(fetchedRun?.winnerKeys).toEqual([
        "openrouter:anthropic/claude-3.5-sonnet",
      ]);

      const recordsRepo = createRecordsRepository({
        runRepo,
        comparisonRepo: createComparisonRepository(db),
        evaluationRepo: createEvaluationRepository(db),
        studyRepo: createStudyRepository(db),
        evidenceRepo: createEvidenceRepository(db),
      });

      const execRecord = await recordsRepo.getTaskExecution("run-retry");
      expect(execRecord).not.toBeNull();
      expect(execRecord?.id).toBe("run-retry");
      expect(execRecord?.candidates[0].attempts).toHaveLength(2);

      const legacySummary = await recordsRepo.getLegacySummary("run-legacy-1");
      expect(legacySummary).not.toBeNull();
      expect(legacySummary?.id).toBe("run-legacy-1");
      expect(legacySummary?.kind).toBe("legacy");
    });

    it("retrieves exact ExperimentRecord and its frozen task set and protocol references", async () => {
      const evalRepo = createEvaluationRepository(db);
      const exp = await evalRepo.getExperiment("exp-complete");

      expect(exp).not.toBeNull();
      expect(exp?.id).toBe("exp-complete");
      expect(exp?.tasks).toHaveLength(1);
      expect(exp?.tasks[0].taskId).toBe("task-canon-1");
      expect(exp?.tasks[0].selectedAttemptId).toBe("att-exp-1");
    });

    it("retrieves exact PolicyStudyRecord, child trials, observations, and playbooks", async () => {
      const studyRepo = createStudyRepository(db);
      const study = await studyRepo.getStudy("study-exploratory");

      expect(study).not.toBeNull();
      expect(study?.id).toBe("study-exploratory");
      expect(study?.claimLevel).toBe("exploratory");
      expect(study?.definition.workload.taskSetId).toBe("taskset-1");

      const recordsRepo = createRecordsRepository({
        runRepo: createRunRepository(db),
        comparisonRepo: createComparisonRepository(db),
        evaluationRepo: createEvaluationRepository(db),
        studyRepo,
        evidenceRepo: createEvidenceRepository(db),
      });

      const studyChildren = await recordsRepo.getPolicyStudyChildren("study-exploratory");
      expect(studyChildren.trialCount).toBe(2);
      expect(studyChildren.observationCount).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Invariant 2: All migrations/rebuilds are idempotent
  // ---------------------------------------------------------------------------
  describe("Invariant 2: Migrations and rebuilds are idempotent", () => {
    it("running full migration registry multiple times preserves exact row counts and markers", async () => {
      // First migration run
      const report1 = await runMigrationRegistry(db);
      expect(report1.ready).toBe(true);
      expect(report1.errors).toEqual([]);

      const pass1Counts = {
        tasks: await db.tasks.count(),
        taskVersions: await db.taskVersions.count(),
        taskSets: await db.taskSets.count(),
        taskSetVersions: await db.taskSetVersions.count(),
        comparisonResults: await db.comparisonResults.count(),
        studies: await db.studies.count(),
        observations: await db.observations.count(),
      };

      // Second migration run (must be exact no-op)
      const report2 = await runMigrationRegistry(db);
      expect(report2.ready).toBe(true);
      expect(report2.errors).toEqual([]);

      const pass2Counts = {
        tasks: await db.tasks.count(),
        taskVersions: await db.taskVersions.count(),
        taskSets: await db.taskSets.count(),
        taskSetVersions: await db.taskSetVersions.count(),
        comparisonResults: await db.comparisonResults.count(),
        studies: await db.studies.count(),
        observations: await db.observations.count(),
      };

      expect(pass2Counts).toEqual(pass1Counts);

      // Third run with individual migration adapters
      await migrateEmbeddedLegacyTasks(db);
      await migrateSuitesToTaskSets(db);
      await migrateComparisonResults(db);
      await ensureFusionToResearchLabMigration(db);

      const pass3Counts = {
        tasks: await db.tasks.count(),
        taskVersions: await db.taskVersions.count(),
        taskSets: await db.taskSets.count(),
        taskSetVersions: await db.taskSetVersions.count(),
        comparisonResults: await db.comparisonResults.count(),
        studies: await db.studies.count(),
        observations: await db.observations.count(),
      };

      expect(pass3Counts).toEqual(pass1Counts);

      // Run background step (search index) to complete full registry state
      const registry = createMigrationRegistry({ db });
      await registry.runBackground();
      const verify = await verifyMigrationState(db);
      expect(verify.ok).toBe(true);
      expect(verify.steps.every((s) => s.verified)).toBe(true);
    });
    it("search index rebuild is idempotent across multiple full rebuild passes", async () => {
      const searchRepo = createSearchIndexRepository(db);
      const resolver = createDexieSearchSourceResolver(db);

      const result1 = await rebuildSearchIndex({ searchRepo, resolver });
      expect(result1.errors).toEqual([]);
      const count1 = await db.searchDocuments.count();
      expect(count1).toBeGreaterThan(0);

      const result2 = await rebuildSearchIndex({ searchRepo, resolver });
      expect(result2.errors).toEqual([]);
      const count2 = await db.searchDocuments.count();
      expect(count2).toBe(count1);
    });
  });

  // ---------------------------------------------------------------------------
  // Invariant 3: Retry/reuse/assessment counts do not inflate samples
  // ---------------------------------------------------------------------------
  describe("Invariant 3: Retry/reuse/assessment counts do not inflate samples", () => {
    it("counts unique task instances as active samples and segregates retry attempts and reused outputs", () => {
      const rows = corpus.evidence.countingRows;
      const counts = countEvidence({ rows, declaredPairs: [] });

      // In corpus.evidence.countingRows we defined 2 distinct lineage cells:
      // Cell 1 has 2 attempts (1 retry)
      // Cell 2 has reusedCandidateOutput: true
      expect(counts.activeObservationCount).toBe(2);
      expect(counts.taskCount).toBe(1); // task-canon-1
      expect(counts.attemptCount).toBe(3); // att-1, att-2, att-3
      expect(counts.reusedAssessmentEventCount).toBe(1);

      // The number of samples MUST equal the active independent cells, NOT the 3 attempts
      expect(counts.activeObservationCount).toBeLessThan(counts.attemptCount);
    });
  });

  // ---------------------------------------------------------------------------
  // Invariant 4: Incomplete evidence never creates complete standings/paired claims
  // ---------------------------------------------------------------------------
  describe("Invariant 4: Incomplete evidence never creates complete standings", () => {
    it("paired comparison over asymmetric/incomplete tasks isolates shared intersection and discloses missingness", () => {
      const obsA = corpus.evidence.observations[0]; // task-canon-1, inst-1-v1
      const obsB = corpus.evidence.observations[1]; // task-canon-1, inst-1-v2 (different version/instance)

      const result = computePairedEvidence({
        selectionA: {
          kind: "exact",
          modelConfiguration: corpus.modelConfigurations.exact,
          cells: [
            {
              executionLineageId: obsA.executionLineageId,
              taskId: obsA.taskId,
              modelConfigurationId: obsA.modelConfigurationId,
              active: {
                observation: obsA,
                decision: corpus.evidence.decisions[0],
                evaluator: { kind: "judge", id: "judge-1" },
                protocolFingerprint: "sha256:fp",
                taskVersionRef: { id: "task-canon-1", version: 1 },
                comparabilityCohortId: "cohort-1",
              },
              unsupported: [],
            },
          ],
          unauthorized: [],
        },
        selectionB: {
          kind: "exact",
          modelConfiguration: corpus.modelConfigurations.rolling,
          cells: [
            {
              executionLineageId: obsB.executionLineageId,
              taskId: obsB.taskId,
              modelConfigurationId: obsB.modelConfigurationId,
              active: {
                observation: obsB,
                decision: corpus.evidence.decisions[1],
                evaluator: { kind: "judge", id: "judge-1" },
                protocolFingerprint: "sha256:fp",
                taskVersionRef: { id: "task-canon-1", version: 2 },
                comparabilityCohortId: "cohort-1",
              },
              unsupported: [],
            },
          ],
          unauthorized: [],
        },
        uncertainty: {
          taskFamilyRelations: corpus.tasks.familyRelations,
          taskFamilyAssignments: corpus.tasks.familyAssignments,
          queryFingerprint: "sha256:qfp",
        },
        options: { metric: "judged_score" },
      });
      // With only 1 shared task, units < 5 -> bootstrap produces insufficient coverage, never a fake CI
      expect(result.coverage.sharedTaskCount).toBe(1);
      expect(result.empty).toBe(false);
      expect(result.bootstrap?.interval).toBeNull();
      expect(result.bootstrap?.coverageState.state).toBe("insufficient");
    });

    it("profile claim generator returns 'missing' label when resolved units < 5", () => {
      const input: ClaimCohortInput = {
        metric: "judged_score",
        cohortId: "cohort-1",
        areaLabel: "code-transformation",
        pointValue: 85,
        eligibleInterval: null,
        resolvedUnitCount: 3, // Below MIN_CLAIM_RESOLVED_UNITS (5)
        boundary: {
          source: "rubric_version",
          ref: { id: "rubric-1", version: 1 },
          supportedRegion: { lower: 80, upper: 100 },
          unsupportedRegion: { lower: 0, upper: 60 },
        },
        hasUndisclosedMissingness: false,
        cohortDisagreement: false,
        incompatibleCohortCount: 1,
        verifiedFailures: 0,
        verifiedTotal: 3,
      };

      const claim = buildProfileClaim(input);
      expect(claim.label).toBe("missing");
      expect(claim.receipt.resolvedUnitCount).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Invariant 5: Profile claims disclose and drill down correctly
  // ---------------------------------------------------------------------------
  describe("Invariant 5: Profile claims disclose and drill down correctly", () => {
    it("every generated claim sentence binds to a source metric key with verifiable receipt", () => {
      const input: ClaimCohortInput = {
        metric: "judged_score",
        cohortId: "cohort-1",
        areaLabel: "debugging",
        pointValue: 92,
        eligibleInterval: { lower: 88, upper: 96 },
        resolvedUnitCount: 8, // >= 5 units
        boundary: {
          source: "rubric_version",
          ref: { id: "rubric-1", version: 1 },
          supportedRegion: { lower: 80, upper: 100 },
          unsupportedRegion: { lower: 0, upper: 60 },
        },
        hasUndisclosedMissingness: false,
        cohortDisagreement: false,
        incompatibleCohortCount: 1,
        verifiedFailures: 0,
        verifiedTotal: 8,
      };

      const claim = buildProfileClaim(input);
      expect(claim.label).toBe("strongest_supported");
      expect(claim.receipt.boundaryRef).toBe("rubric-1@1");
      expect(claim.receipt.eligibleInterval).toEqual({ lower: 88, upper: 96 });

      expect(claim.sentences.length).toBeGreaterThan(0);
      for (const sentence of claim.sentences) {
        expect(sentence.text.length).toBeGreaterThan(0);
        expect(sentence.sourceMetricKey.length).toBeGreaterThan(0);
      }
    });

    it("discloses limitations when verified failures or cohort disagreements exist", () => {
      const input: ClaimCohortInput = {
        metric: "judged_score",
        cohortId: "cohort-1",
        areaLabel: "debugging",
        pointValue: 75,
        eligibleInterval: { lower: 65, upper: 85 },
        resolvedUnitCount: 6,
        boundary: {
          source: "rubric_version",
          ref: { id: "rubric-1", version: 1 },
          supportedRegion: { lower: 80, upper: 100 },
          unsupportedRegion: { lower: 0, upper: 60 },
        },
        hasUndisclosedMissingness: true,
        cohortDisagreement: true,
        incompatibleCohortCount: 2,
        verifiedFailures: 2,
        verifiedTotal: 6,
      };

      const claim = buildProfileClaim(input);
      expect(claim.label).toBe("mixed");
      expect(claim.disclosures.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Invariant 6: Search/Records/Attention preserve type and ownership
  // ---------------------------------------------------------------------------
  describe("Invariant 6: Search/Records/Attention preserve type and ownership", () => {
    it("search index documents preserve exact entity types and owner deep-link hrefs", async () => {
      const searchRepo = createSearchIndexRepository(db);
      const resolver = createDexieSearchSourceResolver(db);
      await rebuildSearchIndex({ searchRepo, resolver });

      const allDocs = await db.searchDocuments.toArray();
      expect(allDocs.length).toBeGreaterThan(5);

      const taskDoc = allDocs.find((d) => d.type === "task" && d.id === "task-canon-1");
      expect(taskDoc).toBeDefined();
      expect(taskDoc?.ownerHref).toBe("/tasks/task-canon-1");

      const studyDoc = allDocs.find((d) => d.type === "fusion_study" && d.id === "study-exploratory");
      expect(studyDoc).toBeDefined();
      expect(studyDoc?.ownerHref).toBe("/lab/studies/study-exploratory");

      const compDoc = allDocs.find((d) => d.type === "comparison" && d.id === "run-1");
      expect(compDoc).toBeDefined();
      expect(compDoc?.ownerHref).toBe("/compare/run-1");
    });

    it("records repository preserves exact RecordType and resolves exact owner context", async () => {
      const recordsRepo = createRecordsRepository({
        runRepo: createRunRepository(db),
        comparisonRepo: createComparisonRepository(db),
        evaluationRepo: createEvaluationRepository(db),
        studyRepo: createStudyRepository(db),
        evidenceRepo: createEvidenceRepository(db),
      });

      const page = await recordsRepo.list();
      expect(page.items.length).toBeGreaterThan(0);

      for (const item of page.items) {
        expect([
          "comparison",
          "evaluation",
          "policy-study",
          "task-execution",
          "observation",
          "legacy",
        ]).toContain(item.recordType);

        const owner = resolveRecordOwner(item);
        expect(owner.ownerKind).toBeDefined();
        expect(["exact", "crosswalk", "unresolved"]).toContain(owner.confidence);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Invariant 7: Records/Attention cannot execute
  // ---------------------------------------------------------------------------
  describe("Invariant 7: Records and Attention cannot execute", () => {
    const INSPECT_PATHS = [
      "src/lib/records",
      "src/lib/attention",
      "src/workspaces/records",
      "src/workspaces/attention",
      "src/ui/RecordsDrawer.tsx",
      "src/ui/RecordsMovePointer.tsx",
      "src/ui/AttentionPopover.tsx",
      "src/ui/AttentionHost.tsx",
    ];

    const FORBIDDEN_EXECUTION_PATTERNS = [
      /\bretryIncomplete\s*\(/,
      /\bstartExperiment\s*\(/,
      /\bextendRoster\s*\(/,
      /\bexecuteRun\s*\(/,
      /\bonResume\b/,
      /\bonAddModel\b/,
      /^(?!import type).*from ["'][^"']*experiment-controller["']/m,
      /^(?!import type).*from ["'][^"']*run-executor["']/m,
    ];

    function collectSourceFiles(rel: string): string[] {
      const abs = join(ROOT, rel);
      try {
        const entries = readdirSync(abs, { withFileTypes: true });
        return entries.flatMap((entry) => {
          const next = `${rel}/${entry.name}`;
          if (entry.isDirectory()) return collectSourceFiles(next);
          if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) return [];
          if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) return [];
          return [next];
        });
      } catch {
        return [rel];
      }
    }

    const files = INSPECT_PATHS.flatMap(collectSourceFiles);

    it("scans all Records and Attention modules", () => {
      expect(files.length).toBeGreaterThan(5);
    });

    it.each(files)("forbids execution and mutation triggers in %s", (rel) => {
      const source = readFileSync(join(ROOT, rel), "utf8");
      for (const pattern of FORBIDDEN_EXECUTION_PATTERNS) {
        expect(source).not.toMatch(pattern);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Invariant 8: Every legacy route/archive remains valid and Fusion Study owner
  //              adapters preserve exact Task Set/version ownership
  // ---------------------------------------------------------------------------
  describe("Invariant 8: Legacy routes/archives valid and owner adapters preserve ownership", () => {
    it("imports legacy non-fusion v2 archive and v3 archive cleanly without errors", async () => {
      const v2Archive = buildValidNonFusionArchiveV2Fixture();
      const freshDb1 = new RSembleEvaluationDB(`legacy-v2-test-${Math.random().toString(36).slice(2)}`);
      await freshDb1.open();

      const preview2 = await previewWorkbenchArchive(freshDb1, v2Archive as never, {
        sourceLabel: "legacy-v2.json",
      });
      expect(preview2.invalid).toEqual([]);
      const commit2 = await commitPreviewWorkbenchArchiveV2(freshDb1, preview2);
      expect(commit2.collisions).toEqual([]);
      freshDb1.close();
      await freshDb1.delete();

      const v3Archive = buildValidArchiveV3Fixture();
      const freshDb2 = new RSembleEvaluationDB(`v3-test-${Math.random().toString(36).slice(2)}`);
      await freshDb2.open();

      const preview3 = await previewWorkbenchArchive(freshDb2, v3Archive, {
        sourceLabel: "v3.json",
      });
      expect(preview3.invalid).toEqual([]);
      const commit3 = await commitPreviewWorkbenchArchiveV3(freshDb2, preview3);
      expect(commit3.collisions).toEqual([]);
      freshDb2.close();
      await freshDb2.delete();
    });

    it("preserves exact taskSetId and taskSetVersion on TaskSetOwnershipCrosswalk rows", async () => {
      const xwalkExploratory = await db.taskSetOwnershipCrosswalk.get(
        "ts-xwalk:fusion:study-exploratory",
      );
      expect(xwalkExploratory).toBeDefined();
      expect(xwalkExploratory?.taskSetId).toBe("taskset-1");
      expect(xwalkExploratory?.version).toBe(1);

      const xwalkConfirmed = await db.taskSetOwnershipCrosswalk.get(
        "ts-xwalk:fusion:study-confirmed",
      );
      expect(xwalkConfirmed).toBeDefined();
      expect(xwalkConfirmed?.taskSetId).toBe("taskset-1");
      expect(xwalkConfirmed?.version).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Invariant 9: Experimental Fusion observations never enter canonical Task
  //              Observation/profile counts
  // ---------------------------------------------------------------------------
  describe("Invariant 9: Experimental Fusion observations isolated from canonical evidence", () => {
    it("canonical observations table contains only evaluation and comparison source kinds", async () => {
      const observations = await db.observations.toArray();
      expect(observations.length).toBeGreaterThan(0);

      for (const obs of observations) {
        expect(["evaluation", "comparison"]).toContain(obs.sourceKind);
      }

      // Study observations live strictly in studyObservations table
      const studyObs = await db.studyObservations.toArray();
      expect(studyObs.length).toBeGreaterThan(0);
      expect(studyObs[0].studyId).toBe("study-exploratory");

      // Verify model evidence queries only return canonical observations
      const query = canonicalizeModelEvidenceQuery({
        respondent: {
          kind: "model_configuration",
          modelConfigurationId: MC_EXACT_ID,
        },
        observedFrom: null,
        observedTo: null,
        taskFamilyIds: [],
        facetFilters: [],
        evidenceClasses: ["comparable", "exploratory", "verified"],
        allowedUses: ["within_model_profile", "task_descriptive"],
        comparabilityCohortIds: [],
        sourceKinds: ["comparison", "evaluation"],
        rubricRefs: [],
        evaluatorFilters: [],
        includeUnknownVersion: true,
        eligibilityRuleVersion: 1,
        aggregationRuleVersion: 1,
        uncertaintyRuleVersion: 1,
      });

      const selection = selectProfileObservations(query, {
        configurations: (await db.modelConfigurations.toArray()).map((r) => r.snapshot),
        observations: await db.observations.toArray(),
        decisions: (await db.evidenceDecisions.toArray()).map((r) => r.decision),
        ledgerRows: corpus.evidence.countingRows,
      });

      expect(selection.kind).toBe("exact");
      if (selection.kind === "exact") {
        for (const cell of selection.cells) {
          expect(["evaluation", "comparison"]).toContain(cell.active.observation.sourceKind);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Invariant 10: No universal score/index appears
  // ---------------------------------------------------------------------------
  describe("Invariant 10: No universal score/index appears", () => {
    it("claim sentences never contain forbidden universal phrases or universal scalars", () => {
      const input: ClaimCohortInput = {
        metric: "judged_score",
        cohortId: "cohort-1",
        areaLabel: "benchmarking",
        pointValue: 90,
        eligibleInterval: { lower: 85, upper: 95 },
        resolvedUnitCount: 10,
        boundary: {
          source: "rubric_version",
          ref: { id: "rubric-1", version: 1 },
          supportedRegion: { lower: 80, upper: 100 },
          unsupportedRegion: { lower: 0, upper: 60 },
        },
        hasUndisclosedMissingness: false,
        cohortDisagreement: false,
        incompatibleCohortCount: 1,
        verifiedFailures: 0,
        verifiedTotal: 10,
      };

      const claim = buildProfileClaim(input);
      for (const sentence of claim.sentences) {
        for (const forbidden of FORBIDDEN_CLAIM_PHRASES) {
          const regex = new RegExp(`\\b${forbidden}\\b`, "i");
          expect(sentence.text).not.toMatch(regex);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Invariant 11: No credential-shaped text appears in UI, logs, exports, or
  //               search documents
  // ---------------------------------------------------------------------------
  describe("Invariant 11: No credential-shaped text in search, exports, or records", () => {
    it("search index documents contain no credential patterns or prohibited keys", async () => {
      const searchRepo = createSearchIndexRepository(db);
      const resolver = createDexieSearchSourceResolver(db);
      await rebuildSearchIndex({ searchRepo, resolver });

      const docs = await db.searchDocuments.toArray();
      expect(docs.length).toBeGreaterThan(0);

      for (const doc of docs) {
        expect(CREDENTIAL_LIKE_INLINE.test(doc.title)).toBe(false);
        expect(CREDENTIAL_LIKE_INLINE.test(doc.subtitle)).toBe(false);
        expect(CREDENTIAL_LIKE_INLINE.test(doc.ownerHref)).toBe(false);
        for (const token of doc.tokens) {
          expect(CREDENTIAL_LIKE_INLINE.test(token)).toBe(false);
        }
      }
    });

    it("archive v3 export contains no prohibited secret keys or credential values", async () => {
      const archive = await exportWorkbenchArchiveV3(db, {
        now: CORPUS_DETERMINISTIC_NOW,
      });

      const validation = validateArchiveV3(archive);
      expect(validation.valid).toBe(true);

      const json = JSON.stringify(archive);
      expect(CREDENTIAL_LIKE_INLINE.test(json)).toBe(false);

      for (const key of EVIDENCE_PROHIBITED_KEYS) {
        expect(json.includes(`"${key}":`)).toBe(false);
      }
    });

    it("credential redactor replaces secret shapes in diagnostics with [REDACTED]", () => {
      const raw = "Error with key sk-1234567890abcdef in request";
      const redacted = redactCredentialMaterial(raw);
      expect(redacted.includes("[REDACTED]")).toBe(true);
      expect(CREDENTIAL_LIKE_INLINE.test(redacted)).toBe(false);
    });
  });
});
