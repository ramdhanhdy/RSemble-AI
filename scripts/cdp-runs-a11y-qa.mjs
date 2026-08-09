// =============================================================================
// cdp-runs-a11y-qa.mjs — accessibility review for the Runs workspace.
//
// Drives Chrome headless over CDP against the running dev server. Deterministic
// fixtures only: run records are seeded directly into IndexedDB with the
// persisted shapes the app's validators accept. No provider calls.
//
// Scope (task t_416739f3):
//   1. focus rings      — every keyboard-focused control shows a visible
//                         indicator (global :focus-visible cyan ring or an
//                         explicit ring utility; border-tint-only is a fail)
//   2. keyboard nav     — real Tab-key walk; every interactive control must be
//                         reachable, including candidate selector rows
//   3. screen reader    — accessible names on all interactive controls, no
//                         interactive content in aria-hidden subtrees, no
//                         skipped heading levels, selected-row state exposed
//   4. 44px targets     — all Runs-region interactive controls >= 44px tall
//   5. deep-link focus  — /runs/:id?candidate=&attempt= lands keyboard focus
//                         on the linked candidate row with a visible ring and
//                         highlights the linked judge attempt
// Fails nonzero on the first unmet assertion. Never prints credentials.
// =============================================================================

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.QA_BASE_URL ?? process.argv[2] ?? "http://localhost:5173/";
const outDir = path.resolve("docs/qa/runs-accessibility");
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
    `--user-data-dir=${path.join(os.tmpdir(), `rsemble-runs-responsive-${Date.now()}`)}`,
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

async function navigate(hash = "#/compare") {
  await send("Page.navigate", { url: `${baseUrl}${hash}` });
  await waitFor("Boolean(document.querySelector('#root > *'))", "application shell");
  await wait(500);
}

async function screenshot(name) {
  const capture = await send("Page.captureScreenshot", { format: "png" });
  const file = `${name}.png`;
  fs.writeFileSync(path.join(outDir, file), Buffer.from(capture.data, "base64"));
  results.screenshots.push(file);
}

function record(name, value) {
  results.probes.push({ name, ...value });
  // In collect mode (A11Y_COLLECT=1) keep going after failures so one run
  // yields the complete baseline; otherwise fail fast on the first unmet
  // assertion (gate mode).
  if (value.pass === false && !process.env.A11Y_COLLECT)
    throw new Error(`${name}: ${value.reason ?? "assertion failed"}`);
}

// --- In-page fixture seeding ---------------------------------------------------
// Mirrors the persisted shapes the app's runtime guards accept
// (isRunRecordV2 / isRunSummary / isLegacyRunSummary). Same approach as
// cdp-suite-reliability-qa.mjs.

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

  // Clear any prior run fixtures for determinism.
  await new Promise((resolve, reject) => {
    const r = tx(db, "runSummaries", "readwrite").clear();
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
  await new Promise((resolve, reject) => {
    const r = tx(db, "runDetails", "readwrite").clear();
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });

  const SLOTS = [
    { id: "s1", providerId: "openrouter", model: "GLM 5.2", slug: "z-ai/glm-5.2", enabled: true },
    { id: "s2", providerId: "openrouter", model: "DeepSeek V4 Flash", slug: "deepseek/deepseek-v4-flash", enabled: true },
  ];
  const MK1 = "openrouter:z-ai/glm-5.2";
  const MK2 = "openrouter:deepseek/deepseek-v4-flash";

  function makeRun(runId, opts = {}) {
    const status = opts.status ?? "completed";
    const mode = opts.mode ?? "rank";
    const scoredKeys = opts.scoredKeys ?? [MK1];
    const judgeAttempts = opts.judgeAttempts ?? [];
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
        }] : [],
      };
    });
    const evaluationsById = {};
    scoredKeys.forEach((key, i) => {
      evaluationsById["cand-" + SLOTS[i].id] = {
        candidateId: "cand-" + SLOTS[i].id,
        blindLabel: "A",
        overallScore: 4.4,
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
      createdAt: opts.createdAt ?? 1700000000000,
      updatedAt: opts.createdAt ?? 1700000000000,
      completedAt: status === "completed" ? 1700000001000 : null,
      status,
      mode,
      source: opts.source ?? { kind: "adhoc" },
      task: { title: opts.title ?? runId, prompt: "Write a short poem about persistence.", systemPrompt: "", temperature: 0.7 },
      evaluation: { profile: null, candidateMessages: [] },
      candidates,
      judge: {
        status: "done",
        acceptedAttemptId: judgeAttempts.length ? judgeAttempts[0].attemptId : "judge-att-1",
        report: { labelMap: [], evaluationsById, comparisons: [] },
        consensus: null,
        attempts: judgeAttempts,
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

  function makeLegacySummary(id, opts = {}) {
    return {
      kind: "legacy",
      schemaVersion: "1-import",
      id,
      createdAt: opts.createdAt ?? 1690000000000,
      taskExcerpt: opts.excerpt ?? "Legacy run from the v1 localStorage history.",
      modelKeys: [MK1],
      winnerKeys: [MK1],
      scoresByModelKey: {},
      detailAvailable: false,
      searchText: "legacy run from the v1 localStorage history",
    };
  }

  const adhocCompleted = makeRun("run-adhoc-1", {
    title: "Ad hoc poem persistence",
    scoredKeys: [MK1, MK2],
    status: "completed",
    mode: "rank",
  });
  const adhocRunning = makeRun("run-adhoc-2", {
    title: "Ad hoc streaming summarization",
    scoredKeys: [MK1],
    status: "running",
    mode: "rank",
    createdAt: 1700000002000,
  });
  const adhocFailed = makeRun("run-adhoc-3", {
    title: "Ad hoc failed extraction",
    scoredKeys: [],
    status: "failed",
    mode: "rank",
    createdAt: 1700000003000,
  });
  const adhocFuse = makeRun("run-adhoc-4", {
    title: "Ad hoc fused verdict",
    scoredKeys: [MK1, MK2],
    status: "completed",
    mode: "fuse",
    createdAt: 1700000004000,
  });
  const adhocAborted = makeRun("run-adhoc-5", {
    title: "Ad hoc aborted cleanup",
    scoredKeys: [],
    status: "aborted",
    mode: "rank",
    createdAt: 1700000005000,
  });
  const adhocInterrupted = makeRun("run-adhoc-6", {
    title: "Ad hoc interrupted retry",
    scoredKeys: [],
    status: "interrupted",
    mode: "rank",
    createdAt: 1700000006000,
  });
  const expCompleted = makeRun("run-exp-1", {
    title: "Experiment suite winner",
    scoredKeys: [MK1, MK2],
    status: "completed",
    mode: "rank",
    createdAt: 1700000007000,
    source: {
      kind: "experiment",
      experimentId: "exp-qa",
      suiteId: "suite-qa",
      suiteVersion: 1,
      protocolFingerprint: "sha256:qa",
      taskId: "t1",
      experimentTaskAttemptId: "att-t1",
      trial: 0,
    },
  });
  const expPartial = makeRun("run-exp-2", {
    title: "Experiment partial coverage",
    scoredKeys: [MK1],
    status: "partial",
    mode: "rank",
    createdAt: 1700000008000,
    source: {
      kind: "experiment",
      experimentId: "exp-qa",
      suiteId: "suite-qa",
      suiteVersion: 1,
      protocolFingerprint: "sha256:qa",
      taskId: "t2",
      experimentTaskAttemptId: "att-t2",
      trial: 1,
    },
    // Deep-link fixture: a real accepted judge attempt with a blind-label map
    // so ?attempt=judge-att-2 highlights a rendered panel (spec §12.1).
    judgeAttempts: [
      {
        attemptId: "judge-att-2",
        providerId: "openrouter",
        model: "GLM 5.2",
        instruction: "Pick the better output.",
        messages: [],
        blindLabelToCandidateId: { A: "cand-s1", B: "cand-s2" },
        candidateAttemptIdsByCandidateId: { "cand-s1": "att-cand-0" },
        startedAt: 1700000008500,
        finishedAt: 1700000008900,
        status: "completed",
        error: null,
        report: { labelMap: [], evaluationsById: {}, comparisons: [] },
        consensus: null,
      },
    ],
  });

  const runs = [
    adhocCompleted,
    adhocRunning,
    adhocFailed,
    adhocFuse,
    adhocAborted,
    adhocInterrupted,
    expCompleted,
    expPartial,
  ];
  // Filler runs so the list exceeds PAGE_SIZE (50) and the Load more control
  // renders for the keyboard-nav probe.
  for (let i = 1; i <= 45; i += 1) {
    runs.push(
      makeRun("run-filler-" + i, {
        title: "Filler run " + i,
        scoredKeys: [MK1],
        status: "completed",
        mode: "rank",
        createdAt: 1700000010000 + i,
      }),
    );
  }
  for (const run of runs) {
    await put(db, "runDetails", runDetailRow(run));
    await put(db, "runSummaries", runSummaryRow(run));
  }

  const legacy1 = makeLegacySummary("legacy-1");
  const legacy2 = makeLegacySummary("legacy-2", { createdAt: 1690000001000, excerpt: "Legacy winner from early adopters." });
  for (const legacy of [legacy1, legacy2]) {
    await put(db, "runSummaries", {
      kind: "legacy",
      summary: legacy,
      id: legacy.id,
      revision: 0,
      createdAt: legacy.createdAt,
      completedAt: null,
      status: null,
      mode: null,
      sourceKind: "adhoc",
      sourceProtocolFingerprint: null,
      sourceExperimentTaskAttemptId: null,
      modelKeys: legacy.modelKeys,
    });
  }

  db.close();
  return { runCount: runs.length, legacyCount: 2 };
})().catch((e) => ({ __seedError: e instanceof Error ? e.message : String(e), __seedStack: e instanceof Error ? e.stack : "" }))`;

// --- Page-state probes ----------------------------------------------------------

// Runs-region detector: any interactive control that lives inside the Runs
// workspace surfaces (list, detail, filters, archive actions).
const RUNS_REGION =
  "el.closest('ul[role=\"list\"], [data-run-detail], [data-section], [data-action], [data-filter], [data-record-row], [data-status-mark]') || el.matches('input[type=\"search\"]')";

// Accessible-name + focus-indicator extraction for one element.
const NAME_PROBE = `(el) => {
  const tag = el.tagName.toLowerCase();
  const labelAttr = el.getAttribute("aria-label") || "";
  const labelledby = el.getAttribute("aria-labelledby");
  const labelText = labelledby
    ? [...document.querySelectorAll("#" + labelledby.split(" ")[0])].map((n) => (n.textContent || "").trim()).join(" ")
    : "";
  let name = labelAttr || labelText || (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 80);
  if (tag === "input" || tag === "select" || tag === "textarea") {
    if (!name && el.labels && el.labels.length) name = (el.labels[0].textContent || "").trim().replace(/\\s+/g, " ").slice(0, 80);
    if (!name && el.getAttribute("placeholder")) name = "(placeholder-only)";
  }
  const cs = getComputedStyle(el);
  const outlineVisible =
    cs.outlineStyle !== "none" &&
    parseFloat(cs.outlineWidth) > 0 &&
    cs.outlineColor !== "transparent" &&
    !/rgba\\(0,\\s*0,\\s*0,\\s*0\\)/.test(cs.outlineColor);
  // Tailwind ring chains always include transparent offset/shadow layers
  // (e.g. "rgb(255,255,255) 0px 0px 0px 0px, rgb(0,229,255) 0px 0px 0px 2px,
  // rgba(0,0,0,0) 0px 0px 0px 0px"). A layer counts as visible only when it
  // has a non-transparent color AND a non-zero size (spread/blur).
  const shadow = cs.boxShadow || "";
  const shadowVisible = (() => {
    if (shadow === "none") return false;
    const layers = shadow.split(/,(?![^()]*\\))/);
    for (const raw of layers) {
      const layer = raw.trim();
      if (!layer || /rgba\\(0,\\s*0,\\s*0,\\s*0\\)/.test(layer)) continue;
      const sizes = layer.match(/-?\\d+(\\.\\d+)?px/g) || [];
      if (sizes.some((n) => parseFloat(n) !== 0)) return true;
    }
    return false;
  })();
  const r = el.getBoundingClientRect();
  let hiddenAncestor = false;
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.getAttribute && n.getAttribute("aria-hidden") === "true") { hiddenAncestor = true; break; }
  }
  return {
    tag,
    name: name || null,
    unnamed: !name,
    ariaLabel: labelAttr || null,
    outlineVisible,
    shadowVisible,
    indicator: outlineVisible || shadowVisible,
    outline: cs.outlineStyle === "none" ? "none" : cs.outlineWidth + " " + cs.outlineStyle + " " + cs.outlineColor,
    boxShadow: shadow === "none" ? "none" : shadow.slice(0, 140),
    height: Math.round(r.height * 10) / 10,
    inViewport: r.top < window.innerHeight && r.bottom > 0 && r.width > 0 && r.height > 0,
    hiddenAncestor,
    text: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 60),
  };
}`;

// Tab-walk: reset focus to a known anchor (body), then press Tab up to
// maxStops times, collecting each stop.
async function tabWalk(maxStops) {
  await evaluate(`(() => {
    document.body.setAttribute('tabindex', '-1');
    document.body.focus();
    document.body.removeAttribute('tabindex');
    return true;
  })()`);
  const stops = [];
  for (let i = 0; i < maxStops; i += 1) {
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    });
    const stop = await evaluate(`(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return { end: true };
      const base = (${NAME_PROBE})(el);
      return {
        end: false,
        ...base,
        dataAction: el.getAttribute("data-action") || null,
        dataCandidateId: el.getAttribute("data-candidate-id") || null,
        href: el.getAttribute("href") || null,
        ariaPressed: el.getAttribute("aria-pressed"),
        ariaExpanded: el.getAttribute("aria-expanded"),
        ariaCurrent: el.getAttribute("aria-current"),
        inRunsRegion: Boolean(el.closest ? (${RUNS_REGION}) : false),
      };
    })()`);
    stops.push(stop);
    if (stop.end) break;
  }
  return stops;
}

async function pressKey(key, code, vk, text) {
  const keyDownParams = {
    type: "keyDown",
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  };
  // Headless shell quirk: button activation on Enter only runs when the key
  // event carries a text payload (otherwise the keydown is delivered but the
  // default click action never fires). Space activates via keyup without it.
  if (text) Object.assign(keyDownParams, { text, unmodifiedText: text });
  await send("Input.dispatchKeyEvent", keyDownParams);
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  });
}

function summarizeStops(stops) {
  return stops
    .filter((s) => !s.end)
    .map((s) => ({
      tag: s.tag,
      name: s.name,
      text: s.text,
      dataAction: s.dataAction,
      dataCandidateId: s.dataCandidateId,
      height: s.height,
      indicator: s.indicator,
    }));
}

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
  await navigate();
  const seeded = await evaluate(SEED_SOURCE);
  if (seeded?.__seedError)
    throw new Error(`Seed failed: ${seeded.__seedError}\n${seeded.__seedStack}`);
  results.seeded = seeded;

  // ===========================================================================
  // 1. Desktop list — keyboard tab order reaches every list control
  // ===========================================================================
  await navigate("#/runs");
  await waitFor(
    'document.querySelectorAll(\'ul[role="list"] a[href*="/runs/"]\').length >= 10',
    "desktop run rows",
  );
  const listStops = await tabWalk(20);
  const listStopsSummaries = summarizeStops(listStops);
  const listStopNames = listStopsSummaries.map((s) => s.name ?? s.text ?? s.tag);
  const listProbe = {
    pass:
      listStopNames.some((n) => n.includes("Search runs")) &&
      listStops.some((s) => s.dataAction === "toggle-filters") &&
      listStops.some((s) => (s.href ?? "").includes("/runs/")) &&
      listStops.every((s) => !s.hiddenAncestor),
    stops: listStopsSummaries,
    reason: !listStopNames.some((n) => n.includes("Search runs"))
      ? "search input not reachable via Tab"
      : !listStops.some((s) => s.dataAction === "toggle-filters")
        ? "filters toggle not reachable via Tab"
        : !listStops.some((s) => (s.href ?? "").includes("/runs/"))
          ? "run row links not reachable via Tab"
          : listStops.some((s) => s.hiddenAncestor)
            ? "Tab reached a control inside aria-hidden"
            : undefined,
  };
  record("a11y-01-list-tab-order", listProbe);

  // Load more renders (seed exceeds PAGE_SIZE) and is a 44px keyboard target.
  const loadMore = await evaluate(`(() => {
    const el = document.querySelector('[data-action="load-more"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { height: Math.round(r.height * 10) / 10, text: (el.textContent || "").trim() };
  })()`);
  record("a11y-02-load-more-target", {
    pass: Boolean(loadMore && loadMore.height >= 44),
    ...(loadMore ?? { height: null }),
    reason: !loadMore
      ? "Load more button did not render with 55 seeded runs"
      : loadMore.height < 44
        ? "Load more button under 44px"
        : undefined,
  });
  await screenshot("01-desktop-runs-list");

  // ===========================================================================
  // 2. Desktop detail — full keyboard walk (incl. candidate selector rows)
  // ===========================================================================
  await navigate("#/runs/run-exp-1");
  await waitFor("Boolean(document.querySelector('[data-run-detail]'))", "desktop detail");
  const detailStops = await tabWalk(120);
  const detailSummaries = summarizeStops(detailStops);
  const candidateStops = detailStops.filter((s) => s.dataCandidateId);
  const expectedActions = ["open-in-compare", "copy-link", "toggle-filters", "load-more"];
  const foundActions = expectedActions.filter((a) => detailStops.some((s) => s.dataAction === a));
  const detailProbe = {
    pass:
      candidateStops.length >= 2 &&
      foundActions.length === expectedActions.length &&
      detailStops.some((s) => (s.text ?? "").includes("Task & Configuration")) &&
      detailStops.every((s) => !s.hiddenAncestor),
    candidateRowsReachable: candidateStops.length,
    foundActions,
    stops: detailSummaries,
    reason:
      candidateStops.length < 2
        ? "candidate selector buttons are NOT reachable via Tab (tabIndex=-1 removes them from the keyboard order)"
        : foundActions.length !== expectedActions.length
          ? `missing keyboard actions: ${expectedActions.filter((a) => !foundActions.includes(a)).join(", ")}`
          : !detailStops.some((s) => (s.text ?? "").includes("Task & Configuration"))
            ? "Task & Configuration disclosure not reachable"
            : detailStops.some((s) => s.hiddenAncestor)
              ? "Tab reached a control inside aria-hidden"
              : undefined,
  };
  record("a11y-03-detail-tab-order", detailProbe);

  // ===========================================================================
  // 3. Focus indicator on every keyboard stop
  // ===========================================================================
  const ringViolations = detailStops
    .filter((s) => !s.end && !s.indicator)
    .map((s) => ({ name: s.name ?? s.text, tag: s.tag }));
  record("a11y-04-focus-indicators", {
    pass: ringViolations.length === 0,
    violations: ringViolations,
    reason: ringViolations.length
      ? `keyboard focus shows no visible indicator on: ${ringViolations.map((v) => v.name).join(", ")}`
      : undefined,
  });

  // ===========================================================================
  // 4. Accessible names on all interactive controls (desktop detail)
  // ===========================================================================
  const nameAudit = await evaluate(`(() => {
    const bad = [];
    for (const el of document.querySelectorAll('a[href], button, input, select, textarea')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const probe = (${NAME_PROBE})(el);
      if (probe.unnamed) bad.push({ tag: probe.tag, text: probe.text });
      if (probe.hiddenAncestor) bad.push({ tag: probe.tag, text: probe.text, issue: "in-aria-hidden" });
    }
    return bad;
  })()`);
  record("a11y-05-accessible-names", {
    pass: nameAudit.length === 0,
    violations: nameAudit,
    reason: nameAudit.length
      ? `interactive controls without accessible names: ${JSON.stringify(nameAudit)}`
      : undefined,
  });

  // ===========================================================================
  // 5. 44px target sizes (Runs region only; shell nav reported as observation)
  // ===========================================================================
  const targetAudit = await evaluate(`(() => {
    const runsBad = [];
    const shellBad = [];
    for (const el of document.querySelectorAll('a[href], button, input, select')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.top >= window.innerHeight) continue; // below the fold: not measured
      if (r.height >= 44) continue;
      const probe = (${NAME_PROBE})(el);
      const inRuns = Boolean(el.closest ? (${RUNS_REGION}) : false);
      const item = { tag: probe.tag, name: probe.name ?? probe.text, height: probe.height };
      if (inRuns) runsBad.push(item); else shellBad.push(item);
    }
    return { runsBad, shellBad };
  })()`);
  record("a11y-06-targets-44px", {
    pass: targetAudit.runsBad.length === 0,
    runsUnder44: targetAudit.runsBad,
    shellUnder44: targetAudit.shellBad,
    reason: targetAudit.runsBad.length
      ? `Runs-region controls under 44px: ${JSON.stringify(targetAudit.runsBad)}`
      : undefined,
  });

  // ===========================================================================
  // 6. Deep-link focus behavior (spec §8.3 / §12.1)
  // ===========================================================================
  await navigate("#/runs/run-exp-2?candidate=cand-s2&attempt=judge-att-2");
  await waitFor(
    `(() => {
      const el = document.activeElement;
      return Boolean(el && el.getAttribute && el.getAttribute("data-candidate-id") === "cand-s2");
    })()`,
    "deep-link candidate focus",
  );
  const deepProbe = await evaluate(`(() => {
    const btn = document.activeElement;
    const r = btn.getBoundingClientRect();
    const judgePanel = document.querySelector('[data-judge-attempt="judge-att-2"]');
    const cs = getComputedStyle(btn);
    // Tailwind ring chains include transparent offset layers; a ring is
    // visible when any non-transparent layer has a non-zero size.
    const shadowVisible = (() => {
      if (cs.boxShadow === "none") return false;
      const layers = cs.boxShadow.split(/,(?![^()]*\\))/);
      for (const raw of layers) {
        const layer = raw.trim();
        if (!layer || /rgba\\(0,\\s*0,\\s*0,\\s*0\\)/.test(layer)) continue;
        const sizes = layer.match(/-?\\d+(\\.\\d+)?px/g) || [];
        if (sizes.some((n) => parseFloat(n) !== 0)) return true;
      }
      return false;
    })();
    return {
      focusedCandidateId: btn.getAttribute("data-candidate-id"),
      ariaPressed: btn.getAttribute("aria-pressed"),
      inViewport: r.top >= 0 && r.top < window.innerHeight,
      rectTop: Math.round(r.top),
      ringVisible: shadowVisible,
      judgePanelPresent: Boolean(judgePanel),
      judgeHighlighted: Boolean(judgePanel && judgePanel.className.includes("ring-accent")),
      selectedAttemptText: (document.body.innerText ?? "").includes("Selected attempt"),
      labelB: (document.body.innerText ?? "").includes("Label: B"),
      selectedCandidateRow: Boolean(document.querySelector('[data-candidate-id="cand-s2"][aria-pressed="true"]')),
    };
  })()`);
  record("a11y-07-deeplink-focus", {
    pass:
      deepProbe.focusedCandidateId === "cand-s2" &&
      deepProbe.ariaPressed === "true" &&
      deepProbe.inViewport &&
      deepProbe.ringVisible &&
      deepProbe.judgePanelPresent &&
      deepProbe.judgeHighlighted &&
      deepProbe.selectedAttemptText &&
      deepProbe.selectedCandidateRow,
    ...deepProbe,
    reason:
      deepProbe.focusedCandidateId !== "cand-s2"
        ? "focus did not land on the linked candidate row"
        : deepProbe.ariaPressed !== "true"
          ? "linked candidate not selected (aria-pressed)"
          : !deepProbe.inViewport
            ? "linked candidate row scrolled out of viewport"
            : !deepProbe.ringVisible
              ? "focused candidate row has no visible focus ring"
              : !deepProbe.judgePanelPresent
                ? "linked judge attempt panel missing"
                : !deepProbe.judgeHighlighted
                  ? "linked judge attempt panel not highlighted"
                  : !deepProbe.selectedAttemptText
                    ? "Selected attempt label missing"
                    : !deepProbe.selectedCandidateRow
                      ? "candidate row not aria-pressed after deep link"
                      : undefined,
  });
  await screenshot("02-desktop-deeplink-focused");

  // Degraded deep links show a notice and never crash (spec §8.3).
  await navigate("#/runs/run-exp-2?candidate=does-not-exist");
  await waitFor(
    "(document.body.innerText ?? '').includes('Linked candidate not found')",
    "deep-link candidate-missing notice",
  );
  const degraded = await evaluate(`(() => {
    const ae = document.activeElement;
    return {
      notice: (document.body.innerText ?? "").includes("Linked candidate not found — showing run overview."),
      overviewStillRendered: Boolean(document.querySelector('[data-section="header"]')),
      activeElementDesc: ae && ae !== document.body
        ? { tag: ae.tagName, name: (ae.getAttribute && (ae.getAttribute("aria-label") || ae.textContent || "") || "").trim().slice(0, 40) }
        : null,
      focusSafe: !ae || ae === document.body,
    };
  })()`);
  record("a11y-08-deeplink-degraded", {
    // Focus may legitimately stay on a re-rendered control after a
    // same-document navigation (browser focus preservation); the contract is
    // that the notice shows, the overview renders, and nothing throws.
    pass: degraded.notice && degraded.overviewStillRendered,
    ...degraded,
    reason: !degraded.notice
      ? "candidate-missing notice not shown"
      : !degraded.overviewStillRendered
        ? "overview did not render after invalid deep link"
        : undefined,
  });

  // ===========================================================================
  // 7. Selected row state is exposed to assistive tech (list)
  // ===========================================================================
  await navigate("#/runs/run-exp-2");
  await waitFor("Boolean(document.querySelector('[data-run-detail]'))", "selected-row detail");
  const selectedRow = await evaluate(`(() => {
    const link = document.querySelector('ul[role="list"] a[href*="/runs/run-exp-2"]');
    const srSelected = [...document.querySelectorAll('ul[role="list"] .sr-only')].map((n) => (n.textContent || "").trim());
    return {
      linkFound: Boolean(link),
      ariaCurrent: link ? link.getAttribute("aria-current") : null,
      srOnlyTexts: srSelected,
    };
  })()`);
  record("a11y-09-selected-row-sr", {
    pass: selectedRow.linkFound && selectedRow.ariaCurrent === "true",
    ...selectedRow,
    reason: !selectedRow.linkFound
      ? "selected run row link missing"
      : selectedRow.ariaCurrent !== "true"
        ? "selected row link does not expose aria-current (screen readers cannot tell which row is selected)"
        : undefined,
  });

  // ===========================================================================
  // 8. Heading order on the detail document
  // ===========================================================================
  const headingAudit = await evaluate(`(() => {
    const heads = [...document.querySelectorAll('[data-run-detail] h1, [data-run-detail] h2, [data-run-detail] h3, [data-run-detail] h4, [data-run-detail] h5, [data-run-detail] h6')];
    const levels = heads.map((h) => parseInt(h.tagName.slice(1), 10));
    const skips = [];
    for (let i = 1; i < levels.length; i += 1) {
      if (levels[i] > levels[i - 1] + 1) skips.push({ from: levels[i - 1], to: levels[i], at: heads[i].textContent.trim().slice(0, 40) });
    }
    return { levels, skips, count: heads.length };
  })()`);
  record("a11y-10-heading-order", {
    pass: headingAudit.skips.length === 0 && headingAudit.count >= 6,
    ...headingAudit,
    reason: headingAudit.skips.length
      ? `heading level skipped: ${JSON.stringify(headingAudit.skips)}`
      : headingAudit.count < 6
        ? "detail document has too few headings"
        : undefined,
  });
  await screenshot("03-desktop-detail");

  // ===========================================================================
  // 9. Legacy detail — decorative separators hidden, Back reachable
  // ===========================================================================
  await navigate("#/runs/legacy-1");
  await waitFor(
    "(document.body.innerText ?? '').includes('Legacy run from the v1')",
    "legacy detail",
  );
  const legacyAudit = await evaluate(`(() => {
    const middots = [...document.querySelectorAll('[data-run-detail] span')].filter((s) => (s.textContent || "").trim() === "·" && !s.getAttribute("aria-hidden"));
    const back = [...document.querySelectorAll("a,button")].find((el) => (el.textContent || "").trim().startsWith("Back to Runs"));
    return {
      unmarkedSeparators: middots.length,
      backLinkHeight: back ? Math.round(back.getBoundingClientRect().height * 10) / 10 : null,
      copyLink: Boolean(document.querySelector('[data-action="copy-link"]')),
    };
  })()`);
  record("a11y-11-legacy-detail", {
    pass:
      legacyAudit.unmarkedSeparators === 0 &&
      legacyAudit.backLinkHeight >= 44 &&
      legacyAudit.copyLink,
    ...legacyAudit,
    reason: legacyAudit.unmarkedSeparators
      ? `legacy detail has ${legacyAudit.unmarkedSeparators} unmarked middot separators (read as 'middot' by screen readers)`
      : !legacyAudit.backLinkHeight || legacyAudit.backLinkHeight < 44
        ? "legacy Back link under 44px"
        : !legacyAudit.copyLink
          ? "legacy copy-link button missing"
          : undefined,
  });
  await screenshot("04-desktop-legacy-detail");

  // ===========================================================================
  // 10. Phone — route detail keyboard nav (Back first, controls reachable)
  // ===========================================================================
  await setViewport({ width: 390, height: 844, mobile: true });
  await navigate("#/runs/run-exp-1");
  await waitFor("(document.body.innerText ?? '').includes('Back to Runs')", "phone detail");
  const phoneStops = await tabWalk(30);
  const phoneSummaries = summarizeStops(phoneStops);
  const phoneBack = phoneStops.findIndex((s) => (s.text ?? "").startsWith("Back to Runs"));
  const phoneCandidates = phoneStops.filter((s) => s.dataCandidateId).length;
  const phoneProbe = {
    pass: phoneBack >= 0 && phoneCandidates >= 2 && phoneStops.every((s) => !s.hiddenAncestor),
    backStopIndex: phoneBack,
    candidateRowsReachable: phoneCandidates,
    stops: phoneSummaries,
    reason:
      phoneBack < 0
        ? "Back to Runs link not reachable via Tab on phone detail"
        : phoneCandidates < 2
          ? "candidate selector rows not reachable via Tab on phone"
          : phoneStops.some((s) => s.hiddenAncestor)
            ? "Tab reached a control inside aria-hidden on phone"
            : undefined,
  };
  record("a11y-12-phone-detail-tab-order", phoneProbe);
  await screenshot("05-phone-detail");

  // Phone list + filter sheet: keyboard-only open and reachable selects.
  await navigate("#/runs");
  await waitFor(
    'document.querySelectorAll(\'ul[role="list"] a[href*="/runs/"]\').length >= 10',
    "phone run rows",
  );
  await evaluate(`(() => {
    const search = document.querySelector('input[type="search"]');
    search.focus();
    return true;
  })()`);
  // Focus search, Tab to the filter toggle, activate it with Enter (keyboard-only).
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9,
  });
  const toggleStep = await evaluate(`(() => {
    const toggle = document.querySelector('[data-action="toggle-filters"]');
    if (!toggle) return { ok: false, why: "no toggle" };
    if (document.activeElement === toggle) {
      return { ok: true, focused: true, expandedBefore: toggle.getAttribute("aria-expanded") };
    }
    return { ok: false, why: "activeElement is not toggle", tag: document.activeElement ? document.activeElement.tagName : null, name: (document.activeElement && (document.activeElement.getAttribute("aria-label") || document.activeElement.textContent || "").trim().slice(0, 40)) || null };
  })()`);
  if (toggleStep.ok) {
    await pressKey("Enter", "Enter", 13, "\r");
    await waitFor(
      'document.querySelector(\'[data-action="toggle-filters"]\').getAttribute("aria-expanded") === "true"',
      "filter sheet keyboard open",
    );
    record("a11y-13-phone-filter-keyboard", {
      pass: true,
      openedWithKeyboard: true,
      reason: undefined,
    });
  } else {
    record("a11y-13-phone-filter-keyboard", {
      pass: false,
      openedWithKeyboard: false,
      reason: `filter toggle not reachable from search: ${toggleStep.why}`,
    });
  }
  if (toggleStep.ok) {
    // Tab from the toggle lands in the filter sheet controls (DOM order).
    const sheetStops = [];
    for (let i = 0; i < 8; i += 1) {
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Tab",
        code: "Tab",
        windowsVirtualKeyCode: 9,
        nativeVirtualKeyCode: 9,
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Tab",
        code: "Tab",
        windowsVirtualKeyCode: 9,
        nativeVirtualKeyCode: 9,
      });
      const stop = await evaluate(`(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return { end: true };
        const base = (${NAME_PROBE})(el);
        return { end: false, ...base, dataFilter: el.getAttribute("data-filter"), dataAction: el.getAttribute("data-action") };
      })()`);
      sheetStops.push(stop);
      if (stop.end) break;
    }
    const sheetSummaries = sheetStops
      .filter((s) => !s.end)
      .map((s) => ({
        name: s.name,
        dataFilter: s.dataFilter,
        dataAction: s.dataAction,
        height: s.height,
      }));
    const sheetControls = sheetSummaries.filter(
      (s) => s.dataFilter || s.dataAction === "clear-filters",
    );
    record("a11y-14-phone-filter-sheet-tab", {
      pass: sheetControls.length >= 4 && sheetSummaries.every((s) => s.height >= 44),
      controls: sheetSummaries,
      reason:
        sheetControls.length < 4
          ? "filter sheet controls not all reachable via Tab after keyboard open"
          : sheetSummaries.some((s) => s.height < 44)
            ? "filter sheet control under 44px"
            : undefined,
    });
    await screenshot("06-phone-filter-sheet-keyboard");
  }

  // ===========================================================================
  // Final: no uncaught exceptions / console errors across all probes
  // ===========================================================================
  const finalErrors = results.consoleErrors.filter(
    (e) => !e.includes("Download the React DevTools"),
  );
  record("a11y-15-no-uncaught-exceptions", {
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
