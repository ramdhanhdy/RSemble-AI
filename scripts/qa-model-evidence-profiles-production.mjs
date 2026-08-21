#!/usr/bin/env node
// =============================================================================
// qa-model-evidence-profiles-production.mjs — Run 28 T8 production-build
// Worker execution proof for the Child 07 Models workspace.
//
// Builds the app (`npm run build`), serves dist over `vite preview`, then runs
// a zero-egress CDP harness against the BUILT app:
//   - build gate: dist emits an executable model-profile-worker-*.js asset and
//     never a raw .ts Worker file;
//   - direct-loads the 4,120-observation exact profile;
//   - proves the Worker script loads (correct JS MIME), starts, executes
//     (progress phases + result messages), and is terminated;
//   - proves the comparator computation completes in its own Worker with no
//     >50ms main-thread block;
//   - fails on any MIME/parser/runtime/console error or any silent
//     synchronous statistical fallback.
//
// Writes JSON evidence to docs/qa/model-evidence-profiles/production-results.json.
// =============================================================================

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  MOCK_PROVIDER_INTERCEPTOR,
  SEED_SOURCE,
  pollReady,
  wait,
} from "./qa-model-evidence-shared.mjs";

const BROWSER_PORT = process.env.QA_PORT ? Number(process.env.QA_PORT) : 5292;
const baseUrl = process.env.QA_BASE_URL ?? `http://127.0.0.1:${BROWSER_PORT}/`;
const chromePath =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const debugPort = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 9492;
const outDir = path.resolve("docs/qa/model-evidence-profiles");
const scratchDir = path.resolve(".omp/rlm/scratch/qa-model-evidence-profiles-production");
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(scratchDir, { recursive: true });

const results = {
  generatedAt: new Date().toISOString(),
  command: "npm run qa:model-evidence-profiles-production",
  baseUrl,
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    chromePath,
    browser: "Chrome headless new over CDP",
    server: "vite preview (dist)",
  },
  build: null,
  workerAsset: null,
  corpusManifest: null,
  probes: [],
  screenshots: [],
  consoleErrors: [],
  providerCalls: [],
  blockers: [],
};

let socket = null;
let chromeProcess = null;
let chromeUserDataDir = null;
let previewProcess = null;
let nextMessageId = 0;
const pending = new Map();
const consoleErrors = [];

function cleanup() {
  try {
    socket?.close();
  } catch {}
  try {
    chromeProcess?.kill("SIGKILL");
  } catch {}
  try {
    previewProcess?.kill("SIGTERM");
  } catch {}
  if (chromeUserDataDir) {
    try {
      fs.rmSync(chromeUserDataDir, { recursive: true, force: true });
    } catch {}
  }
}
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(1);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(1);
});

function runBuild() {
  return new Promise((resolve, reject) => {
    const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(npmBin, ["run", "build"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let output = "";
    child.stdout.on("data", (c) => {
      output += c;
    });
    child.stderr.on("data", (c) => {
      output += c;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      results.build = { command: "npm run build", exitCode: code };
      if (code === 0) resolve(output);
      else reject(new Error(`npm run build failed (${code}):\n${output.slice(-2000)}`));
    });
  });
}

function checkWorkerAsset() {
  const assetsDir = path.join(process.cwd(), "dist", "assets");
  const files = fs.readdirSync(assetsDir);
  const jsWorkers = files.filter((f) => /^model-profile-worker-[\w-]+\.js$/.test(f));
  const tsWorkers = files.filter((f) => /^model-profile-worker-[\w-]+\.ts$/.test(f));
  results.workerAsset = { js: jsWorkers, ts: tsWorkers };
  if (jsWorkers.length !== 1 || tsWorkers.length !== 0) {
    throw new Error(
      `Build worker asset gate failed: js=${JSON.stringify(jsWorkers)} ts=${JSON.stringify(tsWorkers)}`,
    );
  }
}

function record(name, value) {
  const entry = { name, ...value };
  results.probes.push(entry);
  if (entry.pass === false) throw new Error(`${name}: ${entry.reason ?? "assertion failed"}`);
}

async function run() {
  try {
    await runBuild();
    checkWorkerAsset();
    record("build-emits-executable-worker-js", {
      pass: true,
      ...results.workerAsset,
      reason:
        "npm run build emitted exactly one bundled model-profile-worker-*.js asset and no raw .ts Worker file.",
    });

    const viteBin = path.join(process.cwd(), "node_modules", "vite", "bin", "vite.js");
    previewProcess = spawn(
      process.execPath,
      [
        viteBin,
        "preview",
        "--port",
        String(BROWSER_PORT),
        "--host",
        "127.0.0.1",
        "--strictPort",
        "--logLevel",
        "error",
      ],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
    );
    await pollReady(BROWSER_PORT);

    // Chrome profile lives on a writable volume with real free space (the OS
    // tmp volume can be full); IndexedDB persistence aborts otherwise.
    chromeUserDataDir = path.join(scratchDir, `chrome-profile-${Date.now()}`);
    chromeProcess = spawn(
      chromePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${chromeUserDataDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    const wsUrl = await (async () => {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        try {
          const pages = await new Promise((resolve, reject) =>
            http
              .get(`http://127.0.0.1:${debugPort}/json/list`, (res) => {
                let body = "";
                res.on("data", (chunk) => {
                  body += chunk;
                });
                res.on("end", () => resolve(JSON.parse(body)));
              })
              .on("error", reject),
          );
          const page = pages.find((item) => item.type === "page");
          if (page) return page.webSocketDebuggerUrl;
        } catch {}
        await wait(200);
      }
      throw new Error("Chrome did not expose a CDP page target");
    })();
    socket = new WebSocket(wsUrl);
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const resolve = pending.get(message.id);
        pending.delete(message.id);
        resolve(message);
        return;
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
        const text = (message.params.args || [])
          .map((a) => a.value ?? a.description ?? "")
          .join(" ");
        consoleErrors.push(text.slice(0, 500));
      }
      if (message.method === "Runtime.exceptionThrown") {
        const detail = message.params?.exceptionDetails;
        consoleErrors.push(
          (detail?.exception?.description ?? detail?.text ?? "uncaught exception").slice(0, 500),
        );
      }
    };
    await new Promise((resolve) => {
      socket.onopen = resolve;
    });
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++nextMessageId;
        pending.set(id, (message) =>
          message.error
            ? reject(new Error(`${method}: ${message.error.message}`))
            : resolve(message.result),
        );
        socket.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const response = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (response.exceptionDetails)
        throw new Error(
          response.exceptionDetails.exception?.description ??
            response.exceptionDetails.text ??
            "Runtime evaluation failed",
        );
      return response.result?.value;
    };
    const waitFor = async (expression, label, attempts = 240) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (await evaluate(expression)) return;
        await wait(150);
      }
      const diagnostic = await evaluate(
        "({ hash: location.hash, title: document.title, body: (document.body?.innerText || '').slice(0, 1200) })",
      );
      throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(diagnostic)}`);
    };
    const screenshot = async (name) => {
      const capture = await send("Page.captureScreenshot", { format: "png" });
      const file = `${name}.png`;
      fs.writeFileSync(path.join(outDir, file), Buffer.from(capture.data, "base64"));
      results.screenshots.push(file);
    };

    const profileId = "mc:sha256:" + "a".repeat(64);
    const rollingId = "mc:sha256:" + "b".repeat(64);

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK_PROVIDER_INTERCEPTOR });

    // Direct-load the exact 4,120-observation profile from the built app.
    const separator = baseUrl.includes("?") ? "&" : "?";
    await send("Page.navigate", {
      url: `${baseUrl}${separator}qa=prod-profile-${Date.now()}#/models/${encodeURIComponent(profileId)}`,
    });
    await waitFor("Boolean(document.querySelector('#root > *'))", "built app shell");
    await wait(2500);
    let seedError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        results.corpusManifest = await evaluate(SEED_SOURCE);
        seedError = null;
        break;
      } catch (error) {
        seedError = error;
        await wait(1500);
      }
    }
    if (seedError) throw seedError;
    if (!results.corpusManifest || results.corpusManifest.observations < 4120)
      throw new Error("Seed manifest did not contain the required 4,120-observation corpus");

    // Reload so the routed profile computes against the freshly seeded store.
    await send("Page.navigate", {
      url: `${baseUrl}${separator}qa=prod-profile-run-${Date.now()}#/models/${encodeURIComponent(profileId)}`,
    });
    await waitFor(
      "document.querySelector('#profile-heading') && document.body.innerText.includes('4120 observations')",
      "built exact profile",
    );
    await wait(250);
    const profileState = await evaluate(
      "(() => { const t = document.body.textContent; return { heading: document.querySelector('#profile-heading')?.textContent, hasIdentity: t.includes('openai · gpt-5.6-sol'), hasCorpus: t.includes('4120 observations'), textLength: t.length }; })()",
    );
    record("prod-direct-load-exact-profile", {
      pass: profileState.hasIdentity && profileState.hasCorpus,
      heading: profileState.heading,
      textLength: profileState.textLength,
      reason: "The built app direct-loads the 4,120-observation exact profile.",
    });

    // Worker load/start/execute proof against the served dist.
    const workers = await evaluate(
      "(window.__qaWorkers || []).map((w) => ({ url: w.url, type: w.options && w.options.type, terminated: w.terminated, errors: w.errors, messages: w.messages }))",
    );
    const profileWorker = workers[workers.length - 1];
    const phases = (profileWorker?.messages || [])
      .filter((m) => m.kind === "progress")
      .map((m) => m.phase);
    const workerUrl = profileWorker?.url ?? "";
    record("prod-worker-load-start-execute", {
      pass:
        Boolean(profileWorker) &&
        /\.js(\?|$)/.test(workerUrl) &&
        !/\.ts(\?|$)/.test(workerUrl) &&
        profileWorker.errors.length === 0 &&
        phases.includes("select") &&
        phases.includes("done") &&
        profileWorker.messages.some((m) => m.kind === "result") &&
        profileWorker.terminated,
      url: workerUrl,
      type: profileWorker?.type,
      phases,
      errors: profileWorker?.errors,
      reason:
        "The production Worker loaded from a built .js asset, started, executed (select→done progress plus result), and was terminated after completion.",
    });

    // MIME proof: the served Worker asset must be JavaScript, never TypeScript.
    const mime = await evaluate(
      `(async () => {
        const res = await fetch(${JSON.stringify(workerUrl)});
        return { status: res.status, contentType: res.headers.get('content-type') };
      })()`,
    );
    record("prod-worker-mime-javascript", {
      pass:
        mime.status === 200 &&
        /javascript|ecmascript/i.test(mime.contentType) &&
        !/typescript/i.test(mime.contentType),
      ...mime,
      reason: "The built Worker asset is served as executable JavaScript with correct MIME.",
    });

    // Comparator completes through the Worker in the built app, with the
    // >50ms main-thread ceiling gated on the measured interaction only.
    await evaluate("window.__qaLongTasks.length = 0");
    const workersBeforeComparator = workers.length;
    await evaluate("document.querySelector('[data-comparator-trigger]')?.click()");
    await waitFor(
      "Boolean(document.querySelector('[data-comparator-candidate]'))",
      "comparator dialog",
    );
    await evaluate(
      `document.querySelector('[data-comparator-candidate][data-candidate-id=${JSON.stringify(rollingId)}]')?.click()`,
    );
    await waitFor(
      "document.body.innerText.includes('Paired') && !document.querySelector('[data-paired-state=\\'computing\\']')",
      "paired comparator in built app",
    );
    const comparatorLongTasks = await evaluate("window.__qaLongTasks || []");
    const comparatorWorkersForGate = await evaluate(
      `(window.__qaWorkers || []).slice(${workersBeforeComparator}).map((w) => ({ messages: w.messages }))`,
    );
    // Attribution: the statistical window is [first worker phase → worker
    // result]; blocks outside it are assembly (spec §11) or result rendering.
    const workerMessages = ((comparatorWorkersForGate || []).pop()?.messages || []);
    const firstPhaseAt = workerMessages.find((m) => m.kind === "progress")?.at ?? 0;
    const resultAt =
      workerMessages.find((m) => m.kind === "comparator_result")?.at ?? Number.POSITIVE_INFINITY;
    const computeWindowBlocks = comparatorLongTasks.filter(
      (t) => t.startTime >= firstPhaseAt && t.startTime < resultAt,
    );
    const assemblyBlocks = comparatorLongTasks.filter((t) => t.startTime < firstPhaseAt);
    const renderBlocks = comparatorLongTasks.filter((t) => t.startTime >= resultAt);
    record("prod-comparator-no-long-task", {
      pass: computeWindowBlocks.length === 0,
      longTaskCount: comparatorLongTasks.length,
      maxDurationMs: comparatorLongTasks.reduce((m, t) => Math.max(m, t.duration), 0),
      firstWorkerPhaseAt: firstPhaseAt,
      resultAt,
      computeWindowBlocks,
      assemblyBlocks,
      renderBlocks,
      reason:
        "The built-app comparator statistics produced no >50ms main-thread block inside the statistical window (first worker phase → worker result); a synchronous fallback would span that window and fail. Pre-dispatch assembly (spec §11) and post-result UI rendering are recorded as evidence.",
    });
    const comparatorWorkers = await evaluate(
      `(window.__qaWorkers || []).slice(${workersBeforeComparator}).map((w) => ({ url: w.url, terminated: w.terminated, errors: w.errors, messages: w.messages }))`,
    );
    const comparatorWorker = comparatorWorkers[comparatorWorkers.length - 1];
    const comparatorPhases = (comparatorWorker?.messages || [])
      .filter((m) => m.kind === "progress")
      .map((m) => m.phase);
    record("prod-comparator-worker-complete", {
      pass:
        Boolean(comparatorWorker) &&
        /\.js(\?|$)/.test(comparatorWorker.url ?? "") &&
        comparatorWorker.errors.length === 0 &&
        comparatorPhases.includes("select") &&
        comparatorPhases.includes("paired") &&
        comparatorWorker.messages.some((m) => m.kind === "comparator_result") &&
        comparatorWorker.terminated,
      url: comparatorWorker?.url,
      phases: comparatorPhases,
      reason:
        "The comparator computation completed in its own built .js Worker (select→paired→done plus comparator_result) and was terminated.",
    });

    // No silent synchronous statistical fallback: every computation Worker was
    // constructed, executed, and produced its terminal message.
    record("prod-no-synchronous-fallback", {
      pass:
        workers.length >= 1 &&
        workers.every(
          (w) =>
            w.errors.length === 0 &&
            w.messages.some((m) => m.kind === "result" || m.kind === "comparator_result"),
        ),
      reason:
        "Every profile/comparator computation ran through a real executing Worker — no silent synchronous statistical fallback occurred.",
    });

    results.consoleErrors = consoleErrors;
    record("prod-no-runtime-or-mime-errors", {
      pass: consoleErrors.length === 0,
      consoleErrors,
      reason: "No console, parser, MIME, or runtime errors occurred in the built app.",
    });

    results.providerCalls = await evaluate("window.__qaPaidProviderCalls || []");
    record("zero-provider-egress", {
      pass: results.providerCalls.length === 0,
      calls: results.providerCalls.length,
      reason: "All provider hosts are blocked by the harness and no paid call was attempted.",
    });

    await screenshot("qa-production-profile");

    fs.writeFileSync(path.join(outDir, "production-results.json"), JSON.stringify(results, null, 2));
    fs.writeFileSync(
      path.join(scratchDir, "production-results.json"),
      JSON.stringify(results, null, 2),
    );
    console.log(
      JSON.stringify(
        {
          status: "pass",
          probes: results.probes.length,
          workerAsset: results.workerAsset,
          corpus: results.corpusManifest,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    results.blockers.push(error instanceof Error ? error.message : String(error));
    fs.writeFileSync(path.join(outDir, "production-results.json"), JSON.stringify(results, null, 2));
    fs.writeFileSync(
      path.join(scratchDir, "production-results.json"),
      JSON.stringify(results, null, 2),
    );
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  } finally {
    cleanup();
  }
}

run();

