// =============================================================================
// cdp-runs-responsive-qa.mjs — responsive/mobile review for the Runs workspace.
//
// Drives Chrome headless over CDP against the running dev server. Deterministic
// fixtures only: run records are seeded directly into IndexedDB with the
// persisted shapes the app's validators accept. No provider calls.
//
// Viewports (task t_3b2cc789):
//   1. wide desktop 1440x900  — split list/detail, 380px list pane
//   2. 1024x768 transition    — boundary: >=1024px stays desktop split
//   3. tablet 768x1024        — route-based list-only / detail-only
//   4. phone 390x844          — route-based detail + filter sheet
//
// Verifies:
//   - split layout presence/absence per breakpoint
//   - route-based mobile detail (/runs -> list, /runs/:id -> detail + Back)
//   - filter sheet toggle, applied-count badge, clear filters
//   - horizontal overflow at every width (list and detail)
//   - no uncaught exceptions
// Fails nonzero on the first unmet assertion. Never prints credentials.
// =============================================================================

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const baseUrl = process.env.QA_BASE_URL ?? process.argv[2] ?? "http://localhost:5173/";
const outDir = path.resolve("docs/qa/runs-responsive");
const chromePath =
  process.env.CHROME_PATH ??
  "/opt/data/home/.chrome/chrome-headless-shell-linux64/chrome-headless-shell";
const debugPort = 9347;
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
  if (value.pass === false) throw new Error(`${name}: ${value.reason ?? "assertion failed"}`);
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

const LAYOUT_PROBE = `(() => {
  const bodyText = document.body?.innerText ?? "";
  const listPane = [...document.querySelectorAll("div")].find(
    (d) => (d.style?.width ?? "") === "380px",
  );
  const rows = document.querySelectorAll('ul[role="list"] a[href*="/runs/"]');
  const backLink = [...document.querySelectorAll("a,button")].find((el) =>
    (el.textContent ?? "").trim().startsWith("Back to Runs"),
  );
  return {
    hash: location.hash,
    listPaneWidth: listPane ? parseInt(listPane.style.width, 10) : null,
    rowCount: rows.length,
    hasPlaceholder: bodyText.includes("Select a run to inspect its evidence."),
    hasBack: Boolean(backLink),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    visibleFilterNames: [...document.querySelectorAll("select[data-filter]")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
      })
      .map((el) => el.getAttribute("data-filter")),
    filterToggleVisible: (() => {
      const el = document.querySelector('[data-action="toggle-filters"]');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
    })(),
    smallTapTargets: [...document.querySelectorAll("a,button")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.height < 36 && r.top < window.innerHeight;
    }).length,
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
  await navigate();
  const seeded = await evaluate(SEED_SOURCE);
  if (seeded?.__seedError)
    throw new Error(`Seed failed: ${seeded.__seedError}\n${seeded.__seedStack}`);
  results.seeded = seeded;

  // ===========================================================================
  // 1. Wide desktop 1440x900 — split layout
  // ===========================================================================
  await setViewport({ width: 1440, height: 900, mobile: false });
  await navigate("#/runs");
  await waitFor(
    'document.querySelectorAll(\'ul[role="list"] a[href*="/runs/"]\').length >= 10',
    "desktop run rows",
  );
  let probe = await evaluate(LAYOUT_PROBE);
  record("desktop-1440-split", {
    pass:
      probe.listPaneWidth === 380 &&
      probe.hasPlaceholder &&
      !probe.hasBack &&
      !probe.overflowX &&
      probe.visibleFilterNames.length === 4 &&
      !probe.filterToggleVisible,
    ...probe,
    reason:
      probe.listPaneWidth !== 380
        ? "list pane width is not 380px"
        : !probe.hasPlaceholder
          ? "detail pane placeholder missing"
          : probe.hasBack
            ? "unexpected Back button on desktop"
            : probe.visibleFilterNames.length !== 4
              ? `expected 4 always-visible desktop filters, found ${probe.visibleFilterNames.length}`
              : probe.filterToggleVisible
                ? "mobile filter toggle is visible on desktop"
                : probe.overflowX
                  ? "horizontal overflow at 1440"
                  : undefined,
  });
  await screenshot("01-desktop-1440-runs-list");

  // Select a run on desktop — detail in right pane, split retained.
  const desktopClick = await evaluate(`(() => {
    const link = document.querySelector('ul[role="list"] a[href*="/runs/"]');
    if (!link) return false;
    link.click();
    return true;
  })()`);
  if (!desktopClick) throw new Error("desktop: could not click a run row");
  await waitFor(
    "(document.body.innerText ?? '').includes('Ad hoc poem persistence')",
    "desktop detail",
  );
  probe = await evaluate(LAYOUT_PROBE);
  record("desktop-1440-select-detail", {
    pass:
      probe.listPaneWidth === 380 &&
      !probe.hasBack &&
      !probe.overflowX &&
      probe.hash.includes("/runs/"),
    ...probe,
    reason: !probe.hash.includes("/runs/")
      ? "row click did not navigate to /runs/:id"
      : probe.hasBack
        ? "Back button appeared on desktop"
        : probe.listPaneWidth !== 380
          ? "list pane disappeared after selection on desktop"
          : probe.overflowX
            ? "horizontal overflow with detail open at 1440"
            : undefined,
  });
  await screenshot("02-desktop-1440-run-detail");

  // ===========================================================================
  // 2. 1024x768 — transition boundary (>=1024 is desktop)
  // ===========================================================================
  await setViewport({ width: 1024, height: 768, mobile: false });
  await navigate("#/runs");
  await waitFor(
    'document.querySelectorAll(\'ul[role="list"] a[href*="/runs/"]\').length >= 10',
    "1024 run rows",
  );
  probe = await evaluate(LAYOUT_PROBE);
  record("boundary-1024-split", {
    pass:
      probe.listPaneWidth === 380 &&
      probe.hasPlaceholder &&
      !probe.hasBack &&
      !probe.overflowX &&
      probe.visibleFilterNames.length === 4 &&
      !probe.filterToggleVisible,
    ...probe,
    reason:
      probe.listPaneWidth !== 380
        ? "1024px is desktop breakpoint but list pane collapsed"
        : !probe.hasPlaceholder
          ? "detail pane placeholder missing at 1024"
          : probe.hasBack
            ? "unexpected Back button at 1024"
            : probe.visibleFilterNames.length !== 4
              ? `expected 4 always-visible filters at 1024, found ${probe.visibleFilterNames.length}`
              : probe.filterToggleVisible
                ? "mobile filter toggle is visible at desktop breakpoint"
                : probe.overflowX
                  ? "horizontal overflow at 1024"
                  : undefined,
  });
  await screenshot("03-boundary-1024-runs-list");

  // ===========================================================================
  // 3. Tablet 768x1024 — route-based list/detail
  // ===========================================================================
  await setViewport({ width: 768, height: 1024, mobile: true });
  await navigate("#/runs");
  await waitFor(
    'document.querySelectorAll(\'ul[role="list"] a[href*="/runs/"]\').length >= 10',
    "tablet run rows",
  );
  probe = await evaluate(LAYOUT_PROBE);
  record("tablet-768-list-only", {
    pass:
      probe.listPaneWidth === null &&
      !probe.hasPlaceholder &&
      !probe.hasBack &&
      !probe.overflowX &&
      probe.visibleFilterNames.length === 0 &&
      probe.filterToggleVisible,
    ...probe,
    reason:
      probe.listPaneWidth !== null
        ? "desktop split pane rendered on tablet"
        : probe.hasPlaceholder
          ? "detail placeholder leaked into tablet list"
          : probe.hasBack
            ? "Back button on tablet list route"
            : probe.visibleFilterNames.length !== 0
              ? "desktop filters are visible before opening the tablet sheet"
              : !probe.filterToggleVisible
                ? "filter toggle missing on tablet"
                : probe.overflowX
                  ? "horizontal overflow at 768"
                  : undefined,
  });
  await screenshot("04-tablet-768-runs-list");

  // Tap a row -> route-based detail with Back.
  const tabletClick = await evaluate(`(() => {
    const link = document.querySelector('ul[role="list"] a[href*="/runs/"]');
    if (!link) return false;
    link.click();
    return true;
  })()`);
  if (!tabletClick) throw new Error("tablet: could not click a run row");
  await waitFor(
    "(document.body.innerText ?? '').includes('Back to Runs')",
    "tablet detail back link",
  );
  probe = await evaluate(LAYOUT_PROBE);
  record("tablet-768-route-detail", {
    pass:
      probe.hasBack &&
      probe.listPaneWidth === null &&
      !probe.overflowX &&
      probe.hash.includes("/runs/"),
    ...probe,
    reason: !probe.hash.includes("/runs/")
      ? "row click did not navigate to /runs/:id"
      : !probe.hasBack
        ? "Back to Runs link missing on tablet detail"
        : probe.listPaneWidth !== null
          ? "split pane leaked into tablet detail"
          : probe.overflowX
            ? "horizontal overflow at tablet detail"
            : undefined,
  });
  await screenshot("05-tablet-768-run-detail");

  // Back -> returns to list.
  const backClick = await evaluate(`(() => {
    const el = [...document.querySelectorAll("a,button")].find((el) =>
      (el.textContent ?? "").trim().startsWith("Back to Runs"),
    );
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!backClick) throw new Error("tablet: could not click Back to Runs");
  await waitFor(
    "location.hash === '#/runs' && document.querySelectorAll('ul[role=\"list\"] a[href*=\"/runs/\"]').length >= 10",
    "tablet back to list",
  );
  probe = await evaluate(LAYOUT_PROBE);
  record("tablet-768-back-to-list", {
    pass:
      probe.hash === "#/runs" && !probe.hasBack && probe.rowCount >= 10 && !probe.hasPlaceholder,
    ...probe,
    reason:
      probe.hash !== "#/runs"
        ? "Back did not return to #/runs"
        : probe.hasBack
          ? "Back link still present after returning to list"
          : probe.rowCount < 10
            ? "list rows missing after Back"
            : undefined,
  });

  // Direct deep-link to a detail on tablet.
  await navigate("#/runs/run-adhoc-4");
  await waitFor(
    "(document.body.innerText ?? '').includes('Back to Runs')",
    "tablet deep-link detail",
  );
  probe = await evaluate(LAYOUT_PROBE);
  const tabletDeepBody = await evaluate(
    `(document.body.innerText ?? "").includes("Ad hoc fused verdict")`,
  );
  record("tablet-768-deeplink-detail", {
    pass: probe.hasBack && !probe.overflowX && tabletDeepBody,
    ...probe,
    reason: !probe.hasBack
      ? "deep-linked detail missing Back link"
      : probe.overflowX
        ? "horizontal overflow on deep-linked detail"
        : undefined,
  });
  await screenshot("06-tablet-768-deeplink-detail");

  // ===========================================================================
  // 4. Phone 390x844 — route-based detail + filter sheet
  // ===========================================================================
  await setViewport({ width: 390, height: 844, mobile: true });
  await navigate("#/runs");
  await waitFor(
    'document.querySelectorAll(\'ul[role="list"] a[href*="/runs/"]\').length >= 10',
    "phone run rows",
  );
  probe = await evaluate(LAYOUT_PROBE);
  record("phone-390-list-only", {
    pass:
      probe.listPaneWidth === null &&
      !probe.hasPlaceholder &&
      !probe.hasBack &&
      !probe.overflowX &&
      probe.visibleFilterNames.length === 0 &&
      probe.filterToggleVisible,
    ...probe,
    reason:
      probe.listPaneWidth !== null
        ? "desktop split pane rendered on phone"
        : probe.hasPlaceholder
          ? "detail placeholder leaked into phone list"
          : probe.hasBack
            ? "Back button on phone list route"
            : probe.visibleFilterNames.length !== 0
              ? "filters are visible before opening the phone sheet"
              : !probe.filterToggleVisible
                ? "filter toggle missing on phone"
                : probe.overflowX
                  ? "horizontal overflow at 390"
                  : undefined,
  });
  await screenshot("07-phone-390-runs-list");

  // Filter sheet: toggle + search visible; controls not visibly exposed until opened.
  const sheetClosed = await evaluate(`(() => {
    const isVisible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
    };
    const toggle = document.querySelector('[data-action="toggle-filters"]');
    const search = document.querySelector('input[type="search"]');
    const visibleFilters = [...document.querySelectorAll("select[data-filter]")].filter(isVisible);
    return {
      toggle: isVisible(toggle),
      search: isVisible(search),
      visibleFilterCount: visibleFilters.length,
    };
  })()`);
  record("phone-390-filters-closed", {
    pass: sheetClosed.toggle && sheetClosed.search && sheetClosed.visibleFilterCount === 0,
    ...sheetClosed,
    reason: !sheetClosed.toggle
      ? "filter toggle button missing on phone"
      : !sheetClosed.search
        ? "search input hidden on phone"
        : sheetClosed.visibleFilterCount !== 0
          ? "filter controls visible before toggle"
          : undefined,
  });

  // Open the sheet.
  await evaluate(`(() => {
    const toggle = document.querySelector('[data-action="toggle-filters"]');
    toggle.click();
    return true;
  })()`);
  await waitFor(
    "Boolean(document.querySelector('[data-filter-sheet]'))",
    "phone filter sheet open",
  );
  const sheetOpen = await evaluate(`(() => {
    const isVisible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
    };
    const sheet = document.querySelector("[data-filter-sheet]");
    const selects = ["model", "status", "mode", "source"].map((n) =>
      isVisible(sheet?.querySelector('[data-filter="' + n + '"]')),
    );
    return {
      model: selects[0],
      status: selects[1],
      mode: selects[2],
      source: selects[3],
      clear: isVisible(sheet?.querySelector('[data-action="clear-filters"]')),
      toggleText: (document.querySelector('[data-action="toggle-filters"]')?.textContent ?? "").trim(),
    };
  })()`);
  record("phone-390-filters-sheet", {
    pass:
      sheetOpen.model && sheetOpen.status && sheetOpen.mode && sheetOpen.source && sheetOpen.clear,
    ...sheetOpen,
    reason:
      !sheetOpen.model || !sheetOpen.status || !sheetOpen.mode || !sheetOpen.source
        ? "filter sheet missing controls"
        : !sheetOpen.clear
          ? "clear-filters button missing"
          : undefined,
  });
  await screenshot("08-phone-390-filter-sheet-open");

  // Apply filters -> applied-count badge.
  await evaluate(`(() => {
    const sel = document.querySelector('[data-filter-sheet] [data-filter="model"]');
    sel.value = ${JSON.stringify("openrouter:z-ai/glm-5.2")};
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await waitFor(
    "Boolean(document.querySelector('[data-action=\"toggle-filters\"]').textContent.includes('1'))",
    "badge count 1",
  );
  const badge1 = await evaluate(
    `document.querySelector('[data-action="toggle-filters"]').textContent`,
  );
  record("phone-390-filter-badge", {
    pass: badge1.includes("1"),
    badge: badge1.trim(),
    reason: !badge1.includes("1") ? "applied-count badge did not show 1" : undefined,
  });

  // Add a second filter -> badge 2 and list filters accordingly.
  await evaluate(`(() => {
    const sel = document.querySelector('[data-filter-sheet] [data-filter="status"]');
    sel.value = "running";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await waitFor(
    "Boolean(document.querySelector('[data-action=\"toggle-filters\"]').textContent.includes('2'))",
    "badge count 2",
  );
  await waitFor(
    'document.querySelectorAll(\'ul[role="list"] a[href*="/runs/"]\').length === 1',
    "filtered list",
  );
  const filtered = await evaluate(
    `document.querySelectorAll('ul[role="list"] a[href*="/runs/"]')[0]?.getAttribute("href")`,
  );
  record("phone-390-filter-combined", {
    pass: filtered === "#/runs/run-adhoc-2",
    href: filtered,
    reason:
      filtered !== "#/runs/run-adhoc-2"
        ? "combined model+running filter returned the wrong row"
        : undefined,
  });

  // Clear filters -> badge gone, all rows back.
  await evaluate(
    `document.querySelector('[data-filter-sheet] [data-action="clear-filters"]').click()`,
  );
  await waitFor(
    'document.querySelectorAll(\'ul[role="list"] a[href*="/runs/"]\').length >= 10',
    "cleared filter list",
  );
  const cleared = await evaluate(`({
    toggleText: (document.querySelector('[data-action="toggle-filters"]')?.textContent ?? "").trim(),
    rows: document.querySelectorAll('ul[role="list"] a[href*="/runs/"]').length,
  })`);
  record("phone-390-filter-clear", {
    pass:
      cleared.rows >= 10 && !cleared.toggleText.includes("1") && !cleared.toggleText.includes("2"),
    ...cleared,
    reason: cleared.rows < 10 ? "rows not restored after clear" : undefined,
  });

  // Close sheet via toggle; search remains.
  await evaluate(`document.querySelector('[data-action="toggle-filters"]').click()`);
  await wait(300);
  const sheetClosedAgain = await evaluate(`(() => {
    const isVisible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
    };
    return {
      visibleFilterCount: [...document.querySelectorAll("select[data-filter]")].filter(isVisible).length,
      search: isVisible(document.querySelector('input[type="search"]')),
    };
  })()`);
  record("phone-390-filters-close", {
    pass: sheetClosedAgain.visibleFilterCount === 0 && sheetClosedAgain.search,
    ...sheetClosedAgain,
    reason:
      sheetClosedAgain.visibleFilterCount !== 0
        ? "filter controls remain visible after closing the sheet"
        : !sheetClosedAgain.search
          ? "search disappeared when closing the sheet"
          : undefined,
  });

  // Phone route-based detail.
  const phoneClick = await evaluate(`(() => {
    const link = document.querySelector('ul[role="list"] a[href*="/runs/"]');
    if (!link) return false;
    link.click();
    return true;
  })()`);
  if (!phoneClick) throw new Error("phone: could not click a run row");
  await waitFor(
    "(document.body.innerText ?? '').includes('Back to Runs')",
    "phone detail back link",
  );
  probe = await evaluate(LAYOUT_PROBE);
  record("phone-390-route-detail", {
    pass:
      probe.hasBack &&
      probe.listPaneWidth === null &&
      !probe.overflowX &&
      probe.hash.includes("/runs/"),
    ...probe,
    reason: !probe.hash.includes("/runs/")
      ? "row click did not navigate to /runs/:id on phone"
      : !probe.hasBack
        ? "Back to Runs link missing on phone detail"
        : probe.overflowX
          ? "horizontal overflow at phone detail"
          : undefined,
  });
  await screenshot("09-phone-390-run-detail");

  // Candidate row text must not clip on phone (regression: non-wrapping flex
  // squeezed the attempts count; fixed with flex-wrap on the row button).
  await navigate("#/runs/run-adhoc-1");
  await waitFor(
    "(document.body.innerText ?? '').includes('Ad hoc poem persistence')",
    "phone candidate detail",
  );
  const candidateRows = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll("[data-candidate-id]")];
    return buttons.map((b) => {
      const br = b.getBoundingClientRect();
      // Rightmost text span inside the button (attempts count)
      const spans = [...b.querySelectorAll("span")].filter(
        (s) => s.getBoundingClientRect().width > 0 && !s.classList.contains("sr-only"),
      );
      const rightmost = spans.reduce(
        (max, s) => Math.max(max, s.getBoundingClientRect().right),
        0,
      );
      const lastText = (b.textContent ?? "").replace(/\\s+/g, " ").trim().slice(-40);
      return {
        buttonRight: Math.round(br.right),
        contentRight: Math.round(rightmost),
        clipped: rightmost > br.right + 1,
        lastText,
      };
    });
  })()`);
  record("phone-390-candidate-rows-no-clip", {
    pass: candidateRows.every((r) => !r.clipped) && candidateRows.length >= 2,
    rows: candidateRows,
    reason: candidateRows.some((r) => r.clipped)
      ? "candidate row content overflows the row button"
      : candidateRows.length < 2
        ? "expected at least 2 candidate rows"
        : undefined,
  });
  await screenshot("11-phone-390-candidates-after-fix");

  // Legacy run detail on phone (summary-only renderer).
  await navigate("#/runs/legacy-1");
  await waitFor("(document.body.innerText ?? '').includes('Back to Runs')", "phone legacy detail");
  const legacyDetail = await evaluate(
    `(document.body.innerText ?? "").includes("Legacy run from the v1 localStorage history")`,
  );
  record("phone-390-legacy-detail", {
    pass: legacyDetail,
    reason: !legacyDetail ? "legacy summary detail did not render" : undefined,
  });
  await screenshot("10-phone-390-legacy-detail");

  // Phone filter sheet on desktop width should still exist? No — desktop keeps
  // the same toggle (sheet is visible on all sizes). Verify the toggle exists
  // at desktop too (already implied by desktop probes). Skip.

  // --- Final summary ----------------------------------------------------------
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
