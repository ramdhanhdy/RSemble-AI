// =============================================================================
// RSemble AI — Policy Study adapter tests (plan Task 6)
//
// Exercises the `policy` registration adapter that runs the proven staged
// methodology (stage A/B/C, pair-screening, MPID, holdout, pool-adequacy,
// recipe-sensitivity, confirmation, cost, retry/recovery, blindness, playbook)
// against generic Lab entities (LabRecipeVersion, ModelPoolVersion) through the
// canonical StudyRepository. Mock providers only — no paid calls.
//
// Mirrors fusion-study.integration.test.ts fixtures but routes them through the
// adapter: Lab assets are stored in InMemoryLabAssetRepository, the study is a
// PolicyStudyRecord on InMemoryStudyRepository, and the playbook is a generic
// PolicyReportPayload. The four policies remain treatments; do_not_fuse is a
// first-class verdict; unknown payloads are blocked before any provider call.
// =============================================================================

import { describe, expect, it } from "vitest";
import type {
  BlindCandidate,
  CandidateEvaluation,
  JudgeReport,
  ModelSlot,
} from "../../../studio-data";
import type { CriticRef, ChatMessage } from "../../providers/types";
import type { EvaluationRubric, EvaluationSuite, EvaluationTask } from "../../evaluations/evaluation-types";
import {
  FUSION_RECIPE_ANALYSIS_FED_V1,
  FUSION_RECIPE_ANALYSIS_SCORES_V1,
  FUSION_RECIPE_BLIND_RAW_V1,
} from "../../evaluations/fusion-recipes";
import type { FusionRecipeVersion } from "../../evaluations/fusion-study-types";
import type { FusionPolicyExecutor, PoolSweepOutput } from "../../evaluations/fusion-study-controller";
import { candidateIdForSlot } from "../../pipeline";

import {
  canonicalRecipePayload,
  recipeDigest,
  type LabRecipeRecord,
  type LabRecipeVersion,
} from "../lab-recipe-types";
import {
  canonicalPoolPayload,
  poolDigest,
  type ModelPoolRecord,
  type ModelPoolVersion,
} from "../model-pool-types";
import { InMemoryLabAssetRepository } from "../../persistence/lab-asset-repository";
import { InMemoryStudyRepository } from "../../persistence/study-repository";
import {
  POLICY_DEFINITION_SCHEMA_VERSION,
  POLICY_REPORT_SCHEMA_VERSION,
  POLICY_STUDY_KIND,
  type ExactModelConfigurationRef,
  type PolicyStudyDefinition,
  type PolicyStudyRecord,
} from "./policy-study-types";
import {
  PolicyStudyAdapter,
  assertRegisteredPayloadKind,
  buildMethodStudyHandle,
  fusionPlaybookToPolicyReport,
  labPoolToMethodPool,
  labRecipeToMethodRecipe,
  labRecipeToMethodRef,
  labPoolToMethodRef,
  loadPolicyStudyAssets,
  recipeSensitivityFromStageC,
  type ModelConfigResolver,
} from "./policy-study-adapter";

const judge1: CriticRef = { providerId: "openrouter", model: "acme/judge-1" };
const judge2: CriticRef = { providerId: "gemini", model: "acme/judge-2" };

const JUDGE1_MC: ExactModelConfigurationRef = {
  id: "mc:sha256:" + "a".repeat(64),
};
const JUDGE2_MC: ExactModelConfigurationRef = {
  id: "mc:sha256:" + "b".repeat(64),
};
const SYNTH_MC: ExactModelConfigurationRef = {
  id: "mc:sha256:" + "c".repeat(64),
};

/**
 * Deterministic ModelConfigResolver for tests: maps every method-domain
 * CriticRef to a canonical mc:sha256 ref. Judges and the default synthesizer
 * have fixed refs; pool-slot models get a deterministic per-model ref.
 */
function makeModelConfigResolver(): ModelConfigResolver {
  return (critic: CriticRef) => {
    if (critic.providerId === judge1.providerId && critic.model === judge1.model) return JUDGE1_MC;
    if (critic.providerId === judge2.providerId && critic.model === judge2.model) return JUDGE2_MC;
    if (critic.model === "z-ai/glm-5.2") return SYNTH_MC;
    // Pool-slot models: deterministic 64-hex from providerId:model.
    const seed = `${critic.providerId}:${critic.model}`;
    const hex = Array.from(seed, (ch) => ch.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("")
      .padEnd(64, "0")
      .slice(0, 64);
    return { id: `mc:sha256:${hex}` };
  };
}
function slot(n: number, slug: string): ModelSlot {
  return {
    id: `s${n}`,
    providerId: "openrouter",
    provider: "Test",
    model: slug,
    slug,
    enabled: true,
  };
}

const POOL_SLOTS = [
  slot(1, "m-a"),
  slot(2, "m-b"),
  slot(3, "m-c"),
  slot(4, "m-d"),
  slot(5, "m-e"),
  slot(6, "m-f"),
];

const STRENGTHS: Record<string, { acc: number; comp: number }> = {
  "openrouter:m-a": { acc: 4, comp: 4 },
  "openrouter:m-b": { acc: 5, comp: 3 },
  "openrouter:m-c": { acc: 3, comp: 5 },
  "openrouter:m-d": { acc: 4, comp: 4 },
  "openrouter:m-e": { acc: 4, comp: 4 },
  "openrouter:m-f": { acc: 4, comp: 4 },
};

const RUBRIC: EvaluationRubric = {
  id: "prof-1",
  version: 1,
  name: "Quality",
  description: "test",
  judgeInstruction: "judge fairly",
  criteria: [
    { id: "acc", name: "Accuracy", description: "correct", weight: 1, anchors: { one: "bad", three: "ok", five: "great" } },
    { id: "comp", name: "Completeness", description: "complete", weight: 1, anchors: { one: "bad", three: "ok", five: "great" } },
  ],
  createdAt: 1000,
  updatedAt: 1000,
};

function taskOf(n: number): EvaluationTask {
  return {
    id: `t${n}`,
    title: `Task ${n}`,
    prompt: `Prompt ${n}`,
    systemPrompt: "",
    evaluation: { kind: "inherit" },
    judgeInstructionOverride: "",
    order: n,
  };
}

const SUITE: EvaluationSuite = {
  id: "suite-1",
  revision: 0,
  version: 4,
  name: "Suite",
  description: "",
  tasks: [taskOf(1), taskOf(2), taskOf(3)],
  modelSlots: POOL_SLOTS,
  defaultJudge: judge1,
  defaultEvaluation: { kind: "profile", profile: { id: "prof-1", version: 1 } },
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: null,
};

const HOLDOUT_SCORES: Record<string, number> = {
  "fuse:BlindRaw": 3.5,
  "fuse:AnalysisFed": 4.2,
  "fuse:AnalysisScores": 4.5,
  refine: 4.4,
  rank: 4.0,
  best_fixed: 3.8,
  cell: 4.0,
};

// --- Lab asset builders (Fusion recipe → Lab Recipe Version) ------------------

function toLabRecipeVersion(recipe: FusionRecipeVersion, createdAt = 1000): LabRecipeVersion {
  const content = {
    recipeFamily: recipe.recipeFamily,
    promptVersion: recipe.promptVersion,
    judgeAnalysisMode: recipe.judgeAnalysisMode,
    rubricAccess: recipe.rubricAccess,
    verification: recipe.verification,
    synthesizer: recipe.synthesizer,
  };
  return {
    recipeId: recipe.id,
    version: recipe.version,
    kind: "fusion",
    recipeFamily: recipe.recipeFamily,
    promptVersion: recipe.promptVersion,
    judgeAnalysisMode: recipe.judgeAnalysisMode,
    rubricAccess: recipe.rubricAccess,
    verification: recipe.verification,
    synthesizer: recipe.synthesizer,
    canonicalPayload: canonicalRecipePayload(content),
    digest: recipeDigest(content),
    createdAt,
  };
}

const LAB_RECIPES: LabRecipeVersion[] = [
  toLabRecipeVersion(FUSION_RECIPE_BLIND_RAW_V1),
  toLabRecipeVersion(FUSION_RECIPE_ANALYSIS_FED_V1),
  toLabRecipeVersion(FUSION_RECIPE_ANALYSIS_SCORES_V1),
];

const POOL_CONTENT = {
  core: POOL_SLOTS,
  challengers: [] as ModelSlot[],
  diversityChecklist: ["independent families"],
  rationale: "test pool",
  supersedesVersion: null as number | null,
};

const LAB_POOL: ModelPoolVersion = {
  poolId: "pool-1",
  version: 1,
  core: POOL_SLOTS,
  challengers: [],
  diversityChecklist: ["independent families"],
  rationale: "test pool",
  supersedesVersion: null,
  canonicalPayload: canonicalPoolPayload(POOL_CONTENT),
  digest: poolDigest(POOL_CONTENT),
  createdAt: 1000,
};

const LAB_POOL_RECORD: ModelPoolRecord = {
  id: "pool-1",
  name: "Test Pool",
  purpose: "testing",
  latestVersion: 1,
  revision: 0,
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: null,
};

function labRecipeRecord(id: string): LabRecipeRecord {
  return {
    id,
    kind: "fusion",
    name: `Recipe ${id}`,
    description: "test",
    latestVersion: 1,
    revision: 0,
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  };
}

async function seedLabAssets(): Promise<InMemoryLabAssetRepository> {
  const repo = new InMemoryLabAssetRepository();
  await repo.createPoolRecord(LAB_POOL_RECORD, LAB_POOL);
  for (const r of LAB_RECIPES) {
    await repo.createRecipeRecord(labRecipeRecord(r.recipeId), r);
  }
  return repo;
}

function makeDefinition(): PolicyStudyDefinition {
  return {
    workload: { taskSetId: "suite-1", version: 4, manifestDigest: "sha256:" + "0".repeat(64) },
    modelPool: { poolId: "pool-1", version: 1, digest: LAB_POOL.digest },
    fusionRecipes: LAB_RECIPES.map((r) => ({ recipeId: r.recipeId, version: r.version, digest: r.digest })),
    judge1: JUDGE1_MC,
    judge2: JUDGE2_MC,
    rubric: { rubricId: "prof-1", version: 1 },
    protocolFingerprint: "sha256:" + "a".repeat(64),
    policies: ["best_fixed", "rank", "fuse", "refine"],
    stageProtocolVersion: 1,
    claimPlan: "exploration",
  };
}

const CONFIRM_SUITE: EvaluationSuite = {
  ...SUITE,
  version: 5,
  tasks: [taskOf(4), taskOf(5), taskOf(6)],
};

function makeConfirmationDefinition(): PolicyStudyDefinition {
  return {
    ...makeDefinition(),
    workload: { taskSetId: "suite-1", version: 5, manifestDigest: "sha256:" + "1".repeat(64) },
    protocolFingerprint: "sha256:" + "b".repeat(64),
    claimPlan: "confirmation",
  };
}

// --- Mock executor (mirrors fusion-study.integration.test.ts) -----------------

function evaluationFor(candidateId: string, blindLabel: string, modelKey: string): CandidateEvaluation {
  const s = STRENGTHS[modelKey] ?? { acc: 4, comp: 4 };
  return {
    candidateId,
    blindLabel,
    overallScore: (s.acc + s.comp) / 2,
    position: `${modelKey} position`,
    rationale: "evidence",
    strengths: ["s"],
    deductions: [],
    missedRequirements: [],
    criterionScores: [
      { criterionId: "acc", label: "Accuracy", score: s.acc, rationale: "r" },
      { criterionId: "comp", label: "Completeness", score: s.comp, rationale: "r" },
    ],
  };
}

function judgeReportFor(outputs: PoolSweepOutput[]): JudgeReport {
  const evaluationsById: Record<string, CandidateEvaluation> = {};
  outputs.forEach((o, i) => {
    evaluationsById[o.candidateId] = evaluationFor(o.candidateId, String.fromCharCode(65 + i), o.modelKey);
  });
  return {
    labelMap: outputs.map((o, i) => ({ label: String.fromCharCode(65 + i), candidateId: o.candidateId })),
    evaluationsById,
    comparisons: [],
  };
}

function makeMockExecutor(overrides: Partial<FusionPolicyExecutor> = {}): FusionPolicyExecutor {
  const base: FusionPolicyExecutor = {
    async runPoolSweep(task, slots) {
      return {
        taskId: task.id,
        outputs: slots.map((s) => ({
          slot: s,
          modelKey: `${s.providerId}:${s.slug}`,
          candidateId: candidateIdForSlot(s.id),
          text: `out:${task.id}:${s.slug}`,
          cost: { tokensIn: 100, tokensOut: 50 },
        })),
      };
    },
    async judgePool(_task, _rubric, _judge, outputs) {
      return { report: judgeReportFor(outputs), consensus: { consensus: [], contradictions: [], uniqueInsights: [] }, cost: { tokensIn: 200, tokensOut: 100 } };
    },
    async runBlockedEvidence(task, _rubric, pair, _judge) {
      const outputs: PoolSweepOutput[] = pair.map((s) => ({
        slot: s,
        modelKey: `${s.providerId}:${s.slug}`,
        candidateId: candidateIdForSlot(s.id),
        text: `out:${task.id}:${s.slug}`,
        cost: { tokensIn: 100, tokensOut: 50 },
      }));
      const blindCandidates: BlindCandidate[] = outputs.map((o, i) => ({
        label: String.fromCharCode(65 + i),
        candidateId: o.candidateId,
        content: o.text,
      }));
      return {
        blindCandidates,
        report: judgeReportFor(outputs),
        consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
        candidateAttemptIdsByCandidateId: Object.fromEntries(outputs.map((o) => [o.candidateId, `catt-${task.id}-${o.slot.id}`])),
        judgeAttemptId: `jatt-${task.id}`,
        candidateRunId: `run-cand-${task.id}`,
        devJudgeRunId: `run-judge-${task.id}`,
        candidateCosts: Object.fromEntries(outputs.map((o) => [o.candidateId, o.cost])),
        judgeCost: { tokensIn: 200, tokensOut: 100 },
      };
    },
    async runSynthesis(_synthesizer: CriticRef, messages: ChatMessage[]) {
      return { text: `synth:${messages[1].content.length}`, cost: { tokensIn: 300, tokensOut: 150 } };
    },
    async runHoldout(_task, _rubric, _judge, artifacts) {
      const scoresByKey: Record<string, number> = {};
      for (const artifact of artifacts) scoresByKey[artifact.key] = HOLDOUT_SCORES[artifact.key] ?? 3.0;
      return { scoresByKey, cost: { tokensIn: 400, tokensOut: 200 } };
    },
  };
  return { ...base, ...overrides };
}

function makeAdapter(labAssets: InMemoryLabAssetRepository, executor: FusionPolicyExecutor = makeMockExecutor()) {
  const studyRepo = new InMemoryStudyRepository(null);
  let counter = 0;
  let clock = 1000;
  return new PolicyStudyAdapter({
    studyRepo,
    labAssetRepo: labAssets,
    judgeResolver: (mc) => (mc.id === JUDGE1_MC.id ? judge1 : judge2),
    executor,
    modelConfigResolver: makeModelConfigResolver(),
    now: () => ++clock,
    generateId: () => `id-${++counter}`,
  });
}

// =============================================================================
// Asset projection
// =============================================================================

describe("Policy Study adapter — asset projection (Lab ↔ method)", () => {
  it("projects a Lab Recipe Version into the method-domain FusionRecipeVersion", () => {
    const lab = LAB_RECIPES[0];
    const method = labRecipeToMethodRecipe(lab);
    expect(method.id).toBe(lab.recipeId);
    expect(method.version).toBe(lab.version);
    expect(method.recipeFamily).toBe(lab.recipeFamily);
    expect(method.promptVersion).toBe(lab.promptVersion);
    expect(method.judgeAnalysisMode).toBe(lab.judgeAnalysisMode);
    expect(method.rubricAccess).toBe(lab.rubricAccess);
    expect(method.verification).toBe(lab.verification);
    expect(method.synthesizer).toEqual(lab.synthesizer);
  });

  it("projects a Lab Recipe Version ref", () => {
    const ref = labRecipeToMethodRef(LAB_RECIPES[1]);
    expect(ref).toEqual({ id: LAB_RECIPES[1].recipeId, version: LAB_RECIPES[1].version });
  });

  it("projects a Model Pool Version into the method-domain PoolManifestVersion", () => {
    const method = labPoolToMethodPool(LAB_POOL);
    expect(method.id).toBe(LAB_POOL.poolId);
    expect(method.version).toBe(LAB_POOL.version);
    expect(method.core).toEqual(LAB_POOL.core);
    expect(method.challengers).toEqual(LAB_POOL.challengers);
    expect(method.diversityChecklist).toEqual(LAB_POOL.diversityChecklist);
    expect(method.rationale).toBe(LAB_POOL.rationale);
    expect(method.supersedesVersion).toBe(LAB_POOL.supersedesVersion);
  });

  it("projects a Model Pool Version ref", () => {
    const ref = labPoolToMethodRef(LAB_POOL);
    expect(ref).toEqual({ id: LAB_POOL.poolId, version: LAB_POOL.version });
  });

  it("loadPolicyStudyAssets loads + projects all pinned Lab assets", async () => {
    const labAssets = await seedLabAssets();
    const assets = await loadPolicyStudyAssets(labAssets, makeDefinition());
    expect(assets.recipes).toHaveLength(3);
    expect(assets.recipes.map((r) => r.id).sort()).toEqual(
      [FUSION_RECIPE_ANALYSIS_FED_V1.id, FUSION_RECIPE_ANALYSIS_SCORES_V1.id, FUSION_RECIPE_BLIND_RAW_V1.id].sort(),
    );
    expect(assets.pool.id).toBe("pool-1");
    expect(assets.pool.core).toEqual(POOL_SLOTS);
  });

  it("loadPolicyStudyAssets rejects a missing model pool (F1 adapter-level)", async () => {
    const labAssets = await seedLabAssets();
    const def = makeDefinition();
    def.modelPool.poolId = "pool-missing";
    await expect(loadPolicyStudyAssets(labAssets, def)).rejects.toThrow(/pool-missing/);
  });

  it("loadPolicyStudyAssets rejects a missing recipe version (F1 adapter-level)", async () => {
    const labAssets = await seedLabAssets();
    const def = makeDefinition();
    def.fusionRecipes = [{ recipeId: "recipe-missing", version: 1, digest: "sha256:" + "1".repeat(64) }];
    await expect(loadPolicyStudyAssets(labAssets, def)).rejects.toThrow(/recipe-missing/);
  });
});

// =============================================================================
// Registered-payload boundary
// =============================================================================

describe("Policy Study adapter — registered-payload boundary", () => {
  it("assertRegisteredPayloadKind accepts the registered policy kind + schema", () => {
    expect(() => assertRegisteredPayloadKind(POLICY_STUDY_KIND, POLICY_DEFINITION_SCHEMA_VERSION)).not.toThrow();
  });

  it("assertRegisteredPayloadKind rejects an unknown kind before any provider call", () => {
    expect(() => assertRegisteredPayloadKind("routing", 1)).toThrow(/Unknown study kind/);
    expect(() => assertRegisteredPayloadKind("fusion", 1)).toThrow(/Unknown study kind/);
  });

  it("assertRegisteredPayloadKind rejects a wrong schema version before any provider call", () => {
    expect(() => assertRegisteredPayloadKind(POLICY_STUDY_KIND, 999)).toThrow(/Unknown payload schema version/);
  });
});

// =============================================================================
// Playbook mapping
// =============================================================================

describe("Policy Study adapter — playbook mapping", () => {
  it("recipeSensitivityFromStageC reports not-run when Stage C is absent", () => {
    const r = recipeSensitivityFromStageC(null);
    expect(r.checked).toBe(false);
    expect(r.note).toContain("not run");
  });

  it("fusionPlaybookToPolicyReport maps rows, recommendation, adequacy, and schema version", () => {
    const methodPb = {
      id: "pb-1",
      studyId: "study-1",
      suiteRef: { suiteId: "suite-1", suiteVersion: 4, protocolFingerprint: "sha256:abc" },
      rows: [
        { policy: "fuse", configuration: "B + C → Synth X", score: 4.5, lift: 0.7, costMultiplier: 3.2, confidence: "high" as const },
        { policy: "best_fixed", configuration: "A", score: 4.0, lift: 0, costMultiplier: 1, confidence: "high" as const },
      ],
      recommendation: { kind: "adopt" as const, policy: "fuse" as const, configuration: "B + C → Synth X", rationale: "beats MPID" },
      poolAdequacy: { probed: false, outcome: null, challengerKeys: [], note: "not probed" },
      claimLevel: "exploratory" as const,
      conclusion: "Status: exploratory",
      createdAt: 2000,
    };
    const fp = "sha256:" + "f".repeat(64);
    const report = fusionPlaybookToPolicyReport(methodPb as never, fp, null, ["t1"], ["o1"]);
    expect(report.studyId).toBe("study-1");
    expect(report.definitionFingerprint).toBe(fp);
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0].meanOutcome).toBe(4.5);
    expect(report.rows[0].policy).toBe("fuse");
    expect(report.recommendation.kind).toBe("adopt");
    expect(report.poolAdequacy.outcome).toBe("unconfirmed");
    expect(report.recipeSensitivity.checked).toBe(false);
    expect(report.claimLevel).toBe("exploratory");
    expect(report.supportingTrialIds).toEqual(["t1"]);
    expect(report.supportingObservationIds).toEqual(["o1"]);
    expect(report.reportSchemaVersion).toBe(POLICY_REPORT_SCHEMA_VERSION);
  });

  it("fusionPlaybookToPolicyReport maps do_not_fuse as a first-class recommendation", () => {
    const methodPb = {
      id: "pb-2",
      studyId: "study-2",
      suiteRef: { suiteId: "s", suiteVersion: 1, protocolFingerprint: "sha256:x" },
      rows: [{ policy: "best_fixed", configuration: "A", score: 4.0, lift: 0, costMultiplier: 1, confidence: "low" as const }],
      recommendation: { kind: "do_not_fuse" as const, rationale: "nothing clears MPID" },
      poolAdequacy: { probed: true, outcome: "unconfirmed", challengerKeys: [], note: "probe failed" },
      claimLevel: "exploratory" as const,
      conclusion: "do not use fusion",
      createdAt: 3000,
    };
    const report = fusionPlaybookToPolicyReport(methodPb as never, "sha256:" + "0".repeat(64), null, [], []);
    expect(report.recommendation.kind).toBe("do_not_fuse");
    expect(report.poolAdequacy.outcome).toBe("unconfirmed");
  });
});

// =============================================================================
// Study handle construction
// =============================================================================

describe("Policy Study adapter — method study handle", () => {
  it("buildMethodStudyHandle projects the definition into a method-domain FusionStudy", async () => {
    const labAssets = await seedLabAssets();
    const adapter = makeAdapter(labAssets);
    const record = await adapter.createStudy(makeDefinition(), "Test");
    const assets = await loadPolicyStudyAssets(labAssets, record.definition);
    const handle = buildMethodStudyHandle({
      record,
      assets,
      judge1,
      judge2,
      kind: "exploration",
    });
    expect(handle.id).toBe(record.id);
    expect(handle.kind).toBe("exploration");
    expect(handle.suiteRef).toEqual({ suiteId: "suite-1", suiteVersion: 4, protocolFingerprint: "sha256:" + "a".repeat(64) });
    expect(handle.poolRef).toEqual({ id: "pool-1", version: 1 });
    expect(handle.recipeRefs).toHaveLength(3);
    expect(handle.judge1).toEqual(judge1);
    expect(handle.judge2).toEqual(judge2);
    expect(handle.stageResults).toEqual({ stageA: null, stageB: null, stageC: null });
  });
});

// =============================================================================
// End-to-end: staged methodology through generic Lab entities
// =============================================================================

describe("Policy Study adapter — staged methodology through generic Lab entities", () => {
  it("creates a draft Policy Study and starts it (lineage: draft → in_progress)", async () => {
    const labAssets = await seedLabAssets();
    const adapter = makeAdapter(labAssets);
    const draft = await adapter.createStudy(makeDefinition(), "E2E");
    expect(draft.status).toBe("draft");
    expect(draft.kind).toBe(POLICY_STUDY_KIND);
    expect(draft.definitionSchemaVersion).toBe(POLICY_DEFINITION_SCHEMA_VERSION);
    expect(draft.definitionFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    const started = await adapter.startStudy(draft);
    expect(started.status).toBe("in_progress");
    expect(started.revision).toBeGreaterThan(draft.revision);
  });

  it("runs the full staged study and seals a generic playbook with all four policies", async () => {
    const labAssets = await seedLabAssets();
    const adapter = makeAdapter(labAssets);
    const draft = await adapter.createStudy(makeDefinition(), "E2E four policies");
    const started = await adapter.startStudy(draft);
    const result = await adapter.runExplorationStudy({
      record: started,
      suite: SUITE,
      rubric: RUBRIC,
      stratificationTasks: 3,
      tasksPerPairA: 2,
      tasksPerPairB: 2,
      tasksPerPairC: 2,
      sequentialPairs: 2,
      mpid: 0.2,
    });
    // Generic playbook persisted on the canonical store.
    expect(result.playbook.studyId).toBe(started.id);
    expect(result.playbook.rows.map((r) => r.policy).sort()).toEqual([
      "best_fixed",
      "fuse",
      "rank",
      "refine",
    ]);
    expect(result.playbook.reportSchemaVersion).toBe(POLICY_REPORT_SCHEMA_VERSION);
    expect(result.playbook.definitionFingerprint).toBe(started.definitionFingerprint);
    // Supporting Trial/Observation refs carried into the generic playbook.
    expect(result.playbook.supportingTrialIds.length).toBeGreaterThan(0);
    expect(result.playbook.supportingObservationIds.length).toBeGreaterThan(0);
    // Study sealed (lineage: in_progress → completed).
    expect(result.sealedRecord.status).toBe("completed");
    expect(result.sealedRecord.reportRef).toMatch(/^pb:sha256:/);
    // Recipe-sensitivity finding recorded.
    expect(result.playbook.recipeSensitivity.checked).toBe(true);
    // Method-domain playbook produced (for inspection).
    expect(result.methodPlaybook.rows.length).toBeGreaterThan(0);
  });

  it("returns do_not_fuse as a first-class verdict when nothing clears the MPID", async () => {
    const flatExecutor = makeMockExecutor({
      async runHoldout(_t, _p, _j, artifacts) {
        return {
          scoresByKey: Object.fromEntries(artifacts.map((a) => [a.key, 4.0])),
          cost: { tokensIn: 400, tokensOut: 200 },
        };
      },
    });
    const labAssets = await seedLabAssets();
    const adapter = makeAdapter(labAssets, flatExecutor);
    const draft = await adapter.createStudy(makeDefinition(), "E2E do_not_fuse");
    const started = await adapter.startStudy(draft);
    const result = await adapter.runExplorationStudy({
      record: started,
      suite: SUITE,
      rubric: RUBRIC,
      stratificationTasks: 3,
      tasksPerPairA: 2,
      tasksPerPairB: 2,
      tasksPerPairC: 2,
      sequentialPairs: 0,
      mpid: 0.2,
    });
    expect(result.playbook.recommendation.kind).toBe("do_not_fuse");
    expect(result.sealedRecord.status).toBe("completed");
  });

  it("rejects a study that is not in_progress before running", async () => {
    const labAssets = await seedLabAssets();
    const adapter = makeAdapter(labAssets);
    const draft = await adapter.createStudy(makeDefinition(), "E2E not started");
    await expect(
      adapter.runExplorationStudy({
        record: draft,
        suite: SUITE,
        rubric: RUBRIC,
        stratificationTasks: 3,
        tasksPerPairA: 2,
        tasksPerPairB: 2,
        tasksPerPairC: 2,
        sequentialPairs: 0,
        mpid: 0.2,
      }),
    ).rejects.toThrow(/in_progress/);
  });

  it("rejects a definition whose pinned Lab assets are missing (F1 before run)", async () => {
    const labAssets = new InMemoryLabAssetRepository();
    // No assets seeded.
    const adapter = makeAdapter(labAssets);
    const draft = await adapter.createStudy(makeDefinition(), "E2E missing assets");
    const started = await adapter.startStudy(draft);
    await expect(
      adapter.runExplorationStudy({
        record: started,
        suite: SUITE,
        rubric: RUBRIC,
        stratificationTasks: 3,
        tasksPerPairA: 2,
        tasksPerPairB: 2,
        tasksPerPairC: 2,
        sequentialPairs: 0,
        mpid: 0.2,
      }),
    ).rejects.toThrow(/not found in Lab assets/);
  });

  it("the generic playbook is retrievable from the canonical StudyRepository", async () => {
    const labAssets = await seedLabAssets();
    const studyRepo = new InMemoryStudyRepository(null);
    let counter = 0;
    let clock = 1000;
    const adapter = new PolicyStudyAdapter({
      studyRepo,
      labAssetRepo: labAssets,
      judgeResolver: (mc) => (mc.id === JUDGE1_MC.id ? judge1 : judge2),
      modelConfigResolver: makeModelConfigResolver(),
      executor: makeMockExecutor(),
      now: () => ++clock,
      generateId: () => `id-${++counter}`,
    });
    const draft = await adapter.createStudy(makeDefinition(), "E2E retrieval");
    const started = await adapter.startStudy(draft);
    const result = await adapter.runExplorationStudy({
      record: started,
      suite: SUITE,
      rubric: RUBRIC,
      stratificationTasks: 3,
      tasksPerPairA: 2,
      tasksPerPairB: 2,
      tasksPerPairC: 2,
      sequentialPairs: 2,
      mpid: 0.2,
    });
    const retrieved = await studyRepo.getPlaybook(result.sealedRecord.reportRef!);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.studyId).toBe(started.id);
    const forStudy = await studyRepo.getPlaybookForStudy(started.id);
    expect(forStudy).not.toBeNull();
    expect(forStudy!.playbook.rows.map((r) => r.policy).sort()).toEqual([
      "best_fixed",
      "fuse",
      "rank",
      "refine",
    ]);
  });
});

// =============================================================================
// Run 20 repair: Lab store lineage, payload boundary, pool-adequacy qualifier
// =============================================================================

describe("Policy Study adapter — Run 20 repair (Lab lineage + payload boundary)", () => {
  it("persists method trials and observations onto the canonical StudyRepository", async () => {
    const labAssets = await seedLabAssets();
    const studyRepo = new InMemoryStudyRepository(null);
    let counter = 0;
    let clock = 1000;
    const adapter = new PolicyStudyAdapter({
      studyRepo,
      labAssetRepo: labAssets,
      judgeResolver: (mc) => (mc.id === JUDGE1_MC.id ? judge1 : judge2),
      modelConfigResolver: makeModelConfigResolver(),
      executor: makeMockExecutor(),
      now: () => ++clock,
      generateId: () => `id-${++counter}`,
    });
    const draft = await adapter.createStudy(makeDefinition(), "E2E lineage");
    const started = await adapter.startStudy(draft);
    const result = await adapter.runExplorationStudy({
      record: started,
      suite: SUITE,
      rubric: RUBRIC,
      stratificationTasks: 3,
      tasksPerPairA: 2,
      tasksPerPairB: 2,
      tasksPerPairC: 2,
      sequentialPairs: 2,
      mpid: 0.2,
    });
    // Lab stores carry trial lineage — not just the method-domain throwaway repo.
    const trials = await studyRepo.listTrials(started.id);
    expect(trials.length).toBeGreaterThan(0);
    // Supporting Trial refs in the playbook resolve via the canonical store.
    for (const tid of result.playbook.supportingTrialIds) {
      const trial = await studyRepo.getTrial(tid);
      expect(trial).not.toBeNull();
    }
    // Lab stores carry observation lineage.
    const observations = await studyRepo.listObservations(started.id);
    expect(observations.length).toBeGreaterThan(0);
    // Supporting Observation refs resolve via the canonical store.
    for (const oid of result.playbook.supportingObservationIds) {
      const obs = observations.find((o) => o.id === oid);
      expect(obs).toBeDefined();
    }
  });

  it("blocks an unknown payload kind before any provider call", async () => {
    const labAssets = await seedLabAssets();
    let executorCalled = false;
    const trackingExecutor = makeMockExecutor({
      async runPoolSweep(task, slots) {
        executorCalled = true;
        return {
          taskId: task.id,
          outputs: slots.map((s) => ({
            slot: s,
            modelKey: `${s.providerId}:${s.slug}`,
            candidateId: candidateIdForSlot(s.id),
            text: `out:${task.id}:${s.slug}`,
            cost: { tokensIn: 100, tokensOut: 50 },
          })),
        };
      },
    });
    const adapter = makeAdapter(labAssets, trackingExecutor);
    const draft = await adapter.createStudy(makeDefinition(), "E2E unknown kind");
    const started = await adapter.startStudy(draft);
    // Forge a record with an unregistered kind.
    const forged: PolicyStudyRecord = { ...started, kind: "routing" as never };
    await expect(
      adapter.runExplorationStudy({
        record: forged,
        suite: SUITE,
        rubric: RUBRIC,
        stratificationTasks: 3,
        tasksPerPairA: 2,
        tasksPerPairB: 2,
        tasksPerPairC: 2,
        sequentialPairs: 0,
        mpid: 0.2,
      }),
    ).rejects.toThrow(/Unknown study kind/);
    expect(executorCalled).toBe(false);
  });

  it("blocks a wrong schema version before any provider call", async () => {
    const labAssets = await seedLabAssets();
    let executorCalled = false;
    const trackingExecutor = makeMockExecutor({
      async runPoolSweep(task, slots) {
        executorCalled = true;
        return {
          taskId: task.id,
          outputs: slots.map((s) => ({
            slot: s,
            modelKey: `${s.providerId}:${s.slug}`,
            candidateId: candidateIdForSlot(s.id),
            text: `out:${task.id}:${s.slug}`,
            cost: { tokensIn: 100, tokensOut: 50 },
          })),
        };
      },
    });
    const adapter = makeAdapter(labAssets, trackingExecutor);
    const draft = await adapter.createStudy(makeDefinition(), "E2E wrong schema");
    const started = await adapter.startStudy(draft);
    // Forge a record with a wrong schema version.
    const forged: PolicyStudyRecord = { ...started, definitionSchemaVersion: 999 as never };
    await expect(
      adapter.runExplorationStudy({
        record: forged,
        suite: SUITE,
        rubric: RUBRIC,
        stratificationTasks: 3,
        tasksPerPairA: 2,
        tasksPerPairB: 2,
        tasksPerPairC: 2,
        sequentialPairs: 0,
        mpid: 0.2,
      }),
    ).rejects.toThrow(/Unknown payload schema version/);
    expect(executorCalled).toBe(false);
  });

  it("runs a confirmation study and persists its lineage onto the canonical StudyRepository", async () => {
    const labAssets = await seedLabAssets();
    const studyRepo = new InMemoryStudyRepository(null);
    let counter = 0;
    let clock = 1000;
    const adapter = new PolicyStudyAdapter({
      studyRepo,
      labAssetRepo: labAssets,
      judgeResolver: (mc) => (mc.id === JUDGE1_MC.id ? judge1 : judge2),
      modelConfigResolver: makeModelConfigResolver(),
      executor: makeMockExecutor(),
      now: () => ++clock,
      generateId: () => `id-${++counter}`,
    });
    // Run the exploration study first.
    const draft = await adapter.createStudy(makeDefinition(), "E2E exploration");
    const started = await adapter.startStudy(draft);
    const exploration = await adapter.runExplorationStudy({
      record: started,
      suite: SUITE,
      rubric: RUBRIC,
      stratificationTasks: 3,
      tasksPerPairA: 2,
      tasksPerPairB: 2,
      tasksPerPairC: 2,
      sequentialPairs: 2,
      mpid: 0.2,
    });
    expect(exploration.sealedRecord.status).toBe("completed");

    // Create and run the confirmation study on a fresh suite version.
    const confirmDraft = await adapter.createStudy(
      makeConfirmationDefinition(),
      "E2E confirmation",
      undefined,
      exploration.sealedRecord.id,
    );
    const confirmStarted = await adapter.startStudy(confirmDraft);
    const confirmation = await adapter.runConfirmationStudy({
      record: confirmStarted,
      sourceRecord: exploration.sealedRecord,
      sourceMethodStudy: exploration.methodStudy,
      sourceMethodPlaybook: exploration.methodPlaybook,
      suite: CONFIRM_SUITE,
      rubric: RUBRIC,
      tasksPerPair: 2,
      mpid: 0.2,
    });
    expect(confirmation.sealedRecord.status).toBe("completed");
    expect(confirmation.sealedRecord.reportRef).toMatch(/^pb:sha256:/);
    // Lab stores carry confirmation trial lineage.
    const confirmTrials = await studyRepo.listTrials(confirmStarted.id);
    expect(confirmTrials.length).toBeGreaterThan(0);
    // Supporting Trial refs resolve via the canonical store.
    for (const tid of confirmation.playbook.supportingTrialIds) {
      const trial = await studyRepo.getTrial(tid);
      expect(trial).not.toBeNull();
    }
    // Lab stores carry confirmation observation lineage.
    const confirmObs = await studyRepo.listObservations(confirmStarted.id);
    expect(confirmObs.length).toBeGreaterThan(0);
    for (const oid of confirmation.playbook.supportingObservationIds) {
      const obs = confirmObs.find((o) => o.id === oid);
      expect(obs).toBeDefined();
    }
  });
});
