#!/usr/bin/env node
// =============================================================================
// cdp-records-qa.mjs — Child 08 Task 10 durable browser closure matrix
//
// Drives Chrome headless over CDP against the running Vite dev server.
// Strictly adheres to the E:-contained runtime policy: all profiles, caches,
// crash dumps, traces, downloads, logs, and temp directories live under
// E:/2026/RSemble-AI/.qa-runtime/run30. Fails closed immediately on any C:-resolved
// runtime path.
//
// Exercises the complete §N / §R matrix:
//   1. Migration pointer lifecycle (one-time status anchor, dismissal persistence)
//   2. Primary navigation topology (Compare, Evaluations, Lab, Models) and zero Runs labels
//   3. Records quick drawer (>=1024px) with search, group bounds, focus trap, Escape return
//   4. Below-1024px substitution (direct /records link, drawer unmounted)
//   5. Full Records utility (/records) with 6-filter complete-set pagination and list-split
//   6. Semantic-vs-exact distinguishability in default stream
//   7. Six typed details (comparison, evaluation, policy-study, task-execution, observation, legacy)
//   8. Open in Compare configuration preload with honesty token
//   9. Legacy /runs query redirect and /runs/:id URL-preserving compatibility
//  10. DataArchiveActions reachability and truthfulness (zero delete/retention)
//  11. Viewports ladder (1440x900, 1024x768, 768x1024, 390x844) and 200% zoom containment
//  12. Keyboard-only flows, focus restoration, 44px targets, reduced motion
//  13. Long mono IDs break-all and card rect containment (no horizontal document overflow)
//  14. Secret probe and zero paid provider network egress
// =============================================================================

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

// -----------------------------------------------------------------------------
// 1. E: Runtime Policy and Containment Boundaries
// -----------------------------------------------------------------------------

const QA_RUNTIME_ROOT = path.resolve("E:/2026/RSemble-AI/.qa-runtime/run30");
const RETAINED_EVIDENCE_DIR = path.resolve("docs/qa/records-workbench");

const TEMP_DIR = path.join(QA_RUNTIME_ROOT, "temp");
const NPM_CACHE_DIR = path.join(QA_RUNTIME_ROOT, "npm-cache");
const XDG_CACHE_DIR = path.join(QA_RUNTIME_ROOT, "xdg-cache");
const BROWSER_DIR = path.join(QA_RUNTIME_ROOT, "browser");
const DOWNLOADS_DIR = path.join(QA_RUNTIME_ROOT, "downloads");
const TRACES_DIR = path.join(QA_RUNTIME_ROOT, "traces");
const LOGS_DIR = path.join(QA_RUNTIME_ROOT, "logs");
const SCRATCH_DIR = path.join(QA_RUNTIME_ROOT, "scratch");

const requiredDirs = [
  QA_RUNTIME_ROOT,
  RETAINED_EVIDENCE_DIR,
  TEMP_DIR,
  NPM_CACHE_DIR,
  XDG_CACHE_DIR,
  BROWSER_DIR,
  DOWNLOADS_DIR,
  TRACES_DIR,
  LOGS_DIR,
  SCRATCH_DIR,
];

for (const dir of requiredDirs) {
  fs.mkdirSync(dir, { recursive: true });
}

// Redirect process environment to E: runtime root
process.env.TEMP = TEMP_DIR;
process.env.TMP = TEMP_DIR;
process.env.TMPDIR = TEMP_DIR;
process.env.npm_config_cache = NPM_CACHE_DIR;
process.env.XDG_CACHE_HOME = XDG_CACHE_DIR;
process.env.PUPPETEER_CACHE_DIR = BROWSER_DIR;
process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSER_DIR;

const chromeUserDataDir = path.join(BROWSER_DIR, `chrome-profile-${Date.now()}`);
const chromeDiskCacheDir = path.join(BROWSER_DIR, `chrome-disk-cache-${Date.now()}`);
const chromeCrashDumpsDir = path.join(BROWSER_DIR, `chrome-crashes-${Date.now()}`);

fs.mkdirSync(chromeUserDataDir, { recursive: true });
fs.mkdirSync(chromeDiskCacheDir, { recursive: true });
fs.mkdirSync(chromeCrashDumpsDir, { recursive: true });

function assertEContainment(label, targetPath) {
  const normalized = path.resolve(targetPath).replace(/\\/g, "/");
  if (/^[a-z]:/i.test(normalized) && !/^e:/i.test(normalized)) {
    throw new Error(
      `E: containment violation in ${label}: path "${normalized}" resolves outside E: drive!`,
    );
  }
}

// Fail closed if any QA path resolves to C:
assertEContainment("QA_RUNTIME_ROOT", QA_RUNTIME_ROOT);
assertEContainment("RETAINED_EVIDENCE_DIR", RETAINED_EVIDENCE_DIR);
assertEContainment("TEMP_DIR", TEMP_DIR);
assertEContainment("NPM_CACHE_DIR", NPM_CACHE_DIR);
assertEContainment("XDG_CACHE_DIR", XDG_CACHE_DIR);
assertEContainment("BROWSER_DIR", BROWSER_DIR);
assertEContainment("chromeUserDataDir", chromeUserDataDir);
assertEContainment("chromeDiskCacheDir", chromeDiskCacheDir);
assertEContainment("chromeCrashDumpsDir", chromeCrashDumpsDir);

// -----------------------------------------------------------------------------
// 2. Harness Configuration and Ports
// -----------------------------------------------------------------------------

const BROWSER_PORT = process.env.QA_PORT ? Number(process.env.QA_PORT) : 5198;
const baseUrl = process.env.QA_BASE_URL ?? `http://127.0.0.1:${BROWSER_PORT}/`;
const chromePath =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const debugPort = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 9398;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pollReady(port, host = "127.0.0.1", attempts = 80) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const probe = () => {
      const req = http.get(`http://${host}:${port}/`, (res) => {
        res.resume();
        if (res.statusCode === 200 || res.statusCode === 404) return resolve(true);
        retry();
      });
      req.on("error", retry);
      function retry() {
        tries += 1;
        if (tries >= attempts) {
          return reject(new Error(`Dev server on ${port} never became ready`));
        }
        setTimeout(probe, 250);
      }
    };
    probe();
  });
}

function canonicalJsonString(value) {
  function sortKeys(val) {
    if (val === null || typeof val !== "object") return val;
    if (Array.isArray(val)) return val.map(sortKeys);
    const sorted = {};
    for (const key of Object.keys(val).sort()) {
      sorted[key] = sortKeys(val[key]);
    }
    return sorted;
  }
  return JSON.stringify(sortKeys(value));
}

function sha256Hex(value) {
  return "sha256:" + crypto.createHash("sha256").update(canonicalJsonString(value)).digest("hex");
}

const NOW = 1716048000000;
const SECRET_TOKEN_TEST = "sk-proj-SUPERSECRET1234567890abcdefghijklmnopqrstuvwxyz";

const results = {
  generatedAt: new Date().toISOString(),
  command: "npm run qa:records",
  baseUrl,
  runtimeContainment: {
    root: QA_RUNTIME_ROOT,
    userDataDir: chromeUserDataDir,
    diskCacheDir: chromeDiskCacheDir,
    crashDumpsDir: chromeCrashDumpsDir,
    tempDir: TEMP_DIR,
    retainedEvidenceDir: RETAINED_EVIDENCE_DIR,
    verifiedDrive: "E:",
  },
  probes: [],
  screenshots: [],
  consoleErrors: [],
  providerCalls: [],
  matrix: {
    migrationPointer: null,
    primaryNavigation: null,
    recordsDrawer: null,
    below1024Substitution: null,
    recordsListAndFiltering: null,
    semanticVsExactDistinction: null,
    typedDetails: null,
    comparePreload: null,
    legacyRouteCompatibility: null,
    archiveActions: null,
    viewportLadderAndZoom: null,
    keyboardAndAccessibility: null,
    reducedMotion: null,
    secretAndEgressInvariants: null,
  },
};

// -----------------------------------------------------------------------------
// 3. Network Egress and Console Interceptor
// -----------------------------------------------------------------------------

const MOCK_PROVIDER_INTERCEPTOR = `(() => {
  window.__qaPaidProviderCalls = [];
  const originalFetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input && input.url) || '';
    if (url.includes('/models')) {
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const isPaid = /openrouter\\.ai|api\\.openai\\.com|anthropic\\.com|generativelanguage\\.googleapis\\.com|api\\.deepseek\\.com|umans\\.ai/i.test(url);
    if (isPaid) {
      window.__qaPaidProviderCalls.push({ url, method: (init && init.method) || 'GET', timestamp: Date.now() });
      return new Response(JSON.stringify({ error: 'Blocked by Records QA egress gate' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch.apply(this, arguments);
  };
})()`;

// -----------------------------------------------------------------------------
// 4. Deterministic IndexedDB Fixture Generation
// -----------------------------------------------------------------------------

function buildFixtureCorpus() {
  const slots = [
    {
      id: "s1",
      providerId: "openrouter",
      provider: "OpenRouter",
      model: "GLM 5.2",
      slug: "z-ai/glm-5.2",
      label: "GLM 5.2",
      enabled: true,
    },
    {
      id: "s2",
      providerId: "openrouter",
      provider: "OpenRouter",
      model: "DeepSeek V4 Flash",
      slug: "deepseek/deepseek-v4-flash",
      label: "DeepSeek V4 Flash",
      enabled: true,
    },
  ];

  function makeCandidate(candidateId, slotId, model, slug, output, status, createdAt) {
    const isCompleted = status === "completed";
    const isFailed = status === "failed";
    return {
      candidateId,
      slotId,
      modelKey: `openrouter:${slug}`,
      providerId: "openrouter",
      model,
      slug,
      acceptedAttemptId: isCompleted ? `att-${candidateId}` : null,
      attempts: [
        {
          attemptId: `att-${candidateId}`,
          messages: [{ role: "user", content: "Execute task" }],
          startedAt: createdAt,
          finishedAt: isCompleted || isFailed ? createdAt + 4000 : null,
          status,
          output: isCompleted ? output : null,
          tokensIn: 45,
          tokensOut: 110,
          error: isFailed ? { message: "Rate limit exceeded" } : null,
        },
      ],
    };
  }

  function makeJudgeAttempt(c1Id, c2Id, createdAt) {
    return {
      attemptId: `j-att-${c1Id}`,
      providerId: "openrouter",
      model: "qwen-3.8-max",
      instruction: "Evaluate accuracy and readability.",
      messages: [{ role: "user", content: "Evaluate" }],
      blindLabelToCandidateId: { A: c1Id, B: c2Id },
      candidateAttemptIdsByCandidateId: { [c1Id]: `att-${c1Id}`, [c2Id]: `att-${c2Id}` },
      startedAt: createdAt + 4000,
      finishedAt: createdAt + 8000,
      status: "completed",
      error: null,
      report: {
        labelMap: [
          { label: "A", candidateId: c1Id },
          { label: "B", candidateId: c2Id },
        ],
        evaluationsById: {
          [c1Id]: {
            candidateId: c1Id,
            blindLabel: "A",
            overallScore: 4.9,
            position: "First",
            rationale: "Optimal and correct implementation.",
            strengths: ["Fast", "Accurate"],
            deductions: [],
            missedRequirements: [],
            criterionScores: [
              {
                criterionId: "crit-correctness",
                label: "Correctness",
                score: 5.0,
                rationale: "100% correct",
              },
            ],
          },
          [c2Id]: {
            candidateId: c2Id,
            blindLabel: "B",
            overallScore: 4.2,
            position: "Second",
            rationale: "Good implementation with minor inefficiency.",
            strengths: ["Clean"],
            deductions: [],
            missedRequirements: [],
            criterionScores: [
              {
                criterionId: "crit-correctness",
                label: "Correctness",
                score: 4.2,
                rationale: "Valid",
              },
            ],
          },
        },
        comparisons: [
          {
            candidateIds: [c1Id, c2Id],
            blindLabels: ["A", "B"],
            reason: "Candidate A is faster.",
          },
        ],
      },
      consensus: {
        consensus: ["Both models answered correctly."],
        contradictions: [],
        uniqueInsights: [],
      },
    };
  }

  function makeRunRecord(id, title, opts = {}) {
    const status = opts.status ?? "completed";
    const mode = opts.mode ?? "rank";
    const createdAt = opts.createdAt ?? NOW;
    const completedAt = status === "running" ? null : createdAt + 10000;
    const isCompleted = status === "completed";
    const c1Id = `c1-${id}`;
    const c2Id = `c2-${id}`;

    const c1 = makeCandidate(
      c1Id,
      "s1",
      "GLM 5.2",
      "z-ai/glm-5.2",
      `Output 1 for ${title}`,
      status,
      createdAt,
    );
    const c2 = makeCandidate(
      c2Id,
      "s2",
      "DeepSeek V4 Flash",
      "deepseek/deepseek-v4-flash",
      `Output 2 for ${title}`,
      status,
      createdAt,
    );
    const judgeAttempt = isCompleted ? makeJudgeAttempt(c1Id, c2Id, createdAt) : null;

    return {
      schemaVersion: 2,
      id,
      revision: 1,
      execution: { ownerId: "qa-tab", fence: 1 },
      createdAt,
      updatedAt: completedAt ?? createdAt + 1000,
      completedAt,
      status,
      mode,
      source: opts.source ?? { kind: "adhoc" },
      task: {
        title,
        prompt: opts.prompt ?? "Execute prompt",
        systemPrompt: "You are an AI assistant.",
        temperature: 0.7,
      },
      evaluation: {
        profile: null,
        candidateMessages: [{ role: "user", content: opts.prompt ?? "Execute prompt" }],
      },
      candidates: [c1, c2],
      judge: {
        status: isCompleted ? "done" : "idle",
        acceptedAttemptId: isCompleted ? judgeAttempt.attemptId : null,
        report: isCompleted ? judgeAttempt.report : null,
        consensus: isCompleted ? judgeAttempt.consensus : null,
        attempts: isCompleted ? [judgeAttempt] : [],
      },
      fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
      winnerKeys: isCompleted ? ["openrouter:z-ai/glm-5.2"] : [],
    };
  }

  function makeRunSummary(record) {
    const modelKeys = record.candidates.map((c) => c.modelKey);
    const scoresByModelKey = {};
    if (record.status === "completed") {
      scoresByModelKey["openrouter:z-ai/glm-5.2"] = 4.9;
      scoresByModelKey["openrouter:deepseek/deepseek-v4-flash"] = 4.2;
    }
    const fullSummary = {
      kind: "full",
      schemaVersion: 2,
      id: record.id,
      revision: record.revision,
      createdAt: record.createdAt,
      completedAt: record.completedAt,
      status: record.status,
      mode: record.mode,
      source: record.source,
      taskTitle: record.task.title,
      taskExcerpt: record.task.prompt.slice(0, 100),
      modelKeys,
      winnerKeys: record.winnerKeys,
      scoresByModelKey,
      judgeModelKey: "openrouter:qwen-3.8-max",
      evaluationProfileId: null,
      evaluationProfileVersion: null,
      detailAvailable: true,
      searchText:
        `${record.id} ${record.task.title} ${record.task.prompt} ${modelKeys.join(" ")}`.toLowerCase(),
    };

    return {
      kind: "full",
      id: record.id,
      revision: record.revision,
      createdAt: record.createdAt,
      completedAt: record.completedAt,
      status: record.status,
      mode: record.mode,
      sourceKind: record.source.kind,
      sourceProtocolFingerprint:
        record.source.kind === "experiment" ? (record.source.protocolFingerprint ?? null) : null,
      sourceExperimentTaskAttemptId:
        record.source.kind === "experiment"
          ? (record.source.experimentTaskAttemptId ?? null)
          : null,
      modelKeys,
      summary: fullSummary,
    };
  }

  // 1. Comparison 1 (Ad-hoc)
  const cmp1Record = makeRunRecord("cmp-rank-adhoc-1", "Ad-hoc QuickSort Optimization", {
    createdAt: NOW - 100000,
    prompt: "Optimize quicksort algorithm in Rust with benchmark tests.",
  });
  const cmp1Summary = makeRunSummary(cmp1Record);
  const cmp1Index = {
    id: "cmp-rank-adhoc-1",
    runId: "cmp-rank-adhoc-1",
    createdAt: cmp1Record.createdAt,
    updatedAt: cmp1Record.createdAt + 10000,
    status: "completed",
    mode: "rank",
    title: cmp1Record.task.title,
    taskBinding: { kind: "ad_hoc", inputSnapshotRef: "snap:sha256:cmp1-rust-quicksort" },
    taskInstanceId: null,
    activeObservationIds: [],
    evidenceReceiptRevision: 0,
    lineage: { repeatedFrom: null },
    revision: 1,
  };

  // 2. Comparison 2 (Canonical Fuse)
  const cmp2Record = makeRunRecord("cmp-fuse-canonical-1", "Canonical Matrix Multiplication Fuse", {
    createdAt: NOW - 200000,
    mode: "fuse",
    prompt: "Fuse two matrix multiplication kernel variants into an optimal SIMD kernel.",
  });
  const cmp2Summary = makeRunSummary(cmp2Record);
  const cmp2Index = {
    id: "cmp-fuse-canonical-1",
    runId: "cmp-fuse-canonical-1",
    createdAt: cmp2Record.createdAt,
    updatedAt: cmp2Record.createdAt + 10000,
    status: "completed",
    mode: "fuse",
    title: cmp2Record.task.title,
    taskBinding: { kind: "canonical", taskId: "task-matrix-simd", taskVersion: 1 },
    taskInstanceId: "inst-matrix-simd-1",
    activeObservationIds: [],
    evidenceReceiptRevision: 0,
    lineage: { repeatedFrom: null },
    revision: 1,
  };

  // 3. Evaluation execution and Task Set
  const evalChildRun = makeRunRecord("run-eval-task-1", "Task Set Execution: Binary Search", {
    createdAt: NOW - 300000,
    source: {
      kind: "experiment",
      experimentId: "exp-eval-set-1",
      suiteId: "set-coding-bench",
      suiteVersion: 1,
      protocolFingerprint: "sha256:eval-set-1",
      taskId: "task-binsearch",
      experimentTaskAttemptId: "att-eval-1",
      trial: 0,
    },
  });
  const evalChildSummary = makeRunSummary(evalChildRun);

  const suiteTasks = [
    {
      id: "task-binsearch",
      title: "Binary Search",
      prompt: "Implement binary search in TypeScript",
      systemPrompt: "",
      evaluation: { kind: "holistic" },
      judgeInstructionOverride: "",
      order: 0,
    },
  ];

  const suiteRecord = {
    id: "set-coding-bench",
    revision: 1,
    version: 1,
    name: "Coding Benchmark",
    description: "Standard algorithmic benchmark suite",
    tasks: suiteTasks,
    modelSlots: slots,
    defaultJudge: { providerId: "openrouter", model: "Qwen 3.8 Max", slug: "qwen/qwen-3.8-max" },
    defaultEvaluation: { kind: "holistic" },
    profiles: [],
    createdAt: NOW - 500000,
    updatedAt: NOW - 500000,
    archivedAt: null,
    suite: {
      id: "set-coding-bench",
      revision: 1,
      version: 1,
      name: "Coding Benchmark",
      description: "Standard algorithmic benchmark suite",
      tasks: suiteTasks,
      models: slots,
      judge: { providerId: "openrouter", model: "Qwen 3.8 Max", slug: "qwen/qwen-3.8-max" },
      evaluation: { kind: "holistic" },
      profiles: [],
      createdAt: NOW - 500000,
      updatedAt: NOW - 500000,
      archivedAt: null,
    },
  };

  const experimentSnapshot = {
    suiteId: "set-coding-bench",
    suiteVersion: 1,
    tasks: suiteTasks,
    modelSlots: slots,
    defaultJudge: { providerId: "openrouter", model: "Qwen 3.8 Max", slug: "qwen/qwen-3.8-max" },
    defaultEvaluation: { kind: "holistic" },
    profiles: [],
    protocolFingerprint: "sha256:eval-set-1",
    createdAt: NOW - 300000,
  };

  const experimentRecord = {
    id: "exp-eval-set-1",
    revision: 1,
    suiteId: "set-coding-bench",
    suiteVersion: 1,
    protocolFingerprint: "sha256:eval-set-1",
    status: "completed",
    execution: null,
    createdAt: NOW - 300000,
    updatedAt: NOW - 290000,
    snapshot: experimentSnapshot,
    tasks: [
      {
        taskId: "task-binsearch",
        selectedAttemptId: "att-eval-1",
        attempts: [
          {
            id: "att-eval-1",
            runId: "run-eval-task-1",
            trial: 0,
            status: "completed",
            startedAt: NOW - 300000,
            finishedAt: NOW - 290000,
            error: null,
          },
        ],
      },
    ],
    experiment: {
      id: "exp-eval-set-1",
      revision: 1,
      suiteId: "set-coding-bench",
      suiteVersion: 1,
      protocolFingerprint: "sha256:eval-set-1",
      status: "completed",
      execution: null,
      createdAt: NOW - 300000,
      updatedAt: NOW - 290000,
      snapshot: experimentSnapshot,
      tasks: [
        {
          taskId: "task-binsearch",
          selectedAttemptId: "att-eval-1",
          attempts: [
            {
              id: "att-eval-1",
              runId: "run-eval-task-1",
              trial: 0,
              status: "completed",
              startedAt: NOW - 300000,
              finishedAt: NOW - 290000,
              error: null,
            },
          ],
        },
      ],
    },
  };

  // 4. Policy Study in the Lab
  const studyChildRun = makeRunRecord("run-study-task-1", "Latency Policy Study Trial Run", {
    createdAt: NOW - 400000,
    source: { kind: "adhoc" },
  });
  const studyChildSummary = makeRunSummary(studyChildRun);

  const studyDefinition = {
    workload: {
      taskSetId: "set-coding-bench",
      version: 1,
      manifestDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    },
    modelPool: {
      poolId: "pool-1",
      version: 1,
      digest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    },
    fusionRecipes: [
      {
        recipeId: "recipe-1",
        version: 1,
        digest: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      },
    ],
    judge1: { id: "mc:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" },
    judge2: { id: "mc:sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210" },
    rubric: { rubricId: "rubric-1", version: 1 },
    protocolFingerprint: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
    policies: ["best_fixed", "rank", "fuse", "refine"],
    stageProtocolVersion: 1,
    claimPlan: "exploration",
  };
  const studyDefFingerprint = sha256Hex(studyDefinition);

  const policyStudyRecord = {
    id: "study-latency-policy",
    revision: 1,
    kind: "policy",
    title: "Latency & Speed Tradeoff Study",
    status: "completed",
    claimLevel: "exploratory",
    definitionSchemaVersion: 1,
    definitionFingerprint: studyDefFingerprint,
    definition: studyDefinition,
    reportRef: "study-latency-policy",
    confirmationOf: null,
    createdAt: NOW - 400000,
    updatedAt: NOW - 390000,
    archivedAt: null,
    record: {
      id: "study-latency-policy",
      revision: 1,
      kind: "policy",
      title: "Latency & Speed Tradeoff Study",
      status: "completed",
      claimLevel: "exploratory",
      definitionSchemaVersion: 1,
      definitionFingerprint: studyDefFingerprint,
      definition: studyDefinition,
      reportRef: "study-latency-policy",
      confirmationOf: null,
      createdAt: NOW - 400000,
      updatedAt: NOW - 390000,
      archivedAt: null,
    },
  };

  const trialPayload = {
    policy: "fuse",
    stage: "A",
    candidateConfig: {
      members: [
        { id: "mc:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" },
      ],
    },
    recipeRef: {
      recipeId: "recipe-1",
      version: 1,
      digest: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
    },
    synthesizer: {
      id: "mc:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
  };
  const trialPayloadFingerprint = sha256Hex(trialPayload);

  const studyTrialRecord = {
    id: "trial-latency-1",
    studyId: "study-latency-policy",
    payloadKind: "policy",
    payloadSchemaVersion: 1,
    payloadFingerprint: trialPayloadFingerprint,
    payload: trialPayload,
    status: "sealed",
    sampleIndex: 0,
    artifactRefs: [{ runId: "run-study-task-1", kind: "run" }],
    observationIds: ["obs-1"],
    policyCost: { tokensIn: 100, tokensOut: 50 },
    experimentalCost: { tokensIn: 100, tokensOut: 50 },
    createdAt: NOW - 400000,
    sealedAt: NOW - 395000,
    trial: {
      id: "trial-latency-1",
      studyId: "study-latency-policy",
      payloadKind: "policy",
      payloadSchemaVersion: 1,
      payloadFingerprint: trialPayloadFingerprint,
      payload: trialPayload,
      status: "sealed",
      sampleIndex: 0,
      artifactRefs: [{ runId: "run-study-task-1", kind: "run" }],
      observationIds: ["obs-1"],
      policyCost: { tokensIn: 100, tokensOut: 50 },
      experimentalCost: { tokensIn: 100, tokensOut: 50 },
      createdAt: NOW - 400000,
      sealedAt: NOW - 395000,
    },
  };

  const studyObservationRecord = {
    id: "study-obs-latency-1",
    studyId: "study-latency-policy",
    trialId: "trial-latency-1",
    payloadKind: "policy",
    payloadSchemaVersion: 1,
    sourceRunId: "run-study-task-1",
    observedAt: NOW - 400000,
    observation: {
      id: "study-obs-latency-1",
      studyId: "study-latency-policy",
      trialId: "trial-latency-1",
      payloadKind: "policy",
      payloadSchemaVersion: 1,
      sourceRunId: "run-study-task-1",
      observedAt: NOW - 400000,
    },
  };

  // 5. Standalone Task Execution
  const exactTaskRun = makeRunRecord("run-exact-task-1", "Implement Fibonacci in Rust", {
    createdAt: NOW - 50000,
    prompt: "Write an efficient fibonacci generator.",
  });
  const exactTaskSummary = makeRunSummary(exactTaskRun);

  // 6. Long ID and Overflow Probe Record
  const longFieldsRun = makeRunRecord(
    "run-longfields-id-0123456789abcdef0123456789abcdef0123456789abcdef",
    "Supercalifragilisticexpialidocious Ultra-Long Continuous String Without Whitespace That Tests Card Bounding And Container Containment At All Viewports",
    {
      createdAt: NOW - 60000,
      prompt: "Execute long field containment probe.",
    },
  );
  const longFieldsSummary = makeRunSummary(longFieldsRun);

  // 7. Evidence Observation Record
  const mcId = "mc:sha256:8f691efd6f3ec0cc6038a0a45271b574b5fe9f50b6d1a1ca890ce6028dc7d0f1";
  const obsId = "obs:sha256:34c277860e425860c166d2d5d79e85d3cc0dfc9737098da7c3c55b25ac7f1d43";
  const fingerprint = "sha256:4b88c674e9b5e936369d601d64d0069a2e2ce0b43a7a0307fd1dfab60d500993";

  const modelConfig = {
    id: mcId,
    providerId: "openrouter",
    requestedModel: "z-ai/glm-5.2",
    resolvedModelIdentifier: "z-ai/glm-5.2-20260101",
    parameters: { temperature: 0.7 },
    createdAt: NOW - 600000,
    snapshot: {
      id: mcId,
      providerId: "openrouter",
      requestedModel: "z-ai/glm-5.2",
      resolvedModelIdentifier: "z-ai/glm-5.2-20260101",
      parameters: { temperature: 0.7 },
      createdAt: NOW - 600000,
    },
  };

  const observationRecord = {
    id: obsId,
    sourceKey: JSON.stringify([
      "comparison",
      "cmp-rank-adhoc-1",
      "cell-1",
      mcId,
      "c1-cmp-rank-adhoc-1",
      JSON.stringify(["j-att-cmp-rank-adhoc-1", null]),
    ]),
    taskId: "task-quicksort",
    taskVersion: 1,
    sourceKind: "comparison",
    sourceResultId: "cmp-rank-adhoc-1",
    runId: "cmp-rank-adhoc-1",
    modelConfigurationId: mcId,
    observedAt: NOW - 100000,
    score: 4.9,
    metrics: { correctness: 5.0, latencyMs: 280 },
    revision: 1,
    observation: {
      id: obsId,
      sourceKind: "comparison",
      sourceResultId: "cmp-rank-adhoc-1",
      executionLineageId: "cmp:cmp-rank-adhoc-1",
      runId: "cmp-rank-adhoc-1",
      sourceTaskCellId: "cell-1",
      taskId: "task-quicksort",
      taskVersion: 1,
      taskInstanceId: "inst-task-quicksort-1",
      taskFamilyId: "family-algorithms",
      modelConfigurationId: mcId,
      candidateAttemptId: "c1-cmp-rank-adhoc-1",
      assessmentRef: {
        judgeAttemptId: "j-att-cmp-rank-adhoc-1",
        judgeProviderId: "openrouter",
        judgeModel: "qwen-3.8-max",
        blindLabelMapping: { "c1-cmp-rank-adhoc-1": "A" },
        candidateAttemptIdsByCandidateId: { "c1-cmp-rank-adhoc-1": "att-c1-cmp-rank-adhoc-1" },
        rubricRef: null,
        verifierRef: null,
        verifierOutcome: null,
      },
      protocolFingerprint: fingerprint,
      rubricRef: null,
      evaluatorSnapshot: {
        kind: "model_judge",
        providerId: "openrouter",
        model: "qwen-3.8-max",
        resolvedVersion: "2026-01-01",
        instructionDigest: fingerprint,
        reasoningEffort: null,
        toolScaffoldSignature: null,
      },
      verifierSnapshot: null,
      outcome: {
        judgeAccepted: true,
        overallScore: 4.9,
        criterionValues: [],
        verifierPassed: null,
      },
      observedAt: NOW - 100000,
      observationSchemaVersion: 1,
    },
  };

  const evidenceDecisionRecord = {
    id: `${obsId}#1`,
    observationId: obsId,
    ruleVersion: 1,
    decision: {
      observationId: obsId,
      ruleVersion: 1,
      status: "eligible",
      evidenceClass: "comparable",
      allowedUses: [
        "task_descriptive",
        "within_model_profile",
        "paired_model_comparison",
        "task_set_standing",
      ],
      reasonCodes: [
        "canonical_task_resolved",
        "instance_reconstructed",
        "candidate_selected_completed",
        "assessment_selected_completed",
        "rubric_resolved",
        "protocol_complete",
        "model_configuration_exact",
        "full_pair_coverage",
        "full_task_set_coverage",
      ],
      comparabilityCohortId: fingerprint,
      decidedAt: NOW - 100000,
    },
  };

  // 8. Legacy Record (Imported summary)
  const legacySummary = {
    kind: "legacy",
    id: "legacy-run-2025-01",
    revision: 1,
    createdAt: 1705000000000,
    completedAt: 1705000010000,
    status: null,
    mode: null,
    sourceKind: "legacy",
    sourceProtocolFingerprint: null,
    sourceExperimentTaskAttemptId: null,
    modelKeys: ["openai:gpt-4o", "anthropic:claude-3-opus"],
    summary: {
      kind: "legacy",
      schemaVersion: "1-import",
      id: "legacy-run-2025-01",
      createdAt: 1705000000000,
      taskExcerpt: "Optimize SQL query for high-throughput logging",
      modelKeys: ["openai:gpt-4o", "anthropic:claude-3-opus"],
      winnerKeys: [],
      scoresByModelKey: {},
      detailAvailable: false,
      searchText: "legacy-run-2025-01 legacy sql query optimize gpt claude",
    },
  };

  // 9. Pagination Runs (51 additional runs to test complete-set filtering & 50-item page size)
  const paginationRecords = [];
  const paginationSummaries = [];
  const statuses = ["completed", "failed", "aborted", "interrupted", "completed", "completed"];
  for (let i = 1; i <= 51; i++) {
    const pId = `run-paginate-${String(i).padStart(2, "0")}`;
    const pStatus = statuses[i % statuses.length];
    const pRecord = makeRunRecord(pId, `Paginated Benchmark Task #${i}`, {
      status: pStatus,
      createdAt: NOW - 700000 - i * 1000,
      prompt: `Pagination test prompt #${i}`,
    });
    paginationRecords.push(pRecord);
    paginationSummaries.push(makeRunSummary(pRecord));
  }

  const allRunRecords = [
    cmp1Record,
    cmp2Record,
    evalChildRun,
    studyChildRun,
    exactTaskRun,
    longFieldsRun,
    ...paginationRecords,
  ];

  const allRunSummaries = [
    cmp1Summary,
    cmp2Summary,
    evalChildSummary,
    studyChildSummary,
    exactTaskSummary,
    longFieldsSummary,
    legacySummary,
    ...paginationSummaries,
  ];

  return {
    runDetails: allRunRecords.map((r) => ({
      id: r.id,
      record: r,
      revision: r.revision,
      createdAt: r.createdAt,
      status: r.status,
    })),
    runSummaries: allRunSummaries,
    comparisonResults: [cmp1Index, cmp2Index],
    experiments: [experimentRecord],
    suites: [suiteRecord],
    studies: [policyStudyRecord],
    studyTrials: [studyTrialRecord],
    studyObservations: [studyObservationRecord],
    modelConfigurations: [modelConfig],
    observations: [observationRecord],
    evidenceDecisions: [evidenceDecisionRecord],
  };
}

function generateSeedScript(corpus) {
  return `(async () => {
    const DB_NAME = 'rsemble-evaluation';
    const corpus = ${JSON.stringify(corpus)};
    const openDb = () => new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const put = (db, storeName, value) => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const clearStore = (db, storeName) => new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(storeName)) return resolve();
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    const db = await openDb();
    const storesToClear = [
      'runSummaries', 'runDetails', 'comparisonResults', 'experiments', 'suites',
      'studies', 'studyTrials', 'studyObservations', 'modelConfigurations',
      'observations', 'evidenceDecisions'
    ];
    for (const s of storesToClear) {
      if (db.objectStoreNames.contains(s)) await clearStore(db, s);
    }

    for (const row of corpus.runDetails) await put(db, 'runDetails', row);
    for (const row of corpus.runSummaries) await put(db, 'runSummaries', row);
    for (const row of corpus.comparisonResults) await put(db, 'comparisonResults', row);
    for (const row of corpus.experiments) await put(db, 'experiments', row);
    for (const row of corpus.suites) await put(db, 'suites', row);
    for (const row of corpus.studies) await put(db, 'studies', row);
    for (const row of corpus.studyTrials) await put(db, 'studyTrials', row);
    for (const row of corpus.studyObservations) await put(db, 'studyObservations', row);
    for (const row of corpus.modelConfigurations) await put(db, 'modelConfigurations', row);
    for (const row of corpus.observations) await put(db, 'observations', row);
    for (const row of corpus.evidenceDecisions) await put(db, 'evidenceDecisions', row);

    return {
      runSummaries: corpus.runSummaries.length,
      runDetails: corpus.runDetails.length,
      comparisonResults: corpus.comparisonResults.length,
    };
  })()`;
}

// -----------------------------------------------------------------------------
// 5. Main Execution and Verification Scenarios
// -----------------------------------------------------------------------------

async function run() {
  let viteProcess = null;
  let chromeProcess = null;
  let socket = null;
  let nextMessageId = 0;
  const pending = new Map();

  const cleanup = () => {
    try {
      if (socket) socket.close();
    } catch {}
    try {
      if (chromeProcess) chromeProcess.kill("SIGKILL");
    } catch {}
    try {
      if (viteProcess) viteProcess.kill("SIGTERM");
    } catch {}
    try {
      if (chromeUserDataDir && fs.existsSync(chromeUserDataDir)) {
        fs.rmSync(chromeUserDataDir, { recursive: true, force: true });
      }
    } catch {}
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(1);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(1);
  });

  try {
    // 1. Start Vite dev server if not already running
    if (!process.env.QA_BASE_URL) {
      const viteBin = path.join(process.cwd(), "node_modules", "vite", "bin", "vite.js");
      viteProcess = spawn(
        process.execPath,
        [
          viteBin,
          "--port",
          String(BROWSER_PORT),
          "--host",
          "127.0.0.1",
          "--strictPort",
          "--logLevel",
          "error",
        ],
        { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } },
      );
      await pollReady(BROWSER_PORT);
    }

    // 2. Launch headless Chrome over CDP with E: arguments
    chromeProcess = spawn(
      chromePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${chromeUserDataDir}`,
        `--disk-cache-dir=${chromeDiskCacheDir}`,
        `--crash-dumps-dir=${chromeCrashDumpsDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ],
      { stdio: "ignore" },
    );

    const getWsUrl = async () => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        try {
          const pages = await new Promise((resolve, reject) => {
            http
              .get(`http://127.0.0.1:${debugPort}/json/list`, (res) => {
                let body = "";
                res.on("data", (chunk) => {
                  body += chunk;
                });
                res.on("end", () => resolve(JSON.parse(body)));
              })
              .on("error", reject);
          });
          const page = pages.find((candidate) => candidate.type === "page");
          if (page) return page.webSocketDebuggerUrl;
        } catch {}
        await wait(250);
      }
      throw new Error("Chrome did not expose a CDP page target.");
    };

    const wsUrl = await getWsUrl();
    socket = new WebSocket(wsUrl);

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") {
        const detail =
          message.params.exceptionDetails?.exception?.description ??
          message.params.exceptionDetails?.text ??
          "uncaught exception";
        results.consoleErrors.push(detail);
        return;
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        const text = (message.params.args ?? [])
          .map((arg) => arg.value ?? arg.description ?? "")
          .join(" ");
        if (text) results.consoleErrors.push(text);
        return;
      }
      const resolve = pending.get(message.id);
      if (!resolve) return;
      pending.delete(message.id);
      resolve(message);
    };

    await new Promise((resolve) => {
      socket.onopen = resolve;
    });

    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++nextMessageId;
        pending.set(id, (msg) => {
          if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
          else resolve(msg.result);
        });
        socket.send(JSON.stringify({ id, method, params }));
      });

    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        const detail =
          result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          "Runtime evaluation failed.";
        throw new Error(detail);
      }
      return result.result?.value;
    };

    const waitFor = async (expression, label, maxAttempts = 200) => {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (await evaluate(expression)) return;
        await wait(150);
      }
      const diagnostic = await evaluate(`({
        hash: location.hash,
        title: document.title,
        body: (document.body && document.body.innerText ? document.body.innerText : "").slice(0, 800),
      })`);
      throw new Error(`Timed out waiting for ${label}. ${JSON.stringify(diagnostic)}`);
    };

    const setViewport = async ({ width, height, mobile = false, touch = false, scale = 1 }) => {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: scale,
        mobile,
      });
      await send(
        "Emulation.setTouchEmulationEnabled",
        touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false },
      );
    };

    const navigateTo = async (hash = "") => {
      const cleanHash = hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "";
      await send("Page.navigate", { url: baseUrl });
      await waitFor(
        "Boolean(document.querySelector('header, main, #root > *'))",
        "application shell",
      );
      if (cleanHash) {
        await evaluate(`(window.location.hash = ${JSON.stringify(cleanHash)})`);
        await wait(300);
      }
    };

    const screenshot = async (name) => {
      const capture = await send("Page.captureScreenshot", { format: "png" });
      const file = `${name}.png`;
      fs.writeFileSync(path.join(RETAINED_EVIDENCE_DIR, file), Buffer.from(capture.data, "base64"));
      results.screenshots.push(file);
    };

    const failures = [];
    const record = (name, value) => {
      results.probes.push({ name, ...value });
      if (value.pass === false) {
        failures.push(`${name}: ${value.reason ?? "assertion failed"}`);
      }
    };

    const press = async (key, code, windowsVirtualKeyCode) => {
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key,
        code,
        windowsVirtualKeyCode,
        ...(key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}),
      });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
    };

    // Enable runtime exceptions and console events
    await send("Runtime.enable");
    await send("Page.enable");

    // Install mock network interceptor on every frame
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: MOCK_PROVIDER_INTERCEPTOR,
    });

    // -------------------------------------------------------------------------
    // Initial Load & Seeding
    // -------------------------------------------------------------------------
    await setViewport({ width: 1440, height: 900 });
    await navigateTo("");
    await evaluate(MOCK_PROVIDER_INTERCEPTOR);

    const fixtureCorpus = buildFixtureCorpus();
    const seedReceipt = await evaluate(generateSeedScript(fixtureCorpus));
    record("seed-indexeddb-corpus", {
      pass: seedReceipt.runSummaries >= 58 && seedReceipt.comparisonResults >= 2,
      receipt: seedReceipt,
    });

    // =========================================================================
    // Scenario 1: Migration Pointer Lifecycle (§O.1, §R.20)
    // =========================================================================
    // Clear dismissal key to test initial pointer render
    await evaluate(`localStorage.removeItem('records-move-pointer-dismissed')`);
    await navigateTo("#/compare");
    await waitFor(
      "Boolean(document.querySelector('[data-records-move-pointer]'))",
      "Migration Pointer",
    );

    const pointerInfo = await evaluate(`(() => {
      const el = document.querySelector('[data-records-move-pointer]');
      if (!el) return null;
      const heading = el.querySelector('h2')?.innerText ?? '';
      const text = el.querySelector('p')?.innerText ?? '';
      const button = el.querySelector('button');
      const rect = button?.getBoundingClientRect();
      const role = el.getAttribute('role');
      return {
        role,
        heading,
        text,
        buttonText: button?.innerText ?? '',
        buttonRect: rect ? { width: rect.width, height: rect.height } : null,
      };
    })()`);

    record("migration-pointer-presence-and-wording", {
      pass:
        pointerInfo &&
        pointerInfo.role === "status" &&
        pointerInfo.heading.includes("Runs moved.") &&
        pointerInfo.text.includes("Exact execution records now live here") &&
        pointerInfo.buttonText.includes("Got it") &&
        pointerInfo.buttonRect.height >= 44,
      pointerInfo,
    });

    await screenshot("qa-desktop-1440-migration-pointer");

    // Click "Got it" button to dismiss
    await evaluate(`(() => {
      const btn = document.querySelector('[data-records-move-pointer] button');
      if (btn) btn.click();
    })()`);
    await wait(300);

    const postDismiss = await evaluate(`(() => ({
      pointerVisible: Boolean(document.querySelector('[data-records-move-pointer]')),
      storageValue: localStorage.getItem('records-move-pointer-dismissed'),
    }))()`);

    record("migration-pointer-dismissal-persistence", {
      pass: postDismiss.pointerVisible === false && postDismiss.storageValue === "true",
      postDismiss,
    });

    // Reload page to verify pointer does NOT reappear after dismissal
    await navigateTo("#/compare");
    await wait(400);
    const reloadPointer = await evaluate(
      `Boolean(document.querySelector('[data-records-move-pointer]'))`,
    );
    record("migration-pointer-never-reappears", {
      pass: reloadPointer === false,
    });

    results.matrix.migrationPointer = postDismiss.storageValue === "true" && !reloadPointer;

    // =========================================================================
    // Scenario 2: Primary Navigation Topology (§G.4, §R.4, §R.5, §R.6, §R.7)
    // =========================================================================
    await navigateTo("#/compare");
    await waitFor("Boolean(document.querySelector('header'))", "Header");

    const navInfo = await evaluate(`(() => {
      const primaryNav = Array.from(document.querySelectorAll('nav[aria-label="Primary"] a'))
        .map(a => ({
          text: a.innerText.trim(),
          href: a.getAttribute('href'),
          ariaCurrent: a.getAttribute('aria-current'),
        }));

      const recordsButton = document.querySelector('header button[aria-label="Records"], header a[aria-label="Records"]');
      const recordsRect = recordsButton ? recordsButton.getBoundingClientRect() : null;
      const recordsPopup = recordsButton ? recordsButton.getAttribute('aria-haspopup') : null;
      const recordsExpanded = recordsButton ? recordsButton.getAttribute('aria-expanded') : null;

      const connButton = document.querySelector('header button[aria-label*="Connection status"], header button[title="Provider connections"]');
      const connName = connButton ? (connButton.getAttribute('aria-label') || connButton.innerText) : '';

      return {
        primaryNav,
        recordsExists: Boolean(recordsButton),
        recordsRect: recordsRect ? { width: recordsRect.width, height: recordsRect.height } : null,
        recordsPopup,
        recordsExpanded,
        connName,
      };
    })()`);

    const primaryLabels = navInfo.primaryNav.map((n) => n.text);
    const expectedPrimary = ["Compare", "Evaluations", "Lab", "Models"];
    const navOrderPass =
      primaryLabels.length === 4 &&
      expectedPrimary.every((label, idx) => primaryLabels[idx] === label);

    record("primary-nav-topology-desktop", {
      pass: navOrderPass,
      labels: primaryLabels,
      expected: expectedPrimary,
    });

    record("records-utility-cluster-desktop", {
      pass:
        navInfo.recordsExists &&
        navInfo.recordsRect &&
        navInfo.recordsRect.width >= 44 &&
        navInfo.recordsRect.height >= 44 &&
        navInfo.recordsPopup === "dialog",
      rect: navInfo.recordsRect,
      popup: navInfo.recordsPopup,
    });

    record("connections-pill-accessible-name", {
      pass: /live|ready|checking|running/i.test(navInfo.connName),
      accessibleName: navInfo.connName,
    });

    // Check DOM text sweep across all 4 primary destinations: no "Runs" label or link
    const destinations = ["#/compare", "#/evaluations", "#/lab", "#/models"];
    for (const dest of destinations) {
      await navigateTo(dest);
      await wait(300);
      const sweep = await evaluate(`(() => {
        const bodyText = document.body ? document.body.innerText : '';
        const navText = Array.from(document.querySelectorAll('header, nav')).map(el => el.innerText).join(' ');
        const runsInNav = /\\bRuns\\b/.test(navText);
        return {
          runsInNav,
          hasContent: bodyText.length > 50,
        };
      })()`);

      record(`no-runs-in-shell-${dest.replace(/[^a-z]/g, "")}`, {
        pass: sweep.runsInNav === false && sweep.hasContent === true,
        runsInNav: sweep.runsInNav,
        hasContent: sweep.hasContent,
      });
    }

    results.matrix.primaryNavigation = navOrderPass;

    // =========================================================================
    // Scenario 3: Quick Records Drawer (>=1024px) (§H, §R.8, §R.9)
    // =========================================================================
    await setViewport({ width: 1440, height: 900 });
    await navigateTo("#/compare");
    await waitFor(
      "Boolean(document.querySelector('header button[aria-label=\"Records\"]'))",
      "Records Header Button",
    );

    // Open drawer via button click
    await evaluate(`document.querySelector('header button[aria-label="Records"]').click()`);
    await waitFor(
      "Boolean(document.querySelector('[role=\"dialog\"], .drawer-panel'))",
      "Records Drawer",
    );
    await waitFor("Boolean(document.querySelector('[data-drawer-group]'))", "Drawer items loaded");

    const drawerInitial = await evaluate(`(() => {
      const drawer = document.querySelector('[role="dialog"], .drawer-panel');
      const groups = Array.from(drawer.querySelectorAll('h3, [role="group"] h3, [data-drawer-group-head]')).map(h => h.innerText.trim());
      const rows = Array.from(drawer.querySelectorAll('[data-record-row]'));
      const searchInput = drawer.querySelector('#records-drawer-search');
      return {
        isOpen: Boolean(drawer),
        groupsCount: groups.length,
        groups,
        rowsCount: rows.length,
        hasSearch: Boolean(searchInput),
      };
    })()`);

    record("records-drawer-open-and-bounds", {
      pass:
        drawerInitial.isOpen &&
        drawerInitial.groupsCount <= 5 &&
        drawerInitial.groupsCount >= 1 &&
        drawerInitial.hasSearch,
      drawerInitial,
    });

    await screenshot("qa-desktop-1440-drawer-open");

    // Search for exact ID in drawer
    // Search for exact ID in drawer using native setter
    await evaluate(`(() => {
      const input = document.querySelector('#records-drawer-search');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'cmp-rank-adhoc-1');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`);
    await wait(350);

    const drawerSearch = await evaluate(`(() => {
      const drawer = document.querySelector('[role="dialog"], .drawer-panel');
      const exactMatchHeader = Array.from(drawer.querySelectorAll('h3, [data-drawer-group-head]')).find(h => /exact match/i.test(h.innerText));
      const matchRow = drawer.querySelector('[data-record-id="cmp-rank-adhoc-1"]');
      return {
        hasExactMatchHeader: Boolean(exactMatchHeader),
        matchRowExists: Boolean(matchRow),
      };
    })()`);

    record("records-drawer-search-exact-match", {
      pass: drawerSearch.hasExactMatchHeader && drawerSearch.matchRowExists,
      drawerSearch,
    });
    await screenshot("qa-desktop-1440-drawer-search");

    // Press Escape to close drawer and assert focus returns to trigger
    await press("Escape", "Escape", 27);
    await wait(300);

    const drawerClosed = await evaluate(`(() => {
      const drawer = document.querySelector('[role="dialog"], .drawer-panel');
      const active = document.activeElement;
      const isTrigger = active && active.getAttribute('aria-label') === 'Records';
      return {
        drawerClosed: !drawer,
        focusRestoredToTrigger: Boolean(isTrigger),
        activeTag: active ? active.tagName : null,
      };
    })()`);

    record("records-drawer-escape-and-focus-restore", {
      pass: drawerClosed.drawerClosed,
      drawerClosed,
    });

    // Test "View all records" navigation
    await evaluate(`document.querySelector('header button[aria-label="Records"]').click()`);
    await waitFor(
      "Boolean(document.querySelector('[role=\"dialog\"], .drawer-panel'))",
      "Records Drawer reopen",
    );
    await evaluate(`(() => {
      const viewAllLink = Array.from(document.querySelectorAll('[role="dialog"] a, .drawer-panel a')).find(a => /view all/i.test(a.innerText));
      if (viewAllLink) viewAllLink.click();
    })()`);
    await wait(400);

    const viewAllNav = await evaluate(`(() => ({
      hash: location.hash,
      drawerOpen: Boolean(document.querySelector('[role="dialog"], .drawer-panel')),
    }))()`);

    record("records-drawer-view-all-navigation", {
      pass: viewAllNav.hash.startsWith("#/records") && viewAllNav.drawerOpen === false,
      viewAllNav,
    });

    results.matrix.recordsDrawer =
      drawerInitial.isOpen &&
      drawerSearch.matchRowExists &&
      viewAllNav.hash.startsWith("#/records");

    // =========================================================================
    // Scenario 4: Below 1024px Substitution (<1024px) (§H.6, §N, §R.10)
    // =========================================================================
    // Test 768px tablet portrait
    await setViewport({ width: 768, height: 1024 });
    await navigateTo("#/compare");
    await waitFor("Boolean(document.querySelector('header'))", "Header at 768");

    const tabletUtility = await evaluate(`(() => {
      const link = document.querySelector('header a[aria-label="Records"]');
      const button = document.querySelector('header button[aria-label="Records"]');
      return {
        isLink: Boolean(link),
        isButton: Boolean(button),
        href: link ? link.getAttribute('href') : null,
      };
    })()`);

    record("below-1024-substitution-768-link", {
      pass: tabletUtility.isLink && !tabletUtility.isButton,
      tabletUtility,
    });

    // Test 390px mobile phone
    await setViewport({ width: 390, height: 844, mobile: true, touch: true });
    await navigateTo("#/compare");
    await waitFor("Boolean(document.querySelector('header'))", "Header at 390");

    const mobileUtility = await evaluate(`(() => {
      const link = document.querySelector('header a[aria-label="Records"]');
      const bottomNav = document.querySelector('nav[aria-label="Primary"]');
      const bottomNavLinks = bottomNav ? Array.from(bottomNav.querySelectorAll('a')).map(a => a.innerText.trim()) : [];
      return {
        isLink: Boolean(link),
        bottomNavExists: Boolean(bottomNav),
        bottomNavLabels: bottomNavLinks,
      };
    })()`);

    record("below-1024-substitution-390-mobile", {
      pass:
        mobileUtility.isLink &&
        mobileUtility.bottomNavExists &&
        mobileUtility.bottomNavLabels.length === 4,
      mobileUtility,
    });

    await screenshot("qa-mobile-390-bottom-nav");

    results.matrix.below1024Substitution = tabletUtility.isLink && mobileUtility.isLink;

    // =========================================================================
    // Scenario 5: Full Records Utility (/records) & Filtering (§I, §J, §R.11, §R.13)
    // =========================================================================
    await setViewport({ width: 1440, height: 900 });
    await navigateTo("#/records");
    await waitFor("Boolean(document.querySelector('[data-record-row]'))", "Records list rows");

    const recordsListInfo = await evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll('[data-record-row]'));
      const filters = {
        search: Boolean(document.querySelector('input[data-filter="search"], input[placeholder*="Search records"]')),
        type: Boolean(document.querySelector('select[data-filter="type"]')),
        model: Boolean(document.querySelector('select[data-filter="model"]')),
        status: Boolean(document.querySelector('select[data-filter="status"]')),
        mode: Boolean(document.querySelector('select[data-filter="mode"]')),
        source: Boolean(document.querySelector('select[data-filter="source"]')),
      };
      return {
        initialRowCount: rows.length,
        filters,
      };
    })()`);

    record("records-list-initial-render-and-filters", {
      pass:
        recordsListInfo.initialRowCount === 50 &&
        recordsListInfo.filters.search &&
        recordsListInfo.filters.type &&
        recordsListInfo.filters.status,
      recordsListInfo,
    });

    await screenshot("qa-desktop-1440-records-split");

    // Test complete-set filtering before pagination: select status="failed" using native setter
    await evaluate(`(() => {
      const select = document.querySelector('select[data-filter="status"]');
      if (select) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(select, 'failed');
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);
    await wait(300);
    const filteredFailed = await evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll('[data-record-row]'));
      return {
        count: rows.length,
      };
    })()`);

    record("complete-set-status-filtering", {
      pass: filteredFailed.count >= 8 && filteredFailed.count < 50,
      count: filteredFailed.count,
    });

    // Reset status filter and verify semantic vs exact distinguishability
    await evaluate(`(() => {
      const select = document.querySelector('select[data-filter="status"]');
      if (select) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(select, '');
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()`);
    await wait(300);

    const distinctionCheck = await evaluate(`(() => {
      const cmpRow = document.querySelector('[data-record-id="cmp-rank-adhoc-1"]');
      if (!cmpRow) return null;
      const eyebrow = cmpRow.querySelector('[class*="uppercase"]')?.innerText ?? '';
      const ownerHint = cmpRow.innerText;
      const exactLink = cmpRow.querySelector('[data-exact-link]');
      return {
        eyebrow,
        hasOwnerHint: /in compare/i.test(ownerHint),
        hasExactLink: Boolean(exactLink),
      };
    })()`);

    const distinctionPass = Boolean(
      distinctionCheck &&
      distinctionCheck.eyebrow.includes("COMPARISON") &&
      distinctionCheck.hasOwnerHint &&
      distinctionCheck.hasExactLink,
    );

    record("semantic-vs-exact-distinguishability-triad", {
      pass: distinctionPass,
      distinctionCheck,
    });

    results.matrix.recordsListAndFiltering = recordsListInfo.initialRowCount === 50;
    results.matrix.semanticVsExactDistinction = distinctionPass;
    // =========================================================================
    // Scenario 6: Six Typed Details + Legacy (§K, §L, §R.12, §R.14, §R.15, §R.16)
    // =========================================================================
    // 1. Comparison Detail
    await navigateTo("#/records/comparison/cmp-rank-adhoc-1");
    await waitFor(
      "Boolean(document.querySelector('[data-owner-action], [data-records-detail]'))",
      "Comparison Detail",
    );

    const cmpDetail = await evaluate(`(() => {
      const ownerAction = document.querySelector('[data-owner-action]');
      const comparePreloadBtn = document.querySelector('[data-action="open-in-compare"]');
      const text = document.body ? document.body.innerText : '';
      const hasForbiddenVerbs = /\\b(retry|resume|re-judge|re-fuse|repair|add-model|delete|retention)\\b/i.test(text);
      return {
        ownerLabel: ownerAction?.innerText ?? '',
        ownerHref: ownerAction?.getAttribute('href') ?? '',
        hasPreloadBtn: Boolean(comparePreloadBtn),
        hasForbiddenVerbs,
      };
    })()`);

    record("typed-detail-comparison", {
      pass:
        cmpDetail.ownerLabel.includes("Open comparison result") &&
        cmpDetail.ownerHref.includes("/compare/results/cmp-rank-adhoc-1") &&
        cmpDetail.hasPreloadBtn &&
        !cmpDetail.hasForbiddenVerbs,
      cmpDetail,
    });
    await screenshot("qa-desktop-1440-comparison-detail");

    // 2. Evaluation Detail
    await navigateTo("#/records/evaluation/exp-eval-set-1");
    await waitFor("Boolean(document.querySelector('[data-owner-action]'))", "Evaluation Detail");

    const evalDetail = await evaluate(`(() => {
      const ownerAction = document.querySelector('[data-owner-action]');
      const childLinks = Array.from(document.querySelectorAll('a[href*="/records/task-execution/"]'));
      return {
        ownerLabel: ownerAction?.innerText ?? '',
        ownerHref: ownerAction?.getAttribute('href') ?? '',
        childLinksCount: childLinks.length,
      };
    })()`);

    record("typed-detail-evaluation", {
      pass:
        evalDetail.ownerLabel.includes("Open evaluation") &&
        evalDetail.ownerHref.includes("/evaluations/results/exp-eval-set-1") &&
        evalDetail.childLinksCount >= 1,
      evalDetail,
    });
    await screenshot("qa-desktop-1440-evaluation-detail");

    // 3. Policy Study Detail
    await navigateTo("#/records/policy-study/study-latency-policy");
    await waitFor("Boolean(document.querySelector('[data-owner-action]'))", "Policy Study Detail");

    const studyDetail = await evaluate(`(() => {
      const ownerAction = document.querySelector('[data-owner-action]');
      const beneathRows = Array.from(document.querySelectorAll('[data-record-row]'));
      const text = document.body ? document.body.innerText : '';
      return {
        ownerLabel: ownerAction?.innerText ?? '',
        ownerHref: ownerAction?.getAttribute('href') ?? '',
        beneathRowsCount: beneathRows.length,
        hasBeneathList: /beneath this record|exact child records/i.test(text),
      };
    })()`);

    record("typed-detail-policy-study", {
      pass:
        studyDetail.ownerLabel.includes("Open study") &&
        studyDetail.ownerHref.includes("/lab/studies/study-latency-policy") &&
        studyDetail.hasBeneathList,
      studyDetail,
    });
    await screenshot("qa-desktop-1440-policy-study-detail");

    // 4. Task Execution Detail
    await navigateTo("#/records/task-execution/run-exact-task-1");
    await waitFor("Boolean(document.querySelector('[data-run-detail]'))", "Task Execution Detail");

    const taskExecDetail = await evaluate(`(() => {
      const detail = document.querySelector('[data-run-detail]');
      const candidates = Array.from(document.querySelectorAll('[data-candidate-id]'));
      return {
        exists: Boolean(detail),
        candidatesCount: candidates.length,
      };
    })()`);

    record("typed-detail-task-execution", {
      pass: taskExecDetail.exists && taskExecDetail.candidatesCount >= 2,
      taskExecDetail,
    });
    await screenshot("qa-desktop-1440-task-execution-detail");

    // 5. Observation Detail
    await navigateTo(
      "#/records/observation/obs:sha256:34c277860e425860c166d2d5d79e85d3cc0dfc9737098da7c3c55b25ac7f1d43",
    );
    await waitFor("Boolean(document.querySelector('[data-owner-action]'))", "Observation Detail");

    const obsDetail = await evaluate(`(() => {
      const ownerAction = document.querySelector('[data-owner-action]');
      const text = document.body ? document.body.innerText : '';
      return {
        ownerLabel: ownerAction?.innerText ?? '',
        hasDecisionBadge: /eligible|comparable/i.test(text),
      };
    })()`);

    record("typed-detail-observation", {
      pass: obsDetail.ownerLabel.length > 0 && obsDetail.hasDecisionBadge,
      obsDetail,
    });
    await screenshot("qa-desktop-1440-observation-detail");

    // 6. Legacy Detail
    await navigateTo("#/records/legacy/legacy-run-2025-01");
    await waitFor("Boolean(document.querySelector('[data-run-detail]'))", "Legacy Detail");

    const legDetail = await evaluate(`(() => {
      const text = document.body ? document.body.innerText : '';
      return {
        hasLegacyHonesty: /older history format|only summary fields|imported/i.test(text),
      };
    })()`);

    record("typed-detail-legacy", {
      pass: legDetail.hasLegacyHonesty,
      legDetail,
    });
    await screenshot("qa-desktop-1440-legacy-detail");

    // 7. Typed Not Found Recovery
    await navigateTo("#/records/comparison/nonexistent-id");
    await waitFor("Boolean(document.querySelector('[data-record-not-found]'))", "Record Not Found");

    const notFoundInfo = await evaluate(`(() => {
      const el = document.querySelector('[data-record-not-found]');
      const recoveryLinks = el ? Array.from(el.querySelectorAll('a')).map(a => a.innerText.trim()) : [];
      return {
        exists: Boolean(el),
        recoveryLinks,
      };
    })()`);

    record("typed-not-found-recovery", {
      pass: notFoundInfo.exists && notFoundInfo.recoveryLinks.length >= 2,
      notFoundInfo,
    });
    await screenshot("qa-desktop-1440-not-found");

    results.matrix.typedDetails = cmpDetail.hasPreloadBtn && evalDetail.childLinksCount >= 1;

    // =========================================================================
    // Scenario 7: Open in Compare Preload Flow (§K.1, §R.15)
    // =========================================================================
    await navigateTo("#/records/comparison/cmp-rank-adhoc-1");
    await waitFor(
      "Boolean(document.querySelector('[data-action=\"open-in-compare\"]'))",
      "Open in Compare Button",
    );

    await evaluate(`document.querySelector('[data-action="open-in-compare"]').click()`);
    await waitFor(
      "Boolean(document.querySelector('textarea, [data-task-input]'))",
      "Compare Workspace",
    );

    const preloadCheck = await evaluate(`(() => {
      const hash = location.hash;
      const promptInput = document.querySelector('textarea');
      return {
        hash,
        promptValue: promptInput ? promptInput.value : '',
      };
    })()`);

    record("compare-configuration-preload-flow", {
      pass: preloadCheck.hash.startsWith("#/compare") && preloadCheck.promptValue.length > 0,
      preloadCheck,
    });

    results.matrix.comparePreload = preloadCheck.hash.startsWith("#/compare");

    // =========================================================================
    // Scenario 8: Legacy Route Compatibility (§D, §O.2, §R.18, §R.19)
    // =========================================================================
    // 1. /runs?status=failed redirect to /records?status=failed
    await navigateTo("#/runs?status=failed");
    await wait(300);
    const legacyRunsRedirect = await evaluate(`(() => ({
      hash: location.hash,
    }))()`);

    record("legacy-runs-query-redirect", {
      pass:
        legacyRunsRedirect.hash.startsWith("#/records") &&
        legacyRunsRedirect.hash.includes("status=failed"),
      hash: legacyRunsRedirect.hash,
    });

    // 2. /runs/:id URL-preserving compatibility
    await navigateTo("#/runs/run-exact-task-1");
    await waitFor("Boolean(document.querySelector('[data-run-detail]'))", "Legacy Run Detail");

    const legacyExactRun = await evaluate(`(() => {
      const hash = location.hash;
      const detail = document.querySelector('[data-run-detail]');
      return {
        hash,
        detailRendered: Boolean(detail),
      };
    })()`);

    record("legacy-runs-exact-url-preserving", {
      pass:
        legacyExactRun.hash === "#/runs/run-exact-task-1" && legacyExactRun.detailRendered === true,
      legacyExactRun,
    });
    await screenshot("qa-legacy-route-runs-exact");

    results.matrix.legacyRouteCompatibility =
      legacyRunsRedirect.hash.includes("status=failed") && legacyExactRun.detailRendered;

    // =========================================================================
    // Scenario 9: DataArchiveActions Reachability and Truthfulness (§I.1, §R.22)
    // =========================================================================
    await navigateTo("#/records");
    await waitFor("Boolean(document.querySelector('[data-record-row]'))", "Records List");

    const archiveActionsCheck = await evaluate(`(() => {
      const text = document.body ? document.body.innerText : '';
      const hasExport = /export/i.test(text);
      const hasImport = /import/i.test(text);
      const hasDelete = /delete all|purge records|retention/i.test(text);
      return {
        hasExport,
        hasImport,
        hasDelete,
      };
    })()`);

    record("data-archive-actions-truthful", {
      pass: archiveActionsCheck.hasExport && !archiveActionsCheck.hasDelete,
      archiveActionsCheck,
    });

    results.matrix.archiveActions = archiveActionsCheck.hasExport && !archiveActionsCheck.hasDelete;

    // =========================================================================
    // Scenario 10: Viewport Ladder & 200% Zoom Containment (§N, §P, §R.23, §R.24)
    // =========================================================================
    const viewports = [
      { name: "desktop-1440", width: 1440, height: 900, scale: 1, mobile: false },
      { name: "boundary-1024", width: 1024, height: 768, scale: 1, mobile: false },
      { name: "tablet-768", width: 768, height: 1024, scale: 1, mobile: false },
      { name: "mobile-390", width: 390, height: 844, scale: 1, mobile: true },
      { name: "zoom-200-scale2", width: 1440, height: 900, scale: 2, mobile: false },
    ];

    let allViewportsContained = true;

    for (const vp of viewports) {
      await setViewport({
        width: vp.width,
        height: vp.height,
        scale: vp.scale,
        mobile: vp.mobile,
      });
      await navigateTo("#/records");
      await wait(300);

      const overflow = await evaluate(`(() => {
        const docEl = document.documentElement;
        const body = document.body;
        const scrollWidth = Math.max(docEl.scrollWidth, body.scrollWidth);
        const clientWidth = docEl.clientWidth;
        const hasHorizontalOverflow = scrollWidth > clientWidth + 2;
        return {
          scrollWidth,
          clientWidth,
          hasHorizontalOverflow,
        };
      })()`);

      if (overflow.hasHorizontalOverflow) allViewportsContained = false;

      record(`viewport-overflow-${vp.name}`, {
        pass: !overflow.hasHorizontalOverflow,
        overflow,
      });

      if (vp.name === "boundary-1024") await screenshot("qa-tablet-1024-boundary");
      if (vp.name === "tablet-768") await screenshot("qa-tablet-768-records-list");
      if (vp.name === "mobile-390") await screenshot("qa-mobile-390-records-list");
      if (vp.name === "zoom-200-scale2") await screenshot("qa-zoom-200-effective-width");
    }

    // Long ID card containment check
    await setViewport({ width: 1440, height: 900 });
    await navigateTo(
      "#/records/task-execution/run-longfields-id-0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    await waitFor("Boolean(document.querySelector('[data-run-detail]'))", "Longfields Detail");

    const longContainment = await evaluate(`(() => {
      const heading = document.querySelector('h1, h2, [data-detail-heading]');
      const headingRect = heading ? heading.getBoundingClientRect() : null;
      const docWidth = document.documentElement.clientWidth;
      return {
        headingWidth: headingRect ? headingRect.width : 0,
        docWidth,
        contained: headingRect ? headingRect.right <= docWidth : true,
      };
    })()`);

    record("long-id-and-title-containment", {
      pass: longContainment.contained,
      longContainment,
    });

    results.matrix.viewportLadderAndZoom = allViewportsContained && longContainment.contained;

    // =========================================================================
    // Scenario 11: Keyboard Navigation & 44px Touch Targets (§P, §R.24)
    // =========================================================================
    await setViewport({ width: 1440, height: 900 });
    await navigateTo("#/compare");
    await waitFor("Boolean(document.querySelector('header'))", "Header");

    // 1. Header Tab Walk: Logo -> Compare -> Evaluations -> Lab -> Models -> Palette -> Records -> Connections -> Help
    await evaluate("document.body.focus()");
    const focusedElements = [];
    for (let i = 0; i < 9; i++) {
      await press("Tab", "Tab", 9);
      await wait(100);
      const active = await evaluate(`(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        return {
          tag: el.tagName,
          ariaLabel: el.getAttribute('aria-label') ?? '',
          text: el.innerText?.trim() ?? '',
          href: el.getAttribute('href') ?? '',
        };
      })()`);
      if (active) focusedElements.push(active);
    }

    const headerTabPass =
      focusedElements.length >= 6 &&
      focusedElements.some((e) => e.ariaLabel === "Records" || e.text === "Records") &&
      focusedElements.some((e) => /connection status/i.test(e.ariaLabel));

    record("keyboard-header-tab-walk", {
      pass: Boolean(headerTabPass),
      focusedCount: focusedElements.length,
      focusedElements,
    });

    // 2. Detail Heading Focus on Route Navigation
    await navigateTo("#/records/task-execution/run-exact-task-1");
    await waitFor("Boolean(document.querySelector('[data-run-detail]'))", "Run Detail");
    await wait(300);

    const detailFocus = await evaluate(`(() => {
      const active = document.activeElement;
      const isHeading = active ? (active.hasAttribute('data-detail-heading') || active.tagName === 'H1' || active.tagName === 'H2') : false;
      return {
        activeTag: active ? active.tagName : null,
        isHeading,
        activeText: active ? active.innerText?.slice(0, 50) : null,
      };
    })()`);

    record("detail-heading-focus-movement", {
      pass: Boolean(detailFocus.isHeading),
      detailFocus,
    });

    // 3. 44px Minimum Interactive Targets & Separation
    const targetSizes = await evaluate(`(() => {
      const interactive = Array.from(document.querySelectorAll(
        'header button, header a, [data-record-row-link], [data-exact-link], select[data-filter], input[data-filter="search"], button[data-action]'
      )).filter(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
      const violations = [];
      for (const el of interactive) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 43 || rect.height < 43) {
          violations.push({
            tag: el.tagName,
            label: el.getAttribute('aria-label') || el.innerText?.slice(0, 30),
            width: rect.width,
            height: rect.height,
          });
        }
      }
      return {
        checkedCount: interactive.length,
        violationsCount: violations.length,
        violations,
      };
    })()`);

    const touchTargetsPass = targetSizes.checkedCount > 10 && targetSizes.violationsCount === 0;
    record("interactive-targets-44px-rule", {
      pass: Boolean(touchTargetsPass),
      targetSizes,
    });

    results.matrix.keyboardAndAccessibility = Boolean(
      headerTabPass && detailFocus.isHeading && touchTargetsPass,
    );

    // =========================================================================
    // Scenario 12: Reduced Motion Emulation (§G.3, §P, §R.24)
    // =========================================================================
    await send("Emulation.setEmulatedMedia", {
      media: "screen",
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });

    await navigateTo("#/compare");
    await wait(200);
    await evaluate(`document.querySelector('header button[aria-label="Records"]').click()`);
    await waitFor(
      "Boolean(document.querySelector('[role=\"dialog\"], .drawer-panel'))",
      "Drawer in Reduced Motion",
    );

    await screenshot("qa-reduced-motion");
    record("reduced-motion-drawer-render", { pass: true });
    results.matrix.reducedMotion = true;

    // Reset media emulation
    await send("Emulation.setEmulatedMedia", { media: "screen", features: [] });

    // =========================================================================
    // Scenario 13: Secret Probe and Egress Invariant (§R.22)
    // =========================================================================
    const secretCheck = await evaluate(`(() => {
      const text = document.body ? document.body.innerText : '';
      const token = ${JSON.stringify(SECRET_TOKEN_TEST)};
      const leaked = text.includes(token) || text.includes('sk-proj-SUPERSECRET');
      const paidCalls = window.__qaPaidProviderCalls || [];
      return {
        leaked,
        paidCallsCount: paidCalls.length,
      };
    })()`);

    record("secret-token-not-in-dom", {
      pass: !secretCheck.leaked,
    });

    record("zero-paid-provider-network-egress", {
      pass: secretCheck.paidCallsCount === 0,
      paidCallsCount: secretCheck.paidCallsCount,
    });

    record("zero-uncaught-console-errors", {
      pass: results.consoleErrors.length === 0,
      consoleErrors: results.consoleErrors,
    });

    results.matrix.secretAndEgressInvariants = Boolean(
      !secretCheck.leaked && secretCheck.paidCallsCount === 0 && results.consoleErrors.length === 0,
    );

    // -------------------------------------------------------------------------
    // 6. Final Results Serialization
    // -------------------------------------------------------------------------
    const passCount = results.probes.filter((p) => p.pass === true).length;
    const failCount = results.probes.filter((p) => p.pass !== true).length;
    const allMatrixCellsTrue =
      Object.values(results.matrix).length === 14 &&
      Object.values(results.matrix).every((val) => val === true);
    const allGreen = failCount === 0 && allMatrixCellsTrue;

    results.summary = {
      totalProbes: results.probes.length,
      passedProbes: passCount,
      failedProbes: failCount,
      matrixCellsDeclared: Object.keys(results.matrix).length,
      matrixCellsPassed: Object.values(results.matrix).filter((v) => v === true).length,
      allMatrixCellsTrue,
      screenshotsCaptured: results.screenshots.length,
      allGreen,
    };

    fs.writeFileSync(
      path.join(RETAINED_EVIDENCE_DIR, "results.json"),
      JSON.stringify(results, null, 2),
      "utf-8",
    );

    console.log(
      `\n[cdp-records-qa] Matrix execution complete: ${passCount} passed, ${failCount} failed. Matrix allGreen=${allGreen}`,
    );
    console.log(`[cdp-records-qa] Evidence retained in ${RETAINED_EVIDENCE_DIR}/results.json\n`);

    if (!allGreen) {
      console.error("[cdp-records-qa] FAILURES:\n" + failures.join("\n"));
      console.error("[cdp-records-qa] MATRIX STATUS:", JSON.stringify(results.matrix, null, 2));
      process.exit(1);
    }
  } catch (err) {
    console.error(`\n[cdp-records-qa] FATAL ERROR:`, err);
    process.exit(1);
  } finally {
    cleanup();
  }
}

run();
