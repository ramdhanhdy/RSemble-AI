// =============================================================================
// cdp-runs-edge-qa.mjs — edge-state review for the Runs workspace.
//
// Task t_8cc78e90: test all row states, detail evidence types, deep-links,
// zero results, and no-run states.
//
// Drives Chrome headless over CDP against the running dev server. Deterministic
// fixtures only: run records are seeded directly into IndexedDB with the
// persisted shapes the app's validators accept. No provider calls.
//
// Probes:
//   A. Row states     — every RunStatus (running, completed, partial, failed,
//                       aborted, interrupted), legacy rows, selected-row
//                       treatment, winner/score summaries, source chips
//   B. Detail evidence — header/status/mode/timestamps, timeline lifecycle per
//                       status, outcome, cost breakdown (reported/estimated/
//                       unknown/none), candidate selector + selected output,
//                       judge evidence (accepted, historical, evaluations),
//                       fusion result, provenance (experiment), reused-output
//                       provenance, task/config disclosure
//   C. Deep links     — /runs/:id direct (desktop split + mobile route),
//                       ?candidate= focus, ?attempt= accepted/historical,
//                       invalid candidate/attempt notices, unknown run id,
//                       legacy deep link
//   D. Zero results   — empty DB (no-history), search no-match, filter no-match,
//                       clear-filters recovery
//   E. No-run state   — desktop placeholder, unknown-id not-found (desktop +
//                       mobile)
// Fails nonzero on the first unmet assertion. Never prints credentials.
// =============================================================================

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.QA_BASE_URL ?? process.argv[2] ?? "http://localhost:5173/";
const outDir = path.resolve("docs/qa/runs-edge");
const chromePath =
  process.env.CHROME_PATH ??
  "/opt/data/home/.chrome/chrome-headless-shell-linux64/chrome-headless-shell";
const debugPort = 9348;
const results = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  probes: [],
  screenshots: [],
  consoleErrors: [],
};

fs.mkdirSync(outDir, { recursive: true });

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${path.join(os.tmpdir(), `rsemble-runs-edge-${Date.now()}`)}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getPageWebSocketUrl() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const pages = await new Promise((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${debugPort}/json/list`, (response) => {
            let body = "";
            response.on("data", (chunk) => {
              body += chunk;
            });
            response.on("end", () => resolve(JSON.parse(body)));
          })
          .on("error", reject);
      });
      const page = pages.find((candidate) => candidate.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome can take a moment to expose its debugger endpoint.
    }
    await wait(250);
  }
  throw new Error("Chrome did not expose a CDP page target.");
}

const socket = new WebSocket(await getPageWebSocketUrl());
let nextMessageId = 0;
const pending = new Map();
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

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextMessageId;
    pending.set(id, (message) => {
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
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
}

async function waitFor(expression, label, maxAttempts = 100) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await evaluate(expression)) return;
    await wait(125);
  }
  const diagnostic = await evaluate(`({
    hash: location.hash,
    title: document.title,
    body: (document.body?.innerText ?? "").slice(0, 1000),
  })`);
  throw new Error(`Timed out waiting for ${label}. ${JSON.stringify(diagnostic)}`);
}

async function setViewport({ width, height, mobile = false }) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: mobile ? 2 : 1,
    mobile,
  });
  await send(
    "Emulation.setTouchEmulationEnabled",
    mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false },
  );
}

async function navigate(hash = "#/runs") {
  await send("Page.navigate", { url: `${baseUrl}${hash}` });
  await waitFor("Boolean(document.querySelector('#root > *'))", "application shell");
  await wait(500);
}

// Full document reload. Required after externally seeding/clearing IndexedDB:
// Page.navigate to the *same* hash is a no-op, so the app would keep its stale
// in-memory repository and never re-read the seeded rows.
async function reload() {
  await send("Page.reload", { ignoreCache: true });
  await waitFor("Boolean(document.querySelector('#root > *'))", "application shell");
  await wait(600);
}

async function screenshot(name) {
  const capture = await send("Page.captureScreenshot", { format: "png" });
  const file = `${name}.png`;
  fs.writeFileSync(path.join(outDir, file), Buffer.from(capture.data, "base64"));
  results.screenshots.push(file);
}

function record(name, value) {
  results.probes.push({ name, ...value });
  if (value.pass === false) throw new Error(`${name}: ${value.reason ?? "assertion failed"}`);
}

// --- In-page fixture seeding ---------------------------------------------------
// Mirrors the persisted shapes the app's runtime guards accept
// (isRunRecordV2 / isRunSummary / isLegacyRunSummary). Same approach as
// cdp-runs-responsive-qa.mjs. Covers every RunStatus plus legacy, fuse,
// experiment provenance, reused outputs, and multi-attempt judge evidence.

const SEED_SOURCE = `(async () => {
  const DB = "rsemble-evaluation";
  const openDb = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = (db, store, mode) => db.transaction(store, mode).objectStore(store);
  const put = (db, store, value) => new Promise((resolve, reject) => {
    const r = tx(db, store, "readwrite").put(value);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
  const clearStore = (db, store) => new Promise((resolve, reject) => {
    const r = tx(db, store, "readwrite").clear();
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });

  const db = await openDb();

  const SLOTS = [
    { id: "s1", providerId: "openrouter", model: "GLM 5.2", slug: "z-ai/glm-5.2" },
    { id: "s2", providerId: "openrouter", model: "DeepSeek V4 Flash", slug: "deepseek/deepseek-v4-flash" },
  ];
  const MK1 = "openrouter:z-ai/glm-5.2";
  const MK2 = "openrouter:deepseek/deepseek-v4-flash";

  function candidate(slot, accepted, opts = {}) {
    const key = slot.providerId + ":" + slot.slug;
    const attemptId = opts.attemptId ?? "att-" + slot.id;
    const attempts = accepted
      ? [{
          attemptId,
          messages: [],
          startedAt: opts.startedAt ?? 1700000000000,
          finishedAt: opts.finishedAt ?? 1700000001000,
          status: "completed",
          output: opts.output ?? "output-" + key,
          tokensIn: opts.tokensIn ?? 120,
          tokensOut: opts.tokensOut ?? 90,
          error: null,
          ...(opts.cost ? { cost: opts.cost } : {}),
          ...(opts.inputEstimate ? { inputEstimate: opts.inputEstimate } : {}),
          ...(opts.reusedFrom ? { reusedFrom: opts.reusedFrom } : {}),
        }]
      : [];
    return {
      candidateId: "cand-" + slot.id,
      slotId: slot.id,
      modelKey: key,
      providerId: slot.providerId,
      model: slot.model,
      slug: slot.slug,
      acceptedAttemptId: accepted ? attemptId : null,
      attempts,
    };
  }

  function failedCandidate(slot, attemptId) {
    return {
      candidateId: "cand-" + slot.id,
      slotId: slot.id,
      modelKey: slot.providerId + ":" + slot.slug,
      providerId: slot.providerId,
      model: slot.model,
      slug: slot.slug,
      acceptedAttemptId: null,
      attempts: [{
        attemptId,
        messages: [],
        startedAt: 1700000000000,
        finishedAt: null,
        status: "failed",
        output: null,
        tokensIn: null,
        tokensOut: null,
        error: { message: "simulated provider failure" },
      }],
    };
  }

  function judgeAttempt(attemptId, opts = {}) {
    return {
      attemptId,
      providerId: "openrouter",
      model: "Qwen 3.8 Max",
      instruction: opts.instruction ?? "Evaluate the candidates blind.",
      messages: [],
      blindLabelToCandidateId: opts.blindMap ?? { A: "cand-s1", B: "cand-s2" },
      candidateAttemptIdsByCandidateId: opts.candidateMap ?? { "cand-s1": "att-cand-s1", "cand-s2": "att-cand-s2" },
      startedAt: 1700000001000,
      finishedAt: opts.finishedAt ?? 1700000002000,
      status: opts.status ?? "completed",
      error: opts.error ?? null,
      report: opts.report ?? null,
      consensus: null,
      usage: { inputTokens: 500, outputTokens: 200, reasoningTokens: null, cacheReadTokens: null, cacheWriteTokens: null },
      inputEstimate: { totalTokens: 700, textTokens: 700, method: "provider-reported", partial: false },
      ...(opts.cost ? { cost: opts.cost } : { cost: { usd: 0.0004, source: "provider-reported" } }),
    };
  }

  function evaluation(cid, label, score) {
    return {
      candidateId: cid,
      blindLabel: label,
      overallScore: score,
      position: "p",
      rationale: "rationale-" + cid,
      strengths: ["strength-" + label],
      deductions: [],
      missedRequirements: [],
      criterionScores: [],
    };
  }

  function makeRun(runId, opts = {}) {
    const status = opts.status ?? "completed";
    const mode = opts.mode ?? "rank";
    const acceptedKeys = opts.acceptedKeys ?? [];
    const judgeDone = opts.judgeDone ?? (status !== "running" && status !== "aborted");
    const judgeStatus = opts.judgeStatus ?? (judgeDone ? "done" : status === "running" ? "running" : "idle");
    const candidates = SLOTS.map((slot) => {
      const key = slot.providerId + ":" + slot.slug;
      if (acceptedKeys.includes(key)) {
        const copts = (opts.candidateOpts ?? {})[key] ?? {};
        return candidate(slot, true, copts);
      }
      if ((opts.failedKeys ?? []).includes(key)) {
        return failedCandidate(slot, "att-fail-" + slot.id);
      }
      return candidate(slot, false);
    });
    const evaluationsById = {};
    (opts.scoredKeys ?? []).forEach((key, i) => {
      const slot = SLOTS[i];
      evaluationsById["cand-" + slot.id] = evaluation("cand-" + slot.id, String.fromCharCode(65 + i), opts.scores?.[key] ?? 4.0);
    });
    const judgeAttempts = opts.judgeAttempts ?? (
      judgeStatus === "done"
        ? [judgeAttempt("judge-att-1", { report: { labelMap: [], evaluationsById, comparisons: [] } })]
        : judgeStatus === "error"
          ? [judgeAttempt("judge-att-1", { status: "failed", error: { message: "judge failed" }, report: null })]
          : []
    );
    const fusionAttempts = opts.fusionAttempts ?? [];
    return {
      schemaVersion: 2,
      id: runId,
      revision: 1,
      execution: { ownerId: "qa-tab", fence: 1 },
      createdAt: opts.createdAt ?? 1700000000000,
      updatedAt: opts.updatedAt ?? (opts.createdAt ?? 1700000000000) + 1000,
      completedAt: opts.completedAt ?? (status === "completed" ? 1700000001000 : null),
      status,
      mode,
      source: opts.source ?? { kind: "adhoc" },
      task: { title: opts.title ?? runId, prompt: "Write a short poem about persistence.", systemPrompt: "", temperature: 0.7 },
      evaluation: { profile: null, candidateMessages: [] },
      ...(opts.reasoning ? { reasoning: opts.reasoning } : {}),
      candidates,
      judge: {
        status: judgeStatus,
        acceptedAttemptId: judgeStatus === "done" ? "judge-att-1" : null,
        report: judgeStatus === "done" ? { labelMap: [], evaluationsById, comparisons: [] } : null,
        consensus: null,
        attempts: judgeAttempts,
      },
      fusion: {
        status: opts.fusionStatus ?? "idle",
        acceptedAttemptId: opts.fusionAttempts?.length ? "fusion-att-1" : null,
        attempts: fusionAttempts,
      },
      winnerKeys: opts.winnerKeys ?? [],
    };
  }

  function makeSummary(run, opts = {}) {
    return {
      kind: "full",
      schemaVersion: 2,
      id: run.id,
      revision: 1,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      status: run.status,
      mode: run.mode,
      source: run.source,
      taskTitle: run.task.title,
      taskExcerpt: run.task.prompt,
      modelKeys: run.candidates.map((c) => c.modelKey),
      winnerKeys: run.winnerKeys,
      scoresByModelKey: opts.scoresByModelKey ?? {},
      judgeModelKey: "openrouter:qwen-3.8-max",
      evaluationProfileId: null,
      evaluationProfileVersion: null,
      detailAvailable: true,
      searchText: run.task.prompt,
    };
  }

  function runSummaryRow(run, opts = {}) {
    const summary = makeSummary(run, opts);
    return {
      kind: "full",
      summary,
      id: run.id,
      revision: 1,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      status: run.status,
      mode: run.mode,
      sourceKind: run.source.kind,
      sourceProtocolFingerprint: run.source.protocolFingerprint ?? null,
      sourceExperimentTaskAttemptId: run.source.experimentTaskAttemptId ?? null,
      modelKeys: run.candidates.map((c) => c.modelKey),
    };
  }

  function runDetailRow(run) {
    return { id: run.id, record: run, revision: 1, createdAt: run.createdAt, status: run.status };
  }

  const REASONING = {
    candidates: {
      [MK1]: { requested: "high", effective: "high", source: "provider-docs" },
      [MK2]: { requested: "medium", effective: "medium", source: "provider-docs" },
    },
    judge: { requested: "medium", effective: "medium", source: "provider-docs" },
  };

  const runs = [
    // 1. Completed rank run: full evidence set (winner, scores, costs all
    //    three provenances, judge report, reasoning policy).
    makeRun("run-completed", {
      title: "Ad hoc completed evidence walk",
      acceptedKeys: [MK1, MK2],
      scoredKeys: [MK1, MK2],
      scores: { [MK1]: 4.4, [MK2]: 4.1 },
      winnerKeys: [MK1],
      candidateOpts: {
        [MK1]: { cost: { usd: 0.0012, source: "provider-reported" }, inputEstimate: { totalTokens: 900, textTokens: 900, method: "provider-reported", partial: false } },
        [MK2]: { cost: { usd: 0.0008, source: "catalog-estimate" } },
      },
      reasoning: REASONING,
    }),
    // 2. Running: live duration, judge pending, result pending.
    makeRun("run-running", {
      title: "Ad hoc streaming summarization",
      status: "running",
      createdAt: 1700000002000,
      acceptedKeys: [MK1],
      judgeStatus: "running",
    }),
    // 3. Failed: no accepted candidate or judge attempt, no cost data.
    makeRun("run-failed", {
      title: "Ad hoc failed extraction",
      status: "failed",
      createdAt: 1700000003000,
      completedAt: 1700000003500,
      failedKeys: [MK1, MK2],
      judgeStatus: "error",
    }),
    // 4. Partial: one candidate accepted, judge done, no winner.
    makeRun("run-partial", {
      title: "Ad hoc partial coverage",
      status: "partial",
      createdAt: 1700000004000,
      completedAt: 1700000004500,
      acceptedKeys: [MK1],
      failedKeys: [MK2],
      scoredKeys: [MK1],
      scores: { [MK1]: 3.8 },
    }),
    // 5. Aborted: ended by user, completedAt present -> "Ended" label.
    makeRun("run-aborted", {
      title: "Ad hoc aborted cleanup",
      status: "aborted",
      createdAt: 1700000005000,
      completedAt: 1700000005200,
      acceptedKeys: [MK1],
      judgeStatus: "idle",
    }),
    // 6. Interrupted: stopped mid-run.
    makeRun("run-interrupted", {
      title: "Ad hoc interrupted retry",
      status: "interrupted",
      createdAt: 1700000006000,
      completedAt: 1700000006100,
      acceptedKeys: [MK1],
      judgeStatus: "running",
    }),
    // 7. Fuse: accepted fusion result, no ranked winners.
    makeRun("run-fuse", {
      title: "Ad hoc fused verdict",
      status: "completed",
      mode: "fuse",
      createdAt: 1700000007000,
      completedAt: 1700000008000,
      acceptedKeys: [MK1, MK2],
      scoredKeys: [MK1, MK2],
      fusionStatus: "done",
      fusionAttempts: [{
        attemptId: "fusion-att-1",
        providerId: "openrouter",
        model: "Qwen 3.8 Max",
        messages: [],
        sourceJudgeAttemptId: "judge-att-1",
        candidateAttemptIdsByCandidateId: { "cand-s1": "att-cand-s1", "cand-s2": "att-cand-s2" },
        startedAt: 1700000007500,
        finishedAt: 1700000008000,
        status: "completed",
        error: null,
        result: "Fused verdict: **persistence wins** with nuance on tone.",
        usage: { inputTokens: 300, outputTokens: 150, reasoningTokens: null, cacheReadTokens: null, cacheWriteTokens: null },
        inputEstimate: { totalTokens: 400, textTokens: 400, method: "provider-reported", partial: false },
        cost: { usd: 0.0005, source: "provider-reported" },
      }],
    }),
    // 8. Experiment: provenance trail with links.
    makeRun("run-exp", {
      title: "Experiment suite pricing",
      status: "completed",
      createdAt: 1700000009000,
      acceptedKeys: [MK1, MK2],
      scoredKeys: [MK1, MK2],
      scores: { [MK1]: 4.6, [MK2]: 4.0 },
      winnerKeys: [MK1],
      source: {
        kind: "experiment",
        experimentId: "exp-qa",
        suiteId: "suite-qa",
        suiteVersion: 1,
        protocolFingerprint: "sha256:qa",
        taskId: "pricing",
        experimentTaskAttemptId: "att-exp-1",
        trial: 0,
      },
    }),
    // 9. Reused output: accepted attempt copied from an earlier run.
    makeRun("run-reused", {
      title: "Ad hoc reused evidence",
      status: "completed",
      createdAt: 1700000010000,
      acceptedKeys: [MK1, MK2],
      scoredKeys: [MK2],
      scores: { [MK2]: 4.3 },
      winnerKeys: [MK2],
      candidateOpts: {
        [MK2]: {
          reusedFrom: { sourceRunId: "run-completed", sourceCandidateId: "cand-s2", sourceAttemptId: "att-cand-s2" },
        },
      },
    }),
    // 10. Multi-attempt judge: accepted + historical attempt for deep links.
    makeRun("run-judge-multi", {
      title: "Ad hoc judge retry history",
      status: "completed",
      createdAt: 1700000011000,
      acceptedKeys: [MK1, MK2],
      scoredKeys: [MK1, MK2],
      scores: { [MK1]: 4.5, [MK2]: 4.2 },
      winnerKeys: [MK1],
      judgeAttempts: [
        judgeAttempt("judge-att-1", { report: { labelMap: [], evaluationsById: {
          "cand-s1": evaluation("cand-s1", "A", 4.5),
          "cand-s2": evaluation("cand-s2", "B", 4.2),
        }, comparisons: [] } }),
        judgeAttempt("judge-att-2", { report: null, instruction: "Historical retry after holdout failure." }),
      ],
    }),
  ];

  const summaryOpts = {
    "run-completed": { scoresByModelKey: { [MK1]: 4.4 } },
    "run-reused": { scoresByModelKey: { [MK2]: 4.3 } },
  };

  // Clear any prior run fixtures for determinism.
  await clearStore(db, "runSummaries");
  await clearStore(db, "runDetails");

  for (const run of runs) {
    await put(db, "runDetails", runDetailRow(run));
    await put(db, "runSummaries", runSummaryRow(run, summaryOpts[run.id] ?? {}));
  }

  const legacy1 = {
    kind: "legacy",
    schemaVersion: "1-import",
    id: "legacy-1",
    createdAt: 1690000000000,
    taskExcerpt: "Legacy run from the v1 localStorage history.",
    modelKeys: [MK1],
    winnerKeys: [MK1],
    scoresByModelKey: { [MK1]: 3.2 },
    detailAvailable: false,
    searchText: "legacy run from the v1 localStorage history",
  };
  await put(db, "runSummaries", {
    kind: "legacy",
    summary: legacy1,
    id: legacy1.id,
    revision: 0,
    createdAt: legacy1.createdAt,
    completedAt: null,
    status: null,
    mode: null,
    sourceKind: "adhoc",
    sourceProtocolFingerprint: null,
    sourceExperimentTaskAttemptId: null,
    modelKeys: legacy1.modelKeys,
  });

  // Live execution lease matching run-running's execution fence. The app's
  // startup sweep (recoverInterruptedRuns) converts stale "running" runs whose
  // owner/fence no longer match the active lease to "interrupted" — seeded
  // running rows must therefore carry a live matching lease to legitimately
  // present as Running. storageMeta rows use { key, value }.
  await put(db, "storageMeta", {
    key: "execution-lease",
    value: {
      leaseId: "qa-lease-1",
      ownerId: "qa-tab",
      kind: "compare",
      executionId: "run-running",
      acquiredAt: 1700000002000,
      heartbeatAt: 1700000002000,
      fence: 1,
      expiresAt: 1900000000000,
    },
  });

  db.close();
  return { runCount: runs.length, legacyCount: 1 };
})().catch((e) => ({ __seedError: e instanceof Error ? e.message : String(e), __seedStack: e instanceof Error ? e.stack : "" }))`;

const CLEAR_SOURCE = `(async () => {
  const DB = "rsemble-evaluation";
  const openDb = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const db = await openDb();
  const clearStore = (store) => new Promise((resolve, reject) => {
    const r = db.transaction(store, "readwrite").objectStore(store).clear();
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
  const deleteKey = (store, key) => new Promise((resolve, reject) => {
    const r = db.transaction(store, "readwrite").objectStore(store).delete(key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
  await clearStore("runSummaries");
  await clearStore("runDetails");
  // Drop any leftover lease/fence so a previous run's live lease cannot
  // suppress the startup sweep or leak into the seeded fixtures.
  await deleteKey("storageMeta", "execution-lease");
  await deleteKey("storageMeta", "execution-lease-fence");
  db.close();
  return true;
})().catch((e) => ({ __clearError: e instanceof Error ? e.message : String(e) }))`;

// --- Page-state probes ----------------------------------------------------------

const ROW_STATE_PROBE = `(() => {
  const rows = [...document.querySelectorAll('ul[role="list"] a[href*="/runs/"]')];
  return rows.map((row) => ({
    href: row.getAttribute("href"),
    status: (row.querySelector("[data-status-mark]")?.textContent ?? "").trim(),
    text: (row.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 220),
  }));
})()`;

const DETAIL_PROBE = `(() => {
  const t = (sel) => (document.querySelector(sel)?.textContent ?? "").replace(/\\s+/g, " ").trim();
  const sections = [...document.querySelectorAll("[data-section]")].map((s) => s.getAttribute("data-section"));
  return {
    body: (document.body?.innerText ?? "").replace(/\\s+/g, " ").trim(),
    sections,
    header: t('[data-section="header"]'),
    timeline: t('[data-section="timeline"]'),
    outcome: t('[data-section="outcome"]'),
    cost: t('[data-section="cost-breakdown"]'),
    costCards: document.querySelectorAll('[data-section="cost-breakdown"] [data-cost-source]').length,
    costTotal: t('[data-cost-total]'),
    candidates: [...document.querySelectorAll("[data-candidate-id]")].map((b) => ({
      id: b.getAttribute("data-candidate-id"),
      pressed: b.getAttribute("aria-pressed"),
      text: (b.textContent ?? "").replace(/\\s+/g, " ").trim(),
    })),
    selectedCandidate: t('[data-section="selected-candidate"]'),
    judge: t('[data-section="judge"]'),
    judgeAttempts: [...document.querySelectorAll("[data-judge-attempt]")].map((p) => p.getAttribute("data-judge-attempt")),
    fusion: t('[data-section="fusion"]'),
    provenance: t('[data-section="provenance"]'),
    provenanceLinks: [...document.querySelectorAll('[data-section="provenance"] a')].map((a) => a.getAttribute("href")),
    taskConfig: t('[data-section="task-config"]'),
    taskConfigExpanded: document.querySelector('[data-section="task-config"] button')?.getAttribute("aria-expanded"),
    reasoning: t('[data-reasoning-provenance]'),
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
})()`;

// --- Scenarios ------------------------------------------------------------------

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = String(input);
        if (url.includes("/models")) {
          return new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return nativeFetch(input, init);
      };
    })()`,
  });

  await setViewport({ width: 1440, height: 900, mobile: false });
  await navigate("#/runs");

  // ===========================================================================
  // D. Zero results — empty database (no-history state)
  // ===========================================================================
  const cleared = await evaluate(CLEAR_SOURCE);
  if (cleared?.__clearError) throw new Error(`Clear failed: ${cleared.__clearError}`);
  await reload();
  await waitFor(
    "(document.body.innerText ?? '').includes('No run history yet.')",
    "empty history state",
  );
  let probe = await evaluate(`(() => {
    const text = document.body.innerText ?? "";
    const compareLink = [...document.querySelectorAll("a")].find((a) => {
      const href = a.getAttribute("href") ?? "";
      const text = (a.textContent ?? "").trim();
      return (href === "/compare" || href === "#/compare") && text.includes("Go to Compare");
    });
    return {
      hasNoHistory: text.includes("No run history yet."),
      hasGoCompare: Boolean(compareLink && compareLink.textContent.includes("Go to Compare")),
      rowCount: document.querySelectorAll('ul[role="list"] a[href*="/runs/"]').length,
    };
  })()`);
  record("empty-db-no-history-state", {
    pass: probe.hasNoHistory && probe.hasGoCompare && probe.rowCount === 0,
    ...probe,
    reason: !probe.hasNoHistory
      ? "no-history copy missing on empty DB"
      : !probe.hasGoCompare
        ? "Go to Compare CTA missing"
        : probe.rowCount !== 0
          ? "rows rendered on empty DB"
          : undefined,
  });
  await screenshot("01-empty-history");

  // Desktop placeholder when no run selected.
  probe = await evaluate(
    `(document.body.innerText ?? "").includes("Select a run to inspect its evidence.")`,
  );
  record("desktop-no-selection-placeholder", {
    pass: probe,
    reason: !probe ? "detail placeholder missing with no selection" : undefined,
  });

  // ===========================================================================
  // Seed the edge-state fixtures.
  // ===========================================================================
  const seeded = await evaluate(SEED_SOURCE);
  if (seeded?.__seedError)
    throw new Error(`Seed failed: ${seeded.__seedError}\n${seeded.__seedStack}`);
  results.seeded = seeded;
  // The repository notifies its own writes only; externally seeded rows need a
  // fresh load (same pattern as cdp-runs-responsive-qa.mjs). Page.navigate to
  // the same hash is a no-op, so force a full document reload.
  await reload();
  await waitFor(
    'document.querySelectorAll(\'ul[role="list"] a[href*="/runs/"]\').length >= 11',
    "seeded run rows",
  );

  // ===========================================================================
  // A. Row states — every status renders its own token
  // ===========================================================================
  const rows = await evaluate(ROW_STATE_PROBE);
  const byHref = Object.fromEntries(rows.map((r) => [r.href.replace("#", ""), r]));
  const expectedStatus = {
    "/runs/run-running": "Running",
    "/runs/run-completed": "Completed",
    "/runs/run-failed": "Failed",
    "/runs/run-partial": "Partial",
    "/runs/run-aborted": "Aborted",
    "/runs/run-interrupted": "Interrupted",
    "/runs/run-fuse": "Completed",
    "/runs/run-exp": "Completed",
    "/runs/run-reused": "Completed",
    "/runs/run-judge-multi": "Completed",
  };
  const mismatches = Object.entries(expectedStatus).filter(
    ([href, status]) => byHref[href]?.status !== status,
  );
  record("rows-all-statuses", {
    pass: mismatches.length === 0 && rows.length >= 11,
    rows: rows.map((r) => ({ href: r.href, status: r.status })),
    reason:
      mismatches.length > 0
        ? `status token mismatch: ${JSON.stringify(mismatches)}`
        : rows.length < 11
          ? `expected >= 11 rows, got ${rows.length}`
          : undefined,
  });
  await screenshot("02-rows-all-states");

  // Legacy row renders with the legacy source chip and the completed token
  // (v1 history only ever stored completed runs; status defaults to completed).
  probe = await evaluate(`(() => {
    const row = document.querySelector('a[href="#/runs/legacy-1"]');
    if (!row) return { found: false };
    const text = (row.textContent ?? "").replace(/\\s+/g, " ").trim();
    return {
      found: true,
      hasLegacyChip: text.includes("legacy"),
      hasCompletedToken: (row.querySelector("[data-status-mark]")?.textContent ?? "").trim() === "Completed",
      excerptShown: text.includes("Legacy run from the v1 localStorage history"),
      text,
    };
  })()`);
  record("row-legacy-renders", {
    pass: probe.found && probe.hasLegacyChip && probe.hasCompletedToken && probe.excerptShown,
    ...probe,
    reason: !probe.found
      ? "legacy row missing"
      : !probe.hasLegacyChip
        ? "legacy source chip missing"
        : !probe.hasCompletedToken
          ? "legacy row status token missing"
          : !probe.excerptShown
            ? "legacy excerpt not shown"
            : undefined,
  });

  // Winner + score summary on the completed row.
  probe = await evaluate(`(() => {
    const row = document.querySelector('a[href="#/runs/run-completed"]');
    const text = (row?.textContent ?? "").replace(/\\s+/g, " ").trim();
    return { text, hasWinner: text.includes("Winner:"), hasScore: text.includes("Score: 4.4") };
  })()`);
  record("row-winner-score-summary", {
    pass: probe.hasWinner && probe.hasScore,
    ...probe,
    reason: !probe.hasWinner
      ? "winner summary missing on completed row"
      : !probe.hasScore
        ? "top score summary missing on completed row"
        : undefined,
  });

  // Source chips per row kind.
  probe = await evaluate(`(() => {
    const chipOf = (href) => {
      const row = document.querySelector('a[href="#' + href + '"]');
      const text = (row?.textContent ?? "").replace(/\\s+/g, " ").trim();
      return text.includes("experiment") ? "experiment" : text.includes("legacy") ? "legacy" : "ad hoc";
    };
    return {
      adhoc: chipOf("/runs/run-completed"),
      experiment: chipOf("/runs/run-exp"),
      legacy: chipOf("/runs/legacy-1"),
    };
  })()`);
  record("rows-source-chips", {
    pass:
      probe.adhoc === "ad hoc" && probe.experiment === "experiment" && probe.legacy === "legacy",
    ...probe,
    reason: "source chips mislabeled",
  });

  // Selected-row treatment: navigate to a run, assert data-selected + aria-current.
  await navigate("#/runs/run-completed");
  await waitFor(
    "Boolean(document.querySelector('[data-selected=\"true\"]'))",
    "selected row treatment",
  );
  probe = await evaluate(`(() => {
    const wrapper = document.querySelector('[data-selected="true"]');
    const link = wrapper?.querySelector('a[href*="/runs/"]');
    return {
      selectedHref: link?.getAttribute("href") ?? null,
      ariaCurrent: link?.getAttribute("aria-current") ?? null,
      srSelected: (wrapper?.textContent ?? "").includes("Selected"),
    };
  })()`);
  record("row-selected-treatment", {
    pass:
      probe.selectedHref === "#/runs/run-completed" &&
      probe.ariaCurrent === "true" &&
      probe.srSelected,
    ...probe,
    reason:
      probe.selectedHref !== "#/runs/run-completed"
        ? "wrong row selected"
        : probe.ariaCurrent !== "true"
          ? "aria-current missing on selected row"
          : !probe.srSelected
            ? "sr-only Selected label missing"
            : undefined,
  });

  // ===========================================================================
  // B. Detail evidence — completed rank run (full evidence set)
  // ===========================================================================
  await navigate("#/runs/run-completed");
  await waitFor(
    "(document.body.innerText ?? '').includes('Ad hoc completed evidence walk')",
    "completed detail",
  );
  probe = await evaluate(DETAIL_PROBE);
  const completedPass =
    probe.sections.includes("header") &&
    probe.sections.includes("timeline") &&
    probe.sections.includes("outcome") &&
    probe.sections.includes("cost-breakdown") &&
    probe.sections.includes("candidates") &&
    probe.sections.includes("selected-candidate") &&
    probe.sections.includes("judge") &&
    probe.sections.includes("task-config") &&
    probe.header.includes("Completed") &&
    probe.header.includes("rank") &&
    probe.header.includes("ad hoc") &&
    probe.header.includes("Started") &&
    probe.header.includes("Completed") &&
    probe.header.includes("Duration") &&
    probe.timeline.includes("2/2 done") &&
    probe.timeline.includes("ranked - winner set") &&
    probe.outcome.includes("Winners:") &&
    probe.outcome.includes("openrouter:z-ai/glm-5.2") &&
    probe.outcome.includes("2 candidates") &&
    probe.costCards === 3 &&
    probe.costTotal.includes("Incremental total") &&
    probe.candidates.length === 2 &&
    probe.candidates.some((c) => c.id === "cand-s1" && c.pressed === "true") &&
    probe.selectedCandidate.includes("Selected candidate") &&
    probe.selectedCandidate.includes("output-openrouter:z-ai/glm-5.2") &&
    probe.judge.includes("Judge Evidence") &&
    probe.judge.includes("Evaluations") &&
    probe.judge.includes("Label: A") &&
    !probe.sections.includes("fusion") &&
    !probe.overflowX;
  record("detail-completed-full-evidence", {
    pass: completedPass,
    sections: probe.sections,
    header: probe.header.slice(0, 300),
    timeline: probe.timeline,
    outcome: probe.outcome,
    costCards: probe.costCards,
    costTotal: probe.costTotal,
    candidates: probe.candidates.map((c) => `${c.id}:${c.pressed}`),
    judge: probe.judge.slice(0, 200),
    fusion: probe.fusion,
    reason: !completedPass ? "completed detail missing expected evidence" : undefined,
  });
  await screenshot("03-completed-detail");

  // Task & Configuration disclosure: collapsed by default, expands to show
  // prompt/system/temperature/models/reasoning policy.
  probe = await evaluate(`(() => {
    const btn = document.querySelector('[data-section="task-config"] button');
    const collapsed = btn?.getAttribute("aria-expanded") === "false";
    btn?.click();
    return { collapsed };
  })()`);
  await waitFor(
    'document.querySelector(\'[data-section="task-config"] button\').getAttribute("aria-expanded") === "true"',
    "task-config expanded",
  );
  probe = await evaluate(`(() => {
    const text = (document.querySelector('[data-section="task-config"]')?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const reasoning = (document.querySelector('[data-reasoning-provenance]')?.textContent ?? "").replace(/\\s+/g, " ").trim();
    return {
      text,
      reasoning,
      hasPrompt: text.includes("Prompt:"),
      hasTemperature: text.includes("Temperature: 0.7"),
      hasModels: text.includes("Models:"),
      hasReasoning: reasoning.includes("requested high · effective high · provider-docs"),
    };
  })()`);
  record("detail-task-config-disclosure", {
    pass: probe.hasPrompt && probe.hasTemperature && probe.hasModels && probe.hasReasoning,
    ...probe,
    reason: !probe.hasPrompt
      ? "prompt missing after expand"
      : !probe.hasTemperature
        ? "temperature missing after expand"
        : !probe.hasModels
          ? "model roster missing after expand"
          : !probe.hasReasoning
            ? "reasoning policy provenance missing"
            : undefined,
  });

  // ===========================================================================
  // B2. Running detail — live duration, pending stages
  // ===========================================================================
  await navigate("#/runs/run-running");
  await waitFor(
    "(document.body.innerText ?? '').includes('Ad hoc streaming summarization')",
    "running detail",
  );
  probe = await evaluate(DETAIL_PROBE);
  record("detail-running-state", {
    pass:
      probe.header.includes("Running") &&
      probe.header.includes("Running for") &&
      !probe.header.includes("Completed ") &&
      probe.timeline.includes("pending") &&
      !probe.overflowX,
    header: probe.header.slice(0, 300),
    timeline: probe.timeline,
    reason: !probe.header.includes("Running for")
      ? "running duration missing in header"
      : probe.header.includes("Completed ")
        ? "completed time shown for a running run"
        : !probe.timeline.includes("pending")
          ? "timeline result not pending"
          : undefined,
  });
  await screenshot("04-running-detail");

  // ===========================================================================
  // B3. Failed detail — no accepted judge attempt, no winners, no cost data
  // ===========================================================================
  await navigate("#/runs/run-failed");
  await waitFor(
    "(document.body.innerText ?? '').includes('Ad hoc failed extraction')",
    "failed detail",
  );
  probe = await evaluate(DETAIL_PROBE);
  record("detail-failed-state", {
    pass:
      probe.header.includes("Failed") &&
      probe.header.includes("Ended") &&
      probe.timeline.includes("no result - judge failed") &&
      probe.timeline.includes("judge") &&
      probe.outcome.includes("No winners recorded.") &&
      probe.judge.includes("No accepted Judge attempt.") &&
      probe.cost.includes("No cost data for this run.") &&
      !probe.overflowX,
    header: probe.header.slice(0, 300),
    timeline: probe.timeline,
    outcome: probe.outcome,
    judge: probe.judge.slice(0, 200),
    cost: probe.cost,
    reason: !probe.header.includes("Ended")
      ? "failed run did not render Ended label"
      : !probe.timeline.includes("no result - judge failed")
        ? "failed timeline result wrong"
        : !probe.outcome.includes("No winners recorded.")
          ? "failed outcome missing no-winners copy"
          : !probe.judge.includes("No accepted Judge attempt.")
            ? "failed judge missing no-accepted copy"
            : undefined,
  });
  await screenshot("05-failed-detail");

  // ===========================================================================
  // B4. Partial detail — candidate error warn state, judge accepted present
  // ===========================================================================
  await navigate("#/runs/run-partial");
  await waitFor(
    "(document.body.innerText ?? '').includes('Ad hoc partial coverage')",
    "partial detail",
  );
  probe = await evaluate(DETAIL_PROBE);
  record("detail-partial-state", {
    pass:
      probe.header.includes("Partial") &&
      probe.timeline.includes("no result - candidate error") &&
      probe.timeline.includes("1/2 done") &&
      probe.outcome.includes("No winners recorded.") &&
      probe.judge.includes("Judge Evidence") &&
      probe.judge.includes("Evaluations"),
    header: probe.header.slice(0, 200),
    timeline: probe.timeline,
    reason: !probe.timeline.includes("no result - candidate error")
      ? "partial timeline result wrong"
      : !probe.outcome.includes("No winners recorded.")
        ? "partial outcome missing no-winners copy"
        : !probe.judge.includes("Judge Evidence")
          ? "partial judge evidence missing"
          : undefined,
  });

  // ===========================================================================
  // B5. Aborted detail — Ended label, aborted timeline result
  // ===========================================================================
  await navigate("#/runs/run-aborted");
  await waitFor(
    "(document.body.innerText ?? '').includes('Ad hoc aborted cleanup')",
    "aborted detail",
  );
  probe = await evaluate(DETAIL_PROBE);
  record("detail-aborted-state", {
    pass:
      probe.header.includes("Aborted") &&
      probe.header.includes("Ended") &&
      probe.timeline.includes("aborted") &&
      !probe.timeline.includes("pending"),
    header: probe.header.slice(0, 300),
    timeline: probe.timeline,
    reason: !probe.header.includes("Ended")
      ? "aborted run did not render Ended label"
      : !probe.timeline.includes("aborted")
        ? "aborted timeline result not labeled aborted (shows: " + probe.timeline + ")"
        : probe.timeline.includes("pending")
          ? "aborted timeline shows pending"
          : undefined,
  });
  await screenshot("06-aborted-detail");

  // ===========================================================================
  // B6. Interrupted detail — stopped mid-run
  // ===========================================================================
  await navigate("#/runs/run-interrupted");
  await waitFor(
    "(document.body.innerText ?? '').includes('Ad hoc interrupted retry')",
    "interrupted detail",
  );
  probe = await evaluate(DETAIL_PROBE);
  record("detail-interrupted-state", {
    pass: probe.header.includes("Interrupted") && probe.timeline.includes("stopped mid-run"),
    header: probe.header.slice(0, 200),
    timeline: probe.timeline,
    reason: !probe.timeline.includes("stopped mid-run")
      ? "interrupted timeline result wrong"
      : undefined,
  });

  // ===========================================================================
  // B7. Fuse detail — accepted fusion result
  // ===========================================================================
  await navigate("#/runs/run-fuse");
  await waitFor("(document.body.innerText ?? '').includes('Ad hoc fused verdict')", "fuse detail");
  probe = await evaluate(DETAIL_PROBE);
  record("detail-fuse-state", {
    pass:
      probe.header.includes("fuse") &&
      probe.timeline.includes("fused") &&
      probe.fusion.includes("Fused verdict:") &&
      probe.fusion.includes("persistence wins") &&
      probe.sections.includes("fusion") &&
      !probe.fusion.includes("No accepted Fusion result."),
    header: probe.header.slice(0, 200),
    timeline: probe.timeline,
    fusion: probe.fusion.slice(0, 200),
    reason: !probe.fusion.includes("persistence wins")
      ? "fused result missing from fusion section"
      : probe.fusion.includes("No accepted Fusion result.")
        ? "fusion section says no result despite accepted attempt"
        : !probe.timeline.includes("fused")
          ? "fuse timeline result not fused"
          : undefined,
  });
  await screenshot("07-fuse-detail");

  // ===========================================================================
  // B8. Experiment provenance detail
  // ===========================================================================
  await navigate("#/runs/run-exp");
  await waitFor(
    "(document.body.innerText ?? '').includes('Experiment suite pricing')",
    "experiment detail",
  );
  probe = await evaluate(DETAIL_PROBE);
  record("detail-experiment-provenance", {
    pass:
      probe.header.includes("experiment") &&
      probe.sections.includes("provenance") &&
      probe.provenanceLinks.some((l) => l.endsWith("/experiments/exp-qa")) &&
      probe.provenanceLinks.some((l) => l.endsWith("/evaluations/suite-qa")) &&
      probe.provenance.includes("pricing") &&
      probe.provenance.includes("att-exp-1"),
    provenance: probe.provenance,
    provenanceLinks: probe.provenanceLinks,
    reason: !probe.sections.includes("provenance")
      ? "provenance section missing for experiment run"
      : !probe.provenanceLinks.some((l) => l.endsWith("/experiments/exp-qa"))
        ? "experiment link missing"
        : !probe.provenanceLinks.some((l) => l.endsWith("/evaluations/suite-qa"))
          ? "suite link missing"
          : undefined,
  });
  await screenshot("08-experiment-provenance");

  // ===========================================================================
  // B9. Reused-output provenance
  // ===========================================================================
  await navigate("#/runs/run-reused");
  await waitFor(
    "(document.body.innerText ?? '').includes('Ad hoc reused evidence')",
    "reused detail",
  );
  probe = await evaluate(`(() => {
    const note = document.querySelector("[data-reused-from]");
    const link = note?.querySelector("a");
    return {
      hasNote: Boolean(note),
      noteText: (note?.textContent ?? "").replace(/\\s+/g, " ").trim(),
      viewSourceHref: link?.getAttribute("href") ?? null,
    };
  })()`);
  record("detail-reused-output", {
    pass:
      probe.hasNote &&
      probe.noteText.includes("Reused from prior attempt") &&
      (probe.viewSourceHref === "/runs/run-completed" ||
        probe.viewSourceHref === "#/runs/run-completed"),
    ...probe,
    reason: !probe.hasNote
      ? "reused-from note missing"
      : probe.viewSourceHref !== "/runs/run-completed" &&
          probe.viewSourceHref !== "#/runs/run-completed"
        ? "View source run link wrong"
        : undefined,
  });
  await screenshot("09-reused-output");

  // ===========================================================================
  // C. Deep links — candidate + judge attempt focus, invalid params, not-found
  // ===========================================================================
  // C1. Valid candidate deep link: cand-s2 selected and focused.
  await navigate("#/runs/run-judge-multi?candidate=cand-s2");
  await waitFor(
    "(document.body.innerText ?? '').includes('Ad hoc judge retry history')",
    "judge-multi detail",
  );
  probe = await evaluate(`(() => {
    const btn = document.querySelector('[data-candidate-id="cand-s2"]');
    const panel = document.querySelector('[data-section="selected-candidate"]');
    return {
      pressed: btn?.getAttribute("aria-pressed") ?? null,
      focused: document.activeElement === btn,
      panelHasS2: (panel?.textContent ?? "").includes("openrouter:deepseek/deepseek-v4-flash"),
    };
  })()`);
  record("deeplink-candidate-focus", {
    pass: probe.pressed === "true" && probe.focused && probe.panelHasS2,
    ...probe,
    reason:
      probe.pressed !== "true"
        ? "linked candidate not selected"
        : !probe.focused
          ? "linked candidate not focused"
          : !probe.panelHasS2
            ? "selected-candidate panel does not show linked candidate"
            : undefined,
  });
  await screenshot("10-deeplink-candidate-focus");

  // C2. Valid judge attempt deep link — accepted attempt highlighted.
  await navigate("#/runs/run-judge-multi?attempt=judge-att-1");
  await waitFor(
    "(document.body.innerText ?? '').includes('Ad hoc judge retry history')",
    "judge-multi detail (accepted attempt)",
  );
  probe = await evaluate(`(() => {
    const panel = document.querySelector('[data-judge-attempt="judge-att-1"]');
    return {
      highlighted: panel?.classList.contains("ring-1") ?? false,
      label: (panel?.textContent ?? "").includes("Selected attempt"),
    };
  })()`);
  record("deeplink-judge-attempt-accepted", {
    pass: probe.highlighted && probe.label,
    ...probe,
    reason: !probe.label
      ? "accepted attempt not labeled Selected attempt"
      : !probe.highlighted
        ? "accepted attempt not highlighted"
        : undefined,
  });

  // C3. Historical judge attempt deep link — separate panel, accepted summary
  //     semantics unchanged.
  await navigate("#/runs/run-judge-multi?attempt=judge-att-2");
  await waitFor(
    "(document.body.innerText ?? '').includes('Historical attempt')",
    "historical judge attempt",
  );
  probe = await evaluate(`(() => {
    const hist = document.querySelector('[data-judge-attempt="judge-att-2"]');
    const accepted = document.querySelector('[data-judge-attempt="judge-att-1"]');
    return {
      histLabel: (hist?.textContent ?? "").includes("Historical attempt — accepted summary unchanged"),
      acceptedStillShown: Boolean(accepted),
      acceptedStillAccepted: (accepted?.textContent ?? "").includes("Selected attempt") || !accepted?.classList.contains("ring-1"),
      histHighlighted: hist?.classList.contains("ring-1") ?? false,
    };
  })()`);
  record("deeplink-judge-attempt-historical", {
    pass: probe.histLabel && probe.acceptedStillShown && probe.histHighlighted,
    ...probe,
    reason: !probe.histLabel
      ? "historical attempt not labeled"
      : !probe.acceptedStillShown
        ? "accepted attempt panel disappeared"
        : !probe.histHighlighted
          ? "historical attempt not highlighted"
          : undefined,
  });
  await screenshot("11-deeplink-judge-historical");

  // C4. Invalid candidate deep link — non-blocking notice, overview renders.
  await navigate("#/runs/run-completed?candidate=does-not-exist");
  await waitFor(
    "(document.body.innerText ?? '').includes('Linked candidate not found')",
    "invalid candidate notice",
  );
  probe = await evaluate(`(() => {
    const text = document.body.innerText ?? "";
    const header = (document.querySelector('[data-section="header"]')?.textContent ?? "").replace(/\\s+/g, " ").trim();
    return {
      notice: text.includes("Linked candidate not found — showing run overview."),
      // innerText reflects CSS text-transform (h3 headings render uppercased),
      // so assert the overview via textContent and section presence instead.
      overviewStillRenders: header.includes("Ad hoc completed evidence walk") && Boolean(document.querySelector('[data-section="outcome"]')),
    };
  })()`);
  record("deeplink-invalid-candidate", {
    pass: probe.notice && probe.overviewStillRenders,
    ...probe,
    reason: !probe.notice
      ? "invalid candidate notice missing"
      : !probe.overviewStillRenders
        ? "overview did not render after invalid candidate link"
        : undefined,
  });

  // C5. Invalid judge attempt deep link — non-blocking notice.
  await navigate("#/runs/run-completed?attempt=does-not-exist");
  await waitFor(
    "(document.body.innerText ?? '').includes('Linked judge attempt not found')",
    "invalid attempt notice",
  );
  probe = await evaluate(`(() => {
    const text = document.body.innerText ?? "";
    const header = (document.querySelector('[data-section="header"]')?.textContent ?? "").replace(/\\s+/g, " ").trim();
    return {
      notice: text.includes("Linked judge attempt not found — showing run overview."),
      // innerText reflects CSS text-transform; assert via textContent/sections.
      overviewStillRenders: header.includes("Ad hoc completed evidence walk") && Boolean(document.querySelector('[data-section="outcome"]')),
    };
  })()`);
  record("deeplink-invalid-attempt", {
    pass: probe.notice && probe.overviewStillRenders,
    ...probe,
    reason: !probe.notice
      ? "invalid attempt notice missing"
      : !probe.overviewStillRenders
        ? "overview did not render after invalid attempt link"
        : undefined,
  });

  // C6. Unknown run id — not-found state with Back to Runs.
  await navigate("#/runs/does-not-exist-404");
  await waitFor(
    "(document.body.innerText ?? '').includes('Run not found.')",
    "unknown run not-found",
  );
  probe = await evaluate(`(() => {
    const text = document.body.innerText ?? "";
    const back = [...document.querySelectorAll("a")].find((a) => a.textContent.trim() === "Back to Runs");
    return {
      notFound: text.includes("Run not found."),
      backHref: back?.getAttribute("href") ?? null,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  })()`);
  record("not-found-unknown-run-desktop", {
    pass:
      probe.notFound &&
      (probe.backHref === "/runs" || probe.backHref === "#/runs") &&
      !probe.overflowX,
    ...probe,
    reason: !probe.notFound
      ? "Run not found copy missing"
      : probe.backHref !== "/runs" && probe.backHref !== "#/runs"
        ? "Back to Runs link missing or wrong href"
        : undefined,
  });
  await screenshot("12-not-found-desktop");

  // C7. Legacy deep link — summary-only detail with limitation notice.
  await navigate("#/runs/legacy-1");
  await waitFor(
    "(document.body.innerText ?? '').includes('Full evidence was not captured')",
    "legacy detail",
  );
  probe = await evaluate(`(() => {
    const text = document.body.innerText ?? "";
    const header = (document.querySelector('[data-section="header"]')?.textContent ?? "").replace(/\\s+/g, " ").trim();
    const copyBtn = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Copy link"));
    const openCompare = document.querySelector('[data-action="open-in-compare"]');
    return {
      // innerText reflects CSS text-transform (badge is uppercase-styled), so
      // assert the badge via the header section's textContent.
      legacyBadge: header.includes("Legacy summary"),
      limitation: text.includes("Full evidence was not captured by the older history format."),
      winner: text.includes("openrouter:z-ai/glm-5.2"),
      hasCopyLink: Boolean(copyBtn),
      hasOpenCompare: Boolean(openCompare),
    };
  })()`);
  record("deeplink-legacy-detail", {
    pass:
      probe.legacyBadge &&
      probe.limitation &&
      probe.winner &&
      probe.hasCopyLink &&
      !probe.hasOpenCompare,
    ...probe,
    reason: !probe.legacyBadge
      ? "legacy summary badge missing"
      : !probe.limitation
        ? "legacy limitation notice missing"
        : !probe.winner
          ? "legacy winner missing"
          : !probe.hasCopyLink
            ? "Copy link missing on legacy detail"
            : probe.hasOpenCompare
              ? "Open in Compare shown for legacy run (no frozen config)"
              : undefined,
  });
  await screenshot("13-legacy-detail");

  // ===========================================================================
  // D2. Zero results — search no-match
  // ===========================================================================
  await navigate("#/runs");
  await waitFor(
    'document.querySelectorAll(\'ul[role="list"] a[href*="/runs/"]\').length >= 11',
    "full list before search",
  );
  await evaluate(`(() => {
    const input = document.querySelector('input[type="search"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "zzz-no-match-query");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await waitFor(
    "(document.body.innerText ?? '').includes('No matching runs.')",
    "search no-match state",
  );
  probe = await evaluate(`(() => {
    const text = document.body.innerText ?? "";
    const clear = document.querySelector('[data-action="clear-empty-filters"]');
    return {
      noMatch: text.includes("No matching runs."),
      noHistoryLeak: !text.includes("No run history yet."),
      rows: document.querySelectorAll('ul[role="list"] a[href*="/runs/"]').length,
      hasClear: Boolean(clear),
    };
  })()`);
  record("zero-results-search-no-match", {
    pass: probe.noMatch && probe.noHistoryLeak && probe.rows === 0 && probe.hasClear,
    ...probe,
    reason: !probe.noMatch
      ? "no-match copy missing for empty search results"
      : probe.rows !== 0
        ? "rows still rendered for no-match search"
        : !probe.hasClear
          ? "clear-filters action missing in no-match state"
          : probe.noHistoryLeak
            ? "no-history state leaked into no-match search"
            : undefined,
  });
  await screenshot("14-zero-results-search");

  // Recovery from no-match via the empty-state clear action.
  await evaluate(`document.querySelector('[data-action="clear-empty-filters"]').click()`);
  await waitFor(
    'document.querySelectorAll(\'ul[role="list"] a[href*="/runs/"]\').length >= 11',
    "rows after clear",
  );
  probe = await evaluate(`(() => {
    const text = document.body.innerText ?? "";
    const input = document.querySelector('input[type="search"]');
    return {
      rowsBack: document.querySelectorAll('ul[role="list"] a[href*="/runs/"]').length,
      noMatchGone: !text.includes("No matching runs."),
      searchCleared: (input?.value ?? "") === "",
    };
  })()`);
  record("zero-results-search-clear-recovery", {
    pass: probe.rowsBack >= 11 && probe.noMatchGone && probe.searchCleared,
    ...probe,
    reason:
      probe.rowsBack < 11
        ? "rows did not return after clear"
        : !probe.noMatchGone
          ? "no-match copy persisted after clear"
          : !probe.searchCleared
            ? "search input not cleared"
            : undefined,
  });

  // ===========================================================================
  // D3. Zero results — filter no-match (status+mode combination that no
  // seeded run satisfies: run-failed is rank mode, so failed+fuse is empty)
  // ===========================================================================
  await evaluate(`(() => {
    const toggle = document.querySelector('[data-action="toggle-filters"]');
    toggle.click();
    return true;
  })()`);
  await waitFor(
    "Boolean(document.querySelector('[data-filter=\\\"status\\\"]'))",
    "filter sheet open",
  );
  await evaluate(`(() => {
    const status = document.querySelector('[data-filter="status"]');
    status.value = "failed";
    status.dispatchEvent(new Event("change", { bubbles: true }));
    const mode = document.querySelector('[data-filter="mode"]');
    mode.value = "fuse";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await waitFor(
    "(document.body.innerText ?? '').includes('No matching runs.')",
    "filter no-match state",
  );
  probe = await evaluate(`(() => {
    const text = document.body.innerText ?? "";
    return {
      noMatch: text.includes("No matching runs."),
      noHistoryLeak: !text.includes("No run history yet."),
      rows: document.querySelectorAll('ul[role="list"] a[href*="/runs/"]').length,
      badge: (document.querySelector('[data-action="toggle-filters"]')?.textContent ?? "").trim(),
    };
  })()`);
  record("zero-results-filter-no-match", {
    pass: probe.noMatch && probe.noHistoryLeak && probe.rows === 0 && probe.badge.includes("2"),
    ...probe,
    reason: !probe.noMatch
      ? "no-match copy missing for empty filter results"
      : probe.rows !== 0
        ? "rows still rendered for no-match filter"
        : !probe.badge.includes("2")
          ? "filter applied-count badge missing"
          : probe.noHistoryLeak
            ? "no-history state leaked into no-match filter"
            : undefined,
  });

  // Recovery from filter no-match via the empty-state clear action.
  await evaluate(`document.querySelector('[data-action="clear-empty-filters"]').click()`);
  await waitFor(
    'document.querySelectorAll(\'ul[role="list"] a[href*="/runs/"]\').length >= 11',
    "rows after filter clear",
  );
  probe = await evaluate(`(() => {
    const text = document.body.innerText ?? "";
    return {
      rowsBack: document.querySelectorAll('ul[role="list"] a[href*="/runs/"]').length,
      badge: (document.querySelector('[data-action="toggle-filters"]')?.textContent ?? "").trim(),
      noMatchGone: !text.includes("No matching runs."),
    };
  })()`);
  record("zero-results-filter-clear-recovery", {
    pass: probe.rowsBack >= 11 && !probe.badge.includes("1") && probe.noMatchGone,
    ...probe,
    reason:
      probe.rowsBack < 11
        ? "rows did not return after filter clear"
        : probe.badge.includes("1")
          ? "applied-count badge not cleared"
          : undefined,
  });

  // ===========================================================================
  // E. Mobile (390x844) — route-based deep links, not-found, legacy
  // ===========================================================================
  await setViewport({ width: 390, height: 844, mobile: true });
  await navigate("#/runs/run-failed");
  await waitFor("(document.body.innerText ?? '').includes('Back to Runs')", "mobile failed detail");
  probe = await evaluate(`(() => {
    const text = document.body.innerText ?? "";
    return {
      hasBack: text.includes("Back to Runs"),
      failedCopy: text.includes("No accepted Judge attempt."),
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  })()`);
  record("mobile-deeplink-failed-detail", {
    pass: probe.hasBack && probe.failedCopy && !probe.overflowX,
    ...probe,
    reason: !probe.hasBack
      ? "Back to Runs missing on mobile detail"
      : !probe.failedCopy
        ? "failed evidence missing on mobile detail"
        : undefined,
  });
  await screenshot("15-mobile-failed-detail");

  await navigate("#/runs/does-not-exist-404");
  await waitFor("(document.body.innerText ?? '').includes('Run not found.')", "mobile not-found");
  probe = await evaluate(`(() => {
    const text = document.body.innerText ?? "";
    const back = [...document.querySelectorAll("a")].find((a) => a.textContent.trim() === "Back to Runs");
    return {
      notFound: text.includes("Run not found."),
      backHref: back?.getAttribute("href") ?? null,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  })()`);
  record("mobile-not-found-unknown-run", {
    pass:
      probe.notFound &&
      (probe.backHref === "/runs" || probe.backHref === "#/runs") &&
      !probe.overflowX,
    ...probe,
    reason: !probe.notFound
      ? "Run not found copy missing on mobile"
      : probe.backHref !== "/runs" && probe.backHref !== "#/runs"
        ? "Back to Runs link missing on mobile not-found"
        : undefined,
  });
  await screenshot("16-mobile-not-found");

  await navigate("#/runs/legacy-1");
  await waitFor(
    "(document.body.innerText ?? '').includes('Full evidence was not captured')",
    "mobile legacy detail",
  );
  probe = await evaluate(`(() => {
    const text = document.body.innerText ?? "";
    return {
      hasBack: text.includes("Back to Runs"),
      limitation: text.includes("Full evidence was not captured by the older history format."),
    };
  })()`);
  record("mobile-legacy-detail", {
    pass: probe.hasBack && probe.limitation,
    ...probe,
    reason: !probe.limitation ? "legacy limitation notice missing on mobile" : undefined,
  });

  // ===========================================================================
  // Final summary — no uncaught exceptions / console errors
  // ===========================================================================
  const finalErrors = results.consoleErrors.filter(
    (e) => !e.includes("Download the React DevTools"),
  );
  record("no-uncaught-exceptions", {
    pass: finalErrors.length === 0,
    errors: finalErrors,
    reason: finalErrors.length ? `console errors: ${finalErrors.join(" | ")}` : undefined,
  });
} finally {
  const summaryPath = path.join(outDir, "results.json");
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2));
  console.log(`QA summary written to ${summaryPath}`);
  console.log(`Probes: ${results.probes.length}, Screenshots: ${results.screenshots.length}`);
  for (const p of results.probes) {
    console.log(`  ${p.pass ? "PASS" : "FAIL"}  ${p.name}`);
  }
  if (results.consoleErrors.length) {
    console.log("Console errors:");
    for (const e of results.consoleErrors) console.log(`  - ${e}`);
  }
  try {
    socket.close();
  } catch {
    // ignore
  }
  chrome.kill("SIGKILL");
}
