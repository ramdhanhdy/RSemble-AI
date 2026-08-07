// Renders ExperimentResults with a scored fixture into happy-dom and writes a
// standalone HTML preview (real markup + the compiled Tailwind bundle) for
// visual review. The dom-setup side-effect import MUST stay first (React DOM
// reads document at import time). Run: npx tsx scripts/render-results-preview.tsx
import "./preview-dom-setup";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ExperimentResults } from "../src/workspaces/evaluations/ExperimentResults";

const SLOTS = [
  {
    id: "s1",
    providerId: "openrouter",
    provider: "OpenRouter",
    model: "DeepSeek V4 Flash",
    slug: "deepseek/deepseek-v4-flash-0731",
    enabled: true,
  },
  {
    id: "s2",
    providerId: "umans",
    provider: "Umans",
    model: "Kimi K3",
    slug: "umans-kimi-k3",
    enabled: true,
  },
  {
    id: "s3",
    providerId: "umans",
    provider: "Umans",
    model: "GLM 5.2",
    slug: "umans-glm-5.2",
    enabled: true,
  },
  {
    id: "s4",
    providerId: "openrouter",
    provider: "OpenRouter",
    model: "Grok 4.5",
    slug: "x-ai/grok-4.5",
    enabled: true,
  },
  {
    id: "s5",
    providerId: "openrouter",
    provider: "OpenRouter",
    model: "GPT-5.6 Luna",
    slug: "openai/gpt-5.6-luna",
    enabled: true,
  },
] as const;

const TASKS = [
  {
    id: "t1",
    title: "PulseFit board deck (integrative)",
    prompt: "p",
    systemPrompt: "",
    evaluation: { kind: "inherit" as const },
    judgeInstructionOverride: "",
    order: 0,
  },
  {
    id: "t2",
    title: "Fable & Fern cohort economics (unit-economics isolation)",
    prompt: "p",
    systemPrompt: "",
    evaluation: { kind: "inherit" as const },
    judgeInstructionOverride: "",
    order: 1,
  },
  {
    id: "t3",
    title: "The free-tier question (market & strategy isolation)",
    prompt: "p",
    systemPrompt: "",
    evaluation: { kind: "inherit" as const },
    judgeInstructionOverride: "",
    order: 2,
  },
];

// Mirrors the user's real scores from the screenshot.
const SCORES: Record<string, number[]> = {
  "openrouter:deepseek/deepseek-v4-flash-0731": [3.5, 3.4, 3.3],
  "umans:umans-kimi-k3": [4.3, 4.6, 4.0],
  "umans:umans-glm-5.2": [4.0, 4.2, 3.5],
  "openrouter:x-ai/grok-4.5": [4.6, 4.1, 3.4],
  "openrouter:openai/gpt-5.6-luna": [4.9, 4.1, 3.5],
};

function runRecord(runId: string, taskIdx: number) {
  return {
    schemaVersion: 2 as const,
    id: runId,
    revision: 1,
    execution: { ownerId: "owner", fence: 1 },
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    completedAt: 1700000001000,
    status: "completed" as const,
    mode: "rank" as const,
    source: { kind: "adhoc" as const },
    task: { title: "Task", prompt: "p", systemPrompt: "", temperature: 0.7 },
    evaluation: { profile: null, candidateMessages: [] },
    candidates: SLOTS.map((s) => ({
      candidateId: `cand-${s.id}`,
      slotId: s.id,
      modelKey: `${s.providerId}:${s.slug}`,
      providerId: s.providerId,
      model: s.model,
      slug: s.slug,
      acceptedAttemptId: `catt-${s.id}`,
      attempts: [],
    })),
    judge: {
      status: "done" as const,
      acceptedAttemptId: "jatt-1",
      report: {
        labelMap: SLOTS.map((s, i) => ({
          label: String.fromCharCode(65 + i),
          candidateId: `cand-${s.id}`,
        })),
        evaluationsById: Object.fromEntries(
          SLOTS.map((s) => [
            `cand-${s.id}`,
            {
              candidateId: `cand-${s.id}`,
              blindLabel: "A",
              overallScore: SCORES[`${s.providerId}:${s.slug}`][taskIdx],
              position: "p",
              rationale: "r",
              strengths: ["s"],
              deductions: [],
              missedRequirements: [],
              criterionScores: [],
            },
          ]),
        ),
        comparisons: [],
      },
      consensus: null,
      attempts: [],
    },
    fusion: { status: "idle" as const, acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
  };
}

const experiment = {
  id: "exp-pulsefit-1",
  revision: 3,
  suiteId: "suite-pulsefit-biz-analytics",
  suiteVersion: 1,
  protocolFingerprint: "sha256:fp",
  status: "completed" as const,
  execution: null,
  snapshot: {
    suiteId: "suite-pulsefit-biz-analytics",
    suiteVersion: 1,
    tasks: TASKS,
    modelSlots: [...SLOTS],
    defaultJudge: { providerId: "openrouter" as const, model: "z-ai/glm-5.2" },
    defaultEvaluation: { kind: "holistic" as const },
    profiles: [],
    protocolFingerprint: "sha256:fp",
    createdAt: 1700000000000,
  },
  tasks: TASKS.map((t, i) => ({
    taskId: t.id,
    selectedAttemptId: `att-${i}`,
    attempts: [
      {
        id: `att-${i}`,
        runId: `run-${i + 1}`,
        trial: 1,
        status: "completed" as const,
        startedAt: 1,
        finishedAt: 2,
        error: null,
      },
    ],
  })),
  createdAt: 1700000000000,
  updatedAt: 1700000001000,
};

const records = new Map(TASKS.map((t, i) => [`run-${i + 1}`, runRecord(`run-${i + 1}`, i)]));

const container = document.createElement("div");
container.style.cssText = "background:#0a0f1c;min-height:100vh;";
document.body.appendChild(container);
document.body.style.cssText = "background:#0a0f1c;margin:0;";
const root = createRoot(container);
act(() => {
  root.render(
    createElement(
      MemoryRouter,
      { initialEntries: ["/experiments/exp-pulsefit-1"] },
      createElement(ExperimentResults, {
        experiment: experiment as never,
        resolveRunRecord: async (runId: string) => records.get(runId) ?? null,
      }),
    ),
  );
});
await act(async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
});
await act(async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
});

const cssFile = readdirSync("dist/assets").find((f) => f.endsWith(".css"));
if (!cssFile) throw new Error("No built CSS found — run vite build first");
const css = readFileSync(`dist/assets/${cssFile}`, "utf8");
const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>${css}</style></head>
<body style="background:#0a0f1c;margin:0;">${container.outerHTML}</body></html>`;
writeFileSync(".preview-experiment-results.html", html);
console.log("wrote .preview-experiment-results.html");
root.unmount();
process.exit(0);
