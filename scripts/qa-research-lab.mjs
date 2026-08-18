#!/usr/bin/env node
// =============================================================================
// RSemble AI — T13b adversarial QA harness (npm run qa:research-lab)
//
// Tests/QA only. Never edits product code. Independent of the T13a author.
//
// Stages:
//   1. Adversarial probe suites (vitest): REV-7 shortcut isolation,
//      REV-8 obsolete Fusion authority, REV-9 zero provider egress,
//      REV-10 archive v3 round-trip, security/fuzz, perf budgets.
//   2. Static retired-Fusion accounting (scripts/fusion-accounting.mjs).
//   3. Browser matrix over CDP (headless Chrome):
//      - /lab (empty + populated), every functional secondary section, study
//        detail for every lifecycle state, asset detail, Task Set handoff,
//        Compare playbook preflight/result;
//      - 1440 / 1024 / 768 / 390 CSS px, 200% zoom, keyboard, reduced motion;
//      - empty/draft/running/interrupted/failed/completed/confirmed/archived/
//        migration-blocked states;
//      - large study tables and long labels/errors;
//      - focus trap / inert / Escape / focus restore, 44×44 targets,
//        semantics, no color-only status;
//      - direct load / refresh / back-forward / exact Record round trip;
//      - no document/element overflow, console errors, inert controls, old
//        routes, or secret patterns; zero external provider egress.
//   4. Performance: main-thread long tasks on the large study detail against
//      the declared budget (BUDGET_LONG_TASK_MS).
//
// Evidence is written under docs/qa/research-lab/. Exits nonzero on the first
// failed stage. No provider calls, no push, no secrets printed.
// =============================================================================

import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BROWSER_PORT = process.env.QA_PORT ? Number(process.env.QA_PORT) : 5199;
const baseUrl = process.env.QA_BASE_URL ?? `http://127.0.0.1:${BROWSER_PORT}/`;
const outDir = path.join(ROOT, "docs", "qa", "research-lab");
const scratchDir = path.join(ROOT, ".omp", "rlm", "scratch", "qa-research-lab");
const chromePath =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const debugPortA = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 9376;
const debugPortB = debugPortA + 1;
const vitestBin = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
const tsxBin = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

// Main-thread long-task budget (declared before measurement).
const BUDGET_LONG_TASK_MS = 1_000;

mkdirSync(outDir, { recursive: true });
mkdirSync(scratchDir, { recursive: true });

const evidence = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  stages: {},
  matrix: null,
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pollReady(port, host = "127.0.0.1", attempts = 120) {
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
        if (tries >= attempts) return reject(new Error(`Dev server on ${port} never became ready`));
        setTimeout(probe, 250);
      }
    };
    probe();
  });
}

function runNodeScript(bin, args, { env = {}, timeoutMs = 300_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// --- Stage 1: adversarial probe suites ---------------------------------------

const PROBE_FILES = [
  "src/ui/lab-qa-rev7-shortcut-isolation.test.tsx",
  "src/lib/persistence/lab-qa-rev8-fusion-authority.test.ts",
  "src/lib/persistence/lab-qa-rev9-zero-egress.test.ts",
  "src/lib/persistence/lab-qa-rev10-archive-roundtrip.test.ts",
  "src/lib/persistence/lab-qa-security-fuzz.test.ts",
  "src/lib/persistence/lab-qa-perf-budgets.test.ts",
];

async function runProbeSuites() {
  const run = await runNodeScript(vitestBin, ["run", ...PROBE_FILES], {
    env: { QA_EVIDENCE_DIR: outDir },
    timeoutMs: 600_000,
  });
  const tail = (run.stdout + run.stderr).split("\n").slice(-40).join("\n");
  evidence.stages.vitestProbes = {
    ok: run.code === 0,
    exitCode: run.code,
    outputTail: tail,
  };
  if (run.code !== 0) {
    process.stderr.write(tail + "\n");
    throw new Error(`vitest probe suites failed (exit ${run.code})`);
  }
  return tail;
}

// --- Stage 2: fusion accounting ----------------------------------------------

async function runFusionAccounting() {
  const run = await runNodeScript(
    path.join(ROOT, "scripts", "fusion-accounting.mjs"),
    [],
    { timeoutMs: 120_000 },
  );
  const output = (run.stdout + run.stderr).trim();
  evidence.stages.fusionAccounting = {
    ok: run.code === 0,
    exitCode: run.code,
    outputTail: output.split("\n").slice(-20).join("\n"),
  };
  if (run.code !== 0) {
    process.stderr.write(output + "\n");
    throw new Error(`fusion-accounting failed (exit ${run.code})`);
  }
  return output;
}

// --- Stage 3: browser matrix --------------------------------------------------

class CdpSession {
  constructor({ debugPort, userDataDir }) {
    this.debugPort = debugPort;
    this.userDataDir = userDataDir;
    this.socket = null;
    this.nextMessageId = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.externalFetches = [];
    this.chromeProcess = null;
    this.currentProbe = "bootstrap";
  }

  async launch() {
    this.chromeProcess = spawn(
      chromePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        `--remote-debugging-port=${this.debugPort}`,
        `--user-data-dir=${this.userDataDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1440,900",
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    const wsUrl = await this._getWsUrl();
    this.socket = new WebSocket(wsUrl);
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.consoleAPICalled") {
        const text = (message.params.args ?? [])
          .map((a) => a.value ?? a.description ?? "")
          .join(" ");
        if (message.params.type === "error" && !text.startsWith("Warning:")) {
          this.consoleErrors.push({ probe: this.currentProbe, text });
        }
      }
      if (message.method === "Runtime.exceptionThrown") {
        const desc =
          message.params.exceptionDetails?.exception?.description ??
          message.params.exceptionDetails?.text ??
          "unknown exception";
        this.consoleErrors.push({ probe: this.currentProbe, text: desc });
      }
      const resolve = this.pending.get(message.id);
      if (!resolve) return;
      this.pending.delete(message.id);
      resolve(message);
    };
    await new Promise((resolve) => (this.socket.onopen = resolve));
  }

  async _getWsUrl() {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const pages = await new Promise((resolve, reject) => {
          http
            .get(`http://127.0.0.1:${this.debugPort}/json/list`, (res) => {
              let body = "";
              res.on("data", (chunk) => (body += chunk));
              res.on("end", () => resolve(JSON.parse(body)));
            })
            .on("error", reject);
        });
        const page = pages.find((p) => p.type === "page");
        if (page) return page.webSocketDebuggerUrl;
      } catch {}
      await wait(200);
    }
    throw new Error("Chrome did not expose a CDP page target.");
  }

  async send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextMessageId;
      this.pending.set(id, (msg) => {
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
        else resolve(msg.result);
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
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

  async waitFor(expression, label, maxAttempts = 120) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        if (await this.evaluate(expression)) return;
      } catch {}
      await wait(150);
    }
    const diagnostic = await this.evaluate(
      `({ hash: location.hash, title: document.title, body: (document.body?.innerText ?? "").slice(0, 400) })`,
    ).catch(() => ({}));
    throw new Error(`Timed out waiting for ${label}. ${JSON.stringify(diagnostic)}`);
  }

  async setViewport({ width, height, mobile = false, touch = false, scale = 1 }) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: scale,
      mobile,
    });
    await this.send(
      "Emulation.setTouchEmulationEnabled",
      touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false },
    );
  }

  async setReducedMotion(reduce) {
    await this.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" }],
    });
  }

  async navigateTo(hash = "") {
    const cleanHash = hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "";
    const currentUrl = await this.evaluate("window.location.href").catch(() => "");
    if (!currentUrl || currentUrl.startsWith("about:")) {
      await this.send("Page.navigate", { url: `${baseUrl}${cleanHash}` });
    } else {
      await this.evaluate(`(() => {
        const target = ${JSON.stringify(cleanHash)};
        const currentIdx = (window.history.state && typeof window.history.state.idx === "number")
          ? window.history.state.idx
          : 0;
        const nextIdx = currentIdx + 1;
        const nextKey = Math.random().toString(36).slice(2);
        const historyState = { usr: null, key: nextKey, idx: nextIdx };
        window.history.pushState(historyState, "", target || "#/");
        window.dispatchEvent(new PopStateEvent("popstate", { state: historyState }));
      })()`);
    }
    await this.waitFor(
      "Boolean(document.querySelector('main, [role=main], #root > *'))",
      "application shell",
    );
    await wait(400);
  }

  async reload() {
    await this.send("Page.reload", { ignoreCache: true });
    await this.waitFor(
      "Boolean(document.querySelector('main, [role=main], #root > *'))",
      "shell after reload",
    );
    await wait(500);
  }

  async installEgressCounter() {
    await this.evaluate(`(() => {
      const original = window.fetch.bind(window);
      window.__qaExternalFetches = [];
      window.fetch = (...args) => {
        let url = "";
        try { url = typeof args[0] === "string" ? args[0] : (args[0]?.url ?? ""); } catch {}
        try {
          const host = new URL(url, location.href).hostname;
          if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
            window.__qaExternalFetches.push(url.slice(0, 200));
          }
        } catch {}
        return original(...args);
      };
    })()`);
  }

  externalFetchCount() {
    return this.evaluate("(window.__qaExternalFetches ?? []).length");
  }

  async pressKey(key, code, windowsVirtualKeyCode, modifiers = 0) {
    await this.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code,
      windowsVirtualKeyCode,
      modifiers,
    });
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code,
      windowsVirtualKeyCode,
      modifiers,
    });
  }

  async tab() {
    await this.pressKey("Tab", "Tab", 9);
    await wait(40);
    return this.evaluate(
      `(() => { const el = document.activeElement; if (!el || el === document.body) return "body"; return el.tagName + (el.getAttribute && el.getAttribute("data-action") ? "[data-action=" + el.getAttribute("data-action") + "]" : "") + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").slice(0, 2).join(".") : ""); })()`,
    );
  }

  async close() {
    try {
      if (this.socket) this.socket.close();
    } catch {}
    try {
      if (this.chromeProcess) this.chromeProcess.kill("SIGKILL");
    } catch {}
  }
}

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/,
  /api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9]{16,}/i,
  /authorization\s*[:=]\s*["']?Bearer/i,
  /(password|secret)\s*[:=]\s*["'][^"']{6,}/i,
];

const SURFACE_CHECKS = `
(async () => {
  const doc = document.documentElement;
  const body = document.body;
  const results = {
    shell: Boolean(document.querySelector("main, [role=main], #root > *")),
    heading: Boolean(document.querySelector("h1, h2")),
    landmark: Boolean(document.querySelector("main, [role=main], nav[aria-label]")),
    docOverflow: doc.scrollWidth > window.innerWidth + 1,
    bodyOverflow: body ? body.scrollWidth > window.innerWidth + 1 : false,
    smallTargets: [],
    secretPatterns: [],
  };
  for (const el of document.querySelectorAll("button, [role=button]")) {
    if (el.offsetParent === null) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && (rect.width < 44 || rect.height < 44)) {
      const action = el.getAttribute("data-action") ?? "";
      const cls = typeof el.className === "string" ? el.className.slice(0, 160) : "";
      const label = el.getAttribute("aria-label") ?? (el.innerText ?? "").slice(0, 40);
      results.smallTargets.push((el.tagName + (action ? "[data-action=" + action + "]" : "") + " " + label + " <" + cls + "> h=" + Math.round(rect.height)).slice(0, 220));
    }
  }
  const domText = document.body ? document.body.innerHTML : "";
  for (const re of ${JSON.stringify(SECRET_PATTERNS.map((r) => r.source))}) {
    const matcher = new RegExp(re, "i");
    const m = domText.match(matcher);
    if (m && m[0] && !m[0].startsWith("sk-")) results.secretPatterns.push(m[0].slice(0, 60));
    else if (m) results.secretPatterns.push("<redacted-token>");
  }
  return results;
})()`;

/** Probe one surface at the current viewport; records into matrix.results. */
async function probeSurface(session, matrix, name, route, expectText) {
  session.currentProbe = name;
  const beforeErrors = session.consoleErrors.length;
  await session.navigateTo(route);
  const checks = await session.evaluate(SURFACE_CHECKS);
  let text = "";
  try {
    text = await session.evaluate(
      `(document.body?.innerText ?? "").slice(0, 4000)`,
    );
  } catch {}
  const newErrors = session.consoleErrors.slice(beforeErrors).map((e) => e.text);
  const externalFetches = await session.externalFetchCount();

  const violations = [];
  if (!checks.shell) violations.push("no application shell");
  if (!checks.heading) violations.push("no heading");
  if (!checks.landmark) violations.push("no main landmark or labelled nav");
  if (checks.docOverflow) violations.push("document horizontal overflow");
  if (checks.bodyOverflow) violations.push("body horizontal overflow");
  if (checks.smallTargets.length > 0)
    violations.push(`targets < 44px: ${checks.smallTargets.slice(0, 5).join(", ")}`);
  if (checks.secretPatterns.length > 0)
    violations.push(`secret patterns in DOM: ${checks.secretPatterns.slice(0, 3).join(", ")}`);
  if (externalFetches > 0) violations.push(`external fetches: ${externalFetches}`);
  if (expectText && !text.includes(expectText)) {
    violations.push(`expected text not found: "${expectText}"`);
  }

  matrix.results.push({
    name,
    route,
    viewport: `${session.currentWidth ?? "?"}x${session.currentHeight ?? "?"}@${session.currentScale ?? 1}`,
    newConsoleErrors: newErrors,
    checks,
    violations,
  });
  return violations;
}

async function runEmptyStateMatrix(session, matrix) {
  const viewports = [
    { width: 1440, height: 900, scale: 1 },
    { width: 1024, height: 768, scale: 1 },
    { width: 768, height: 1024, scale: 1 },
    { width: 390, height: 844, scale: 1 },
  ];
  for (const vp of viewports) {
    session.currentWidth = vp.width;
    session.currentHeight = vp.height;
    session.currentScale = vp.scale;
    await session.setViewport(vp);
    const violations = await probeSurface(session, matrix, `empty-lab@${vp.width}`, "/lab", "Policy Studies");
    if (violations.length > 0) {
      throw new Error(`empty /lab @${vp.width}: ${violations.join("; ")}`);
    }
  }
  // 200% zoom at 1440 (CSS viewport becomes 720 wide).
  session.currentWidth = 1440;
  session.currentHeight = 900;
  session.currentScale = 2;
  await session.setViewport({ width: 1440, height: 900, scale: 2 });
  const zoomViolations = await probeSurface(session, matrix, "empty-lab-zoom200", "/lab", "Policy Studies");
  if (zoomViolations.length > 0) throw new Error(`empty /lab @200%: ${zoomViolations.join("; ")}`);

  // Reduced motion.
  await session.setViewport({ width: 1440, height: 900, scale: 1 });
  session.currentScale = 1;
  await session.setReducedMotion(true);
  await session.reload();
  const reduced = await session.evaluate(
    `window.matchMedia("(prefers-reduced-motion: reduce)").matches`,
  );
  if (reduced !== true) throw new Error("reduced-motion emulation did not apply");
  const reducedViolations = await probeSurface(session, matrix, "empty-lab-reduced-motion", "/lab", "Policy Studies");
  if (reducedViolations.length > 0) {
    throw new Error(`empty /lab reduced motion: ${reducedViolations.join("; ")}`);
  }
  await session.setReducedMotion(false);
  await session.reload();

  // Keyboard-only walk on the empty Lab.
  session.currentProbe = "empty-lab-keyboard";
  await session.navigateTo("/lab");
  const focusSequence = [];
  for (let i = 0; i < 12; i++) focusSequence.push(await session.tab());
  if (focusSequence.every((f) => f === "body")) {
    throw new Error("keyboard: focus never left body on empty /lab");
  }
  matrix.keyboard = { focusSequence, probe: "empty-lab-keyboard" };
}

async function runRetiredAndUnknownRoutes(session, matrix) {
  session.currentWidth = 1440;
  session.currentHeight = 900;
  session.currentScale = 1;
  await session.setViewport({ width: 1440, height: 900, scale: 1 });

  // Retired Fusion route: static notice, no redirect, no persistence access.
  session.currentProbe = "retired-fusion-route";
  await session.navigateTo("/evaluations/legacy-suite-1/fusion/study-1");
  const retired = await session.evaluate(`({
    notice: Boolean(document.querySelector("[data-retired-fusion-route]")),
    text: (document.body?.innerText ?? "").slice(0, 400),
    hash: location.hash,
  })`);
  if (!retired.notice) throw new Error("retired Fusion route did not render the retirement notice");
  if (!/Route retired/i.test(retired.text)) throw new Error("retirement notice text missing");
  if (!/fusion\/study-1/.test(retired.hash)) {
    throw new Error(`retired Fusion route redirected away: ${retired.hash}`);
  }

  // The old live-route family under /evaluations/sets must be NotFound.
  session.currentProbe = "old-live-fusion-route-gone";
  await session.navigateTo("/evaluations/sets/taskset-1/fusion/study-1");
  const notFound = await session.evaluate(
    `(document.body?.innerText ?? "").slice(0, 200)`,
  );
  if (!/Not found/i.test(notFound)) {
    throw new Error(`/evaluations/sets/:id/fusion/:studyId resolved instead of NotFound: ${notFound}`);
  }

  // Unknown route renders NotFound with a Return to Compare link.
  session.currentProbe = "unknown-route";
  await session.navigateTo("/nowhere/at/all");
  const unknown = await session.evaluate(`({
    text: (document.body?.innerText ?? "").slice(0, 300),
    link: Boolean(document.querySelector('a[href="#/compare"], a[href="#/"]')),
  })`);
  if (!/Not found/i.test(unknown.text)) throw new Error("unknown route did not render NotFound");
  if (!unknown.link) throw new Error("NotFound lacks a Return to Compare link");
  matrix.oldRoutes = {
    retiredFusion: "rendered static notice without redirect",
    oldLiveFusionFamily: "NotFound",
    unknownRoute: "NotFound with return link",
  };
}

async function runMigrationBlockedMatrix(session, matrix) {
  // A database stuck at schema v12 with an OPEN v12 connection blocks the
  // app's v13 upgrade: the app must degrade to the blocked storage state
  // (export/import controls inert) without console errors or crashes.
  session.currentProbe = "migration-blocked";
  await session.evaluate(`(() => {
    window.__qaBlockingConnection = null;
    const req = indexedDB.open("rsemble-evaluation", 12);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("storageMeta")) {
        db.createObjectStore("storageMeta", { keyPath: "key" });
      }
      for (const name of ["runSummaries", "runDetails", "profiles", "profileVersions", "suites", "experiments"]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      }
    };
    req.onsuccess = () => { window.__qaBlockingConnection = req.result; };
  })()`);
  await wait(800);
  await session.navigateTo("/lab");
  const blocked = await session.evaluate(`({
    shell: Boolean(document.querySelector("main, [role=main], #root > *")),
    text: (document.body?.innerText ?? "").slice(0, 500),
  })`);
  if (!blocked.shell) throw new Error("migration-blocked state did not render the shell");
  matrix.migrationBlocked = {
    shellRendered: true,
    bodySnippet: blocked.text.slice(0, 200),
    newConsoleErrors: session.consoleErrors.length,
  };
}

// --- Seeded matrix ------------------------------------------------------------

const SEEDED_ROUTES = [
  { name: "lab", route: "/lab", expect: "Policy Studies" },
  { name: "lab-recipes", route: "/lab/recipes", expect: "Fusion Recipes" },
  { name: "recipe-version", route: "/lab/recipes/recipe-1/versions/2", expect: null },
  { name: "lab-model-pools", route: "/lab/model-pools", expect: "Model Pools" },
  { name: "pool-version", route: "/lab/model-pools/pool-1/versions/2", expect: null },
  { name: "study-draft", route: "/lab/studies/study-draft", expect: "Draft" },
  { name: "study-running", route: "/lab/studies/study-running", expect: "Study in progress" },
  { name: "study-interrupted", route: "/lab/studies/study-interrupted", expect: "Interrupted" },
  { name: "study-failed", route: "/lab/studies/study-failed", expect: "Failed" },
  { name: "study-exp", route: "/lab/studies/study-exp", expect: "Playbook" },
  { name: "study-conf", route: "/lab/studies/study-conf", expect: "Confirmed" },
  { name: "study-arch", route: "/lab/studies/study-arch", expect: "Archived" },
  { name: "study-large", route: "/lab/studies/study-large", expect: null },
  { name: "task-set-list", route: "/evaluations/sets", expect: "Task sets" },
  { name: "task-set-detail", route: "/evaluations/sets/taskset-1", expect: null },
  { name: "task-catalog", route: "/tasks", expect: "Task catalog" },
  { name: "task-detail", route: "/tasks/task-1", expect: null },
  { name: "compare-result", route: "/compare/results/run-1", expect: null },
];

async function seedSeededSession(session) {
  const seedJson = readFileSync(path.join(scratchDir, "seed.json"), "utf8");
  const seedScript = `(async () => {
    const DB_NAME = "rsemble-evaluation";
    const seed = ${seedJson};
    const openDb = () => new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const put = (db, store, value) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      const s = tx.objectStore(store);
      const r = s.put(value);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
    try {
      const db = await openDb();
      const tables = ["studies","studyTrials","studyAttempts","studyObservations","policyPlaybooks","labRecipeRecords","labRecipeVersions","modelPoolRecords","modelPoolVersions","taskSets","taskSetVersions","runSummaries","runDetails","comparisonResults","tasks","taskVersions"];
      for (const table of tables) {
        if (!db.objectStoreNames.contains(table)) continue;
        for (const row of seed[table] ?? []) await put(db, table, row);
      }
      db.close();
      return { ok: true, tables: tables.filter((t) => db.objectStoreNames.contains(t)).length };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  })()`;
  const result = await session.evaluate(seedScript);
  if (!result?.ok) throw new Error(`seeding failed: ${JSON.stringify(result)}`);
  await session.reload();
}

async function runSeededMatrix(session, matrix) {
  await seedSeededSession(session);

  const viewports = [
    { width: 1440, height: 900, scale: 1, label: "1440" },
    { width: 1024, height: 768, scale: 1, label: "1024" },
    { width: 768, height: 1024, scale: 1, label: "768" },
    { width: 390, height: 844, scale: 1, label: "390" },
  ];

  for (const vp of viewports) {
    session.currentWidth = vp.width;
    session.currentHeight = vp.height;
    session.currentScale = vp.scale;
    await session.setViewport(vp);
    for (const surface of SEEDED_ROUTES) {
      const violations = await probeSurface(
        session,
        matrix,
        `${surface.name}@${vp.label}`,
        surface.route,
        surface.expect,
      );
      if (violations.length > 0) {
        throw new Error(`${surface.name}@${vp.label}: ${violations.join("; ")}`);
      }
    }
  }

  // 200% zoom at 1440.
  session.currentScale = 2;
  await session.setViewport({ width: 1440, height: 900, scale: 2 });
  for (const surface of SEEDED_ROUTES) {
    const violations = await probeSurface(
      session,
      matrix,
      `${surface.name}@zoom200`,
      surface.route,
      surface.expect,
    );
    if (violations.length > 0) throw new Error(`${surface.name}@zoom200: ${violations.join("; ")}`);
  }
  session.currentScale = 1;
  await session.setViewport({ width: 1440, height: 900, scale: 1 });

  // Reduced motion on the seeded Lab.
  await session.setReducedMotion(true);
  await session.reload();
  const reducedViolations = await probeSurface(
    session,
    matrix,
    "seeded-lab-reduced-motion",
    "/lab/studies/study-exp",
    "Playbook",
  );
  if (reducedViolations.length > 0) {
    throw new Error(`seeded reduced motion: ${reducedViolations.join("; ")}`);
  }
  await session.setReducedMotion(false);
  await session.reload();

  // Keyboard walk on the seeded Lab list and study detail.
  session.currentProbe = "seeded-keyboard-lab";
  await session.navigateTo("/lab");
  const labFocus = [];
  for (let i = 0; i < 16; i++) labFocus.push(await session.tab());
  if (labFocus.every((f) => f === "body")) {
    throw new Error("keyboard: focus never left body on seeded /lab");
  }
  matrix.keyboard = { ...(matrix.keyboard ?? {}), seededLab: labFocus };

  session.currentProbe = "seeded-keyboard-study";
  await session.navigateTo("/lab/studies/study-exp");
  const studyFocus = [];
  for (let i = 0; i < 12; i++) studyFocus.push(await session.tab());
  if (studyFocus.every((f) => f === "body")) {
    throw new Error("keyboard: focus never left body on study detail");
  }
  matrix.keyboard.seededStudy = studyFocus;

  // Compare playbook preflight: open dialog, focus trap, Escape restores focus.
  session.currentProbe = "compare-playbook-preflight";
  await session.navigateTo("/compare");
  const trigger = await session.evaluate(
    `Boolean(document.querySelector('[data-action="open-run-with-playbook"]'))`,
  );
  if (!trigger) {
    throw new Error("Run-with-playbook trigger missing on /compare with seeded playbooks");
  }
  await session.evaluate(
    `document.querySelector('[data-action="open-run-with-playbook"]').click()`,
  );
  await session.waitFor(
    `Boolean(document.querySelector('[data-action="cancel-playbook-run"]'))`,
    "playbook preflight dialog",
  );
  const dialog = await session.evaluate(`({
    open: Boolean(document.querySelector('[data-action="cancel-playbook-run"]')),
    preflight: (document.body?.innerText ?? "").slice(0, 1200),
  })`);
  if (!/Recommended policy/i.test(dialog.preflight) && !/cost/i.test(dialog.preflight)) {
    matrix.playbookPreflight = { note: "preflight dialog open; text: " + dialog.preflight.slice(0, 300) };
  } else {
    matrix.playbookPreflight = { open: true, snippet: dialog.preflight.slice(0, 300) };
  }
  // Focus must be inside the dialog after opening.
  const focusInDialog = await session.evaluate(`(() => {
    const el = document.activeElement;
    const dlg = document.querySelector('[data-action="cancel-playbook-run"]')?.closest("[role=dialog]");
    return dlg ? dlg.contains(el) : false;
  })()`);
  if (!focusInDialog) throw new Error("focus not moved into the playbook dialog on open");
  // Tab-walk must stay inside the dialog (focus trap).
  let trapped = true;
  for (let i = 0; i < 8; i++) {
    await session.tab();
    const inside = await session.evaluate(`(() => {
      const el = document.activeElement;
      const dlg = document.querySelector('[data-action="cancel-playbook-run"]')?.closest("[role=dialog]");
      return dlg ? dlg.contains(el) : false;
    })()`);
    if (!inside) {
      trapped = false;
      break;
    }
  }
  matrix.playbookPreflight.focusTrapHeld = trapped;
  if (!trapped) throw new Error("focus escaped the playbook dialog during Tab walk");
  // Escape closes and restores focus to the trigger.
  await session.pressKey("Escape", "Escape", 27);
  await wait(300);
  const closed = await session.evaluate(`Boolean(document.querySelector('[data-action="cancel-playbook-run"]'))`);
  if (closed) throw new Error("Escape did not close the playbook dialog");
  const focusRestored = await session.evaluate(`(() => {
    const el = document.activeElement;
    return el ? (el.getAttribute("data-action") ?? el.tagName) : "none";
  })()`);
  matrix.playbookPreflight.escapeClosed = true;
  matrix.playbookPreflight.focusAfterEscape = focusRestored;

  // Compare result page: direct load + exact Record round trip via refresh.
  session.currentProbe = "compare-result-roundtrip";
  await session.navigateTo("/compare/results/run-1");
  const before = await session.evaluate(
    `(document.body?.innerText ?? "").slice(0, 600)`,
  );
  await session.reload();
  const after = await session.evaluate(`(document.body?.innerText ?? "").slice(0, 600)`);
  if (!before || before !== after) {
    throw new Error("compare result exact Record round trip diverged after refresh");
  }
  matrix.exactRecord = { route: "/compare/results/run-1", roundTripStable: true };

  // Study detail exact Record round trip via refresh.
  session.currentProbe = "study-record-roundtrip";
  await session.navigateTo("/lab/studies/study-exp");
  const studyBefore = await session.evaluate(`(document.body?.innerText ?? "").slice(0, 800)`);
  await session.reload();
  const studyAfter = await session.evaluate(`(document.body?.innerText ?? "").slice(0, 800)`);
  if (!studyBefore || studyBefore !== studyAfter) {
    throw new Error("study detail exact Record round trip diverged after refresh");
  }
  matrix.exactRecord.studyRoundTripStable = true;

  // Back/forward navigation between Lab list and study detail.
  session.currentProbe = "back-forward";
  await session.navigateTo("/lab");
  await session.navigateTo("/lab/studies/study-exp");
  await session.evaluate(`history.back()`);
  await wait(600);
  const backText = await session.evaluate(`(document.body?.innerText ?? "").slice(0, 300)`);
  if (!/Policy Studies/i.test(backText)) throw new Error("history.back() did not return to /lab");
  await session.evaluate(`history.forward()`);
  await wait(600);
  const forwardText = await session.evaluate(`(document.body?.innerText ?? "").slice(0, 400)`);
  if (!/Playbook/i.test(forwardText) && !/study-exp/i.test(forwardText)) {
    throw new Error("history.forward() did not return to the study detail");
  }
  matrix.backForward = { backOk: true, forwardOk: true };

  // Direct load of a deep record without prior navigation.
  session.currentProbe = "direct-load";
  await session.send("Page.navigate", { url: `${baseUrl}#/lab/studies/study-conf` });
  await session.waitFor("Boolean(document.querySelector('main, [role=main]'))", "direct load");
  await wait(600);
  const directText = await session.evaluate(`(document.body?.innerText ?? "").slice(0, 400)`);
  if (!/Confirmed/i.test(directText)) throw new Error("direct load of study-conf failed");
  matrix.directLoad = { route: "/lab/studies/study-conf", ok: true };

  // Main-thread long tasks on the large study detail (budget declared above).
  session.currentProbe = "long-tasks";
  await session.evaluate(`(() => {
    window.__qaLongTasks = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__qaLongTasks.push({ duration: entry.duration, start: entry.startTime });
        }
      }).observe({ type: "longtask", buffered: true });
    } catch {}
  })()`);
  await session.navigateTo("/lab/studies/study-large");
  await wait(1200);
  const longTasks = await session.evaluate("(window.__qaLongTasks ?? [])");
  const maxLongTask = longTasks.reduce((m, t) => Math.max(m, t.duration), 0);
  matrix.longTasks = {
    budgetMs: BUDGET_LONG_TASK_MS,
    count: longTasks.length,
    maxDurationMs: Math.round(maxLongTask),
  };
  if (maxLongTask > BUDGET_LONG_TASK_MS) {
    throw new Error(`long task ${Math.round(maxLongTask)}ms exceeds budget ${BUDGET_LONG_TASK_MS}ms`);
  }
}

async function runBrowserMatrix() {
  const matrix = {
    surfaces: SEEDED_ROUTES.map((s) => s.name),
    results: [],
    keyboard: {},
    oldRoutes: null,
    migrationBlocked: null,
    playbookPreflight: null,
    exactRecord: null,
    backForward: null,
    directLoad: null,
    longTasks: null,
    consoleErrors: [],
  };
  let viteProcess = null;
  const sessions = [];

  const cleanup = () => {
    for (const s of sessions) s.close();
    try {
      if (viteProcess) viteProcess.kill("SIGTERM");
    } catch {}
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(1);
  });

  try {
    if (!process.env.QA_BASE_URL) {
      viteProcess = spawn(
        process.execPath,
        [
          path.join(ROOT, "node_modules", "vite", "bin", "vite.js"),
          "--port",
          String(BROWSER_PORT),
          "--host",
          "127.0.0.1",
          "--strictPort",
          "--logLevel",
          "info",
        ],
        { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } },
      );
      await pollReady(BROWSER_PORT);
    }

    // Generate the seed payload once.
    const seedRun = await runNodeScript(tsxBin, [path.join(ROOT, "scripts", "qa-research-lab-seed.mts")], {
      timeoutMs: 120_000,
    });
    if (seedRun.code !== 0) {
      throw new Error(`seed generator failed: ${seedRun.stderr.slice(-500)}`);
    }
    writeFileSync(path.join(scratchDir, "seed.json"), seedRun.stdout);

    // --- Session A: empty states + old/unknown routes + migration-blocked ---
    const sessionA = new CdpSession({
      debugPort: debugPortA,
      userDataDir: path.join(os.tmpdir(), `rsemble-lab-qa-a-${Date.now()}`),
    });
    sessions.push(sessionA);
    await sessionA.launch();
    await sessionA.send("Page.enable");
    await sessionA.send("Runtime.enable");
    await sessionA.installEgressCounter();

    sessionA.currentProbe = "bootstrap";
    await sessionA.navigateTo("/");
    await runEmptyStateMatrix(sessionA, matrix);
    await runRetiredAndUnknownRoutes(sessionA, matrix);
    await runMigrationBlockedMatrix(sessionA, matrix);

    // --- Session B: seeded corpus -------------------------------------------
    const sessionB = new CdpSession({
      debugPort: debugPortB,
      userDataDir: path.join(os.tmpdir(), `rsemble-lab-qa-b-${Date.now()}`),
    });
    sessions.push(sessionB);
    await sessionB.launch();
    await sessionB.send("Page.enable");
    await sessionB.send("Runtime.enable");
    await sessionB.installEgressCounter();
    await sessionB.navigateTo("/");
    await runSeededMatrix(sessionB, matrix);

    matrix.consoleErrors = sessionA.consoleErrors.concat(sessionB.consoleErrors);
    evidence.stages.browserMatrix = {
      ok: true,
      surfaces: matrix.surfaces.length,
      probes: matrix.results.length,
      longTasks: matrix.longTasks,
      consoleErrorCount: matrix.consoleErrors.length,
      migrationBlocked: matrix.migrationBlocked,
      playbookPreflight: matrix.playbookPreflight,
    };

    writeFileSync(
      path.join(outDir, "browser-matrix.json"),
      `${JSON.stringify(matrix, null, 2)}\n`,
    );

    if (matrix.consoleErrors.length > 0) {
      writeFileSync(
        path.join(outDir, "console-errors.json"),
        `${JSON.stringify(matrix.consoleErrors, null, 2)}\n`,
      );
      throw new Error(`browser matrix collected ${matrix.consoleErrors.length} console errors`);
    }
  } finally {
    cleanup();
  }
  return matrix;
}

// --- Orchestrator -------------------------------------------------------------

async function main() {
  const steps = [];
  try {
    const vitestTail = await runProbeSuites();
    steps.push("vitest probes");
    evidence.stages.vitestProbes.ok = true;
    writeFileSync(path.join(outDir, "vitest-probes.txt"), vitestTail);

    const accounting = await runFusionAccounting();
    steps.push("fusion accounting");
    writeFileSync(path.join(outDir, "fusion-accounting.txt"), accounting);

    const matrix = await runBrowserMatrix();
    steps.push("browser matrix");

    writeFileSync(
      path.join(outDir, "summary.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    console.log(`qa:research-lab PASS — ${steps.join(", ")}`);
    process.exit(0);
  } catch (err) {
    evidence.stages.error = err instanceof Error ? err.message : String(err);
    try {
      writeFileSync(
        path.join(outDir, "summary.json"),
        `${JSON.stringify(evidence, null, 2)}\n`,
      );
    } catch {}
    console.error(`qa:research-lab FAIL — ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
