// =============================================================================
// cdp-suite-reliability-qa.mjs — production-preview browser QA for the
// Suite Execution Reliability program (spec §17, plan Task 15).
//
// Drives Chrome headless over CDP against a production preview. Deterministic
// fixtures only: provider fetches are mocked in-page (with togglable failure
// flags), and suite/experiment/run records are seeded directly into IndexedDB
// with the persisted shapes the app's validators accept. No paid provider
// calls. Fails nonzero on the first unmet assertion and never prints
// credentials.
//
// Scenarios (plan Task 15 Step 2):
//   1. ready/failed/untested model preflight
//   2. failed preflight confirmation with unchanged roster
//   3. complete winner at 15/15 and provisional leader at 14/15
//   4. one-cell repair cost preview and completion
//   5. failed repair preserving better selected evidence
//   6. 250-task progress at page one and page five
//   7. attempt history collapsed and expanded
//   8. 250-task matrix with sticky first column
//   9. mobile pagination
//  10. keyboard-only controls, Escape, and focus restoration
//  11. 200% zoom
//  12. reduced motion
// =============================================================================

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.QA_BASE_URL ?? process.argv[2] ?? "http://localhost:5176/";
const outDir = path.resolve("docs/qa/suite-execution-reliability");
const chromePath =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const debugPort = 9339;
const results = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  probes: [],
  screenshots: [],
};

fs.mkdirSync(outDir, { recursive: true });

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${path.join(os.tmpdir(), `rsemble-suite-reliability-${Date.now()}`)}`,
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

async function waitFor(expression, label, maxAttempts = 80) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await evaluate(expression)) return;
    await wait(125);
  }
  const diagnostic = await evaluate(`({
    hash: location.hash,
    title: document.title,
    body: (document.body?.innerText ?? "").slice(0, 1200),
  })`);
  throw new Error(`Timed out waiting for ${label}. ${JSON.stringify(diagnostic)}`);
}

async function setViewport({ width, height, mobile = false, touch = false }) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: mobile ? 2 : 1,
    mobile,
  });
  await send(
    "Emulation.setTouchEmulationEnabled",
    touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false },
  );
}

async function navigate() {
  await send("Page.navigate", { url: baseUrl });
  await waitFor(
    "Boolean(document.querySelector('main, [role=main], #root > *'))",
    "application shell",
  );
  await wait(400);
}

async function screenshot(name) {
  const capture = await send("Page.captureScreenshot", { format: "png" });
  const file = `${name}.png`;
  fs.writeFileSync(path.join(outDir, file), Buffer.from(capture.data, "base64"));
  results.screenshots.push(file);
}

async function readExperimentTaskState(experimentId, taskId) {
  return evaluate(`new Promise((resolve, reject) => {
    const open = indexedDB.open("rsemble-evaluation");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("experiments", "readonly").objectStore("experiments").get(${JSON.stringify(experimentId)});
      request.onerror = () => { db.close(); reject(request.error); };
      request.onsuccess = () => {
        const task = request.result?.experiment?.tasks?.find((entry) => entry.taskId === ${JSON.stringify(taskId)}) ?? null;
        db.close();
        resolve(task);
      };
    };
  })`);
}

function record(name, value) {
  results.probes.push({ name, ...value });
  if (value.pass === false) throw new Error(`${name}: ${value.reason ?? "assertion failed"}`);
}

async function clickButton(label) {
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find((element) =>
      (element.getAttribute("aria-label") ?? "").includes(${JSON.stringify(label)}) ||
      (element.textContent ?? "").trim().includes(${JSON.stringify(label)}),
    );
    if (!button) return false;
    window.__qaTrigger = button;
    button.focus();
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Could not find button: ${label}`);
}

async function press(key, code, windowsVirtualKeyCode) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
}

// --- In-page fixture seeding ---------------------------------------------------
//
// The persisted shapes below are validated by the app's runtime guards
// (isEvaluationSuite / isExperimentRecord / isRunRecordV2). They mirror the
// unit-test fixtures so the app accepts them.

const MOCK_FETCH_SOURCE = `(() => {
  window.__qaFailCompletions = false;
  window.__qaFailJudge = false;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/models")) {
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("chat/completions")) {
      const request = JSON.parse(init?.body ?? "{}");
      const model = String(request.model ?? "");
      const isJudgeCall = model.includes("judge");
      if (window.__qaFailCompletions && !isJudgeCall) {
        return new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (window.__qaFailJudge && isJudgeCall) {
        return new Response(JSON.stringify({ error: { message: "judge exploded" } }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (request.stream) {
        const encoder = new TextEncoder();
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"OK"}}]}\\n\\n'));
            controller.enqueue(encoder.encode("data: [DONE]\\n\\n"));
            controller.close();
          },
        }), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      const content = isJudgeCall
        ? JSON.stringify({
            consensus: ["Both candidates completed the task."],
            contradictions: [],
            uniqueInsights: [
              { source: "A", insight: "Candidate A returned a valid response." },
              { source: "B", insight: "Candidate B returned a valid response." },
            ],
            evaluations: [
              { label: "A", score: 4.2, position: "Strong", rationale: "Valid response.", strengths: ["Completed the task"], deductions: [], missedRequirements: [], criterionScores: [] },
              { label: "B", score: 4.4, position: "Strong", rationale: "Valid response.", strengths: ["Completed the task"], deductions: [], missedRequirements: [], criterionScores: [] },
            ],
            comparisons: [{ labels: ["A", "B"], reason: "Candidate B is slightly stronger." }],
          })
        : "OK";
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return nativeFetch(input, init);
  };
})()`;

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
  const del = (db, store, id) => new Promise((resolve, reject) => {
    const r = tx(db, store, "readwrite").delete(id);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });

  const db = await openDb();

  const SLOTS = [
    { id: "s1", providerId: "umans", provider: "Umans", model: "Model", slug: "model", enabled: true },
    { id: "s2", providerId: "9router", provider: "9Router", model: "Route", slug: "route", enabled: true },
  ];
  const MK1 = "umans:model";
  const MK2 = "9router:route";

  function makeTask(id, order) {
    return { id, title: "Task " + id, prompt: "Prompt " + id, systemPrompt: "", evaluation: { kind: "holistic" }, judgeInstructionOverride: "", order };
  }

  function makeSnapshot(taskIds) {
    return {
      suiteId: "suite-qa",
      suiteVersion: 1,
      tasks: taskIds.map(makeTask),
      modelSlots: SLOTS,
      defaultJudge: { providerId: "openrouter", model: "judge" },
      defaultEvaluation: { kind: "holistic" },
      profiles: [],
      protocolFingerprint: "sha256:qa",
      createdAt: 1700000000000,
    };
  }

  function makeRun(runId, scoredKeys, opts = {}) {
    const candidates = SLOTS.map((slot, i) => {
      const key = slot.providerId + ":" + slot.slug;
      const accepted = scoredKeys.includes(key);
      return {
        candidateId: "cand-" + slot.id,
        slotId: slot.id,
        modelKey: key,
        providerId: slot.providerId,
        model: slot.model,
        slug: slot.slug,
        acceptedAttemptId: accepted ? "att-cand-" + i : null,
        attempts: accepted ? [{
          attemptId: "att-cand-" + i,
          messages: [],
          startedAt: 1700000000000,
          finishedAt: 1700000001000,
          status: "completed",
          output: "output-" + key,
          tokensIn: 1,
          tokensOut: 1,
          error: null,
          ...(opts.reusedFrom ? { reusedFrom: opts.reusedFrom } : {}),
        }] : [],
      };
    });
    const evaluationsById = {};
    scoredKeys.forEach((key, i) => {
      evaluationsById["cand-" + SLOTS[i].id] = {
        candidateId: "cand-" + SLOTS[i].id,
        blindLabel: "A",
        overallScore: key === MK1 ? 4.38 : 4.54,
        position: "p",
        rationale: "r",
        strengths: ["s"],
        deductions: [],
        missedRequirements: [],
        criterionScores: [],
      };
    });
    return {
      schemaVersion: 2,
      id: runId,
      revision: 1,
      execution: { ownerId: "qa-tab", fence: 1 },
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      completedAt: 1700000001000,
      status: opts.status ?? "completed",
      mode: "rank",
      source: opts.source ?? { kind: "adhoc" },
      task: { title: "t", prompt: "p", systemPrompt: "", temperature: 0.7 },
      evaluation: { profile: null, candidateMessages: [] },
      candidates,
      judge: {
        status: "done",
        acceptedAttemptId: "judge-att-1",
        report: { labelMap: [], evaluationsById, comparisons: [] },
        consensus: null,
        attempts: [],
      },
      fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
      winnerKeys: scoredKeys.includes(MK1) ? [MK1] : [],
    };
  }

  function makeSummary(run) {
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
      scoresByModelKey: {},
      judgeModelKey: "openrouter:judge",
      evaluationProfileId: null,
      evaluationProfileVersion: null,
      detailAvailable: true,
      searchText: run.task.prompt,
    };
  }

  // Indexed store rows — the app's repositories read wrapper rows, never raw
  // domain records (database.ts).
  function runSummaryRow(run) {
    return {
      kind: "full",
      summary: makeSummary(run),
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

  function experimentRow(experiment) {
    return {
      id: experiment.id,
      experiment,
      revision: experiment.revision,
      suiteId: experiment.suiteId,
      suiteVersion: experiment.suiteVersion,
      protocolFingerprint: experiment.protocolFingerprint,
      createdAt: experiment.createdAt,
      status: experiment.status,
    };
  }

  function suiteRow(suite) {
    return {
      id: suite.id,
      suite,
      revision: suite.revision,
      version: suite.version,
      updatedAt: suite.updatedAt,
      archivedAt: suite.archivedAt,
    };
  }

  const suite = {
    id: "suite-qa",
    revision: 2,
    version: 1,
    name: "QA Suite",
    description: "qa",
    tasks: ["t1", "t2"].map(makeTask),
    modelSlots: SLOTS,
    defaultJudge: { providerId: "openrouter", model: "judge" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    archivedAt: null,
  };
  await put(db, "suites", suiteRow(suite));

  // exp-qa: 15 tasks — umans complete at 4.38, 9router provisional at 14/15.
  const qaTaskIds = Array.from({ length: 15 }, (_, i) => "t" + (i + 1));
  for (let i = 0; i < 15; i++) {
    const taskId = qaTaskIds[i];
    const runId = "run-qa-" + taskId;
    const scored = [MK1];
    if (i < 14) scored.push(MK2);
    const run = makeRun(runId, scored, {
      source: { kind: "experiment", experimentId: "exp-qa", suiteId: "suite-qa", suiteVersion: 1, protocolFingerprint: "sha256:qa", taskId, experimentTaskAttemptId: "att-" + taskId, trial: 0 },
    });
    await put(db, "runDetails", runDetailRow(run));
    await put(db, "runSummaries", runSummaryRow(run));
  }
  await put(db, "experiments", experimentRow({
    id: "exp-qa",
    revision: 3,
    suiteId: "suite-qa",
    suiteVersion: 1,
    protocolFingerprint: "sha256:qa",
    status: "completed",
    execution: null,
    snapshot: makeSnapshot(qaTaskIds),
    tasks: qaTaskIds.map((taskId) => ({
      taskId,
      selectedAttemptId: "att-" + taskId,
      attempts: [{ id: "att-" + taskId, runId: "run-qa-" + taskId, trial: 0, status: "completed", startedAt: 1700000000000, finishedAt: 1700000001000, error: null }],
    })),
    createdAt: 1700000000000,
    updatedAt: 1700000002000,
  }));

  // exp-big: 250 tasks, selected PARTIAL attempt (1/2 scored, 9router no-score)
  // so the cell is repairable. Prior failed attempt stays in history.
  const bigTaskIds = Array.from({ length: 250 }, (_, i) => "t" + (i + 1));
  for (let i = 0; i < 250; i++) {
    const taskId = bigTaskIds[i];
    const runId = "run-big-" + taskId;
    const run = makeRun(runId, [MK1], {
      status: "partial",
      source: { kind: "experiment", experimentId: "exp-big", suiteId: "suite-qa", suiteVersion: 1, protocolFingerprint: "sha256:qa", taskId, experimentTaskAttemptId: "att-" + taskId, trial: 1 },
    });
    await put(db, "runDetails", runDetailRow(run));
    await put(db, "runSummaries", runSummaryRow(run));
    // Prior failed attempt run (for history).
    const oldRun = makeRun(runId + "-old", [], {
      status: "failed",
      source: { kind: "experiment", experimentId: "exp-big", suiteId: "suite-qa", suiteVersion: 1, protocolFingerprint: "sha256:qa", taskId, experimentTaskAttemptId: "att-" + taskId + "-old", trial: 0 },
    });
    await put(db, "runDetails", runDetailRow(oldRun));
    await put(db, "runSummaries", runSummaryRow(oldRun));
  }
  await put(db, "experiments", experimentRow({
    id: "exp-big",
    revision: 3,
    suiteId: "suite-qa",
    suiteVersion: 1,
    protocolFingerprint: "sha256:qa",
    status: "completed_with_failures",
    execution: null,
    snapshot: makeSnapshot(bigTaskIds),
    tasks: bigTaskIds.map((taskId) => ({
      taskId,
      selectedAttemptId: "att-" + taskId,
      attempts: [
        { id: "att-" + taskId + "-old", runId: "run-big-" + taskId + "-old", trial: 0, status: "failed", startedAt: 1700000000000, finishedAt: 1700000001000, error: null },
        { id: "att-" + taskId, runId: "run-big-" + taskId, trial: 1, status: "partial", startedAt: 1700000002000, finishedAt: 1700000003000, error: null, coverage: { scoredModelKeys: [MK1], totalModels: 2 } },
      ],
    })),
    createdAt: 1700000000000,
    updatedAt: 1700000002000,
  }));

  // exp-running: 250 tasks, running status with queued work — drives the
  // progress ledger (page 1 and page 5) and attempt-history disclosure.
  const runTaskIds = Array.from({ length: 250 }, (_, i) => "t" + (i + 1));
  for (let i = 0; i < 250; i++) {
    const taskId = runTaskIds[i];
    const runId = "run-running-" + taskId;
    const run = makeRun(runId, [MK1], {
      status: i < 3 ? "completed" : i === 3 ? "running" : "partial",
      source: { kind: "experiment", experimentId: "exp-running", suiteId: "suite-qa", suiteVersion: 1, protocolFingerprint: "sha256:qa", taskId, experimentTaskAttemptId: "att-" + taskId, trial: 0 },
    });
    await put(db, "runDetails", runDetailRow(run));
    await put(db, "runSummaries", runSummaryRow(run));
  }
  await put(db, "experiments", experimentRow({
    id: "exp-running",
    revision: 3,
    suiteId: "suite-qa",
    suiteVersion: 1,
    protocolFingerprint: "sha256:qa",
    status: "running",
    execution: { ownerId: "qa-tab", fence: 1 },
    snapshot: makeSnapshot(runTaskIds),
    tasks: runTaskIds.map((taskId, i) => ({
      taskId,
      selectedAttemptId: "att-" + taskId,
      attempts: [
        { id: "att-" + taskId + "-old", runId: "run-running-" + taskId + "-old", trial: 0, status: "failed", startedAt: 1700000000000, finishedAt: 1700000001000, error: null },
        { id: "att-" + taskId, runId: "run-running-" + taskId, trial: 1, status: i < 3 ? "completed" : i === 3 ? "running" : "queued", startedAt: i < 3 ? 1700000002000 : null, finishedAt: i < 3 ? 1700000003000 : null, error: null, coverage: i < 3 ? { scoredModelKeys: [MK1, MK2], totalModels: 2 } : undefined },
      ],
    })),
    createdAt: 1700000000000,
    updatedAt: 1700000002000,
  }));

  db.close();
  return { suiteId: "suite-qa", qaId: "exp-qa", bigId: "exp-big", runningId: "exp-running" };
})().catch((e) => ({ __seedError: e instanceof Error ? e.message : String(e), __seedStack: e instanceof Error ? e.stack : "" }))`;

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK_FETCH_SOURCE });
  await send("Emulation.setEmulatedMedia", { features: [] });
  await setViewport({ width: 1440, height: 1000 });

  await navigate();
  await waitFor("Boolean(window.indexedDB)", "indexedDB");
  const seeded = await evaluate(SEED_SOURCE);
  if (seeded?.__seedError)
    throw new Error(`Seed failed: ${seeded.__seedError}\n${seeded.__seedStack}`);
  results.seeded = seeded;

  // --- Scenario 1: model preflight ready / failed / untested -------------------
  await send("Page.navigate", { url: `${baseUrl}#/compare` });
  await waitFor("Boolean(document.querySelector('textarea'))", "compare task input");
  const preflight = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll("button")];
    const testButtons = buttons.filter((b) => (b.getAttribute("aria-label") ?? "").includes("Test model"));
    return {
      testActions: testButtons.length,
      untestedActions: testButtons.filter((button) =>
        !button.parentElement?.querySelector('[role="status"], [role="alert"]')
      ).length,
      costNotice: (document.body.textContent ?? "").includes("Live model tests send a small generation request"),
    };
  })()`);
  record("compare-model-preflight", {
    ...preflight,
    pass: preflight.testActions > 0 && preflight.untestedActions > 0 && preflight.costNotice,
    reason: "Compare exposes model test actions, explicit Untested state, and the cost notice",
  });
  if (preflight.testActions > 0) {
    await clickButton("Test model");
    await waitFor("Boolean(document.querySelector('[role=\"status\"]'))", "probe status");
    await wait(400);
    const probe = await evaluate(`(() => {
      const status = document.querySelector('[role="status"]');
      const text = status?.textContent ?? "";
      return { ready: text.includes("Ready"), text };
    })()`);
    record("compare-probe-ready", {
      ...probe,
      pass: probe.ready,
      reason: "mocked provider stream yields a Ready probe result",
    });
    await screenshot("qa-probe-ready");

    // Failed probe: flip the mock to reject, re-test.
    await evaluate("window.__qaFailCompletions = true");
    await clickButton("Test model");
    await waitFor("Boolean(document.querySelector('[role=\"alert\"]'))", "failed probe alert");
    const failedProbe = await evaluate(`(() => {
      const alert = document.querySelector('[role="alert"]');
      const text = alert?.textContent ?? "";
      return {
        unauthorized: text.includes("Unauthorized"),
        noCredentialLeak: !/sk-[A-Za-z0-9]{6,}/.test(document.body.textContent ?? ""),
      };
    })()`);
    record("compare-probe-failed", {
      ...failedProbe,
      pass: failedProbe.unauthorized && failedProbe.noCredentialLeak,
      reason: "failed probe renders a sanitized Unauthorized state without credential-shaped text",
    });
    await screenshot("qa-probe-failed");
    await evaluate("window.__qaFailCompletions = false");
  }

  // --- Scenario 2: failed preflight confirmation with unchanged roster ---------
  await evaluate("window.__qaFailCompletions = true");
  await send("Page.navigate", { url: `${baseUrl}#/evaluations/suite-qa` });
  await waitFor(
    "Boolean(document.querySelector('[data-action=\"run-suite\"]'))",
    "suite editor run",
  );
  await clickButton("Settings");
  await waitFor(
    "Boolean(document.querySelector('#suite-settings-disclosure'))",
    "suite settings disclosure",
  );
  const preflightRosterBefore = await evaluate(`[
    ...document.querySelectorAll('button[aria-label^="Test model "]')
  ].map((button) => button.getAttribute("aria-label"))`);
  // Test selected models with the failing mock → Failed states.
  await clickButton("Test selected models");
  await waitFor("Boolean(document.querySelector('[role=\"alert\"]'))", "failed batch probe");
  // Open Run → preflight confirmation must list failures and require Run anyway.
  await clickButton("Run v1");
  await waitFor("Boolean(document.querySelector('[role=\"dialog\"]'))", "preflight dialog");
  const preflightDialog = await evaluate(`(() => {
    const text = document.body.textContent ?? "";
    const labels = [...document.querySelectorAll("button")].map((b) => b.textContent?.trim());
    return {
      failedListed: text.includes("Failed models"),
      runAnyway: labels.includes("Run anyway"),
      reviewTests: labels.includes("Review model tests"),
      noReadySubset: !/run ready models only/i.test(text),
      roster: [...document.querySelectorAll('button[aria-label^="Test model "]')]
        .map((button) => button.getAttribute("aria-label")),
    };
  })()`);
  record("preflight-failed-confirmation", {
    ...preflightDialog,
    rosterUnchanged:
      JSON.stringify(preflightRosterBefore) === JSON.stringify(preflightDialog.roster),
    pass:
      preflightDialog.failedListed &&
      preflightDialog.runAnyway &&
      preflightDialog.reviewTests &&
      preflightDialog.noReadySubset &&
      JSON.stringify(preflightRosterBefore) === JSON.stringify(preflightDialog.roster),
    reason:
      "failed preflight lists failures, requires Run anyway, and preserves the exact selected roster",
  });
  await screenshot("qa-preflight-failed");
  await press("Escape", "Escape", 27);
  await evaluate("window.__qaFailCompletions = false");

  // --- Scenario 3: complete winner + provisional leader ------------------------
  await send("Page.navigate", { url: `${baseUrl}#/experiments/exp-qa` });
  await waitFor(
    "Boolean(document.querySelector('[data-testid=\"winner-callout\"]'))",
    "winner callout",
  );
  const winner = await evaluate(`(() => {
    const callout = document.querySelector('[data-testid="winner-callout"]');
    const text = document.body.textContent ?? "";
    const provisionalHeading = [...document.querySelectorAll("h2")]
      .find((element) => (element.textContent ?? "").includes("Provisional results"));
    return {
      winnerTitle: callout?.textContent ?? "",
      provisionalRows: provisionalHeading?.nextElementSibling?.textContent ?? "",
      provisionalHasNumericRank: /#\s*\d+/.test(provisionalHeading?.nextElementSibling?.textContent ?? ""),
      hasProvisionalLeader: text.includes("Provisional score leader"),
      notEligible: text.includes("not winner-eligible"),
      hasProvisionalResults: text.includes("Provisional results"),
      overflowX: document.documentElement.scrollWidth > innerWidth,
    };
  })()`);
  record("winner-provisional-15-14", {
    ...winner,
    pass:
      (winner.winnerTitle ?? "").includes("Complete-coverage winner") &&
      (winner.winnerTitle ?? "").includes("umans") &&
      winner.hasProvisionalLeader &&
      winner.notEligible &&
      winner.hasProvisionalResults &&
      !winner.provisionalHasNumericRank &&
      !winner.overflowX,
    reason:
      "complete 15/15 model crowned; incomplete 14/15 labeled provisional without numeric rank",
  });
  await screenshot("qa-winner-provisional");

  // --- Scenario 8: 250-task matrix with sticky first column --------------------
  await send("Page.navigate", { url: `${baseUrl}#/experiments/exp-big` });
  await waitFor("Boolean(document.querySelector('table thead th'))", "big matrix", 240);
  const matrix = await evaluate(`(() => {
    const header = document.querySelector("thead th");
    const firstRow = document.querySelector("tbody tr th");
    const region = document.querySelector("[role='region']");
    const footer = document.querySelector("tfoot th");
    return {
      rowsMounted: document.querySelectorAll("tbody tr").length,
      rangeText: (document.body.textContent ?? "").match(/\\d+–\\d+ of \\d+/)?.[0] ?? null,
      headerStickyLeft: ((header?.getAttribute("class") ?? "").includes("sticky") && (header?.getAttribute("class") ?? "").includes("left-0")),
      firstRowStickyLeft: (firstRow?.getAttribute("class") ?? "").includes("sticky left-0"),
      footerStickyLeft: (footer?.getAttribute("class") ?? "").includes("sticky left-0"),
      regionFocusable: region?.getAttribute("tabindex") === "0",
      headerStickyTop: getComputedStyle(header).position === "sticky"
        && (header?.getAttribute("class") ?? "").includes("top-0"),
      opaqueHeader: !getComputedStyle(header).backgroundColor.endsWith(", 0)"),
    };
  })()`);
  record("matrix-250-sticky", {
    ...matrix,
    pass:
      matrix.rowsMounted <= 50 &&
      matrix.rangeText === "1–50 of 250" &&
      matrix.headerStickyLeft &&
      matrix.firstRowStickyLeft &&
      matrix.footerStickyLeft &&
      matrix.regionFocusable &&
      matrix.headerStickyTop &&
      matrix.opaqueHeader,
    reason:
      "250-task matrix mounts <=50 rows, sticky first column (header/row/footer) and focusable scroll region",
  });
  await evaluate(`(() => {
    const region = document.querySelector("table")?.closest("[role='region']");
    region?.scrollIntoView({ block: "center" });
  })()`);
  await screenshot("qa-matrix-250");

  // --- Scenario 4: one-cell repair cost preview and completion -----------------
  // First repairable cell (task t1, model 9router:route) → Complete missing result.
  await clickButton("Complete missing result");
  await waitFor("Boolean(document.querySelector('[role=\"dialog\"]'))", "recovery dialog");
  const recovery = await evaluate(`(() => {
    const text = document.body.textContent ?? "";
    return {
      oneCandidateCall: /1 candidate call/i.test(text),
      oneJudgeCall: /1 Judge call/i.test(text),
      reuseMention: /outputs? will be reused/i.test(text) || /reuse/i.test(text),
    };
  })()`);
  record("recovery-cost-preview", {
    ...recovery,
    pass: recovery.oneCandidateCall && recovery.oneJudgeCall && recovery.reuseMention,
    reason: "recovery dialog previews exact candidate + Judge call counts",
  });
  await screenshot("qa-recovery-dialog");
  // Confirm → repair executes (mock success) → cell becomes scored.
  const confirmed = await evaluate(`(() => {
    const confirm = document.querySelector("[data-recovery-confirm]");
    if (!confirm) return false;
    window.__qaTrigger = document.activeElement;
    confirm.click();
    return true;
  })()`);
  if (!confirmed) throw new Error("Could not find repair confirm action");
  await waitFor(
    "!document.querySelector('[role=\"dialog\"]') || Boolean(document.querySelector('[data-recovery-message]'))",
    "recovery result",
  );
  const recoveryError = await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return dialog?.querySelector('[data-recovery-message]')?.textContent ?? null;
  })()`);
  if (recoveryError) throw new Error(`Repair start failed: ${recoveryError}`);
  // The repair commits a newly judged compound attempt. Wait until the exact
  // t1 matrix row is scored and its recovery action disappears.
  await waitFor(
    `(() => {
    const row = [...document.querySelectorAll("tbody tr")]
      .find((candidate) => (candidate.querySelector("th")?.textContent ?? "").trim() === "Task t1");
    return Boolean(row) && !(row.textContent ?? "").includes("No score")
      && !row.querySelector("[data-recovery-action]");
  })()`,
    "repaired t1 result",
    240,
  );
  const afterRepair = await evaluate(`(() => {
    const repairButtons = [...document.querySelectorAll("[data-recovery-action='repair-cell']")];
    return {
      anyRepairableCellLeft: repairButtons.length,
      t1Row: [...document.querySelectorAll("tbody tr")]
        .find((tr) => (tr.querySelector("th")?.textContent ?? "").trim() === "Task t1")?.textContent ?? "",
    };
  })()`);
  record("recovery-cell-completed", {
    ...afterRepair,
    pass: afterRepair.t1Row.includes("Task t1") && !afterRepair.t1Row.includes("No score"),
    reason: "repair execution selects newly judged evidence and clears the missing t1 cell",
  });
  await evaluate(`(() => {
    const row = [...document.querySelectorAll("tbody tr")]
      .find((candidate) => (candidate.querySelector("th")?.textContent ?? "").trim() === "Task t1");
    row?.scrollIntoView({ block: "center" });
  })()`);
  await screenshot("qa-after-repair");

  // --- Scenario 5: failed repair preserves better selected evidence ------------
  // Flip the judge to fail; repair another cell (t2) → attempt fails → prior
  // selected partial attempt stays selected.
  await evaluate("window.__qaFailJudge = true");
  await clickButton("Complete missing result");
  await waitFor("Boolean(document.querySelector('[role=\"dialog\"]'))", "recovery dialog 2");
  const confirmed2 = await evaluate(`(() => {
    const confirm = document.querySelector("[data-recovery-confirm]");
    if (!confirm) return false;
    confirm.click();
    return true;
  })()`);
  if (!confirmed2) throw new Error("Could not find second repair confirm");
  await waitFor("!document.querySelector('[role=\"dialog\"]')", "recovery dialog 2 close");
  let failedTaskState = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    failedTaskState = await readExperimentTaskState("exp-big", "t2");
    const latestStatus = failedTaskState?.attempts?.at(-1)?.status;
    if (
      (failedTaskState?.attempts?.length ?? 0) >= 3 &&
      latestStatus !== "queued" &&
      latestStatus !== "running"
    )
      break;
    await wait(125);
  }
  const failedRepair = await evaluate(`(() => {
    const text = document.body.textContent ?? "";
    // The t2 cell must STILL be missing (judge failure → repair attempt failed
    // → the prior selected partial attempt keeps selection).
    const t2Row = [...document.querySelectorAll("tbody tr")]
      .find((tr) => (tr.querySelector("th")?.textContent ?? "").trim() === "Task t2")?.textContent ?? "";
    return {
      surfaceAlive: text.includes("Experiment results"),
      cellStillMissing: t2Row.includes("No score"),
      repairActionStillOffered: t2Row.includes("Complete missing result"),
    };
  })()`);
  const latestFailedAttemptStatus = failedTaskState?.attempts?.at(-1)?.status ?? null;
  record("failed-repair-preserves-evidence", {
    ...failedRepair,
    attempts: failedTaskState?.attempts?.length ?? 0,
    selectedAttemptId: failedTaskState?.selectedAttemptId ?? null,
    latestAttemptStatus: latestFailedAttemptStatus,
    pass:
      failedRepair.surfaceAlive &&
      failedRepair.cellStillMissing &&
      failedRepair.repairActionStillOffered &&
      (failedTaskState?.attempts?.length ?? 0) >= 3 &&
      failedTaskState?.selectedAttemptId === "att-t2" &&
      latestFailedAttemptStatus !== "queued" &&
      latestFailedAttemptStatus !== "running",
    reason:
      "a terminal judge-failing repair adds an attempt but preserves the better selected evidence and leaves the repair action available",
  });
  await evaluate(`(() => {
    const row = [...document.querySelectorAll("tbody tr")]
      .find((candidate) => (candidate.querySelector("th")?.textContent ?? "").trim() === "Task t2");
    row?.scrollIntoView({ block: "center" });
  })()`);
  await screenshot("qa-failed-repair");
  await evaluate("window.__qaFailJudge = false");

  // --- Scenario 6/7: 250-task progress ledger + attempt history ----------------
  await send("Page.navigate", { url: `${baseUrl}#/experiments/exp-running` });
  await waitFor("Boolean(document.querySelector('[data-task-row]'))", "task ledger", 240);
  const ledger = await evaluate(`(() => {
    const text = document.body.textContent ?? "";
    return {
      rowsMounted: document.querySelectorAll("[data-task-row]").length,
      rangeText: text.match(/\\d+–\\d+ of \\d+/)?.[0] ?? null,
      instrumentVisible: Boolean(document.querySelector("[data-ledger-instrument]")),
      historyCollapsed: !document.querySelector("[data-attempt-row]"),
    };
  })()`);
  record("ledger-250-page1", {
    ...ledger,
    pass:
      ledger.rowsMounted <= 50 &&
      ledger.rangeText === "1–50 of 250" &&
      ledger.instrumentVisible &&
      ledger.historyCollapsed,
    reason: "250-task ledger mounts <=50 rows with sticky instrument header and collapsed history",
  });
  await screenshot("qa-ledger-250-page1");
  // Page five.
  await clickButton("Next");
  await waitFor("(document.body.textContent ?? '').includes('51–100 of 250')", "ledger page two");
  await clickButton("Next");
  await clickButton("Next");
  await clickButton("Next");
  await waitFor("(document.body.textContent ?? '').includes('201–250 of 250')", "ledger page five");
  const ledgerPage5 = await evaluate(`({
    rowsMounted: document.querySelectorAll("[data-task-row]").length,
    rangeText: (document.body.textContent ?? "").match(/\\d+–\\d+ of \\d+/)?.[0] ?? null,
  })`);
  record("ledger-250-page5", {
    ...ledgerPage5,
    pass: ledgerPage5.rowsMounted <= 50 && ledgerPage5.rangeText === "201–250 of 250",
    reason: "page five mounts <=50 rows with the correct range",
  });
  await screenshot("qa-ledger-250-page5");
  // Expand attempt history disclosure.
  await evaluate(`(() => {
    const disclosure = document.querySelector("[data-attempt-toggle]");
    if (disclosure) disclosure.click();
    return Boolean(disclosure);
  })()`);
  await waitFor(
    "Boolean(document.querySelector('[data-attempt-row]'))",
    "attempt history expanded",
  );
  const history = await evaluate(`(() => {
    return {
      attemptRows: document.querySelectorAll("[data-attempt-row]").length,
      hasOldFailed: (document.body.textContent ?? "").includes("failed") || (document.body.textContent ?? "").includes("Failed"),
    };
  })()`);
  record("ledger-attempt-history", {
    ...history,
    pass: history.attemptRows > 0 && history.hasOldFailed,
    reason: "expanding the disclosure mounts attempt rows including historical failures",
  });
  await evaluate(
    `document.querySelector("[data-attempt-history]")?.scrollIntoView({ block: "center" })`,
  );
  await screenshot("qa-ledger-history-expanded");

  // --- Scenario 9: mobile pagination -------------------------------------------
  await setViewport({ width: 390, height: 844, mobile: true, touch: true });
  await send("Page.navigate", { url: `${baseUrl}#/experiments/exp-big` });
  await waitFor(
    "Boolean(document.querySelector('select#mobile-experiment-model-select'))",
    "mobile results",
    240,
  );
  const mobile = await evaluate(`(() => {
    const select = document.querySelector("select#mobile-experiment-model-select");
    const root = select?.parentElement?.parentElement;
    const cards = root?.querySelectorAll(":scope > ul > li") ?? [];
    return {
      cardsMounted: cards.length,
      rangeText: (root?.querySelector('nav[aria-label="Pagination"]')?.textContent ?? "").match(/\\d+–\\d+ of \\d+/)?.[0] ?? null,
      overflowX: document.documentElement.scrollWidth > innerWidth,
    };
  })()`);
  record("mobile-250-pagination", {
    ...mobile,
    pass: mobile.cardsMounted <= 50 && mobile.rangeText === "1–50 of 250" && !mobile.overflowX,
    reason: "mobile mounts <=50 cards with range text and no page-level horizontal overflow",
  });
  await screenshot("qa-mobile-250");
  await clickButton("Next page");
  await waitFor(
    `(() => {
    const select = document.querySelector("select#mobile-experiment-model-select");
    const root = select?.parentElement?.parentElement;
    return (root?.querySelector('nav[aria-label="Pagination"]')?.textContent ?? "").includes("51–100 of 250");
  })()`,
    "mobile page two",
  );
  const mobilePage2 = await evaluate(`(() => {
    const select = document.querySelector("select#mobile-experiment-model-select");
    const root = select?.parentElement?.parentElement;
    return {
      cardsMounted: root?.querySelectorAll(":scope > ul > li").length ?? 0,
      overflowX: document.documentElement.scrollWidth > innerWidth,
    };
  })()`);
  record("mobile-250-page-two", {
    ...mobilePage2,
    pass: mobilePage2.cardsMounted <= 50 && !mobilePage2.overflowX,
    reason: "mobile page two mounts <=50 cards without overflow",
  });
  await screenshot("qa-mobile-250-page2");

  // --- Scenario 10: keyboard-only dialog flow ----------------------------------
  await setViewport({ width: 1440, height: 1000, mobile: false, touch: false });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await send("Page.navigate", { url: `${baseUrl}#/compare` });
  await waitFor("Boolean(document.querySelector('textarea'))", "compare for keyboard");
  const keyboardTriggerFocused = await evaluate(`(() => {
    const trigger = [...document.querySelectorAll("button")]
      .find((button) => (button.getAttribute("aria-label") ?? "").startsWith("Connection status:"));
    if (!trigger) return false;
    window.__qaTrigger = trigger;
    trigger.focus();
    return document.activeElement === trigger;
  })()`);
  if (!keyboardTriggerFocused) throw new Error("Could not focus the connection-status trigger");
  await press(" ", "Space", 32);
  await waitFor("Boolean(document.querySelector('[role=dialog]'))", "connections dialog");
  const dialog = await evaluate(`(() => {
    const el = document.querySelector('[role=dialog]');
    return {
      focusInDialog: Boolean(el?.contains(document.activeElement)),
      overflowX: document.documentElement.scrollWidth > innerWidth,
    };
  })()`);
  const trapPrepared = await evaluate(`(() => {
    const dialog = document.querySelector('[role=dialog]');
    const focusable = [...(dialog?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
    const last = focusable.at(-1);
    last?.focus();
    return Boolean(last) && document.activeElement === last;
  })()`);
  if (!trapPrepared) throw new Error("Could not prepare dialog focus-trap assertion");
  await press("Tab", "Tab", 9);
  const tabTrapped = await evaluate(
    "Boolean(document.querySelector('[role=dialog]')?.contains(document.activeElement))",
  );
  record("dialog-keyboard-focus", {
    ...dialog,
    keyboardOpened: keyboardTriggerFocused,
    tabTrapped,
    pass: keyboardTriggerFocused && dialog.focusInDialog && tabTrapped && !dialog.overflowX,
    reason:
      "keyboard opens the dialog, focus enters it, and Tab remains trapped without horizontal overflow",
  });
  await screenshot("qa-dialog");
  await press("Escape", "Escape", 27);
  await waitFor("!document.querySelector('[role=dialog]')", "dialog close");
  const restored = await evaluate("document.activeElement === window.__qaTrigger");
  record("dialog-focus-restored", {
    restored,
    pass: restored,
    reason: "Escape restores focus to the trigger",
  });

  // --- Scenario 11: 200% zoom --------------------------------------------------
  await setViewport({ width: 720, height: 500 });
  await navigate();
  const zoom = await evaluate(`({
    overflowX: document.documentElement.scrollWidth > innerWidth,
    innerWidth,
  })`);
  record("zoom-200-percent", {
    ...zoom,
    pass: !zoom.overflowX && zoom.innerWidth === 720,
    reason: "effective 200% CSS viewport fits without horizontal overflow",
  });
  await screenshot("qa-zoom-200");

  // --- Scenario 12: reduced motion ----------------------------------------------
  await setViewport({ width: 1440, height: 1000 });
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await navigate();
  const reduced = await evaluate(`(() => {
    const spinner = document.createElement("span");
    spinner.className = "animate-spin-ease";
    document.body.append(spinner);
    const animation = getComputedStyle(spinner).animationName;
    spinner.remove();
    return {
      spinnerAnimation: animation,
      overflowX: document.documentElement.scrollWidth > innerWidth,
    };
  })()`);
  record("reduced-motion", {
    ...reduced,
    pass: reduced.spinnerAnimation === "none" && !reduced.overflowX,
    reason: "reduced motion removes spinner rotation without horizontal overflow",
  });
  await screenshot("qa-reduced-motion");

  fs.writeFileSync(path.join(outDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`Suite-reliability QA passed. Evidence: ${outDir}`);
} catch (error) {
  fs.writeFileSync(
    path.join(outDir, "results.json"),
    `${JSON.stringify({ ...results, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`,
  );
  console.error(error);
  process.exitCode = 1;
} finally {
  socket.close();
  chrome.kill();
}
