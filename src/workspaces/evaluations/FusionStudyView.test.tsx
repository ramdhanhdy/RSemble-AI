// =============================================================================
// FusionStudyView tests — playbook honesty (acceptance 7, 8, 9, 10):
// all four policies + claim badge + "do not fuse" verdict; the screened-pair
// table shows losers as well as winners; provenance drill-in renders the
// sealed chain.
// =============================================================================

// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { FusionStudyView } from "./FusionStudyView";
import { InMemoryFusionStudyRepository } from "../../lib/persistence/fusion-study-repository";
import type { ModelSlot } from "../../studio-data";
import { FUSION_RECIPE_ANALYSIS_SCORES_V1 } from "../../lib/evaluations/fusion-recipes";
import type {
  FusionPlaybook,
  FusionStudy,
  FusionTrial,
} from "../../lib/evaluations/fusion-study-types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<MemoryRouter>{node}</MemoryRouter>));
  return {
    container,
    $: (s: string) => container.querySelector<HTMLElement>(s),
    $$: (s: string) => [...container.querySelectorAll<HTMLElement>(s)],
    text: () => container.textContent ?? "",
    unmount: () => act(() => root.unmount()),
  };
}

async function settle() {
  await act(async () => {
    await flush();
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

// --- Fixtures -------------------------------------------------------------------

function slot(id: string, slug: string): ModelSlot {
  return { id, providerId: "openrouter", provider: "Test", model: id, slug, enabled: true };
}

function makeStudy(): FusionStudy {
  return {
    id: "study-1",
    revision: 2,
    kind: "exploration",
    suiteRef: {
      suiteId: "suite-1",
      suiteVersion: 4,
      protocolFingerprint: "sha256:0123456789abcdef",
    },
    poolRef: { id: "pool-1", version: 2 },
    judge1: { providerId: "openrouter", model: "acme/judge-1" },
    judge2: { providerId: "gemini", model: "acme/judge-2" },
    recipeRefs: [{ id: "builtin-blind-raw", version: 1 }],
    stageResults: {
      stageA: {
        pairs: [
          {
            pair: ["openrouter:m-b", "openrouter:m-c"],
            stratum: "high",
            familyScores: { BlindRaw: 3.5, AnalysisFed: 4.2, AnalysisScores: 4.5 },
            refineWinnerScore: 4.4,
          },
          {
            pair: ["openrouter:m-a", "openrouter:m-d"],
            stratum: "median",
            familyScores: { BlindRaw: 3.4, AnalysisFed: 4.1, AnalysisScores: 4.4 },
            refineWinnerScore: 4.3,
          },
        ],
        survivors: ["AnalysisScores", "AnalysisFed"],
        eliminated: [
          { family: "BlindRaw", reason: "Dominated by AnalysisFed on all 2 stratified pairs." },
        ],
        completedAt: 1000,
      },
      stageB: {
        screenedPairs: [
          {
            pair: ["openrouter:m-b", "openrouter:m-c"],
            selectionHeadroom: 0.02,
            synthesisHeadroom: 1.0,
            perCriterionHeadroom: [{ criterionId: "acc", headroom: 1 }],
            costMultiplier: 4,
            shortlisted: true,
          },
          {
            pair: ["openrouter:m-d", "openrouter:m-e"],
            selectionHeadroom: 0,
            synthesisHeadroom: 0,
            perCriterionHeadroom: [],
            costMultiplier: 4,
            shortlisted: false,
          },
        ],
        shortlistRule: "H_synth ≥ 0.15 or H_select ≥ 0.25; top 5",
        shortlist: [["openrouter:m-b", "openrouter:m-c"]],
        frozenRecipe: "AnalysisScores",
        recipeEliminationLog: [
          {
            pairs: [["openrouter:m-b", "openrouter:m-c"]],
            dropped: "AnalysisFed",
            reason: "AnalysisScores outscored AnalysisFed on all 1 sequentially evaluated pairs.",
          },
        ],
        poolAdequacy: {
          probed: true,
          outcome: "confirmed",
          challengerKeys: ["openrouter:m-x"],
          note: "Challenger failed on the same instances.",
        },
        policyResults: [],
        comparisons: [],
        completedAt: 1000,
      },
      stageC: null,
    },
    playbookRef: "playbook-1",
    claimLevel: "exploratory",
    confirmationOf: null,
    status: "completed",
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function makePlaybook(): FusionPlaybook {
  return {
    id: "playbook-1",
    studyId: "study-1",
    suiteRef: {
      suiteId: "suite-1",
      suiteVersion: 4,
      protocolFingerprint: "sha256:0123456789abcdef",
    },
    rows: [
      {
        policy: "best_fixed",
        configuration: "openrouter:m-a",
        score: 4.18,
        lift: 0,
        costMultiplier: 1,
        confidence: "high",
      },
      {
        policy: "rank",
        configuration: "m-b + m-c",
        score: 4.37,
        lift: 0.19,
        costMultiplier: 2.4,
        confidence: "high",
      },
      {
        policy: "fuse",
        configuration: "m-b + m-c → AnalysisScores",
        score: 4.52,
        lift: 0.34,
        costMultiplier: 3.2,
        confidence: "medium",
      },
      {
        policy: "refine",
        configuration: "rank winner → reviser",
        score: 4.45,
        lift: 0.27,
        costMultiplier: 2.1,
        confidence: "high",
      },
    ],
    recommendation: {
      kind: "do_not_fuse",
      rationale: "No policy clears the predeclared MPID over the best fixed model.",
    },
    poolAdequacy: {
      probed: true,
      outcome: "confirmed",
      challengerKeys: ["openrouter:m-x"],
      note: "",
    },
    claimLevel: "exploratory",
    conclusion:
      "For this suite: do not use fusion — run the best single model. Pool adequacy: confirmed. Status: exploratory.",
    createdAt: 1000,
  };
}

function makeTrial(id: string): FusionTrial {
  return {
    id,
    revision: 3,
    studyId: "study-1",
    suiteRef: {
      suiteId: "suite-1",
      suiteVersion: 4,
      protocolFingerprint: "sha256:0123456789abcdef",
    },
    poolRef: { id: "pool-1", version: 2 },
    candidateConfig: { slots: [slot("s2", "m-b"), slot("s3", "m-c")] },
    judge1: { providerId: "openrouter", model: "acme/judge-1" },
    judge2: { providerId: "gemini", model: "acme/judge-2" },
    policy: "fuse",
    recipe: { id: "builtin-analysis-scores", version: 1 },
    synthesizer: { providerId: "openrouter", model: "z-ai/glm-5.2" },
    stage: "B",
    sampleIndex: 0,
    children: {
      candidateRunId: "run-cand-t1",
      devJudgeRunId: "run-judge-t1",
      synthesisArtifact: {
        runId: "fusion-synth-t1",
        fusionAttemptId: "fa-t1",
        contentHash: "sha256:0123456789abcdef00",
      },
    },
    observationIds: [`obs-${id}`],
    cost: {
      policy: { tokensIn: 900, tokensOut: 450 },
      experimental: { tokensIn: 1200, tokensOut: 600 },
    },
    status: "sealed",
    sealedAt: 2000,
    createdAt: 1000,
    updatedAt: 2000,
  };
}

async function seed() {
  const repo = new InMemoryFusionStudyRepository();
  await repo.createStudy(makeStudy());
  await repo.createPlaybook(makePlaybook());
  await repo.createRecipe(FUSION_RECIPE_ANALYSIS_SCORES_V1);
  const trial = makeTrial("trial-1");
  // Walk the real lifecycle: create in_progress → observe → seal.
  await repo.createTrial({
    ...trial,
    revision: 0,
    status: "in_progress",
    sealedAt: null,
    observationIds: [],
  });
  await repo.addObservation(
    {
      id: "obs-trial-1",
      trialId: "trial-1",
      judge: { providerId: "gemini", model: "acme/judge-2" },
      runId: null,
      status: "completed",
      overallScore: 4.5,
      tokensIn: 400,
      tokensOut: 200,
      error: null,
      startedAt: 1000,
      finishedAt: 1100,
    },
    0,
  );
  await repo.sealTrial("trial-1", 1, 2000);
  return repo;
}

describe("FusionStudyView", () => {
  it("renders the playbook with all four policies, the claim badge, and the do-not-fuse verdict", async () => {
    const repo = new InMemoryFusionStudyRepository();
    await repo.createStudy(makeStudy());
    await repo.createPlaybook(makePlaybook());
    const h = render(<FusionStudyView fusionRepo={repo} suiteId="suite-1" studyId="study-1" />);
    await settle();

    const table = h.$('[data-testid="playbook-table"]');
    expect(table?.textContent).toContain("best_fixed");
    expect(table?.textContent).toContain("rank");
    expect(table?.textContent).toContain("fuse");
    expect(table?.textContent).toContain("refine");
    expect(table?.textContent).toContain("4.52");
    expect(table?.textContent).toContain("+0.34");
    expect(table?.textContent).toContain("3.2×");

    const badges = h.$$('[data-testid="claim-badge"]').map((el) => el.textContent);
    expect(badges).toContain("Exploratory");

    const verdict = h.$('[data-testid="playbook-verdict"]');
    expect(verdict?.textContent).toContain("do not fuse");
    expect(h.$('[data-testid="playbook-conclusion"]')?.textContent).toContain(
      "Pool adequacy: confirmed",
    );
    h.unmount();
  });

  it("shows the full screened-pair table — losers included", async () => {
    const repo = new InMemoryFusionStudyRepository();
    await repo.createStudy(makeStudy());
    const h = render(<FusionStudyView fusionRepo={repo} suiteId="suite-1" studyId="study-1" />);
    await settle();

    const table = h.$('[data-testid="screened-pair-table"]');
    expect(table?.textContent).toContain("openrouter:m-b + openrouter:m-c");
    // The losing pair is rendered too (winner's-curse transparency).
    expect(table?.textContent).toContain("openrouter:m-d + openrouter:m-e");
    const rows = table?.querySelectorAll("tbody tr") ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[1].textContent).not.toContain("✓");
    expect(h.text()).toContain("AnalysisFed");
    expect(h.text()).toContain("dropped");
    h.unmount();
  });

  it("renders Stage A stratified pairs and elimination reasons", async () => {
    const repo = new InMemoryFusionStudyRepository();
    await repo.createStudy(makeStudy());
    const h = render(<FusionStudyView fusionRepo={repo} suiteId="suite-1" studyId="study-1" />);
    await settle();

    expect(h.text()).toContain("Baseline");
    expect(h.text()).toContain("high");
    expect(h.text()).toContain("median");
    const eliminations = h.$('[data-testid="stage-a-eliminations"]');
    expect(eliminations?.textContent).toContain("BlindRaw");
    expect(eliminations?.textContent).toContain("Dominated");
    h.unmount();
  });

  it("drills into sealed trial provenance", async () => {
    const repo = await seed();
    const h = render(<FusionStudyView fusionRepo={repo} suiteId="suite-1" studyId="study-1" />);
    await settle();

    const toggle = h.$('button[aria-label="Provenance for trial trial-1"]');
    expect(toggle).not.toBeNull();
    act(() => toggle!.click());
    await settle();

    const provenance = h.$('[data-testid="provenance-trial-1"]');
    expect(provenance).not.toBeNull();
    expect(provenance?.textContent).toContain("Suite v4");
    expect(provenance?.textContent).toContain("pool-1 v2");
    expect(provenance?.textContent).toContain("openrouter:m-b + openrouter:m-c");
    expect(provenance?.textContent).toContain("gemini:acme/judge-2");
    expect(provenance?.textContent).toContain("builtin-analysis-scores v1");
    expect(provenance?.textContent).toContain("fa-t1");
    expect(provenance?.textContent).toContain("policy 1350 tok");
    expect(provenance?.textContent).toContain("experimental 1800 tok");
    expect(provenance?.textContent).toContain("sealed");
    h.unmount();
  });

  it("links back to the suite inside Evaluations — no outside navigation", async () => {
    const repo = new InMemoryFusionStudyRepository();
    await repo.createStudy(makeStudy());
    const h = render(<FusionStudyView fusionRepo={repo} suiteId="suite-1" studyId="study-1" />);
    await settle();
    const hrefs = [...h.container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/^\/evaluations\//);
    }
    h.unmount();
  });
});
