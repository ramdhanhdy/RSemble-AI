// =============================================================================
// FusionStudyPanel tests — study listing/creation under a suite, pool
// requirement messaging, and the Run flow driving the orchestration to a
// completed study with a persisted playbook (acceptance 7, 10).
// =============================================================================

// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { FusionStudyPanel } from "./FusionStudyPanel";
import { InMemoryFusionStudyRepository } from "../../lib/persistence/fusion-study-repository";
import type { CatalogModel } from "../../lib/providers/types";
import type { EvaluationSuite, EvaluationTask } from "../../lib/evaluations/evaluation-types";
import type { ModelSlot } from "../../studio-data";
import type { FusionStudy } from "../../lib/evaluations/fusion-study-types";
import type { FusionPolicyExecutor } from "../../lib/evaluations/fusion-study-controller";

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

// --- Fixtures ---------------------------------------------------------------------

function slot(n: number, enabled = true): ModelSlot {
  return {
    id: `s${n}`,
    providerId: "openrouter",
    provider: "Test",
    model: `M${n}`,
    slug: `m-${n}`,
    enabled,
  };
}

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

function makeSuite(enabledCount: number): EvaluationSuite {
  return {
    id: "suite-1",
    revision: 1,
    version: 4,
    name: "Suite",
    description: "",
    tasks: [taskOf(1), taskOf(2)],
    modelSlots: Array.from({ length: 8 }, (_, i) => slot(i + 1, i < enabledCount)),
    defaultJudge: { providerId: "openrouter", model: "acme/judge-1" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  };
}

const MODELS: CatalogModel[] = [
  { id: "acme/judge-2", name: "Judge Two", providerId: "gemini" },
  { id: "acme/judge-1", name: "Judge One", providerId: "openrouter" },
];

function makeStudy(overrides: Partial<FusionStudy> = {}): FusionStudy {
  return {
    id: "study-1",
    revision: 0,
    kind: "exploration",
    suiteRef: { suiteId: "suite-1", suiteVersion: 4, protocolFingerprint: "sha256:abc" },
    poolRef: { id: "pool-suite-1", version: 1 },
    judge1: { providerId: "openrouter", model: "acme/judge-1" },
    judge2: { providerId: "gemini", model: "acme/judge-2" },
    recipeRefs: [],
    stageResults: { stageA: null, stageB: null, stageC: null },
    playbookRef: null,
    claimLevel: "exploratory",
    confirmationOf: null,
    status: "in_progress",
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

/** Minimal mock executor: deterministic scores, no provider calls. */
function mockExecutor(): FusionPolicyExecutor {
  const judgeReport = (outputs: Array<{ candidateId: string; modelKey: string }>) => ({
    labelMap: outputs.map((o, i) => ({ label: String.fromCharCode(65 + i), candidateId: o.candidateId })),
    evaluationsById: Object.fromEntries(
      outputs.map((o, i) => [
        o.candidateId,
        {
          candidateId: o.candidateId,
          blindLabel: String.fromCharCode(65 + i),
          overallScore: 4,
          position: "p",
          rationale: "r",
          strengths: ["s"],
          deductions: [],
          missedRequirements: [],
          criterionScores: [
            { criterionId: "acc", label: "Accuracy", score: i % 2 === 0 ? 5 : 3, rationale: "r" },
            { criterionId: "comp", label: "Completeness", score: i % 2 === 0 ? 3 : 5, rationale: "r" },
          ],
        },
      ]),
    ),
    comparisons: [],
  });
  return {
    async runPoolSweep(task, slots) {
      return {
        taskId: task.id,
        outputs: slots.map((s) => ({
          slot: s,
          modelKey: `${s.providerId}:${s.slug}`,
          candidateId: `cand-${s.id}`,
          text: `out:${s.slug}`,
          cost: { tokensIn: 100, tokensOut: 50 },
        })),
      };
    },
    async judgePool(_t, _p, _j, outputs) {
      return {
        report: judgeReport(outputs),
        consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
        cost: { tokensIn: 200, tokensOut: 100 },
      };
    },
    async runBlockedEvidence(task, _p, pair, _j) {
      const outputs = pair.map((s, i) => ({
        slot: s,
        modelKey: `${s.providerId}:${s.slug}`,
        candidateId: `cand-${s.id}`,
        text: `out:${s.slug}`,
        cost: { tokensIn: 100, tokensOut: 50 },
        i,
      }));
      return {
        blindCandidates: outputs.map((o, i) => ({
          label: String.fromCharCode(65 + i),
          candidateId: o.candidateId,
          content: o.text,
        })),
        report: judgeReport(outputs),
        consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
        candidateAttemptIdsByCandidateId: Object.fromEntries(outputs.map((o) => [o.candidateId, `catt-${o.slot.id}`])),
        judgeAttemptId: `jatt-${task.id}`,
        candidateRunId: `run-cand-${task.id}`,
        devJudgeRunId: `run-judge-${task.id}`,
        candidateCosts: Object.fromEntries(outputs.map((o) => [o.candidateId, o.cost])),
        judgeCost: { tokensIn: 200, tokensOut: 100 },
      };
    },
    async runSynthesis(_s, messages) {
      return { text: `synth:${messages[1].content.length}`, cost: { tokensIn: 300, tokensOut: 150 } };
    },
    async runHoldout(_t, _p, _j, artifacts) {
      return {
        scoresByKey: Object.fromEntries(
          artifacts.map((a) => [a.key, a.key === "best_fixed" ? 3.5 : a.key === "rank" ? 4.0 : 4.2]),
        ),
        cost: { tokensIn: 400, tokensOut: 200 },
      };
    },
  };
}

describe("FusionStudyPanel", () => {
  it("explains the pool requirement when fewer than 6 models are enabled", async () => {
    const repo = new InMemoryFusionStudyRepository();
    const h = render(
      <FusionStudyPanel fusionRepo={repo} evalRepo={null} suite={makeSuite(4)} models={MODELS} />,
    );
    await settle();
    expect(h.text()).toContain("6–8 enabled models");
    const button = h.$("button") as HTMLButtonElement | null;
    expect(button?.disabled).toBe(true);
    h.unmount();
  });

  it("lists studies with claim badge and links under Evaluations", async () => {
    const repo = new InMemoryFusionStudyRepository();
    await repo.createStudy(makeStudy());
    const h = render(
      <FusionStudyPanel fusionRepo={repo} evalRepo={null} suite={makeSuite(6)} models={MODELS} />,
    );
    await settle();
    const list = h.$('[data-testid="fusion-study-list"]');
    expect(list?.textContent).toContain("Exploratory");
    const link = h.$('a[href="/evaluations/suite-1/fusion/study-1"]');
    expect(link).not.toBeNull();
    h.unmount();
  });

  it("creates a study with a pool manifest and built-in recipes", async () => {
    const repo = new InMemoryFusionStudyRepository();
    const h = render(
      <FusionStudyPanel fusionRepo={repo} evalRepo={null} suite={makeSuite(8)} models={MODELS} />,
    );
    await settle();

    const createButton = h.$$("button").find((b) => b.textContent === "New study")!;
    act(() => createButton.click());
    await settle();

    const studies = await repo.listStudies("suite-1");
    expect(studies).toHaveLength(1);
    expect(studies[0].judge2).toEqual({ providerId: "gemini", model: "acme/judge-2" });
    expect(studies[0].recipeRefs).toHaveLength(3);
    expect(studies[0].suiteRef.protocolFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    const manifest = await repo.getLatestPoolManifest("pool-suite-1");
    expect(manifest?.core).toHaveLength(8);
    expect(manifest?.challengers).toHaveLength(0);
    expect(await repo.getRecipe("builtin-blind-raw", 1)).not.toBeNull();
    h.unmount();
  });

  it("runs a study end-to-end to a completed playbook via the injected executor", async () => {
    const repo = new InMemoryFusionStudyRepository();
    const h = render(
      <FusionStudyPanel
        fusionRepo={repo}
        evalRepo={null}
        suite={makeSuite(6)}
        models={MODELS}
        executor={mockExecutor()}
      />,
    );
    await settle();

    // Create then run.
    act(() => h.$$("button").find((b) => b.textContent === "New study")!.click());
    await settle();
    const runButton = h.$$("button").find((b) => b.textContent === "Run");
    expect(runButton).toBeDefined();
    act(() => runButton!.click());
    // The full A→B→C→playbook chain takes several async turns.
    for (let i = 0; i < 40; i++) await settle();

    const studies = await repo.listStudies("suite-1");
    expect(studies[0].status).toBe("completed");
    expect(studies[0].playbookRef).not.toBeNull();
    expect(studies[0].stageResults.stageA?.survivors).toHaveLength(2);
    expect(studies[0].stageResults.stageB?.screenedPairs.length).toBeGreaterThan(0);
    const playbook = await repo.getPlaybook(studies[0].playbookRef!);
    expect(playbook?.rows.map((r) => r.policy).sort()).toEqual(["best_fixed", "fuse", "rank", "refine"]);
    const trials = await repo.listTrials(studies[0].id);
    expect(trials.length).toBeGreaterThan(0);
    expect(trials.every((t) => t.status === "sealed")).toBe(true);
    h.unmount();
  });
});
