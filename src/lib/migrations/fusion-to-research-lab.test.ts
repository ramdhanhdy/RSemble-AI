// =============================================================================
// RSemble AI — Fusion → Research Lab migration preview tests (Child 06 T4)
//
// In-memory, side-effect-free migration preview from legacy Fusion stores to
// strict Research Lab destinations (spec §10, §19; plan Task 4).
//
// Invariants verified:
//  - All-discard preview is a valid outcome for the frozen development corpus.
//  - No guessed fields appear in any converted entity.
//  - Strict destination validators (isPolicyStudyRecord, isPolicyStudyTrial,
//    isPolicyStudyObservation, isPolicyReportPayload, isLabRecipeVersion,
//    isModelPoolVersion, etc.) are never loosened.
//  - Semantic receipt is deterministic and tamper-detectable.
//  - Preview execution is side-effect free (no writes, no source mutations).
// =============================================================================

import { describe, expect, it } from "vitest";
import { FUSION_CORPUS_FIXTURE } from "./fusion-corpus-fixture";
import {
  previewFusionToResearchLab,
  type FusionCorpusSource,
} from "./fusion-to-research-lab";
import {
  isFusionToResearchLabReceipt,
  canonicalReceiptJson,
} from "./fusion-to-research-lab-receipt";
import {
  isLabRecipeRecord,
  isLabRecipeVersion,
} from "../studies/lab-recipe-types";
import {
  isModelPoolRecord,
  isModelPoolVersion,
} from "../studies/model-pool-types";
import {
  isPolicyReportPayload,
  isPolicyStudyObservation,
  isPolicyStudyRecord,
  isPolicyStudyTrial,
} from "../studies/policy/policy-study-types";
import { isStudyAttempt } from "../studies/study-types";
import type { TaskSetOwnershipCrosswalkRow } from "../persistence/database";

// --- Valid test hashes / IDs --------------------------------------------------

const VALID_64_HEX = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const VALID_SHA256 = `sha256:${VALID_64_HEX}`;
const VALID_MC_ID_1 = `mc:${VALID_SHA256}`;
const VALID_MC_ID_2 = `mc:sha256:b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1`;
const VALID_MC_SYNTH = `mc:sha256:c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2`;

describe("Fusion → Research Lab migration preview (frozen T0 corpus)", () => {
  it("previews the frozen T0 corpus with an all-discard receipt and empty destination graph", () => {
    const fixedNow = 1720000000000;
    const result = previewFusionToResearchLab(FUSION_CORPUS_FIXTURE, { now: fixedNow });

    expect(result.isSideEffectFree).toBe(true);
    expect(result.isAllDiscard).toBe(true);
    expect(result.receipt.status).toBe("preview_completed");
    expect(isFusionToResearchLabReceipt(result.receipt)).toBe(true);

    // Assert exact source counts matching T0 characterization fixture
    expect(result.receipt.sourceCounts).toEqual({
      fusionRecipes: 6,
      poolManifests: 4,
      fusionStudies: 5,
      fusionTrials: 16,
      fusionAttempts: 1,
      fusionObservations: 4,
      fusionPlaybooks: 3,
    });

    // Destination graph is completely empty
    expect(result.receipt.totalConvertedRecords).toBe(0);
    expect(result.staged.labRecipeRecords).toHaveLength(0);
    expect(result.staged.labRecipeVersions).toHaveLength(0);
    expect(result.staged.modelPoolRecords).toHaveLength(0);
    expect(result.staged.modelPoolVersions).toHaveLength(0);
    expect(result.staged.studies).toHaveLength(0);
    expect(result.staged.studyTrials).toHaveLength(0);
    expect(result.staged.studyAttempts).toHaveLength(0);
    expect(result.staged.studyObservations).toHaveLength(0);
    expect(result.staged.policyPlaybooks).toHaveLength(0);

    // Total discarded equals total source records (39)
    expect(result.receipt.totalDiscardedRecords).toBe(39);
    expect(result.receipt.totalSourceRecords).toBe(39);
  });

  it("classifies specific T0 records with correct discard reason codes", () => {
    const result = previewFusionToResearchLab(FUSION_CORPUS_FIXTURE, { now: 1000 });

    const decisionMap = new Map(result.receipt.decisions.map((d) => [d.id, d]));

    // 1. study-unresolved-owner must be discarded due to unresolved crosswalk
    const unresolvedDecision = decisionMap.get("study-unresolved-owner");
    expect(unresolvedDecision).toBeDefined();
    expect(unresolvedDecision?.status).toBe("discard");
    expect(unresolvedDecision?.reasonCode).toBe("unresolved_task_set_owner");

    // 2. resolved T0 studies discarded due to strict validation (e.g. critic_ref_not_mc_sha256 or missing_manifest_digest)
    const completedExploration = decisionMap.get("study-exploration-completed");
    expect(completedExploration).toBeDefined();
    expect(completedExploration?.status).toBe("discard");
    expect([
      "critic_ref_not_mc_sha256",
      "missing_manifest_digest",
      "invalid_protocol_fingerprint",
      "missing_rubric",
    ]).toContain(completedExploration?.reasonCode);

    // 3. T0 recipes without metadata discarded with missing_recipe_metadata
    const recipeDecision = decisionMap.get("recipe-blind-raw:v1");
    expect(recipeDecision).toBeDefined();
    expect(recipeDecision?.status).toBe("discard");
    expect(recipeDecision?.reasonCode).toBe("missing_recipe_metadata");

    // 4. T0 pools without metadata discarded with missing_pool_metadata
    const poolDecision = decisionMap.get("pool-core-6:v1");
    expect(poolDecision).toBeDefined();
    expect(poolDecision?.status).toBe("discard");
    expect(poolDecision?.reasonCode).toBe("missing_pool_metadata");
  });

  it("is deterministic: repeated preview produces identical receipt JSON and digest", () => {
    const fixedNow = 1720000000000;
    const res1 = previewFusionToResearchLab(FUSION_CORPUS_FIXTURE, { now: fixedNow });
    const res2 = previewFusionToResearchLab(FUSION_CORPUS_FIXTURE, { now: fixedNow });

    expect(res1.receipt.receiptDigest).toBe(res2.receipt.receiptDigest);
    expect(canonicalReceiptJson(res1.receipt)).toBe(canonicalReceiptJson(res2.receipt));
    expect(res1.receipt.decisions).toEqual(res2.receipt.decisions);
  });

  it("is side-effect free: input fixture objects are not mutated", () => {
    const studyCountBefore = FUSION_CORPUS_FIXTURE.studies.length;
    const firstStudyRef = FUSION_CORPUS_FIXTURE.studies[0];
    const firstStudyClone = JSON.parse(JSON.stringify(firstStudyRef));

    previewFusionToResearchLab(FUSION_CORPUS_FIXTURE);

    expect(FUSION_CORPUS_FIXTURE.studies.length).toBe(studyCountBefore);
    expect(FUSION_CORPUS_FIXTURE.studies[0]).toEqual(firstStudyClone);
  });
});

describe("Fusion → Research Lab migration preview (lossless conversion paths)", () => {
  it("losslessly converts a fully valid Fusion recipe when authoritative metadata is provided", () => {
    const source: FusionCorpusSource = {
      recipes: [
        {
          id: "recipe-custom",
          version: 1,
          recipeFamily: "AnalysisFed",
          promptVersion: "recipe-custom-v1",
          judgeAnalysisMode: "qualitative",
          rubricAccess: true,
          verification: false,
          synthesizer: { providerId: "openrouter", model: "openai/gpt-4o" },
        },
      ],
      pools: [],
      studies: [],
      trials: [],
      attempts: [],
      observations: [],
      playbooks: [],
    };

    const result = previewFusionToResearchLab(source, {
      now: 1000,
      recipeMetadata: {
        "recipe-custom": {
          name: "Custom Analysis Recipe",
          description: "Authoritative recipe description",
          createdAt: 1000,
        },
      },
    });

    expect(result.receipt.sourceCounts.fusionRecipes).toBe(1);
    expect(result.receipt.convertedCounts.labRecipeRecords).toBe(1);
    expect(result.receipt.convertedCounts.labRecipeVersions).toBe(1);
    expect(result.receipt.totalConvertedRecords).toBe(2);
    expect(result.receipt.totalDiscardedRecords).toBe(0);

    const stagedVersion = result.staged.labRecipeVersions[0];
    expect(isLabRecipeVersion(stagedVersion)).toBe(true);
    expect(stagedVersion.recipeId).toBe("recipe-custom");
    expect(stagedVersion.kind).toBe("fusion");
    expect(stagedVersion.digest).toMatch(/^sha256:[0-9a-f]{64}$/);

    const stagedRecord = result.staged.labRecipeRecords[0];
    expect(isLabRecipeRecord(stagedRecord)).toBe(true);
    expect(stagedRecord.name).toBe("Custom Analysis Recipe");
  });

  it("losslessly converts a fully valid Model Pool when authoritative metadata is provided", () => {
    const source: FusionCorpusSource = {
      recipes: [],
      pools: [
        {
          id: "pool-alpha",
          version: 1,
          core: [
            {
              id: "slot-1",
              providerId: "openrouter",
              provider: "OpenRouter",
              model: "model-1",
              slug: "slug-1",
              enabled: true,
            },
          ],
          challengers: [],
          diversityChecklist: ["reasoning-diversity"],
          rationale: "Initial core pool",
          supersedesVersion: null,
          createdAt: 1000,
        },
      ],
      studies: [],
      trials: [],
      attempts: [],
      observations: [],
      playbooks: [],
    };

    const result = previewFusionToResearchLab(source, {
      now: 1000,
      poolMetadata: {
        "pool-alpha": {
          name: "Alpha Pool",
          purpose: "Core capability evaluation",
          createdAt: 1000,
        },
      },
    });

    expect(result.receipt.sourceCounts.poolManifests).toBe(1);
    expect(result.receipt.convertedCounts.modelPoolRecords).toBe(1);
    expect(result.receipt.convertedCounts.modelPoolVersions).toBe(1);
    expect(result.receipt.totalConvertedRecords).toBe(2);

    const stagedVersion = result.staged.modelPoolVersions[0];
    expect(isModelPoolVersion(stagedVersion)).toBe(true);
    expect(stagedVersion.poolId).toBe("pool-alpha");

    const stagedRecord = result.staged.modelPoolRecords[0];
    expect(isModelPoolRecord(stagedRecord)).toBe(true);
    expect(stagedRecord.name).toBe("Alpha Pool");
  });

  it("losslessly converts a valid interconnected study graph with trials, attempts, observations, playbooks", () => {
    const crosswalkRow: TaskSetOwnershipCrosswalkRow = {
      key: "ts-xwalk:fusion:study-valid-1",
      kind: "fusion-owner",
      taskSetId: "task-set-1",
      version: 1,
      digest: VALID_SHA256,
      status: "resolved",
      suiteRef: {
        suiteId: "suite-1",
        suiteVersion: 1,
        protocolFingerprint: VALID_SHA256,
      },
      note: "Resolved crosswalk",
      updatedAt: 1000,
    };
    const source: FusionCorpusSource = {
      recipes: [
        {
          id: "recipe-1",
          version: 1,
          recipeFamily: "AnalysisFed",
          promptVersion: "v1",
          judgeAnalysisMode: "qualitative",
          rubricAccess: false,
          verification: false,
          synthesizer: { providerId: "openrouter", model: "openai/gpt-4o" },
        },
      ],
      pools: [
        {
          id: "pool-1",
          version: 1,
          core: [
            {
              id: "slot-1",
              providerId: "openrouter",
              provider: "OpenRouter",
              model: "model-1",
              slug: "slug-1",
              enabled: true,
            },
          ],
          challengers: [],
          diversityChecklist: ["diversity"],
          rationale: "Core pool",
          supersedesVersion: null,
          createdAt: 1000,
        },
      ],
      studies: [
        {
          id: "study-valid-1",
          revision: 1,
          kind: "exploration",
          suiteRef: {
            suiteId: "suite-1",
            suiteVersion: 1,
            protocolFingerprint: VALID_SHA256,
          },
          poolRef: { id: "pool-1", version: 1 },
          judge1: { providerId: "openrouter", model: "judge-1" },
          judge2: { providerId: "openrouter", model: "judge-2" },
          recipeRefs: [{ id: "recipe-1", version: 1 }],
          status: "completed",
          claimLevel: "exploratory",
          confirmationOf: null,
          playbookRef: "playbook-1",
          createdAt: 1000,
          updatedAt: 2000,
          stageResults: { stageA: null, stageB: null, stageC: null },
        },
      ],
      trials: [
        {
          id: "trial-1",
          studyId: "study-valid-1",
          suiteRef: {
            suiteId: "suite-1",
            suiteVersion: 1,
            protocolFingerprint: VALID_SHA256,
          },
          poolRef: { id: "pool-1", version: 1 },
          policy: "fuse",
          stage: "A",
          candidateConfig: {
            slots: [
              {
                id: "slot-1",
                providerId: "openrouter",
                provider: "OpenRouter",
                model: "model-1",
                slug: "slug-1",
                enabled: true,
              },
            ],
          },
          recipe: { id: "recipe-1", version: 1 },
          synthesizer: { providerId: "openrouter", model: "synth-1" },
          judge1: { providerId: "openrouter", model: "judge-1" },
          judge2: { providerId: "openrouter", model: "judge-2" },
          sampleIndex: 0,
          status: "sealed",
          revision: 1,
          observationIds: [],
          children: {
            candidateRunId: "run-1",
            devJudgeRunId: "run-judge-1",
            synthesisArtifact: null,
          },
          cost: {
            policy: { tokensIn: 100, tokensOut: 50 },
            experimental: { tokensIn: 200, tokensOut: 100 },
          },
          createdAt: 1100,
          updatedAt: 1200,
          sealedAt: 1200,
        },
        {
          id: "trial-2",
          studyId: "study-valid-1",
          suiteRef: {
            suiteId: "suite-1",
            suiteVersion: 1,
            protocolFingerprint: VALID_SHA256,
          },
          poolRef: { id: "pool-1", version: 1 },
          policy: "fuse",
          stage: "A",
          candidateConfig: {
            slots: [
              {
                id: "slot-1",
                providerId: "openrouter",
                provider: "OpenRouter",
                model: "model-1",
                slug: "slug-1",
                enabled: true,
              },
            ],
          },
          recipe: { id: "recipe-1", version: 1 },
          synthesizer: { providerId: "openrouter", model: "synth-1" },
          judge1: { providerId: "openrouter", model: "judge-1" },
          judge2: { providerId: "openrouter", model: "judge-2" },
          sampleIndex: 1,
          status: "sealed",
          revision: 1,
          observationIds: [],
          children: {
            candidateRunId: "run-2",
            devJudgeRunId: "run-judge-1",
            synthesisArtifact: null,
          },
          cost: {
            policy: { tokensIn: 100, tokensOut: 50 },
            experimental: { tokensIn: 200, tokensOut: 100 },
          },
          createdAt: 1300,
          updatedAt: 1400,
          sealedAt: 1400,
        },
      ],
      attempts: [
        {
          id: "attempt-1",
          studyId: "study-valid-1",
          fromTrialId: "trial-1",
          toTrialId: "trial-2",
          reason: "synthesis_rerun",
          createdAt: 1300,
        },
      ],
      observations: [
        {
          id: "obs-1",
          trialId: "trial-1",
          judge: { providerId: "openrouter", model: "judge-2" },
          status: "completed",
          startedAt: 1150,
          finishedAt: 1190,
          overallScore: 0.85,
          tokensIn: 50,
          tokensOut: 20,
          error: null,
          runId: "run-judge-2",
        },
      ],
      playbooks: [
        {
          id: "playbook-1",
          studyId: "study-valid-1",
          suiteRef: {
            suiteId: "suite-1",
            suiteVersion: 1,
            protocolFingerprint: VALID_SHA256,
          },
          rows: [
            {
              policy: "fuse",
              configuration: "Fuse Config 1",
              score: 0.85,
              lift: 0.12,
              costMultiplier: 1.5,
              confidence: "high",
            },
          ],
          recommendation: {
            kind: "adopt",
            policy: "fuse",
            configuration: "Fuse Config 1",
            rationale: "Strong lift",
          },
          poolAdequacy: {
            probed: true,
            outcome: "confirmed",
            challengerKeys: [],
            note: "Adequate pool",
          },
          claimLevel: "exploratory",
          conclusion: "Synthesis recommended",
          createdAt: 1900,
        },
      ],
      crosswalk: [crosswalkRow],
    };

    const result = previewFusionToResearchLab(source, {
      now: 2000,
      recipeMetadata: {
        "recipe-1": {
          name: "Recipe 1",
          description: "Recipe desc",
          createdAt: 1000,
        },
      },
      poolMetadata: {
        "pool-1": {
          name: "Pool 1",
          purpose: "Pool purpose",
          createdAt: 1000,
        },
      },
      // Authoritative exact configuration mappings
      exactModelConfigurations: {
        "judge-1": VALID_MC_ID_1,
        "judge-2": VALID_MC_ID_2,
        "synth-1": VALID_MC_SYNTH,
        "openai/gpt-4o": VALID_MC_SYNTH,
        "model-1": VALID_MC_ID_1,
      },
      // Authoritative study definitions
      studyExtensions: {
        "study-valid-1": {
          title: "Valid Converted Study",
          rubric: { rubricId: "rubric-1", version: 1 },
          policies: ["fuse"],
          stageProtocolVersion: 1,
        },
      },
    });

    expect(result.receipt.status).toBe("preview_completed");
    expect(result.isAllDiscard).toBe(false);
    expect(result.receipt.totalConvertedRecords).toBeGreaterThan(0);
    expect(result.receipt.totalDiscardedRecords).toBe(0);

    // Verify staged study passes strict type guard
    expect(result.staged.studies).toHaveLength(1);
    expect(isPolicyStudyRecord(result.staged.studies[0])).toBe(true);

    // Verify staged trials pass strict type guard
    expect(result.staged.studyTrials).toHaveLength(2);
    for (const trial of result.staged.studyTrials) {
      expect(isPolicyStudyTrial(trial)).toBe(true);
    }

    // Verify staged attempt passes strict type guard
    expect(result.staged.studyAttempts).toHaveLength(1);
    expect(isStudyAttempt(result.staged.studyAttempts[0])).toBe(true);

    // Verify staged observation passes strict type guard
    expect(result.staged.studyObservations).toHaveLength(1);
    expect(isPolicyStudyObservation(result.staged.studyObservations[0])).toBe(true);

    // Verify staged playbook passes strict type guard
    expect(result.staged.policyPlaybooks).toHaveLength(1);
    expect(isPolicyReportPayload(result.staged.policyPlaybooks[0].playbook)).toBe(true);
  });
});

describe("Fusion → Research Lab migration preview (specific discard reasons)", () => {
  it("discards records containing prohibited keys with prohibited_keys_detected", () => {
    const source: FusionCorpusSource = {
      recipes: [
        {
          id: "recipe-leak",
          version: 1,
          recipeFamily: "BlindRaw",
          promptVersion: "v1",
          judgeAnalysisMode: "none",
          rubricAccess: false,
          verification: false,
          synthesizer: { providerId: "openrouter", model: "synth" },
          apiKey: "sk-secret-key-12345",
        } as never,
      ],
      pools: [],
      studies: [],
      trials: [],
      attempts: [],
      observations: [],
      playbooks: [],
    };

    const result = previewFusionToResearchLab(source);
    expect(result.receipt.totalDiscardedRecords).toBe(1);
    expect(result.receipt.decisions[0].reasonCode).toBe("prohibited_keys_detected");
  });

  it("discards unconfirmed pool adequacy with pool_adequacy_unconfirmed_not_supported", () => {
    const source: FusionCorpusSource = {
      recipes: [],
      pools: [],
      studies: [],
      trials: [],
      attempts: [],
      observations: [],
      playbooks: [
        {
          id: "playbook-unconfirmed",
          studyId: "study-x",
          suiteRef: {
            suiteId: "suite-x",
            suiteVersion: 1,
            protocolFingerprint: VALID_SHA256,
          },
          rows: [
            {
              policy: "fuse",
              configuration: "cfg",
              score: 0.5,
              lift: 0.1,
              costMultiplier: 1.0,
              confidence: "low",
            },
          ],
          recommendation: { kind: "do_not_fuse", rationale: "Poor outcome" },
          poolAdequacy: {
            probed: true,
            outcome: "unconfirmed",
            challengerKeys: [],
            note: "Not adequate",
          },
          claimLevel: "exploratory",
          conclusion: "DNF",
          createdAt: 1000,
        },
      ],
    };

    const result = previewFusionToResearchLab(source);
    const decision = result.receipt.decisions.find((d) => d.id === "playbook-unconfirmed");
    expect(decision?.status).toBe("discard");
    expect([
      "pool_adequacy_unconfirmed_not_supported",
      "parent_study_discarded",
    ]).toContain(decision?.reasonCode);
  });

  it("cascades discard: child trials and observations are discarded if parent study is discarded", () => {
    const source: FusionCorpusSource = {
      recipes: [],
      pools: [],
      studies: [
        {
          id: "study-broken",
          revision: 1,
          kind: "exploration",
          suiteRef: {
            suiteId: "suite-unresolved",
            suiteVersion: 1,
            protocolFingerprint: "non-sha256-hash",
          },
          poolRef: { id: "p1", version: 1 },
          judge1: { providerId: "openrouter", model: "j1" },
          judge2: { providerId: "openrouter", model: "j2" },
          recipeRefs: [],
          status: "in_progress",
          claimLevel: "exploratory",
          confirmationOf: null,
          playbookRef: null,
          createdAt: 1000,
          updatedAt: 1000,
          stageResults: { stageA: null, stageB: null, stageC: null },
        },
      ],
      trials: [
        {
          id: "trial-orphan",
          studyId: "study-broken",
          suiteRef: {
            suiteId: "suite-unresolved",
            suiteVersion: 1,
            protocolFingerprint: "non-sha256-hash",
          },
          poolRef: { id: "p1", version: 1 },
          policy: "best_fixed",
          stage: "A",
          candidateConfig: { slots: [] },
          recipe: null,
          synthesizer: null,
          judge1: { providerId: "openrouter", model: "j1" },
          judge2: { providerId: "openrouter", model: "j2" },
          sampleIndex: 0,
          status: "in_progress",
          revision: 0,
          observationIds: [],
          children: {
            candidateRunId: null,
            devJudgeRunId: null,
            synthesisArtifact: null,
          },
          cost: {
            policy: { tokensIn: 0, tokensOut: 0 },
            experimental: { tokensIn: 0, tokensOut: 0 },
          },
          createdAt: 1000,
          updatedAt: 1000,
          sealedAt: null,
        },
      ],
      attempts: [],
      observations: [
        {
          id: "obs-orphan",
          trialId: "trial-orphan",
          judge: { providerId: "openrouter", model: "j1" },
          status: "completed",
          startedAt: 1000,
          finishedAt: 1000,
          overallScore: 0.5,
          tokensIn: 0,
          tokensOut: 0,
          error: null,
          runId: null,
        },
      ],
      playbooks: [],
    };

    const result = previewFusionToResearchLab(source);

    const studyDecision = result.receipt.decisions.find((d) => d.id === "study-broken");
    expect(studyDecision?.status).toBe("discard");

    const trialDecision = result.receipt.decisions.find((d) => d.id === "trial-orphan");
    expect(trialDecision?.status).toBe("discard");
    expect([
      "parent_study_discarded",
      "candidate_members_not_mc_sha256",
      "invalid_protocol_fingerprint",
    ]).toContain(trialDecision?.reasonCode);

    const obsDecision = result.receipt.decisions.find((d) => d.id === "obs-orphan");
    expect(obsDecision?.status).toBe("discard");
    expect([
      "referenced_trial_discarded",
      "critic_ref_not_mc_sha256",
    ]).toContain(obsDecision?.reasonCode);
  });

  it("discards a study with missing_recipe_refs when no fusion recipes can be resolved (does not invent recipe-default with zero digest)", () => {
    const crosswalkRow: TaskSetOwnershipCrosswalkRow = {
      key: "ts-xwalk:fusion:study-no-recipes",
      kind: "fusion-owner",
      taskSetId: "task-set-1",
      version: 1,
      digest: VALID_SHA256,
      status: "resolved",
      suiteRef: {
        suiteId: "suite-1",
        suiteVersion: 1,
        protocolFingerprint: VALID_SHA256,
      },
      note: "Resolved crosswalk",
      updatedAt: 1000,
    };
    const source: FusionCorpusSource = {
      recipes: [],
      pools: [
        {
          id: "pool-1",
          version: 1,
          core: [
            {
              id: "slot-1",
              providerId: "openrouter",
              provider: "OpenRouter",
              model: "model-1",
              slug: "slug-1",
              enabled: true,
            },
          ],
          challengers: [],
          diversityChecklist: ["diversity"],
          rationale: "Core pool",
          supersedesVersion: null,
          createdAt: 1000,
        },
      ],
      studies: [
        {
          id: "study-no-recipes",
          revision: 1,
          kind: "exploration",
          suiteRef: {
            suiteId: "suite-1",
            suiteVersion: 1,
            protocolFingerprint: VALID_SHA256,
          },
          poolRef: { id: "pool-1", version: 1 },
          judge1: { providerId: "openrouter", model: "judge-1" },
          judge2: { providerId: "openrouter", model: "judge-2" },
          recipeRefs: [],
          status: "in_progress",
          claimLevel: "exploratory",
          confirmationOf: null,
          playbookRef: null,
          createdAt: 1000,
          updatedAt: 2000,
          stageResults: { stageA: null, stageB: null, stageC: null },
        },
      ],
      trials: [],
      attempts: [],
      observations: [],
      playbooks: [],
      crosswalk: [crosswalkRow],
    };

    const result = previewFusionToResearchLab(source, {
      now: 2000,
      poolMetadata: {
        "pool-1": {
          name: "Pool 1",
          purpose: "Pool purpose",
          createdAt: 1000,
        },
      },
      exactModelConfigurations: {
        "judge-1": VALID_MC_ID_1,
        "judge-2": VALID_MC_ID_2,
      },
      studyExtensions: {
        "study-no-recipes": {
          title: "Study Without Recipes",
          rubric: { rubricId: "rubric-1", version: 1 },
          policies: ["best_fixed"],
          stageProtocolVersion: 1,
        },
      },
    });

    const studyDecision = result.receipt.decisions.find((d) => d.id === "study-no-recipes");
    expect(studyDecision?.status).toBe("discard");
    expect(studyDecision?.reasonCode).toBe("missing_recipe_refs");
    expect(result.staged.studies).toHaveLength(0);
  });

  it("discards a playbook with missing_recipe_sensitivity when recipeSensitivity is not provided (does not invent synthetic recipeSensitivity)", () => {
    const crosswalkRow: TaskSetOwnershipCrosswalkRow = {
      key: "ts-xwalk:fusion:study-with-pb",
      kind: "fusion-owner",
      taskSetId: "task-set-1",
      version: 1,
      digest: VALID_SHA256,
      status: "resolved",
      suiteRef: {
        suiteId: "suite-1",
        suiteVersion: 1,
        protocolFingerprint: VALID_SHA256,
      },
      note: "Resolved crosswalk",
      updatedAt: 1000,
    };
    const source: FusionCorpusSource = {
      recipes: [
        {
          id: "recipe-1",
          version: 1,
          recipeFamily: "AnalysisFed",
          promptVersion: "v1",
          judgeAnalysisMode: "qualitative",
          rubricAccess: false,
          verification: false,
          synthesizer: { providerId: "openrouter", model: "openai/gpt-4o" },
        },
      ],
      pools: [
        {
          id: "pool-1",
          version: 1,
          core: [
            {
              id: "slot-1",
              providerId: "openrouter",
              provider: "OpenRouter",
              model: "model-1",
              slug: "slug-1",
              enabled: true,
            },
          ],
          challengers: [],
          diversityChecklist: ["diversity"],
          rationale: "Core pool",
          supersedesVersion: null,
          createdAt: 1000,
        },
      ],
      studies: [
        {
          id: "study-with-pb",
          revision: 1,
          kind: "exploration",
          suiteRef: {
            suiteId: "suite-1",
            suiteVersion: 1,
            protocolFingerprint: VALID_SHA256,
          },
          poolRef: { id: "pool-1", version: 1 },
          judge1: { providerId: "openrouter", model: "judge-1" },
          judge2: { providerId: "openrouter", model: "judge-2" },
          recipeRefs: [{ id: "recipe-1", version: 1 }],
          status: "completed",
          claimLevel: "exploratory",
          confirmationOf: null,
          playbookRef: "playbook-no-sens",
          createdAt: 1000,
          updatedAt: 2000,
          stageResults: { stageA: null, stageB: null, stageC: null },
        },
      ],
      trials: [],
      attempts: [],
      observations: [],
      playbooks: [
        {
          id: "playbook-no-sens",
          studyId: "study-with-pb",
          suiteRef: {
            suiteId: "suite-1",
            suiteVersion: 1,
            protocolFingerprint: VALID_SHA256,
          },
          rows: [
            {
              policy: "fuse",
              configuration: "Fuse Config 1",
              score: 0.85,
              lift: 0.12,
              costMultiplier: 1.5,
              confidence: "high",
            },
          ],
          recommendation: {
            kind: "adopt",
            policy: "fuse",
            configuration: "Fuse Config 1",
            rationale: "Strong lift",
          },
          poolAdequacy: {
            probed: true,
            outcome: "confirmed",
            challengerKeys: [],
            note: "Adequate pool",
          },
          claimLevel: "exploratory",
          conclusion: "Synthesis recommended",
          createdAt: 1900,
        },
      ],
      crosswalk: [crosswalkRow],
    };

    const result = previewFusionToResearchLab(source, {
      now: 2000,
      recipeMetadata: {
        "recipe-1": {
          name: "Recipe 1",
          description: "Recipe desc",
          createdAt: 1000,
        },
      },
      poolMetadata: {
        "pool-1": {
          name: "Pool 1",
          purpose: "Pool purpose",
          createdAt: 1000,
        },
      },
      exactModelConfigurations: {
        "judge-1": VALID_MC_ID_1,
        "judge-2": VALID_MC_ID_2,
      },
      studyExtensions: {
        "study-with-pb": {
          title: "Study With Playbook",
          rubric: { rubricId: "rubric-1", version: 1 },
          policies: ["fuse"],
          stageProtocolVersion: 1,
        },
      },
    });

    const pbDecision = result.receipt.decisions.find((d) => d.id === "playbook-no-sens");
    expect(pbDecision?.status).toBe("discard");
    expect(pbDecision?.reasonCode).toBe("missing_recipe_sensitivity");
    expect(result.staged.policyPlaybooks).toHaveLength(0);
  });

  it("discards a completed study with missing_supporting_ids when playbookRef is missing or blank (does not invent 'playbook-report')", () => {
    const crosswalkRow: TaskSetOwnershipCrosswalkRow = {
      key: "ts-xwalk:fusion:study-completed-no-pb",
      kind: "fusion-owner",
      taskSetId: "task-set-1",
      version: 1,
      digest: VALID_SHA256,
      status: "resolved",
      suiteRef: {
        suiteId: "suite-1",
        suiteVersion: 1,
        protocolFingerprint: VALID_SHA256,
      },
      note: "Resolved crosswalk",
      updatedAt: 1000,
    };
    const source: FusionCorpusSource = {
      recipes: [
        {
          id: "recipe-1",
          version: 1,
          recipeFamily: "AnalysisFed",
          promptVersion: "v1",
          judgeAnalysisMode: "qualitative",
          rubricAccess: false,
          verification: false,
          synthesizer: { providerId: "openrouter", model: "openai/gpt-4o" },
        },
      ],
      pools: [
        {
          id: "pool-1",
          version: 1,
          core: [
            {
              id: "slot-1",
              providerId: "openrouter",
              provider: "OpenRouter",
              model: "model-1",
              slug: "slug-1",
              enabled: true,
            },
          ],
          challengers: [],
          diversityChecklist: ["diversity"],
          rationale: "Core pool",
          supersedesVersion: null,
          createdAt: 1000,
        },
      ],
      studies: [
        {
          id: "study-completed-no-pb",
          revision: 1,
          kind: "exploration",
          suiteRef: {
            suiteId: "suite-1",
            suiteVersion: 1,
            protocolFingerprint: VALID_SHA256,
          },
          poolRef: { id: "pool-1", version: 1 },
          judge1: { providerId: "openrouter", model: "judge-1" },
          judge2: { providerId: "openrouter", model: "judge-2" },
          recipeRefs: [{ id: "recipe-1", version: 1 }],
          status: "completed",
          claimLevel: "exploratory",
          confirmationOf: null,
          playbookRef: null,
          createdAt: 1000,
          updatedAt: 2000,
          stageResults: { stageA: null, stageB: null, stageC: null },
        },
      ],
      trials: [],
      attempts: [],
      observations: [],
      playbooks: [],
      crosswalk: [crosswalkRow],
    };

    const result = previewFusionToResearchLab(source, {
      now: 2000,
      recipeMetadata: {
        "recipe-1": {
          name: "Recipe 1",
          description: "Recipe desc",
          createdAt: 1000,
        },
      },
      poolMetadata: {
        "pool-1": {
          name: "Pool 1",
          purpose: "Pool purpose",
          createdAt: 1000,
        },
      },
      exactModelConfigurations: {
        "judge-1": VALID_MC_ID_1,
        "judge-2": VALID_MC_ID_2,
      },
      studyExtensions: {
        "study-completed-no-pb": {
          title: "Completed Study Without Playbook Ref",
          rubric: { rubricId: "rubric-1", version: 1 },
          policies: ["fuse"],
          stageProtocolVersion: 1,
        },
      },
    });

    const studyDecision = result.receipt.decisions.find((d) => d.id === "study-completed-no-pb");
    expect(studyDecision?.status).toBe("discard");
    expect(studyDecision?.reasonCode).toBe("missing_supporting_ids");
    expect(result.staged.studies).toHaveLength(0);
  });

  it("maps synthesis artifact to artifactRefs when valid, and discards trial with invalid_artifact_hash when contentHash is invalid", () => {
    const crosswalkRow: TaskSetOwnershipCrosswalkRow = {
      key: "ts-xwalk:fusion:study-with-artifact",
      kind: "fusion-owner",
      taskSetId: "task-set-1",
      version: 1,
      digest: VALID_SHA256,
      status: "resolved",
      suiteRef: {
        suiteId: "suite-1",
        suiteVersion: 1,
        protocolFingerprint: VALID_SHA256,
      },
      note: "Resolved crosswalk",
      updatedAt: 1000,
    };
    const sourceValid: FusionCorpusSource = {
      recipes: [
        {
          id: "recipe-1",
          version: 1,
          recipeFamily: "AnalysisFed",
          promptVersion: "v1",
          judgeAnalysisMode: "qualitative",
          rubricAccess: false,
          verification: false,
          synthesizer: { providerId: "openrouter", model: "openai/gpt-4o" },
        },
      ],
      pools: [
        {
          id: "pool-1",
          version: 1,
          core: [
            {
              id: "slot-1",
              providerId: "openrouter",
              provider: "OpenRouter",
              model: "model-1",
              slug: "slug-1",
              enabled: true,
            },
          ],
          challengers: [],
          diversityChecklist: ["diversity"],
          rationale: "Core pool",
          supersedesVersion: null,
          createdAt: 1000,
        },
      ],
      studies: [
        {
          id: "study-with-artifact",
          revision: 1,
          kind: "exploration",
          suiteRef: {
            suiteId: "suite-1",
            suiteVersion: 1,
            protocolFingerprint: VALID_SHA256,
          },
          poolRef: { id: "pool-1", version: 1 },
          judge1: { providerId: "openrouter", model: "judge-1" },
          judge2: { providerId: "openrouter", model: "judge-2" },
          recipeRefs: [{ id: "recipe-1", version: 1 }],
          status: "in_progress",
          claimLevel: "exploratory",
          confirmationOf: null,
          playbookRef: null,
          createdAt: 1000,
          updatedAt: 2000,
          stageResults: { stageA: null, stageB: null, stageC: null },
        },
      ],
      trials: [
        {
          id: "trial-with-artifact",
          studyId: "study-with-artifact",
          suiteRef: {
            suiteId: "suite-1",
            suiteVersion: 1,
            protocolFingerprint: VALID_SHA256,
          },
          poolRef: { id: "pool-1", version: 1 },
          policy: "fuse",
          stage: "A",
          candidateConfig: {
            slots: [
              {
                id: "slot-1",
                providerId: "openrouter",
                provider: "OpenRouter",
                model: "model-1",
                slug: "slug-1",
                enabled: true,
              },
            ],
          },
          recipe: { id: "recipe-1", version: 1 },
          synthesizer: { providerId: "openrouter", model: "synth-1" },
          judge1: { providerId: "openrouter", model: "judge-1" },
          judge2: { providerId: "openrouter", model: "judge-2" },
          sampleIndex: 0,
          status: "sealed",
          revision: 1,
          observationIds: [],
          children: {
            candidateRunId: "run-cand-1",
            devJudgeRunId: "run-judge-1",
            synthesisArtifact: {
              runId: "run-synth-1",
              fusionAttemptId: "attempt-synth-1",
              contentHash: VALID_SHA256,
            },
          },
          cost: {
            policy: { tokensIn: 100, tokensOut: 50 },
            experimental: { tokensIn: 200, tokensOut: 100 },
          },
          createdAt: 1100,
          updatedAt: 1200,
          sealedAt: 1200,
        },
      ],
      attempts: [],
      observations: [],
      playbooks: [],
      crosswalk: [crosswalkRow],
    };

    const resultValid = previewFusionToResearchLab(sourceValid, {
      now: 2000,
      recipeMetadata: {
        "recipe-1": {
          name: "Recipe 1",
          description: "Recipe desc",
          createdAt: 1000,
        },
      },
      poolMetadata: {
        "pool-1": {
          name: "Pool 1",
          purpose: "Pool purpose",
          createdAt: 1000,
        },
      },
      exactModelConfigurations: {
        "judge-1": VALID_MC_ID_1,
        "judge-2": VALID_MC_ID_2,
        "synth-1": VALID_MC_SYNTH,
        "model-1": VALID_MC_ID_1,
      },
      studyExtensions: {
        "study-with-artifact": {
          title: "Study With Artifact",
          rubric: { rubricId: "rubric-1", version: 1 },
          policies: ["fuse"],
          stageProtocolVersion: 1,
        },
      },
    });

    expect(resultValid.staged.studyTrials).toHaveLength(1);
    const convertedTrial = resultValid.staged.studyTrials[0];
    expect(convertedTrial.artifactRefs).toHaveLength(1);
    expect(convertedTrial.artifactRefs[0]).toEqual({
      runId: "run-synth-1",
      attemptId: "attempt-synth-1",
      contentHash: VALID_SHA256,
    });

    // Test invalid artifact hash
    const sourceInvalid: FusionCorpusSource = {
      ...sourceValid,
      trials: [
        {
          ...sourceValid.trials[0],
          id: "trial-invalid-hash",
          children: {
            candidateRunId: "run-1",
            devJudgeRunId: "run-judge-1",
            synthesisArtifact: {
              runId: "run-synth-1",
              fusionAttemptId: "attempt-synth-1",
              contentHash: "not-a-sha256-hash",
            },
          },
        },
      ],
    };

    const resultInvalid = previewFusionToResearchLab(sourceInvalid, {
      now: 2000,
      recipeMetadata: {
        "recipe-1": {
          name: "Recipe 1",
          description: "Recipe desc",
          createdAt: 1000,
        },
      },
      poolMetadata: {
        "pool-1": {
          name: "Pool 1",
          purpose: "Pool purpose",
          createdAt: 1000,
        },
      },
      exactModelConfigurations: {
        "judge-1": VALID_MC_ID_1,
        "judge-2": VALID_MC_ID_2,
        "synth-1": VALID_MC_SYNTH,
        "model-1": VALID_MC_ID_1,
      },
      studyExtensions: {
        "study-with-artifact": {
          title: "Study With Artifact",
          rubric: { rubricId: "rubric-1", version: 1 },
          policies: ["fuse"],
          stageProtocolVersion: 1,
        },
      },
    });

    const trialDecision = resultInvalid.receipt.decisions.find((d) => d.id === "trial-invalid-hash");
    expect(trialDecision?.status).toBe("discard");
    expect(trialDecision?.reasonCode).toBe("invalid_artifact_hash");
    expect(resultInvalid.staged.studyTrials).toHaveLength(0);
  });
});
