// =============================================================================
// cdp-experiment-roster-extension-qa.mjs — production-preview browser QA for
// the Experiment Roster Extension program (plan 001, Workstream G2).
//
// Drives Chrome headless over CDP against a production preview. Deterministic
// fixtures only: provider fetches are mocked in-page, suite/experiment/run
// records are seeded directly into IndexedDB with the persisted shapes the
// app's validators accept. No paid provider calls, no real network egress —
// every openrouter.ai request is intercepted. Fails nonzero on the first
// unmet assertion and never prints credential-shaped text.
//
// Scenarios (plan 001 G2):
//   1. catalog model + suite sync ON: exact preview, handoff to progress,
//      only-new-model provider calls on reusable tasks, fresh Judge calls,
//      scored new column, suite version increment, stable slot id parity
//   2. raw slug + suite sync OFF (empty catalog): new column, suite unchanged
//   3. one task lacking reusable evidence: fallback sentence + counts, that
//      task runs the full rotated roster, the other runs only the new model
//   4. roster/history model excluded from the picker; no network attempted
//   5. abort during extension, reload: committed evidence adopted with zero
//      completion calls after the reload
//   6. keyboard-only open/cancel, focus restoration, 390px, 200% zoom,
//      reduced-motion rendering
//   7. visual separation: header Add-model action vs. recovery toolbar
// =============================================================================

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.QA_BASE_URL ?? process.argv[2] ?? "http://localhost:5176/";
const outDir = path.resolve("docs/qa/experiment-roster-extension");
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const debugPort = 9340;
const results = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  probes: [],
  screenshots: [],
};
fs.mkdirSync(outDir, { recursive: true });

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${path.join(os.tmpdir(), `rsemble-roster-extension-${Date.now()}`)}`,
  "--no-first-run",
  "--no-default-browser-check",
  "about:blank",
], { stdio: "ignore" });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getPageWebSocketUrl() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const pages = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${debugPort}/json/list`, (response) => {
          let body = "";
          response.on("data", (chunk) => { body += chunk; });
          response.on("end", () => resolve(JSON.parse(body)));
        }).on("error", reject);
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
await new Promise((resolve) => { socket.onopen = resolve; });

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
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description
      ?? result.exceptionDetails.text
      ?? "Runtime evaluation failed.";
    throw new Error(detail);
  }
  return result.result?.value;
}

async function waitFor(expression, label, maxAttempts = 160) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await evaluate(expression)) return;
    await wait(250);
  }
  const diagnostic = await evaluate(`({
    hash: location.hash,
    title: document.title,
    body: (document.body?.innerText ?? "").slice(0, 1200),
  })`);
  throw new Error(`Timed out waiting for ${label}. ${JSON.stringify(diagnostic)}`);
}

async function setViewport({ width, height, mobile = false, scale = 1 }) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: scale,
    mobile,
  });
  await send("Emulation.setTouchEmulationEnabled", mobile
    ? { enabled: true, maxTouchPoints: 5 }
    : { enabled: false });
}

async function navigate(hash = "") {
  await send("Page.navigate", { url: `${baseUrl}${hash ? `#${hash}` : ""}` });
  await waitFor("Boolean(document.querySelector('main, [role=main], #root > *'))", "application shell");
  await wait(400);
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
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code,
    windowsVirtualKeyCode,
    // Chrome only activates focused buttons on Enter when the event carries
    // the text payload — headless CDP drops it unless set explicitly.
    ...(key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}),
  });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
}

async function focusSelector(selector) {
  const ok = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.focus({ preventScroll: true });
    return document.activeElement === el;
  })()`);
  if (!ok) throw new Error(`focusSelector: could not focus ${selector}`);
}

async function typeText(selector, text) {
  const ok = await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    return true;
  })()`);
  if (!ok) throw new Error(`typeText: input not found for ${selector}`);
}

function readExperimentRow(experimentId) {
  return evaluate(`new Promise((resolve, reject) => {
    const open = indexedDB.open("rsemble-evaluation");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("experiments", "readonly").objectStore("experiments").get(${JSON.stringify(experimentId)});
      request.onerror = () => { db.close(); reject(request.error); };
      request.onsuccess = () => { db.close(); resolve(request.result ?? null); };
    };
  })`);
}

function readSuiteRow(suiteId) {
  return evaluate(`new Promise((resolve, reject) => {
    const open = indexedDB.open("rsemble-evaluation");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("suites", "readonly").objectStore("suites").get(${JSON.stringify(suiteId)});
      request.onerror = () => { db.close(); reject(request.error); };
      request.onsuccess = () => { db.close(); resolve(request.result ?? null); };
    };
  })`);
}

async function waitForExperimentStatus(experimentId, statuses, label, maxAttempts = 240) {
  const list = JSON.stringify(statuses);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const row = await readExperimentRow(experimentId);
    if (row && list.includes(row.status)) return row;
    await wait(250);
  }
  throw new Error(`Timed out waiting for ${label} (${statuses.join("|")}).`);
}

async function openAddModelDialog(experimentId) {
  await navigate(`/experiments/${experimentId}`);
  await waitFor("Boolean(document.querySelector('[data-testid=\"add-model-action\"]'))", `add-model action on ${experimentId}`);
  await clickButton("Add model");
  await waitFor("Boolean(document.querySelector('[role=\"dialog\"]'))", "add-model dialog");
}

async function selectCatalogModel(slug) {
  await waitFor(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return false;
    return [...dialog.querySelectorAll("button")].some((b) => (b.textContent ?? "").includes(${JSON.stringify(slug)}));
  })()`, `catalog entry ${slug}`, 120);
  const clicked = await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const button = [...dialog.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes(${JSON.stringify(slug)}) && !b.disabled);
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Could not commit catalog entry: ${slug}`);
  await waitFor("Boolean(document.querySelector('[role=\"dialog\"] [data-cost-preview]'))", "planner preview");
}

async function confirmAddAndRun() {
  await evaluate(`window.__qaResetCalls()`);
  await clickButton("Add and run");
  // The route flips to the progress surface once the controller owns the run.
  await waitFor(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return !dialog || !(dialog.textContent ?? "").includes("Add model to results");
  })()`, "dialog close after confirm");
}

/** Wait for terminal status and return { row, callsAtTerminal } for diagnostics. */
async function waitForTerminalWithCalls(experimentId, statuses, label) {
  const list = JSON.stringify(statuses);
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const row = await readExperimentRow(experimentId);
    if (row && list.includes(row.status)) {
      const calls = await evaluate("window.__qaCalls ?? []");
      return { row, calls };
    }
    await wait(250);
  }
  throw new Error(`Timed out waiting for ${label} (${statuses.join("|")}).`);
}

/**
 * Extension-aware terminal wait: the seeded record is ALREADY terminal, so we
 * must first observe the rotation's revision bump before accepting a terminal
 * status. `seededRevision` is the revision the seed wrote.
 */
async function waitForExtensionTerminal(experimentId, seededRevision, label, maxAttempts = 240) {
  let sawRotation = false;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const row = await readExperimentRow(experimentId);
    if (row && row.revision > seededRevision) sawRotation = true;
    if (
      sawRotation &&
      row &&
      ["completed", "completed_with_failures", "aborted"].includes(row.status)
    ) {
      const calls = await evaluate("window.__qaCalls ?? []");
      return { row, calls };
    }
    await wait(250);
  }
  throw new Error(`Timed out waiting for extension terminal state: ${label}.`);
}

function completionCalls(calls) {
  return (calls ?? []).filter((c) => !c.isJudge);
}
function judgeCalls(calls) {
  return (calls ?? []).filter((c) => c.isJudge);
}

// --- In-page fixture seeding ---------------------------------------------------
//
// MOCK fetch intercepts every openrouter.ai request (catalog, key, completions)
// plus the local bridge health endpoint, so no real provider egress can occur.
// Judge letters are derived dynamically from the judge prompt so full-roster
// fallback runs with three candidates still produce a valid report
// (pipeline.parseEvaluations requires exactly one evaluation per candidate).

const MOCK_FETCH_SOURCE = `(() => {
  try { localStorage.setItem("rsemble.key.openrouter", "qa-local-key"); } catch {}
  window.__qaEmptyCatalog = false;
  // Restore the call ledger across any same-origin document recreation so
  // probes never lose evidence to an unexpected reload.
  try {
    window.__qaCalls = JSON.parse(localStorage.getItem("__qaCalls") ?? "[]");
  } catch {
    window.__qaCalls = [];
  }
  window.__qaLogCall = (entry) => {
    window.__qaCalls.push(entry);
    try { localStorage.setItem("__qaCalls", JSON.stringify(window.__qaCalls)); } catch {}
  };
  window.__qaResetCalls = () => {
    window.__qaCalls = [];
    try { localStorage.setItem("__qaCalls", "[]"); } catch {}
  };
  window.__qaCompletionDelayMs = 0;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/health")) {
      return new Response(JSON.stringify({ ok: false }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("openrouter.ai") && url.includes("/models")) {
      const data = window.__qaEmptyCatalog
        ? []
        : [{ id: "deepseek/deepseek-chat", name: "DeepSeek Chat" }];
      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("openrouter.ai") && url.includes("/key")) {
      return new Response(JSON.stringify({ data: { label: "qa" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("chat/completions")) {
      const request = JSON.parse(init?.body ?? "{}");
      const model = String(request.model ?? "");
      const isJudgeCall = model.includes("judge");
      window.__qaLogCall({ model, isJudge: isJudgeCall });
      if (request.stream) {
        const encoder = new TextEncoder();
        return new Response(new ReadableStream({
          start(controller) {
            const flush = () => {
              controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"OK"}}]}\n\n'));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            };
            const delay = Number(window.__qaCompletionDelayMs ?? 0);
            if (delay > 0) setTimeout(flush, delay);
            else flush();
          },
        }), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      let content = "OK";
      if (isJudgeCall) {
        const bodyText = (request.messages ?? []).map((m) => String(m.content ?? "")).join("\\n");
        const letters = [];
        const marker = /### Candidate ([A-Z])/g;
        let match;
        while ((match = marker.exec(bodyText)) !== null) {
          if (!letters.includes(match[1])) letters.push(match[1]);
        }
        if (letters.length === 0) letters.push("A");
        const report = {
          consensus: ["All candidates produced mocked evidence."],
          contradictions: [],
          uniqueInsights: letters.map((letter) => ({
            source: letter,
            insight: "Candidate " + letter + " returned a valid mocked response.",
          })),
          evaluations: letters.map((letter, i) => ({
            label: letter,
            score: 4.0 + i * 0.1,
            position: "Strong",
            rationale: "Mocked deterministic evaluation.",
            strengths: ["Completed the task"],
            deductions: [],
            missedRequirements: [],
            criterionScores: [],
          })),
          comparisons: letters.length >= 2
            ? [{ labels: [letters[0], letters[1]], reason: "Mocked comparison." }]
            : [],
        };
        content = JSON.stringify(report);
      }
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

  const db = await openDb();

  // Old roster slots are openrouter models so the scenario-3 full-roster
  // fallback can execute entirely against the mocked endpoint.
  const SLOTS = [
    { id: "s-old-a", providerId: "openrouter", provider: "OpenRouter", model: "Old A", slug: "org/old-a", enabled: true },
    { id: "s-old-b", providerId: "openrouter", provider: "OpenRouter", model: "Old B", slug: "org/old-b", enabled: true },
  ];
  const MK_OLD_A = "openrouter:org/old-a";
  const MK_OLD_B = "openrouter:org/old-b";
  const FINGERPRINT = "sha256:roster";

  function makeTask(id, order) {
    return { id, title: "Task " + id, prompt: "Prompt " + id, systemPrompt: "", evaluation: { kind: "holistic" }, judgeInstructionOverride: "", order };
  }

  function makeSnapshot(taskIds, suiteId) {
    return {
      suiteId,
      suiteVersion: 1,
      tasks: taskIds.map(makeTask),
      modelSlots: SLOTS,
      defaultJudge: { providerId: "openrouter", model: "judge" },
      defaultEvaluation: { kind: "holistic" },
      profiles: [],
      protocolFingerprint: FINGERPRINT,
      createdAt: 1700000000000,
    };
  }

  function makeRun(runId, experimentId, suiteId, taskId, attemptId) {
    const candidates = SLOTS.map((slot, i) => ({
      candidateId: "cand-" + slot.id + "-" + taskId,
      slotId: slot.id,
      modelKey: slot.providerId + ":" + slot.slug,
      providerId: slot.providerId,
      model: slot.model,
      slug: slot.slug,
      acceptedAttemptId: "att-cand-" + runId + "-" + i,
      attempts: [{
        attemptId: "att-cand-" + runId + "-" + i,
        messages: [],
        startedAt: 1700000000000,
        finishedAt: 1700000001000,
        status: "completed",
        output: "output-" + slot.slug + "-" + taskId,
        tokensIn: 1,
        tokensOut: 1,
        error: null,
      }],
    }));
    const evaluationsById = {};
    candidates.forEach((c, i) => {
      evaluationsById[c.candidateId] = {
        candidateId: c.candidateId,
        blindLabel: i === 0 ? "A" : "B",
        overallScore: i === 0 ? 4.3 : 4.4,
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
      status: "completed",
      mode: "rank",
      source: { kind: "experiment", experimentId, suiteId, suiteVersion: 1, protocolFingerprint: FINGERPRINT, taskId, experimentTaskAttemptId: attemptId, trial: 0 },
      task: { title: "Task " + taskId, prompt: "Prompt " + taskId, systemPrompt: "", temperature: 0.7 },
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
      winnerKeys: [MK_OLD_B],
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

  function makeSuite(id) {
    return {
      id,
      revision: 2,
      version: 1,
      name: "Roster QA " + id,
      description: "qa",
      tasks: ["t1", "t2"].map(makeTask),
      modelSlots: SLOTS,
      defaultJudge: { providerId: "openrouter", model: "judge" },
      defaultEvaluation: { kind: "holistic" },
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      archivedAt: null,
    };
  }

  function terminalTasks(prefix, suiteId, experimentId, withRuns = true) {
    return ["t1", "t2"].map((taskId) => ({
      taskId,
      selectedAttemptId: "att-" + prefix + "-" + taskId,
      attempts: [{
        id: "att-" + prefix + "-" + taskId,
        runId: withRuns ? "run-" + prefix + "-" + taskId : null,
        trial: 0,
        status: withRuns ? "completed" : "failed",
        startedAt: 1700000000000,
        finishedAt: 1700000001000,
        error: withRuns ? null : "seeded failure",
      }],
    }));
  }

  async function seedTerminalExperiment(prefix, suiteId, experimentId, extra = {}) {
    const experiment = {
      id: experimentId,
      revision: 3,
      suiteId,
      suiteVersion: 1,
      protocolFingerprint: FINGERPRINT,
      status: "completed",
      execution: null,
      snapshot: makeSnapshot(["t1", "t2"], suiteId),
      tasks: terminalTasks(prefix, suiteId, experimentId),
      createdAt: 1700000000000,
      updatedAt: 1700000002000,
      ...extra,
    };
    for (const taskId of ["t1", "t2"]) {
      const run = makeRun("run-" + prefix + "-" + taskId, experimentId, suiteId, taskId, "att-" + prefix + "-" + taskId);
      await put(db, "runDetails", runDetailRow(run));
      await put(db, "runSummaries", runSummaryRow(run));
    }
    await put(db, "experiments", experimentRow(experiment));
  }

  await put(db, "suites", suiteRow(makeSuite("suite-roster")));
  await put(db, "suites", suiteRow(makeSuite("suite-roster-raw")));

  // S1: catalog model + suite sync ON (compound reuse on both tasks).
  await seedTerminalExperiment("s1", "suite-roster", "exp-roster");
  // S2: raw slug + suite sync OFF on its own suite.
  await seedTerminalExperiment("s2", "suite-roster-raw", "exp-roster-raw");
  // S3: t2 lacks reusable evidence (selected attempt failed, no run).
  {
    const experiment = {
      id: "exp-roster-fallback",
      revision: 3,
      suiteId: "suite-roster",
      suiteVersion: 1,
      protocolFingerprint: FINGERPRINT,
      status: "completed",
      execution: null,
      snapshot: makeSnapshot(["t1", "t2"], "suite-roster"),
      tasks: terminalTasks("s3", "suite-roster", "exp-roster-fallback"),
      createdAt: 1700000000000,
      updatedAt: 1700000002000,
    };
    // t1 keeps a compound run; t2's attempt stays runless.
    experiment.tasks[1].attempts[0].runId = null;
    experiment.tasks[1].attempts[0].status = "failed";
    const run = makeRun("run-s3-t1", "exp-roster-fallback", "suite-roster", "t1", "att-s3-t1");
    await put(db, "runDetails", runDetailRow(run));
    await put(db, "runSummaries", runSummaryRow(run));
    await put(db, "experiments", experimentRow(experiment));
  }
  // S4/S6: duplicate via extension history.
  await seedTerminalExperiment("s4", "suite-roster", "exp-roster-dup", {
    rosterExtensions: [{
      addedModelKey: "openrouter:deepseek/deepseek-chat",
      addedSlot: { id: "slot-hist-deepseek", providerId: "openrouter", provider: "OpenRouter", model: "DeepSeek Chat", slug: "deepseek/deepseek-chat", enabled: true },
      priorFingerprint: FINGERPRINT,
      extendedAt: 1700000003000,
    }],
  });
  // S5: abort + reload recovery.
  await seedTerminalExperiment("s5", "suite-roster", "exp-roster-abort");
  // S7: recovery toolbar (missing cell on t2) alongside terminal results.
  {
    const experiment = {
      id: "exp-roster-rec",
      revision: 3,
      suiteId: "suite-roster",
      suiteVersion: 1,
      protocolFingerprint: FINGERPRINT,
      status: "completed_with_failures",
      execution: null,
      snapshot: makeSnapshot(["t1", "t2"], "suite-roster"),
      tasks: terminalTasks("s7", "suite-roster", "exp-roster-rec"),
      createdAt: 1700000000000,
      updatedAt: 1700000002000,
    };
    experiment.tasks[1].attempts[0].runId = null;
    experiment.tasks[1].attempts[0].status = "failed";
    const run = makeRun("run-s7-t1", "exp-roster-rec", "suite-roster", "t1", "att-s7-t1");
    await put(db, "runDetails", runDetailRow(run));
    await put(db, "runSummaries", runSummaryRow(run));
    await put(db, "experiments", experimentRow(experiment));
  }

  db.close();
  return { ok: true };
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
  if (seeded?.__seedError) throw new Error(`Seed failed: ${seeded.__seedError}\n${seeded.__seedStack}`);
  results.seeded = seeded;
  // Let root provider probes settle so the catalog + readiness map populate.
  await wait(1200);

  // --- Scenario 1: catalog model + suite sync ON ------------------------------
  await openAddModelDialog("exp-roster");
  const s1Dialog = await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const checkbox = dialog?.querySelector('input[type="checkbox"]');
    return {
      title: (dialog?.textContent ?? "").includes("Add model to results"),
      syncChecked: Boolean(checkbox?.checked),
      syncNamesSuite: (dialog?.textContent ?? "").includes("Roster QA suite-roster"),
    };
  })()`);
  record("s1-dialog-open", {
    ...s1Dialog,
    pass: s1Dialog.title && s1Dialog.syncChecked && s1Dialog.syncNamesSuite,
    reason: "dialog opens with suite sync checked by default and names the suite",
  });
  await selectCatalogModel("deepseek/deepseek-chat");
  const s1Preview = await evaluate(`(() => {
    const preview = document.querySelector('[role="dialog"] [data-cost-preview]');
    const text = preview?.textContent ?? "";
    return {
      counts: text.includes("2 candidate calls + 2 Judge calls across 2 tasks."),
      reused: text.includes("4 accepted candidate outputs will be reused."),
      noFallback: !text.includes("lacks reusable evidence"),
    };
  })()`);
  record("s1-exact-preview", {
    ...s1Preview,
    pass: s1Preview.counts && s1Preview.reused && s1Preview.noFallback,
    reason: "planner preview shows exact compound counts and reuse total",
  });
  await screenshot("qa-s1-dialog");
  await confirmAddAndRun();
  const s1Terminal = await waitForExtensionTerminal("exp-roster", 3, "S1 extension completion");
  const s1Calls = s1Terminal.calls;
  const s1Suite = await readSuiteRow("suite-roster");
  const s1Row = s1Terminal.row;
  const s1RevisionAtTerminal = s1Row?.revision;
  const s1NewSlot = s1Row?.experiment?.snapshot?.modelSlots?.find((s) => s.slug === "deepseek/deepseek-chat") ?? null;
  const s1SuiteSlot = s1Suite?.suite?.modelSlots?.find((s) => s.slug === "deepseek/deepseek-chat") ?? null;
  const s1Completion = completionCalls(s1Calls);
  record("s1-only-new-model-calls", {
    completionModels: s1Completion.map((c) => c.model),
    judgeCount: judgeCalls(s1Calls).length,
    rawCallsLength: (s1Calls ?? []).length,
    terminalRevision: s1Row?.revision,
    terminalStatus: s1Row?.status,
    seededRevision: 3,
    pass: s1Completion.length === 2
      && s1Completion.every((c) => c.model === "deepseek/deepseek-chat")
      && judgeCalls(s1Calls).length === 2,
    reason: "reusable tasks execute only the new model plus fresh Judge calls",
  });
  record("s1-suite-sync", {
    suiteVersion: s1Suite?.suite?.version,
    suiteRevision: s1Suite?.suite?.revision,
    slotParity: Boolean(s1NewSlot && s1SuiteSlot && s1NewSlot.id === s1SuiteSlot.id),
    pass: s1Suite?.suite?.version === 2 && Boolean(s1NewSlot && s1SuiteSlot && s1NewSlot.id === s1SuiteSlot.id),
    reason: "suite version increments once and the synced slot id matches the snapshot slot id",
  });
  await navigate("/experiments/exp-roster");
  await waitFor(`(() => {
    const text = document.body.textContent ?? "";
    return text.includes("deepseek/deepseek-chat");
  })()`, "S1 new model column on results");
  const s1Results = await evaluate(`(() => {
    const text = document.body.textContent ?? "";
    const disclosure = document.querySelector('[data-testid="roster-extensions"]');
    return {
      hasColumn: text.includes("deepseek/deepseek-chat"),
      historyShown: Boolean(disclosure) && (disclosure.textContent ?? "").includes("deepseek/deepseek-chat"),
      noRepairLanguageInHistory: !(disclosure?.textContent ?? "").toLowerCase().includes("repair"),
    };
  })()`);
  record("s1-results-surface", {
    ...s1Results,
    pass: s1Results.hasColumn && s1Results.historyShown && s1Results.noRepairLanguageInHistory,
    reason: "results show the scored new column and an extension history disclosure without repair language",
  });
  await screenshot("qa-s1-results");

  // --- Scenario 2: raw slug + suite sync OFF ----------------------------------
  await evaluate("window.__qaEmptyCatalog = true");
  await openAddModelDialog("exp-roster-raw");
  await typeText("input#model-search", "deepseek/deepseek-chat");
  await waitFor(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return [...dialog.querySelectorAll("button")].some((b) =>
      (b.textContent ?? "").includes("deepseek/deepseek-chat") && !b.disabled);
  })()`, "raw slug commit entry");
  await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const button = [...dialog.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("deepseek/deepseek-chat") && !b.disabled);
    button.click();
  })()`);
  await waitFor("Boolean(document.querySelector('[role=\"dialog\"] [data-cost-preview]'))", "S2 planner preview");
  // Uncheck suite sync.
  await evaluate(`(() => {
    const checkbox = document.querySelector('[role="dialog"] input[type="checkbox"]');
    checkbox.click();
  })()`);
  const s2Sync = await evaluate(`Boolean(document.querySelector('[role="dialog"] input[type="checkbox"]')?.checked === false)`);
  record("s2-sync-unchecked", {
    unchecked: s2Sync,
    pass: s2Sync,
    reason: "suite sync can be switched off before confirming",
  });
  await confirmAddAndRun();
  await waitForExtensionTerminal("exp-roster-raw", 3, "S2 extension completion");
  const s2Suite = await readSuiteRow("suite-roster-raw");
  const s2Row = await readExperimentRow("exp-roster-raw");
  const s2NewSlot = s2Row?.experiment?.snapshot?.modelSlots?.find((s) => s.slug === "deepseek/deepseek-chat") ?? null;
  record("s2-suite-unchanged", {
    suiteVersion: s2Suite?.suite?.version,
    suiteRevision: s2Suite?.suite?.revision,
    slotAddedToResults: Boolean(s2NewSlot),
    pass: s2Suite?.suite?.version === 1 && s2Suite?.suite?.revision === 2 && Boolean(s2NewSlot),
    reason: "with sync off the suite is untouched while results gain the new model",
  });
  await evaluate("window.__qaEmptyCatalog = false");

  // --- Scenario 3: fallback task runs the full rotated roster ------------------
  await openAddModelDialog("exp-roster-fallback");
  await selectCatalogModel("deepseek/deepseek-chat");
  const s3Preview = await evaluate(`(() => {
    const preview = document.querySelector('[role="dialog"] [data-cost-preview]');
    const text = preview?.textContent ?? "";
    return {
      counts: text.includes("4 candidate calls + 2 Judge calls across 2 tasks."),
      reused: text.includes("2 accepted candidate outputs will be reused."),
      fallbackSentence: text.includes("1 task lacks reusable evidence and will run the full roster (3 candidates each)."),
    };
  })()`);
  record("s3-fallback-preview", {
    ...s3Preview,
    pass: s3Preview.counts && s3Preview.reused && s3Preview.fallbackSentence,
    reason: "fallback task shows the exact full-roster sentence and adjusted counts",
  });
  await screenshot("qa-s3-preview");
  await confirmAddAndRun();
  await waitForExtensionTerminal("exp-roster-fallback", 3, "S3 extension completion");
  const s3Calls = await evaluate("window.__qaCalls ?? []");
  const s3Completion = completionCalls(s3Calls);
  const byModel = {};
  for (const c of s3Completion) byModel[c.model] = (byModel[c.model] ?? 0) + 1;
  record("s3-per-task-roster", {
    callsByModel: byModel,
    judgeCount: judgeCalls(s3Calls).length,
    pass: byModel["deepseek/deepseek-chat"] === 2
      && byModel["org/old-a"] === 1
      && byModel["org/old-b"] === 1
      && judgeCalls(s3Calls).length === 2,
    reason: "reusable task runs only the new model; fallback task runs the full rotated roster",
  });

  // --- Scenario 4: duplicates excluded, no network attempted --------------------
  // Reset the call ledger so only this scenario's activity counts.
  await evaluate("window.__qaResetCalls()");
  await openAddModelDialog("exp-roster-dup");
  await typeText("input#model-search", "deepseek/deepseek-chat");
  await wait(600);
  const s4State = await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const text = dialog?.textContent ?? "";
    const confirm = [...document.querySelectorAll('[role="dialog"] button')].find((b) =>
      (b.textContent ?? "").includes("Add and run"));
    return {
      alreadyAdded: text.includes("already added"),
      confirmDisabled: Boolean(confirm?.disabled),
    };
  })()`);
  const s4Calls = await evaluate("(window.__qaCalls ?? []).length");
  record("s4-duplicate-excluded", {
    ...s4State,
    networkAttempts: s4Calls,
    pass: s4State.alreadyAdded && s4State.confirmDisabled && s4Calls === 0,
    reason: "history model is excluded from the picker and confirm stays disabled with zero network calls",
  });

  // --- Scenario 6: keyboard, viewport, zoom, reduced motion ----------------------
  // Escape from the still-open S4 dialog: keyboard cancellation.
  await press("Escape", "Escape", 27);
  await waitFor("Boolean(!document.querySelector('[role=\"dialog\"]'))", "dialog close on Escape");
  // Poll for focus restoration, capturing diagnostics each attempt.
  let s6Focus = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    s6Focus = await evaluate(`(() => {
      const el = document.activeElement;
      return {
        restoredToTrigger: Boolean(el && el.getAttribute && el.getAttribute("data-testid") === "add-model-action"),
        tag: el?.tagName ?? null,
        id: el?.id ?? null,
        testid: el?.getAttribute ? el.getAttribute("data-testid") : null,
        role: el?.getAttribute ? el.getAttribute("role") : null,
        inBody: Boolean(el && document.body.contains(el)),
      };
    })()`);
    if (s6Focus.restoredToTrigger) break;
    await wait(250);
  }
  // Keyboard-only open: focus the header action, press Enter.
  await send("Page.bringToFront");
  await focusSelector('[data-testid="add-model-action"]');
  await press("Enter", "Enter", 13);
  await waitFor("Boolean(document.querySelector('[role=\"dialog\"]'))", "keyboard dialog open");
  await press("Escape", "Escape", 27);
  await waitFor("Boolean(!document.querySelector('[role=\"dialog\"]'))", "second dialog close");
  record("s6-keyboard", {
    ...s6Focus,
    pass: s6Focus.restoredToTrigger,
    reason: "Escape closes the dialog and focus returns to the header action",
  });
  // 390px mobile viewport.
  await setViewport({ width: 390, height: 844, mobile: true });
  await navigate("/experiments/exp-roster-dup");
  await waitFor("Boolean(document.querySelector('[data-testid=\"add-model-action\"]'))", "add-model action at 390px");
  const s6Mobile = await evaluate(`(() => {
    const el = document.querySelector('[data-testid="add-model-action"]');
    const rect = el.getBoundingClientRect();
    return { height: rect.height, width: rect.width };
  })()`);
  record("s6-mobile-390", {
    ...s6Mobile,
    pass: s6Mobile.height >= 40 && s6Mobile.width > 0,
    reason: "the add-model action remains a tappable target at 390px",
  });
  await screenshot("qa-s6-mobile");
  // 200% zoom.
  await setViewport({ width: 1440, height: 1000, scale: 2 });
  await navigate("/experiments/exp-roster-dup");
  await waitFor("Boolean(document.querySelector('[data-testid=\"add-model-action\"]'))", "add-model action at 200% zoom");
  record("s6-zoom-200", {
    present: true,
    pass: true,
    reason: "header action renders at 200% device scale",
  });
  // Reduced motion.
  await setViewport({ width: 1440, height: 1000 });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await navigate("/experiments/exp-roster-dup");
  await waitFor(`(() => {
    const text = document.body.textContent ?? "";
    return text.includes("Roster extensions");
  })()`, "reduced-motion results render");
  record("s6-reduced-motion", {
    rendered: true,
    pass: true,
    reason: "results and status text render under prefers-reduced-motion",
  });
  await send("Emulation.setEmulatedMedia", { features: [] });

  // --- Scenario 7: header action vs recovery toolbar ------------------------------
  await navigate("/experiments/exp-roster-rec");
  await waitFor(`(() => {
    return Boolean(document.querySelector('[aria-label="Recovery"]'))
      && Boolean(document.querySelector('[data-testid="add-model-action"]'));
  })()`, "recovery toolbar + add-model action");
  const s7Separation = await evaluate(`(() => {
    const recovery = document.querySelector('[aria-label="Recovery"]');
    const action = document.querySelector('[data-testid="add-model-action"]');
    const recoveryText = recovery?.textContent ?? "";
    return {
      recoveryHasRepairCopy: /repair|retry/i.test(recoveryText),
      actionOutsideRecovery: !recovery.contains(action),
      recoveryHasNoAddModel: !recoveryText.includes("Add model"),
    };
  })()`);
  record("s7-visual-separation", {
    ...s7Separation,
    pass: s7Separation.recoveryHasRepairCopy && s7Separation.actionOutsideRecovery && s7Separation.recoveryHasNoAddModel,
    reason: "recovery toolbar keeps repair-only actions; Add model lives in the header",
  });
  await screenshot("qa-s7-separation");

  // --- Scenario 5: abort + reload recovery -----------------------------------------
  // Slow mocked completions so the two-task serial queue stays open long
  // enough to abort after the first task commits.
  await evaluate("window.__qaCompletionDelayMs = 2500");
  await openAddModelDialog("exp-roster-abort");
  await selectCatalogModel("deepseek/deepseek-chat");
  await confirmAddAndRun();
  // Wait for at least one task to reach a terminal attempt on the progress view.
  await waitFor(`new Promise((resolve) => {
    const open = indexedDB.open("rsemble-evaluation");
    open.onerror = () => resolve(false);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("experiments", "readonly").objectStore("experiments").get("exp-roster-abort");
      request.onerror = () => { db.close(); resolve(false); };
      request.onsuccess = () => {
        const tasks = request.result?.experiment?.tasks ?? [];
        db.close();
        resolve(tasks.some((t) => t.attempts.some((a) => a.status === "completed" || a.status === "failed")));
      };
    };
  })`, "S5 first terminal task");
  await clickButton("Abort experiment");
  await waitForExtensionTerminal("exp-roster-abort", 3, "S5 abort terminal");
  const s5PreReloadCalls = await evaluate("(window.__qaCalls ?? []).filter((c) => !c.isJudge).length");
  await send("Page.reload");
  await waitFor("Boolean(document.querySelector('main, [role=main], #root > *'))", "post-reload shell");
  await navigate("/experiments/exp-roster-abort");
  await wait(2000);
  const s5PostReloadCalls = await evaluate("(window.__qaCalls ?? []).length");
  const s5Row = await readExperimentRow("exp-roster-abort");
  const s5Adopted = (s5Row?.experiment?.tasks ?? []).some((t) =>
    t.attempts.some((a) => a.status === "completed" && a.runId !== null));
  record("s5-abort-recovery", {
    preReloadCompletionCalls: s5PreReloadCalls,
    postReloadCalls: s5PostReloadCalls,
    status: s5Row?.status,
    adoptedCommittedRun: s5Adopted,
    pass: s5PostReloadCalls === 0 && s5Row?.status === "aborted" && s5Adopted,
    reason: "after reload, committed evidence is adopted with zero new provider requests",
  });
  await evaluate("window.__qaCompletionDelayMs = 0");

  // --- Guard: no credential-shaped text anywhere on the final surface -------------
  const leakCheck = await evaluate(`(() => {
    const text = document.body?.innerText ?? "";
    return {
      noCredentialLeak: !/sk-[A-Za-z0-9]{6,}/.test(text),
      noBearerLeak: !text.includes("Bearer"),
    };
  })()`);
  record("guard-no-credential-leak", {
    ...leakCheck,
    pass: leakCheck.noCredentialLeak && leakCheck.noBearerLeak,
    reason: "no credential-shaped strings reach the rendered surface",
  });

  results.summary = {
    probes: results.probes.length,
    passed: results.probes.filter((p) => p.pass !== false).length,
  };
  fs.writeFileSync(path.join(outDir, "qa-results.json"), JSON.stringify(results, null, 2));
  console.log(`roster-extension QA: ${results.summary.passed}/${results.summary.probes} probes passed.`);
  console.log(`Evidence: ${outDir}`);
} catch (error) {
  results.error = error instanceof Error ? error.message : String(error);
  fs.writeFileSync(path.join(outDir, "qa-results.json"), JSON.stringify(results, null, 2));
  console.error(`roster-extension QA FAILED: ${results.error}`);
  process.exitCode = 1;
} finally {
  try { socket.close(); } catch {}
  chrome.kill();
}
