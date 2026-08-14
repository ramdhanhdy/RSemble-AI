// =============================================================================
// RSemble AI — Canonical Tasks automated closure + browser QA gate
// (Child 02, Tasks 11A/11B)
//
//   node scripts/qa-canonical-tasks.mjs            → 11A archive closure gate
//   node scripts/qa-canonical-tasks.mjs --browser  → 11B browser/a11y matrix
//
// --- 11A closure gate (default) ---------------------------------------------
// A deterministic, self-contained closure gate that proves the Child 02
// archive/repository invariants end-to-end WITHOUT vitest: it seeds the
// complete Run/Experiment/Fusion/Rubric/Task corpus, exports the v2
// envelope, imports it into a FRESH database, and asserts byte-identical
// semantic equality on re-export; then proves repeated import is idempotent
// and repeated seeded legacy startup/reload preserves counts, exact
// crosswalks, source Suite/Experiment evidence, and artifact bytes.
//
// The closure logic is TypeScript (it imports the production modules and
// shared fixtures), so this launcher writes it to a temporary .ts file and
// runs it through the project's `tsx` runner. The verdict is aggregated
// here and the process exits non-zero on any failure. No push, no network,
// no secrets.
//
// --- 11B browser matrix (--browser) -----------------------------------------
// Drives the real app (vite dev server) through headless Chrome over CDP.
// Seeds a complete canonical Task corpus + a legacy suite/experiment, lets
// the app's startup migration run, then exercises create/version/duplicate/
// archive/restore, families/relations/facets/provenance, migration origin/
// references, direct/unknown routes, and archive export/preview/cancel/
// collision/successful import at 1440/1024/768/390 CSS px, 200% zoom,
// keyboard-only, and reduced motion. Verifies focus trap/restore, inert
// background, touch targets, per-element overflow, long values, and
// secret-shaped content. Controls must act and no product provider call may
// occur. Console/page errors and deterministic assertions are captured into
// docs/qa/canonical-tasks/results.json. No push, no provider calls, no
// secrets.
// =============================================================================

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const GATE_NAME = "qa-canonical-tasks";

// --- 11A closure check (run under tsx) ---------------------------------------
// Kept inline so the gate is a single owned file. Mirrors the integration
// corpus but asserts the closure verdict explicitly for the harness report.
const CLOSURE_TS = `
import "fake-indexeddb/auto";

import { RSembleEvaluationDB } from "../src/lib/persistence/database";
import {
  commitPreviewWorkbenchArchiveV2,
  exportWorkbenchArchiveV2,
  previewWorkbenchArchive,
} from "../src/lib/persistence/archive";
import { validateArchiveV2 } from "../src/lib/persistence/archive-v2-types";
import * as fx from "../src/lib/persistence/archive-v2-fixtures";
import {
  canonicalTaskMigrationMarkerKey,
  migrateEmbeddedLegacyTasks,
} from "../src/lib/persistence/canonical-task-migration";

const NOW = () => 5000;
const ARTIFACT_TEXT = "candidate-visible artifact text";
const ARTIFACT_BYTES = new TextEncoder().encode(ARTIFACT_TEXT);

const dbs: RSembleEvaluationDB[] = [];
async function freshDb(label: string): Promise<RSembleEvaluationDB> {
  const db = new RSembleEvaluationDB(\`qa-canonical-\${label}-\${crypto.randomUUID()}\`);
  dbs.push(db);
  await db.open();
  return db;
}
async function cleanup(): Promise<void> {
  while (dbs.length) {
    const db = dbs.pop()!;
    db.close();
    await db.delete();
  }
}

async function seedCompleteCorpus(db: RSembleEvaluationDB): Promise<void> {
  await db.runSummaries.put(fx.runSummaryRow(fx.makeRunSummary("run-1")));
  await db.runSummaries.put(fx.runSummaryRow(fx.makeRunSummary("run-2")));
  await db.runDetails.put(fx.runDetailRow(fx.makeRunDetail("run-1")));
  await db.runDetails.put(fx.runDetailRow(fx.makeRunDetail("run-2")));
  await db.profiles.put(fx.profileRow(fx.makeRubricRecord("rubric-1")));
  await db.profileVersions.put(fx.profileVersionRow(fx.makeRubricVersion("rubric-1", 1)));
  await db.suites.put(fx.suiteRow(fx.makeSuite("suite-1")));
  await db.experiments.put(fx.experimentRow(fx.makeExperiment("exp-1", "suite-1")));
  await db.fusionRecipes.put(fx.fusionRecipeRow(fx.makeRecipe("recipe-1", 1)));
  await db.poolManifests.put(fx.poolManifestRow(fx.makePoolManifest("pool-1", 1)));
  await db.fusionStudies.put(fx.fusionStudyRow(fx.makeStudy("study-1")));
  await db.fusionTrials.put(fx.fusionTrialRow(fx.makeTrial("trial-1", "study-1")));
  await db.fusionAttempts.put(fx.fusionAttemptRow(fx.makeAttempt("attempt-1", "study-1")));
  await db.fusionObservations.put(fx.fusionObservationRow(fx.makeObservation("obs-1", "trial-1")));
  await db.fusionPlaybooks.put(fx.fusionPlaybookRow(fx.makePlaybook("playbook-1", "study-1")));
  await db.tasks.put(fx.taskRecordRow(fx.makeTaskRecord("task-1")));
  await db.taskVersions.put(fx.taskVersionRow(fx.makeTaskVersion("task-1", 1, "art-1")));
  await db.taskArtifacts.put(fx.taskArtifactRow(fx.makeTaskArtifact("art-1", ARTIFACT_BYTES)));
  await db.taskArtifactBytes.put(fx.taskArtifactBytesRow("art-1", ARTIFACT_BYTES));
  await db.taskInstances.put(fx.taskInstanceRow(fx.makeTaskInstance("inst-1", "task-1", 1, "art-1")));
  await db.taskFamilies.put(fx.taskFamilyRow(fx.makeTaskFamily("fam-1")));
  await db.taskFamilyAssignments.put(
    fx.taskFamilyAssignmentRow(fx.makeTaskFamilyAssignment("fa-1", "task-1", 1, "fam-1")),
  );
  await db.taskFamilyRelations.put(
    fx.taskFamilyRelationRow(fx.makeTaskFamilyRelation("rel-1", "fam-1", "fam-1")),
  );
  await db.taskFacetAnnotations.put(
    fx.taskFacetAnnotationRow(fx.makeTaskFacetAnnotation("ann-1", "task-1")),
  );
  await db.taskMigrationCrosswalk.put(fx.taskMigrationCrosswalkRow(fx.makeCrosswalk("task-1", 1)));
}

function makeLegacySuite(id: string) {
  return {
    id,
    revision: 1,
    version: 2,
    name: \`Suite \${id}\`,
    description: "",
    tasks: [
      {
        id: "task-1",
        title: "Summarize",
        prompt: "Summarize the passage.",
        systemPrompt: "Use three bullets.",
        evaluation: { kind: "inherit" },
        judgeInstructionOverride: "Judge clarity.",
        order: 0,
      },
    ],
    modelSlots: [],
    defaultJudge: { providerId: "openrouter", model: "judge" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: 10,
    updatedAt: 20,
    archivedAt: null,
  };
}

async function seedLegacy(db: RSembleEvaluationDB): Promise<void> {
  const suite = makeLegacySuite("suite-1");
  await db.suites.put({
    id: suite.id,
    suite,
    revision: 1,
    version: suite.version,
    updatedAt: 20,
    archivedAt: null,
  });
  const experiment = {
    id: "exp-1",
    revision: 1,
    suiteId: "suite-1",
    suiteVersion: 1,
    protocolFingerprint: "sha256:fp",
    status: "completed",
    execution: null,
    snapshot: {
      suiteId: "suite-1",
      suiteVersion: 1,
      tasks: suite.tasks,
      modelSlots: suite.modelSlots,
      defaultJudge: suite.defaultJudge,
      defaultEvaluation: suite.defaultEvaluation,
      profiles: [],
      protocolFingerprint: "sha256:fp",
      createdAt: 15,
    },
    tasks: [],
    createdAt: 15,
    updatedAt: 15,
  };
  await db.experiments.put({
    id: experiment.id,
    experiment,
    revision: 1,
    suiteId: experiment.suiteId,
    suiteVersion: experiment.suiteVersion,
    protocolFingerprint: experiment.protocolFingerprint,
    createdAt: experiment.createdAt,
    status: experiment.status,
  });
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("CLOSURE ASSERT FAILED: " + msg);
}

async function main() {
  // --- 1. Complete corpus: export -> fresh-DB import -> semantic equality ---
  const source = await freshDb("source");
  await seedCompleteCorpus(source);
  const exported = await exportWorkbenchArchiveV2(source, { now: NOW });
  assert(validateArchiveV2(JSON.parse(JSON.stringify(exported))).valid, "exported envelope invalid");

  const target = await freshDb("target");
  const preview = await previewWorkbenchArchive(target, exported, { sourceLabel: "memory" });
  assert(preview.format === "v2", "preview format not v2");
  assert(preview.collisions.length === 0, "preview reported collisions on a fresh DB");
  assert(preview.invalid.length === 0, "preview reported invalid entities on a fresh DB");
  const commit1 = await commitPreviewWorkbenchArchiveV2(target, preview);
  assert(commit1.collisions.length === 0, "commit reported collisions on a fresh DB");
  assert(commit1.created.length > 0, "first commit created nothing");

  const reexported = await exportWorkbenchArchiveV2(target, { now: NOW });
  assert(JSON.stringify(reexported) === JSON.stringify(exported), "re-export not byte-identical");
  assert(
    reexported.manifest.payloadDigest === exported.manifest.payloadDigest,
    "payload digest drifted across import",
  );
  assert(
    reexported.tasks.taskMigrationCrosswalks.map((c) => c.legacyScopeKey).join(",") ===
      "legacy:task-1",
    "crosswalks not preserved exactly",
  );
  const bytesRow = await target.taskArtifactBytes.get("art-1");
  assert(
    bytesRow && Array.from(bytesRow.bytes).join(",") === Array.from(ARTIFACT_BYTES).join(","),
    "artifact bytes not preserved",
  );
  const suiteRow = await target.suites.get("suite-1");
  assert(
    JSON.stringify(suiteRow?.suite) === JSON.stringify(fx.makeSuite("suite-1")),
    "source suite evidence not semantically equal",
  );

  // --- 2. Repeated import idempotency ---
  const preview2 = await previewWorkbenchArchive(target, exported, { sourceLabel: "memory" });
  assert(preview2.create.length === 0, "second preview still creates entities");
  const commit2 = await commitPreviewWorkbenchArchiveV2(target, preview2);
  assert(commit2.created.length === 0, "second commit wrote new entities");
  assert(commit2.reused.length > 0, "second commit reused nothing");
  const countsAfterFirst = {
    runSummaries: await target.runSummaries.count(),
    suites: await target.suites.count(),
    tasks: await target.tasks.count(),
    crosswalks: await target.taskMigrationCrosswalk.count(),
  };
  const preview3 = await previewWorkbenchArchive(target, exported, { sourceLabel: "memory" });
  await commitPreviewWorkbenchArchiveV2(target, preview3);
  assert(
    (await target.runSummaries.count()) === countsAfterFirst.runSummaries &&
      (await target.suites.count()) === countsAfterFirst.suites &&
      (await target.tasks.count()) === countsAfterFirst.tasks &&
      (await target.taskMigrationCrosswalk.count()) === countsAfterFirst.crosswalks,
    "counts changed across repeated import",
  );

  // --- 3. Repeated seeded legacy startup/reload ---
  const legacy = await freshDb("legacy");
  await seedLegacy(legacy);
  const m1 = await migrateEmbeddedLegacyTasks(legacy);
  assert(m1.complete && m1.migratedScopes === 1 && m1.unresolvedDefinitions === 0, "first migration incomplete");
  const legacyCounts = {
    tasks: await legacy.tasks.count(),
    versions: await legacy.taskVersions.count(),
    crosswalks: await legacy.taskMigrationCrosswalk.count(),
  };
  const legacyCrosswalks = (await legacy.taskMigrationCrosswalk.toArray())
    .map((c) => c.legacyScopeKey)
    .sort()
    .join("|");
  const sourceSuiteBefore = JSON.stringify((await legacy.suites.get("suite-1"))?.suite);
  const sourceExperimentBefore = JSON.stringify((await legacy.experiments.get("exp-1"))?.experiment);
  assert(await legacy.storageMeta.get(canonicalTaskMigrationMarkerKey), "migration marker missing");

  const m2 = await migrateEmbeddedLegacyTasks(legacy);
  const m3 = await migrateEmbeddedLegacyTasks(legacy);
  assert(m2.complete && m3.complete, "repeated migration not complete");
  assert(m2.createdVersions === 0 && m3.createdVersions === 0, "repeated migration created versions");
  assert(m2.crosswalksWritten === 0 && m3.crosswalksWritten === 0, "repeated migration wrote crosswalks");
  assert(
    (await legacy.tasks.count()) === legacyCounts.tasks &&
      (await legacy.taskVersions.count()) === legacyCounts.versions &&
      (await legacy.taskMigrationCrosswalk.count()) === legacyCounts.crosswalks,
    "legacy counts changed across repeated startup",
  );
  assert(
    (await legacy.taskMigrationCrosswalk.toArray()).map((c) => c.legacyScopeKey).sort().join("|") ===
      legacyCrosswalks,
    "legacy crosswalks changed across repeated startup",
  );
  assert(
    JSON.stringify((await legacy.suites.get("suite-1"))?.suite) === sourceSuiteBefore,
    "migration rewrote source suite evidence",
  );
  assert(
    JSON.stringify((await legacy.experiments.get("exp-1"))?.experiment) === sourceExperimentBefore,
    "migration rewrote source experiment evidence",
  );
  assert(
    (await legacy.taskArtifacts.count()) === 0 &&
      (await legacy.taskArtifactBytes.count()) === 0 &&
      (await legacy.taskInstances.count()) === 0,
    "migration fabricated artifacts/instances",
  );

  await cleanup();
  console.log(
    "closure: corpus round-trip byte-identical, repeated import idempotent, repeated legacy startup stable",
  );
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    try {
      await cleanup();
    } catch {}
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  });
`;

// --- 11A closure launcher ----------------------------------------------------

function runClosureGate() {
  // Write the closure TS into a temp directory inside the gitignored
  // `.omp/rlm/scratch/` area so bare imports (fake-indexeddb) and the
  // project tsconfig/node_modules resolve naturally, and no untracked
  // artifact escapes the project's gitignore. The closure uses `../src/`
  // relative imports; the depth below is fixed at one level under the
  // project root, so `../src/` resolves to <project>/src.
  const scratchRoot = join(process.cwd(), ".omp", "rlm", "scratch");
  const tmpDir = mkdtempSync(join(scratchRoot, "qa-canonical-tasks-tmp-"));
  const tsFile = join(tmpDir, "closure.ts");
  // The temp file's depth varies, so rewrite the closure's `../src/` imports
  // to absolute file:// URLs (location-independent). Bare imports like
  // `fake-indexeddb/auto` resolve via node_modules walk-up from inside the
  // project tree.
  const cwdUrl = "file:///" + process.cwd().replace(/\\/g, "/").replace(/^\/+/, "");
  const closureSrc = CLOSURE_TS.replace(/from "\.\.\/src\//g, `from "${cwdUrl}/src/`);
  writeFileSync(tsFile, closureSrc);

  let exitCode = 0;
  let stdout = "";
  let stderr = "";
  try {
    const tsxCli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const result = spawnSync(process.execPath, [tsxCli, tsFile], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TSX_TSCONFIG: process.cwd() + "/tsconfig.json" },
    });
    stdout = result.stdout ?? "";
    stderr = result.stderr ?? "";
    exitCode = result.status ?? 1;
  } catch (err) {
    stderr += "\n" + (err instanceof Error ? err.message : String(err));
    exitCode = 1;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  if (exitCode === 0) {
    process.stdout.write(
      `\n${GATE_NAME}: PASS — Child 02 archive/repository closure invariants hold.\n`,
    );
  } else {
    process.stderr.write(
      `\n${GATE_NAME}: FAIL — closure invariants did not hold (exit ${exitCode}).\n`,
    );
  }
  process.exit(exitCode);
}

// =============================================================================
// 11B — Browser / accessibility matrix
// =============================================================================

import fs from "node:fs";
import http from "node:http";
import os from "node:os";

const BROWSER_PORT = 5183;
const BROWSER_BASE = `http://127.0.0.1:${BROWSER_PORT}/`;
const CDP_PORT = 9351;
const OUT_DIR = resolve("docs/qa/canonical-tasks");
const CHROME_PATH =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SCRATCH_DIR = resolve(".omp/rlm/scratch/qa-canonical-tasks-browser");

// Provider host patterns that must NEVER be contacted during the Task matrix.
const PROVIDER_HOST_PATTERNS = [
  /openrouter\.ai/i,
  /api\.openai\.com/i,
  /anthropic\.com/i,
  /api\.x\.ai/i,
  /generativelanguage\.googleapis\.com/i,
  /api\.mistral\.ai/i,
  /api\.together\.xyz/i,
  /api\.groq\.com/i,
  /api\.deepseek\.com/i,
  /api\.fireworks\.ai/i,
  /api\.cohere\.ai/i,
  /api\.perplexity\.ai/i,
  /umans\.ai/i,
];

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
        if (tries >= attempts) return reject(new Error(`dev server on ${port} never became ready`));
        setTimeout(probe, 250);
      }
    };
    probe();
  });
}

async function runBrowserMatrix() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(SCRATCH_DIR, { recursive: true });
  const results = {
    gate: "qa-canonical-tasks --browser",
    generatedAt: new Date().toISOString(),
    baseUrl: BROWSER_BASE,
    probes: [],
    screenshots: [],
    consoleErrors: [],
    pageErrors: [],
    networkRequests: [],
    providerCalls: [],
  };

  const record = (name, value) => {
    results.probes.push({ name, ...value });
    if (value.pass === false) {
      throw new Error(`${name}: ${value.reason ?? "assertion failed"}`);
    }
  };

  // --- Start vite dev server (web only; tasks UI needs no bridge/provider) ---
  const viteBin = join(process.cwd(), "node_modules", "vite", "bin", "vite.js");
  const vite = spawn(
    process.execPath,
    [
      viteBin,
      "--port",
      String(BROWSER_PORT),
      "--host",
      "127.0.0.1",
      "--strictPort",
      "--logLevel",
      "info",
    ],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } },
  );
  let viteStderr = "";
  vite.stderr.on("data", (chunk) => {
    viteStderr += chunk.toString();
  });
  vite.stdout.on("data", () => {});
  const viteCleanup = () => {
    try {
      vite.kill("SIGTERM");
    } catch {}
  };

  let chrome;
  let socket;
  try {
    try {
      await pollReady(BROWSER_PORT);
    } catch (err) {
      throw new Error(`vite dev server did not start: ${err.message}\n${viteStderr}`);
    }

    // --- Spawn headless Chrome with CDP ---
    chrome = spawn(
      CHROME_PATH,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${join(SCRATCH_DIR, `chrome-${Date.now()}`)}`,
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
              .get(`http://127.0.0.1:${CDP_PORT}/json/list`, (response) => {
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
          // Chrome warming up.
        }
        await wait(200);
      }
      throw new Error("Chrome did not expose a CDP page target.");
    };

    const wsUrl = await getWsUrl();
    socket = new WebSocket(wsUrl);
    let nextId = 0;
    const pending = new Map();
    // CDP responses and events both arrive on onmessage. Events (messages
    // with a `method` and no matching pending id) are routed through this
    // hook, which is wired up once the console/network handlers are defined.
    let eventRouter = () => {};
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data.toString());
      const resolve = pending.get(message.id);
      if (resolve) {
        pending.delete(message.id);
        resolve(message);
        return;
      }
      if (message.method) eventRouter(message);
    };
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });

    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, (message) => {
          if (message.error) reject(new Error(`${method}: ${message.error.message}`));
          else resolve(message.result);
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

    const waitFor = async (expression, label, maxAttempts = 100) => {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (await evaluate(expression)) return;
        await wait(120);
      }
      const diagnostic = await evaluate(
        `({hash: location.hash, title: document.title, body: (document.body?.innerText ?? "").slice(0, 600)})`,
      );
      throw new Error(`Timed out waiting for ${label}. ${JSON.stringify(diagnostic)}`);
    };

    const setViewport = async ({ width, height, mobile = false, touch = false }) => {
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
    };

    const screenshot = async (name) => {
      const capture = await send("Page.captureScreenshot", { format: "png" });
      const file = `${name}.png`;
      fs.writeFileSync(join(OUT_DIR, file), Buffer.from(capture.data, "base64"));
      results.screenshots.push(file);
    };

    const navigateTo = async (hash) => {
      await send("Page.navigate", { url: `${BROWSER_BASE}${hash}` });
      await waitFor("Boolean(document.querySelector('main, [role=main], #root > *'))", "shell");
      await wait(350);
    };

    // --- Console / page error / network capture ---
    await send("Page.enable");
    await send("Runtime.enable");
    const consoleHandler = (params) => {
      if (params.type === "error") {
        const text = params.args?.map((a) => a.value ?? a.description ?? "").join(" ");
        results.consoleErrors.push(text);
      }
    };
    const exceptionHandler = (params) => {
      results.pageErrors.push(
        params.exceptionDetails?.exception?.description ??
          params.exceptionDetails?.text ??
          "exception",
      );
    };
    const requestHandler = (params) => {
      const url = params.request?.url ?? "";
      if (!url) return;
      // Ignore dev-server / sourcemap / data: noise.
      if (url.startsWith(BROWSER_BASE) || url.startsWith("data:") || url.startsWith("blob:"))
        return;
      results.networkRequests.push(url);
      if (PROVIDER_HOST_PATTERNS.some((re) => re.test(url))) {
        results.providerCalls.push(url);
      }
    };
    // CDP events arrive on the same socket; route them through onmessage.
    eventRouter = (message) => {
      if (message.method === "Runtime.consoleAPICalled") consoleHandler(message.params);
      else if (message.method === "Runtime.exceptionThrown") exceptionHandler(message.params);
      else if (message.method === "Network.requestWillBeSent") requestHandler(message.params);
    };
    // `rsemble-evaluation` IndexedDB. NO migration marker is written: the
    // app's startup migration runs on reload and creates the canonical legacy
    // task from the seeded suite, exercising the real migration path.
    const SEED_SOURCE = String.raw`
(async () => {
  const DB = "rsemble-evaluation";
  const openDb = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("open blocked"));
  });
  const put = (db, store, value) => new Promise((resolve, reject) => {
    const r = db.transaction(store, "readwrite").objectStore(store).put(value);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
  const db = await openDb();
  // Delete the migration marker so startup migration re-runs after reload.
  await new Promise((resolve, reject) => {
    const r = db.transaction("storageMeta", "readwrite").objectStore("storageMeta").delete("canonical-task-migration:v1");
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
  const NOW = 1700000000000;

  // Authored task with family + facet + instance.
  const authoredVersion = {
    taskId: "task-authored", version: 1,
    title: "Summarize a report", objective: "Produce a concise summary.",
    candidateInstruction: "Summarize the passage in three bullets.",
    defaultContextManifest: [], responseContract: null, taskVerifierRef: null,
    source: { kind: "authored", legacyScopeKey: null, note: null }, createdAt: NOW,
  };
  await put(db, "tasks", {
    id: "task-authored", record: {
      id: "task-authored", latestVersion: 1, createdAt: NOW, updatedAt: NOW,
      archivedAt: null, origin: "authored", revision: 0,
    },
    latestVersion: 1, createdAt: NOW, updatedAt: NOW, archivedAt: null,
    origin: "authored", revision: 0,
  });
  await put(db, "taskVersions", {
    taskId: "task-authored", version: 1, version_: authoredVersion, createdAt: NOW,
  });

  // Archived task.
  await put(db, "tasks", {
    id: "task-archived", record: {
      id: "task-archived", latestVersion: 1, createdAt: NOW, updatedAt: NOW + 1000,
      archivedAt: NOW + 1000, origin: "authored", revision: 1,
    },
    latestVersion: 1, createdAt: NOW, updatedAt: NOW + 1000,
    archivedAt: NOW + 1000, origin: "authored", revision: 1,
  });
  await put(db, "taskVersions", {
    taskId: "task-archived", version: 1, version_: {
      ...authoredVersion, taskId: "task-archived",
      title: "Archived task", objective: "An archived canonical task.",
    }, createdAt: NOW,
  });

  // Long-title task for overflow probe.
  const longTitle = "A".repeat(240);
  await put(db, "tasks", {
    id: "task-long", record: {
      id: "task-long", latestVersion: 1, createdAt: NOW, updatedAt: NOW + 2000,
      archivedAt: null, origin: "authored", revision: 0,
    },
    latestVersion: 1, createdAt: NOW, updatedAt: NOW + 2000,
    archivedAt: null, origin: "authored", revision: 0,
  });
  await put(db, "taskVersions", {
    taskId: "task-long", version: 1, version_: {
      ...authoredVersion, taskId: "task-long",
      title: longTitle, objective: "Long value overflow probe.",
    }, createdAt: NOW + 2000,
  });

  // Family + primary assignment + facet annotation + instance.
  await put(db, "taskFamilies", {
    id: "fam-qa", family: {
      id: "fam-qa", name: "QA Summaries", description: "QA family",
      parentFamilyId: null, createdAt: NOW, updatedAt: NOW,
      archivedAt: null, revision: 1,
    },
    parentFamilyId: null, updatedAt: NOW, archivedAt: null, revision: 1,
  });
  await put(db, "taskFamilyAssignments", {
    id: "fa-qa", assignment: {
      id: "fa-qa", taskId: "task-authored", taskVersion: 1, familyId: "fam-qa",
      isPrimary: true, createdAt: NOW, revision: 1, archivedAt: null,
    },
    taskId: "task-authored", taskVersion: 1, familyId: "fam-qa",
    isPrimary: 1, createdAt: NOW, revision: 1, archivedAt: null,
  });
  await put(db, "taskFacetAnnotations", {
    id: "ann-qa", annotation: {
      id: "ann-qa", taskId: "task-authored", taskVersion: null,
      facetId: "domain", valueId: "nlp", source: "authored", authorKind: "user",
      confidence: null, taxonomyVersion: 1, createdAt: NOW, supersedesId: null,
    },
    taskId: "task-authored", taskVersion: null, facetId: "domain",
    valueId: "nlp", createdAt: NOW,
  });
  await put(db, "taskInstances", {
    id: "inst-qa", instance: {
      id: "inst-qa", taskId: "task-authored", taskVersion: 1,
      normalizedInput: { text: "Solve it", artifactIds: [], metadata: {} },
      contextManifest: [], inputDigest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      inputCompleteness: "complete", createdAt: NOW,
      sourceRef: { kind: "authored", legacyScopeKey: null, originId: null },
    },
    taskId: "task-authored", taskVersion: 1,
    inputDigest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    inputCompleteness: "complete", createdAt: NOW,
  });

  // Legacy suite + experiment (NO migration marker → app migrates on reload).
  const legacyTask = {
    id: "t1", title: "Legacy summarize", prompt: "Summarize the passage.",
    systemPrompt: "Use three bullets.", evaluation: { kind: "inherit" },
    judgeInstructionOverride: "", order: 0,
  };
  const suite = {
    id: "suite-qa", revision: 1, version: 1, name: "QA Legacy Suite",
    description: "Legacy suite for migration probe.", tasks: [legacyTask],
    modelSlots: [], defaultJudge: { providerId: "openrouter", model: "judge" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: NOW, updatedAt: NOW, archivedAt: null,
  };
  await put(db, "suites", {
    id: suite.id, suite, revision: 1, version: suite.version,
    updatedAt: NOW, archivedAt: null,
  });
  const experiment = {
    id: "exp-qa", revision: 1, suiteId: "suite-qa", suiteVersion: 1,
    protocolFingerprint: "sha256:qa", status: "completed", execution: null,
    snapshot: {
      suiteId: "suite-qa", suiteVersion: 1, tasks: [legacyTask], modelSlots: [],
      defaultJudge: suite.defaultJudge, defaultEvaluation: suite.defaultEvaluation,
      profiles: [], protocolFingerprint: "sha256:qa", createdAt: NOW,
    },
    tasks: [], createdAt: NOW, updatedAt: NOW,
  };
  await put(db, "experiments", {
    id: experiment.id, experiment, revision: 1, suiteId: experiment.suiteId,
    suiteVersion: experiment.suiteVersion, protocolFingerprint: experiment.protocolFingerprint,
    createdAt: NOW, status: experiment.status,
  });

  db.close();
  return true;
})().catch((e) => ({ __seedError: (e && (e.name ? e.name + ": " : "") + (e.message || String(e))) }))`;

    // First mount so IndexedDB exists; then seed (overwriting prior rows and
    // clearing the migration marker so startup migration re-runs on reload);
    // then reload so the app's startup migration consumes the legacy suite.
    await navigateTo("");
    await waitFor("Boolean(window.indexedDB)", "indexedDB");
    // The initial navigation may land on a context where IndexedDB access is
    // briefly denied (Chrome security gate during SPA route setup). Retry the
    // seed a few times with a fresh navigation to get a stable context.
    let seeded = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      seeded = await evaluate(SEED_SOURCE);
      if (!seeded?.__seedError) break;
      if (attempt < 2) {
        await wait(300);
        await navigateTo("");
        await waitFor("Boolean(window.indexedDB)", "indexedDB");
      }
    }
    if (seeded?.__seedError) throw new Error(`Seed failed: ${seeded.__seedError}`);
    // Reload so RepositoryProvider re-opens and migration runs.
    await send("Page.navigate", { url: BROWSER_BASE });
    await waitFor(
      "Boolean(document.querySelector('main, [role=main], #root > *'))",
      "shell after reload",
    );
    await wait(800);

    // Helper: wait for the task catalog to settle (ready rows OR empty state),
    // i.e. past the transient storage-unavailable window during migration.
    const waitForCatalog = async () => {
      await waitFor(
        "Boolean(document.querySelector('a[data-task-row]')) || Boolean(document.querySelector('[data-task-empty]'))",
        "task catalog ready",
        120,
      );
      await wait(150);
    };

    // Shared catalog assertion source (viewport-agnostic).
    const catalogAssert = String.raw`
(() => {
  const overflowX = document.documentElement.scrollWidth > innerWidth;
  const rows = [...document.querySelectorAll('a[data-task-row]')];
  const origins = rows.map((r) => r.textContent);
  const hasLegacy = origins.some((t) => t.includes("legacy-task-set"));
  const hasAuthored = origins.some((t) => t.includes("authored"));
  const archived = document.querySelector('[data-task-archived]');
  const familyChip = document.querySelector('[data-row-family]');
  const facetChip = document.querySelector('[data-facet-chip]');
  const refs = document.querySelector('[data-task-references]');
  const longRow = rows.find((r) => r.textContent.includes("A".repeat(40)));
  const longOverflow = longRow ? longRow.getBoundingClientRect().right > innerWidth : null;
  const longTitleSpan = longRow ? longRow.querySelector('.truncate') : null;
  // Touch targets: every interactive control in the catalog has min-height >= 44.
  const interactives = [...document.querySelectorAll('[data-task-catalog] button, [data-task-catalog] a, [data-task-catalog] select, [data-task-catalog] input')];
  const minTarget = 44;
  const smallTargets = interactives
    .map((el) => ({ tag: el.tagName, h: Math.round(el.getBoundingClientRect().height) }))
    .filter((t) => t.h < minTarget);
  return {
    overflowX, rowCount: rows.length, hasLegacy, hasAuthored,
    hasArchived: Boolean(archived), hasFamily: Boolean(familyChip),
    hasFacet: Boolean(facetChip), hasRefs: Boolean(refs),
    longOverflow, longTruncates: longTitleSpan ? getComputedStyle(longTitleSpan).overflow === 'hidden' && getComputedStyle(longTitleSpan).whiteSpace === 'nowrap' : null,
    smallTargets, innerWidth,
  };
})()`;

    // --- Catalog: 1440 -------------------------------------------------------
    await setViewport({ width: 1440, height: 1000 });
    await navigateTo("#/tasks");
    await waitForCatalog();
    const d1440 = await evaluate(catalogAssert);
    record("catalog-1440", {
      ...d1440,
      pass:
        !d1440.overflowX &&
        d1440.rowCount >= 4 &&
        d1440.hasLegacy &&
        d1440.hasAuthored &&
        d1440.hasArchived &&
        d1440.hasFamily &&
        d1440.hasFacet &&
        d1440.hasRefs &&
        d1440.longTruncates === true &&
        d1440.longOverflow === false &&
        d1440.smallTargets.length === 0,
      reason:
        "1440px: legacy+authored+archived+long rows render with family/facet/ref chips, long title truncates without overflow, all targets ≥44px, no horizontal overflow",
    });
    await screenshot("qa-catalog-1440");

    // --- Catalog: 1024 -------------------------------------------------------
    await setViewport({ width: 1024, height: 768 });
    await navigateTo("#/tasks");
    await waitForCatalog();
    const d1024 = await evaluate(catalogAssert);
    record("catalog-1024", {
      ...d1024,
      pass:
        !d1024.overflowX &&
        d1024.rowCount >= 4 &&
        d1024.hasLegacy &&
        d1024.hasArchived &&
        d1024.longTruncates === true &&
        d1024.longOverflow === false &&
        d1024.smallTargets.length === 0,
      reason: "1024px: catalog holds without overflow, long title truncates, targets ≥44px",
    });
    await screenshot("qa-catalog-1024");

    // --- Catalog: 768 --------------------------------------------------------
    await setViewport({ width: 768, height: 1024 });
    await navigateTo("#/tasks");
    await waitForCatalog();
    const d768 = await evaluate(catalogAssert);
    record("catalog-768", {
      ...d768,
      pass:
        !d768.overflowX &&
        d768.rowCount >= 4 &&
        d768.hasLegacy &&
        d768.longTruncates === true &&
        d768.longOverflow === false &&
        d768.smallTargets.length === 0,
      reason: "768px: catalog holds without overflow, long title truncates, targets ≥44px",
    });
    await screenshot("qa-catalog-768");

    // --- Catalog: 390 (mobile + touch) ---------------------------------------
    await setViewport({ width: 390, height: 844, mobile: true, touch: true });
    await navigateTo("#/tasks");
    await waitForCatalog();
    const d390 = await evaluate(catalogAssert);
    record("catalog-390", {
      ...d390,
      pass:
        !d390.overflowX &&
        d390.rowCount >= 4 &&
        d390.hasLegacy &&
        d390.longTruncates === true &&
        d390.longOverflow === false &&
        d390.smallTargets.length === 0,
      reason:
        "390px mobile/touch: catalog holds without overflow, long title truncates, all touch targets ≥44px",
    });
    await screenshot("qa-catalog-390");

    // --- 200% zoom (720px CSS viewport) --------------------------------------
    await setViewport({ width: 720, height: 500 });
    await navigateTo("#/tasks");
    await waitForCatalog();
    const zoom = await evaluate(catalogAssert);
    record("catalog-zoom-200", {
      ...zoom,
      pass:
        !zoom.overflowX &&
        zoom.innerWidth === 720 &&
        zoom.rowCount >= 4 &&
        zoom.longTruncates === true &&
        zoom.longOverflow === false &&
        zoom.smallTargets.length === 0,
      reason:
        "200% effective CSS viewport (720px): catalog legible without overflow, targets ≥44px",
    });
    await screenshot("qa-catalog-zoom-200");

    // --- Reduced motion ------------------------------------------------------
    await setViewport({ width: 1440, height: 1000 });
    await send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await navigateTo("#/tasks");
    await waitForCatalog();
    const reduced = await evaluate(String.raw`
(() => {
  const probe = document.createElement("span");
  probe.className = "animate-spin-ease";
  document.body.append(probe);
  const animation = getComputedStyle(probe).animationName;
  probe.remove();
  return {
    spinnerAnimation: animation,
    overflowX: document.documentElement.scrollWidth > innerWidth,
    rowCount: document.querySelectorAll('a[data-task-row]').length,
  };
})()`);
    record("catalog-reduced-motion", {
      ...reduced,
      pass: reduced.spinnerAnimation === "none" && !reduced.overflowX && reduced.rowCount >= 4,
      reason: "reduced motion removes spinner rotation, catalog renders without overflow",
    });
    await screenshot("qa-catalog-reduced-motion");
    await send("Emulation.setEmulatedMedia", { features: [] });

    // --- Create (1440) -------------------------------------------------------
    await setViewport({ width: 1440, height: 1000 });
    await navigateTo("#/tasks/new");
    await waitFor("Boolean(document.querySelector('[data-task-editor=\"new\"]'))", "create editor");
    await evaluate(String.raw`
(() => {
  const setVal = (sel, v) => {
    const el = document.querySelector(sel);
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  setVal('input[data-editor-field="title"]', 'Browser created task');
  setVal('textarea[data-editor-field="objective"]', 'Created via the browser QA matrix.');
  return true;
})()`);
    await wait(100);
    const createEnabled = await evaluate(
      `(() => { const b = document.querySelector('button[data-action="create-task"]'); return Boolean(b) && !b.disabled; })()`,
    );
    await evaluate(`document.querySelector('button[data-action="create-task"]').click()`);
    await waitFor(
      "Boolean(document.querySelector('[data-action=\"open-created-task\"]'))",
      "create success",
    );
    const createdInfo = await evaluate(String.raw`
(() => {
  const link = document.querySelector('[data-action="open-created-task"]');
  return { href: link?.getAttribute('href') ?? null, text: document.body.innerText };
})()`);
    record("create-task", {
      href: createdInfo.href,
      pass:
        createEnabled === true &&
        Boolean(createdInfo.href) &&
        /^#?\/tasks\//.test(createdInfo.href) &&
        createdInfo.text.includes("Task created") &&
        createdInfo.text.includes("atomically"),
      reason: "create commits Task+v1 atomically and offers an Open link to the new identity",
    });
    const createdId = createdInfo.href.replace(/^#?\/?tasks\//, "");
    await navigateTo(`#/tasks/${createdId}`);
    await waitFor(
      `Boolean(document.querySelector('[data-task-detail="${createdId}"]'))`,
      "created detail",
    );
    const createdDetail = await evaluate(String.raw`
(() => {
  const body = document.body.innerText;
  return { title: body.includes("Browser created task"), v1: body.includes("v1"), authored: body.includes("authored") };
})()`);
    record("create-task-detail", {
      ...createdDetail,
      pass: createdDetail.title && createdDetail.v1 && createdDetail.authored,
      reason: "newly created task detail shows title, v1, authored origin",
    });

    // --- Version (1440) ------------------------------------------------------
    await navigateTo("#/tasks/task-authored");
    await waitFor(
      "Boolean(document.querySelector('[data-task-detail=\"task-authored\"]'))",
      "authored detail",
    );
    await evaluate(String.raw`
(() => {
  const setVal = (sel, v) => {
    const el = document.querySelector(sel);
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  setVal('input[data-editor-field="title"]', 'Summarize a report v2');
  return true;
})()`);
    await wait(100);
    const dirty = await evaluate(
      `Boolean(document.querySelector('[data-editor-status]')?.textContent.includes('Unsaved'))`,
    );
    await evaluate(`document.querySelector('button[data-action="create-version"]').click()`);
    await waitFor(
      "Boolean(document.querySelector('button[data-action=\"confirm-version\"]'))",
      "version confirm",
    );
    await evaluate(`document.querySelector('button[data-action="confirm-version"]').click()`);
    await waitFor(
      `Boolean([...document.querySelectorAll('[data-task-detail="task-authored"] p')].some((p) => p.textContent.includes('v2')))`,
      "v2 header",
    );
    const versionInfo = await evaluate(String.raw`
(() => {
  const body = document.body.innerText;
  const sel = document.querySelector('select[data-action="version-select"]');
  return { v2: body.includes("v2"), selectValue: sel ? sel.value : null };
})()`);
    record("version-append", {
      ...versionInfo,
      pass: dirty && versionInfo.v2 && versionInfo.selectValue === "2",
      reason:
        "dirty draft → explicit Create version 2 confirmation → header and selector reflect v2",
    });
    // Direct version load (read-only).
    await navigateTo("#/tasks/task-authored/versions/2");
    await waitFor(
      "Boolean(document.querySelector('[data-task-version=\"task-authored@2\"]'))",
      "v2 route",
    );
    const v2View = await evaluate(String.raw`
(() => {
  const body = document.body.innerText;
  const title = document.querySelector('input[data-editor-field="title"]');
  return { readOnly: body.includes("read-only"), titleV2: body.includes("Summarize a report v2"), titleDisabled: title ? title.disabled : null, noCreate: !document.querySelector('button[data-action="create-version"]') };
})()`);
    record("version-direct-load", {
      ...v2View,
      pass: v2View.readOnly && v2View.titleV2 && v2View.titleDisabled === true && v2View.noCreate,
      reason:
        "/tasks/:id/versions/2 direct-loads the immutable read-only version (disabled fields, no create action)",
    });
    await navigateTo("#/tasks/task-authored/versions/1");
    await waitFor(
      "Boolean(document.querySelector('[data-task-version=\"task-authored@1\"]'))",
      "v1 route",
    );
    const v1View = await evaluate(
      `(() => ({ readOnly: document.body.innerText.includes("read-only"), title: document.body.innerText.includes("Summarize a report") }))()`,
    );
    record("version-direct-load-v1", {
      ...v1View,
      pass: v1View.readOnly && v1View.title,
      reason: "/tasks/:id/versions/1 direct-loads the immutable v1 read-only view",
    });

    // --- Duplicate (1440) ----------------------------------------------------
    await navigateTo("#/tasks/task-authored");
    await waitFor(
      "Boolean(document.querySelector('[data-task-detail=\"task-authored\"]'))",
      "authored detail",
    );
    await evaluate(`document.querySelector('button[data-action="duplicate-task"]').click()`);
    await waitFor(
      "Boolean(document.querySelector('[data-action=\"open-duplicate\"]'))",
      "duplicate success",
    );
    const dupInfo = await evaluate(String.raw`
(() => {
  const link = document.querySelector('[data-action="open-duplicate"]');
  return { href: link?.getAttribute('href') ?? null };
})()`);
    const dupId = dupInfo.href.replace(/^#?\/?tasks\//, "");
    await navigateTo(`#/tasks/${dupId}`);
    await waitFor(
      `Boolean(document.querySelector('[data-task-detail="${dupId}"]'))`,
      "duplicate detail",
    );
    const dupDetail = await evaluate(String.raw`
(() => {
  const body = document.body.innerText;
  return { authored: body.includes("authored"), v1: body.includes("v1"), title: body.includes("Summarize a report v2") };
})()`);
    record("duplicate-task", {
      dupId,
      pass:
        Boolean(dupInfo.href) &&
        dupId !== "task-authored" &&
        dupDetail.authored &&
        dupDetail.v1 &&
        dupDetail.title,
      reason:
        "duplicate creates a new authored identity at v1 with copied content — never an implied version",
    });

    // --- Archive / Restore (1440) -------------------------------------------
    await navigateTo("#/tasks/task-authored");
    await waitFor(
      "Boolean(document.querySelector('[data-task-detail=\"task-authored\"]'))",
      "authored detail",
    );
    await evaluate(`document.querySelector('button[data-action="archive-task"]').click()`);
    await waitFor(
      "Boolean(document.querySelector('button[data-action=\"confirm-archive\"]'))",
      "archive confirm",
    );
    await evaluate(`document.querySelector('button[data-action="confirm-archive"]').click()`);
    await waitFor(
      "Boolean(document.querySelector('button[data-action=\"restore-task\"]'))",
      "archived state",
    );
    const archivedState = await evaluate(String.raw`
(() => {
  const body = document.body.innerText;
  return { archived: body.includes("Archived"), restore: Boolean(document.querySelector('button[data-action="restore-task"]')), noArchiveBtn: !document.querySelector('button[data-action="archive-task"]') };
})()`);
    record("archive-task", {
      ...archivedState,
      pass: archivedState.archived && archivedState.restore && archivedState.noArchiveBtn,
      reason: "archive confirmation → archived badge + restore action, edit surface hidden",
    });
    await evaluate(`document.querySelector('button[data-action="restore-task"]').click()`);
    await waitFor(
      "Boolean(document.querySelector('button[data-action=\"archive-task\"]'))",
      "restored state",
    );
    const restoredState = await evaluate(String.raw`
(() => {
  const body = document.body.innerText;
  return { active: !body.includes("This task is archived"), archive: Boolean(document.querySelector('button[data-action="archive-task"]')), noRestore: !document.querySelector('button[data-action="restore-task"]') };
})()`);
    record("restore-task", {
      ...restoredState,
      pass: restoredState.active && restoredState.archive && restoredState.noRestore,
      reason: "restore returns the task to active editing with archive action available again",
    });

    // --- Families / relations / facets / provenance (1440) -------------------
    await navigateTo("#/tasks/task-authored");
    await waitFor(
      "Boolean(document.querySelector('[data-task-detail=\"task-authored\"]'))",
      "authored detail",
    );
    // Create a second family.
    await evaluate(`document.querySelector('button[data-action="new-family"]').click()`);
    await waitFor(
      "Boolean(document.querySelector('[data-family-form=\"create\"]'))",
      "family create form",
    );
    await evaluate(String.raw`
(() => {
  const setVal = (sel, v) => {
    const el = document.querySelector(sel);
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  setVal('input[data-field="name"]', 'QA Family Two');
  return true;
})()`);
    await evaluate(`document.querySelector('button[data-action="save-family"]').click()`);
    await waitFor(
      "Boolean([...document.querySelectorAll('[data-family-row]')].some((r) => r.textContent.includes('QA Family Two')))",
      "family row",
    );
    const familyCreated = await evaluate(
      `Boolean([...document.querySelectorAll('[data-family-row]')].some((r) => r.textContent.includes('QA Family Two')))`,
    );
    record("family-create", {
      pass: familyCreated,
      reason: "new family form saves and the family row appears in the registry",
    });

    // Add a typed cross-family relation (fam-qa → QA Family Two).
    await evaluate(String.raw`
(() => {
  const setSel = (sel, v) => {
    const el = document.querySelector(sel);
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  setSel('select[data-field="relation-from"]', 'fam-qa');
  return true;
})()`);
    await wait(100);
    const relationToOptions = await evaluate(String.raw`
(() => {
  const sel = document.querySelector('select[data-field="relation-to"]');
  return [...sel.options].map((o) => o.value).filter((v) => v && v !== 'fam-qa');
})()`);
    const secondFamilyId = relationToOptions[0];
    await evaluate(String.raw`
(() => {
  const setSel = (sel, v) => {
    const el = document.querySelector(sel);
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  setSel('select[data-field="relation-to"]', ${JSON.stringify(secondFamilyId)});
  return true;
})()`);
    await wait(100);
    await evaluate(`document.querySelector('button[data-action="save-relation"]').click()`);
    await waitFor("Boolean(document.querySelector('[data-relation-row]'))", "relation row");
    const relationCreated = await evaluate(
      `Boolean(document.querySelector('[data-relation-row]'))`,
    );
    record("relation-create", {
      pass: relationCreated,
      reason: "typed cross-family relation saves and renders a relation row",
    });

    // Family lifecycle dialog: focus trap + inert background.
    // Open the archive dialog on fam-qa.
    await evaluate(String.raw`
(() => {
  const row = document.querySelector('[data-family-row="fam-qa"]');
  if (!row) return false;
  const btn = row.querySelector('button[data-action="archive-family"]');
  if (!btn) return false;
  btn.focus();
  btn.click();
  return { activeAtClick: document.activeElement ? document.activeElement.getAttribute('data-action') : null };
})()`);
    await waitFor(
      "Boolean(document.querySelector('[data-dialog-backdrop]'))",
      "family dialog open",
    );
    await wait(250);
    const dialogFocus = await evaluate(String.raw`
(() => {
  const popup = document.querySelector('[role="dialog"]');
  const backdrop = document.querySelector('[data-dialog-backdrop]');
  const active = document.activeElement;
  const insideDialog = popup ? popup.contains(active) : false;
  // Inert background: base-ui modal dialogs mark background siblings
  // aria-hidden (inert from assistive tech) and trap Tab focus inside.
  const outsideBtn = document.querySelector('button[data-action="new-family"]');
  const outsideAriaHidden = outsideBtn ? (outsideBtn.closest('[aria-hidden="true"]') !== null) : null;
  return { dialogOpen: Boolean(backdrop), insideDialog, outsideAriaHidden, activeTag: active ? active.tagName : null };
})()`);
    record("family-dialog-focus-trap", {
      ...dialogFocus,
      pass:
        dialogFocus.dialogOpen &&
        dialogFocus.insideDialog &&
        dialogFocus.outsideAriaHidden === true,
      reason:
        "family lifecycle dialog moves focus into the popup and marks the background aria-hidden (inert from AT); Tab cycling stays trapped (separate probe)",
    });
    // Tab cycling stays inside the dialog.
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
    });
    await wait(120);
    const tabTrapped = await evaluate(
      `(() => { const popup = document.querySelector('[role="dialog"]'); return popup ? popup.contains(document.activeElement) : false; })()`,
    );
    record("family-dialog-tab-cycle", {
      pass: tabTrapped,
      reason: "Tab from a dialog control keeps focus inside the dialog (focus cycle)",
    });
    // Cancel and verify focus restore to the trigger.
    await evaluate(`document.querySelector('button[data-action="cancel-archive-family"]').click()`);
    await wait(200);
    const dialogClosed = await evaluate(String.raw`
(() => {
  const open = Boolean(document.querySelector('[data-dialog-backdrop]'));
  const active = document.activeElement;
  const triggerBtn = document.querySelector('[data-family-row="fam-qa"] button[data-action="archive-family"]');
  const triggerRestored = active ? (active.getAttribute('data-action') === 'archive-family') : false;
  return { open, triggerRestored, activeTag: active ? active.tagName : null, activeAction: active ? active.getAttribute('data-action') : null, triggerExists: Boolean(triggerBtn), triggerIsSame: triggerBtn ? triggerBtn === active : false };
})()`);
    record("family-dialog-close-restore", {
      ...dialogClosed,
      pass: dialogClosed.open === false && dialogClosed.triggerRestored,
      reason: "cancel closes the dialog and restores focus to the lifecycle trigger",
    });

    // Facets: add a task-form facet and verify provenance chips.
    await evaluate(String.raw`
(() => {
  const setSel = (sel, v) => {
    const el = document.querySelector(sel);
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  setSel('select[data-field="facet-dimension"]', 'task-form');
  return true;
})()`);
    await wait(100);
    await evaluate(String.raw`
(() => {
  const setSel = (sel, v) => {
    const el = document.querySelector(sel);
    const proto = Object.getPrototypeOf(el);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  setSel('select[data-field="facet-value"]', 'summarization');
  return true;
})()`);
    await wait(100);
    await evaluate(`document.querySelector('button[data-action="add-facet"]').click()`);
    await waitFor("Boolean(document.querySelector('[data-facet-row=\"task-form\"]'))", "facet row");
    const facetInfo = await evaluate(String.raw`
(() => {
  const row = document.querySelector('[data-facet-row="task-form"]');
  const domainRow = document.querySelector('[data-facet-row="domain"]');
  return {
    taskFormValue: row ? row.textContent.includes("Summarization") : false,
    source: row ? Boolean(row.querySelector('[data-facet-source]')) : false,
    author: row ? Boolean(row.querySelector('[data-facet-author]')) : false,
    taxonomy: row ? Boolean(row.querySelector('[data-facet-taxonomy]')) : false,
    domainValue: domainRow ? domainRow.textContent.includes("Natural language") : false,
    domainProvenance: domainRow ? Boolean(domainRow.querySelector('[data-facet-source]')) : false,
  };
})()`);
    record("facet-add-provenance", {
      ...facetInfo,
      pass:
        facetInfo.taskFormValue &&
        facetInfo.source &&
        facetInfo.author &&
        facetInfo.taxonomy &&
        facetInfo.domainValue &&
        facetInfo.domainProvenance,
      reason:
        "add-facet commits a task-form annotation with source/author/taxonomy provenance chips; existing domain facet keeps its provenance",
    });

    // --- Migration origin / references (1440) -------------------------------
    // Find the migrated legacy task row and open it.
    await navigateTo("#/tasks");
    await waitForCatalog();
    const legacyId = await evaluate(String.raw`
(() => {
  const rows = [...document.querySelectorAll('a[data-task-row]')];
  const legacy = rows.find((r) => r.textContent.includes("legacy-task-set"));
  return legacy ? legacy.getAttribute('data-task-row') : null;
})()`);
    await navigateTo(`#/tasks/${legacyId}`);
    await waitFor(
      `Boolean(document.querySelector('[data-task-detail="${legacyId}"]'))`,
      "legacy detail",
    );
    const legacyDetail = await evaluate(String.raw`
(() => {
  const body = document.body.innerText;
  const refs = document.querySelector('[data-task-references-section]');
  const instances = document.querySelector('[data-task-instances]');
  return {
    origin: body.includes("legacy-task-set"),
    refsSection: Boolean(refs),
    instancesSection: Boolean(instances),
    refsText: refs ? refs.textContent : "",
  };
})()`);
    record("migration-origin-references", {
      legacyId,
      ...legacyDetail,
      pass:
        Boolean(legacyId) &&
        legacyDetail.origin &&
        legacyDetail.refsSection &&
        legacyDetail.instancesSection,
      reason:
        "startup-migrated legacy task shows origin legacy-task-set, a references section, and the task instances list",
    });
    // Direct version load for the migrated task.
    await navigateTo(`#/tasks/${legacyId}/versions/1`);
    await waitFor(
      `Boolean(document.querySelector('[data-task-version="${legacyId}@1"]'))`,
      "legacy v1 route",
    );
    const legacyV1 = await evaluate(
      `(() => ({ readOnly: document.body.innerText.includes("read-only") }))()`,
    );
    record("migration-version-direct-load", {
      pass: legacyV1.readOnly,
      reason: "migrated task's version route direct-loads the immutable read-only view",
    });

    // --- Direct / unknown routes (1440) -------------------------------------
    await navigateTo("#/tasks/does-not-exist");
    await waitFor("Boolean(document.querySelector('[data-task-not-found]'))", "unknown task");
    const notFound = await evaluate(
      `(() => ({ notFound: Boolean(document.querySelector('[data-task-not-found]')), text: document.body.innerText.includes("not found") }))()`,
    );
    record("route-unknown-task", {
      ...notFound,
      pass: notFound.notFound && notFound.text,
      reason: "unknown task ID renders the explicit not-found state, no silent redirect",
    });
    await navigateTo("#/tasks/task-authored/versions/999");
    await waitFor("Boolean(document.querySelector('[data-task-not-found]'))", "unknown version");
    const unknownVersion = await evaluate(
      `(() => ({ notFound: Boolean(document.querySelector('[data-task-not-found]')) }))()`,
    );
    record("route-unknown-version", {
      ...unknownVersion,
      pass: unknownVersion.notFound,
      reason: "unknown version number renders the explicit not-found state",
    });
    await navigateTo("#/tasks/task-authored/versions/abc");
    await waitFor(
      "Boolean(document.querySelector('[data-task-invalid-version]'))",
      "invalid version",
    );
    const invalidVersion = await evaluate(
      `(() => ({ invalid: Boolean(document.querySelector('[data-task-invalid-version]')) }))()`,
    );
    record("route-invalid-version", {
      ...invalidVersion,
      pass: invalidVersion.invalid,
      reason:
        "malformed (non-integer) version param renders the explicit invalid-version state, no redirect",
    });

    // --- Keyboard-only operation (1440) -------------------------------------
    await navigateTo("#/tasks");
    await waitForCatalog();
    // Focus the search input via keyboard from the top.
    await evaluate(String.raw`
(() => {
  const search = document.querySelector('input[aria-label="Search tasks"]');
  search.focus();
  return true;
})()`);
    await wait(100);
    const searchFocused = await evaluate(
      `(() => { const el = document.activeElement; return { isSearch: el ? el.getAttribute('aria-label') === 'Search tasks' : false, hasRing: el ? getComputedStyle(el).outlineStyle !== 'none' : false }; })()`,
    );
    // Operate the origin filter by keyboard: focus it, ArrowDown to change value.
    await evaluate(String.raw`
(() => {
  const sel = document.querySelector('select[data-filter="origin"]');
  sel.focus();
  return true;
})()`);
    await wait(80);
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "ArrowDown",
      code: "ArrowDown",
      windowsVirtualKeyCode: 40,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "ArrowDown",
      code: "ArrowDown",
      windowsVirtualKeyCode: 40,
    });
    await wait(200);
    const kbFilter = await evaluate(String.raw`
(() => {
  const sel = document.querySelector('select[data-filter="origin"]');
  const rows = [...document.querySelectorAll('a[data-task-row]')];
  // ArrowDown from "all" selects the next option ("authored"); the catalog
  // must re-query through the repository and show only authored-origin rows.
  const changed = sel.value !== 'all';
  const allAuthored = rows.length > 0 && rows.every((r) => r.textContent.includes("authored"));
  const anyLegacy = rows.some((r) => r.textContent.includes("legacy-task-set"));
  return { changed, value: sel.value, rowCount: rows.length, allAuthored, anyLegacy };
})()`);
    record("keyboard-filter-operation", {
      ...searchFocused,
      ...kbFilter,
      pass:
        searchFocused.isSearch &&
        searchFocused.hasRing &&
        kbFilter.changed &&
        kbFilter.value === "authored" &&
        kbFilter.allAuthored &&
        kbFilter.anyLegacy === false,
      reason:
        "keyboard-only: search input is focusable with a visible focus ring; ArrowDown on the origin select changes the filter to authored and the catalog re-queries to authored-origin rows only",
    });
    await screenshot("qa-keyboard-catalog");

    // --- Archive export / preview / cancel / collision / success (1440) -----
    await navigateTo("#/runs");
    await waitFor(
      "Boolean(document.querySelector('button[data-action=\"export-v2\"]'))",
      "archive actions",
    );
    await wait(400);
    // Install a click override to capture the exported archive blob text.
    await evaluate(String.raw`
(() => {
  window.__capturedArchives = [];
  window.__archiveClickOrig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && this.href && this.href.startsWith('blob:')) {
      fetch(this.href).then((r) => r.text()).then((t) => window.__capturedArchives.push({ name: this.download, text: t }));
      return; // do not trigger a real download
    }
    return window.__archiveClickOrig.apply(this, arguments);
  };
  return true;
})()`);
    // Export v2.
    await evaluate(`document.querySelector('button[data-action="export-v2"]').click()`);
    await waitFor(
      "Boolean(document.querySelector('[role=status]')?.textContent.includes('Exported complete v2 archive'))",
      "v2 export done",
    );
    const exportInfo = await evaluate(String.raw`
(() => {
  const status = [...document.querySelectorAll('[role=status]')].map((s) => s.textContent).join(' | ');
  const captured = window.__capturedArchives;
  return { status, capturedCount: captured.length, hasArchive: captured.length > 0 };
})()`);
    record("archive-export-v2", {
      ...exportInfo,
      pass:
        exportInfo.status.includes("Exported complete v2 archive") &&
        exportInfo.capturedCount === 1 &&
        exportInfo.hasArchive,
      reason:
        "v2 export completes and reports the exported entity total; the archive blob is captured for downstream probes",
    });
    const capturedArchiveText = await evaluate(`window.__capturedArchives[0]?.text ?? null`);
    if (!capturedArchiveText) throw new Error("archive export did not capture a blob");

    // Cancel a fresh export mid-flight.
    await evaluate(String.raw`
(() => {
  // Clear prior status by starting a new export then cancelling.
  return true;
})()`);
    await evaluate(`document.querySelector('button[data-action="export-v2"]').click()`);
    // The v2 export resolves fast (IndexedDB read + serialize). Poll tightly
    // for the cancel button — it only renders while exportV2Busy is true —
    // and click it the instant it appears, before the export resolves.
    let cancelVisible = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      cancelVisible = await evaluate(
        `Boolean(document.querySelector('button[data-action="cancel-export"]'))`,
      );
      if (cancelVisible) {
        await evaluate(`document.querySelector('button[data-action="cancel-export"]').click()`);
        break;
      }
      await wait(8);
    }
    if (cancelVisible) {
      await waitFor(
        "Boolean([...document.querySelectorAll('[role=alert]')].some((a) => a.textContent.includes('cancel')))",
        "export cancel guidance",
        60,
      );
    }
    const cancelInfo = await evaluate(String.raw`
(() => {
  const alerts = [...document.querySelectorAll('[role=alert]')].map((a) => a.textContent).join(' | ');
  const statuses = [...document.querySelectorAll('[role=status]')].map((s) => s.textContent).join(' | ');
  return { cancelGuidance: alerts.toLowerCase().includes('cancel'), statuses };
})()`);
    record("archive-export-cancel", {
      cancelVisible,
      ...cancelInfo,
      pass: cancelVisible && cancelInfo.cancelGuidance,
      reason: "cancel-export aborts the in-flight v2 export and surfaces cancellation guidance",
    });

    // Helper: feed a JSON string to the hidden import file input.
    const feedArchive = async (jsonText, fileName = "archive.json") => {
      await evaluate(
        String.raw`
(async () => {
  const input = document.querySelector('input[type="file"]');
  const bytes = new TextEncoder().encode(${JSON.stringify(jsonText)});
  const file = new File([bytes], ${JSON.stringify(fileName)}, { type: 'application/json' });
  const dt = new DataTransfer();
  dt.items.add(file);
  Object.defineProperty(input, 'files', { value: dt.files, writable: false, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`,
      );
    };

    // Preview (captured archive → all reuse, identical).
    await feedArchive(capturedArchiveText, "captured-v2.json");
    await waitFor(
      "Boolean([...document.querySelectorAll('[role=status]')].some((s) => s.textContent.includes('Import preview')))",
      "import preview",
    );
    const previewInfo = await evaluate(String.raw`
(() => {
  const preview = [...document.querySelectorAll('[role=status]')].find((s) => s.textContent.includes('Import preview'));
  const text = preview ? preview.textContent : '';
  const confirm = document.querySelector('button[data-action="confirm-import"]');
  const cancel = document.querySelector('button[data-action="cancel-import"]');
  return { hasPreview: Boolean(preview), formatV2: text.includes('format v2'), totalMentioned: /\d+\s*record/.test(text), hasConfirm: Boolean(confirm), hasCancel: Boolean(cancel) };
})()`);
    record("archive-import-preview", {
      ...previewInfo,
      pass:
        previewInfo.hasPreview &&
        previewInfo.formatV2 &&
        previewInfo.totalMentioned &&
        previewInfo.hasConfirm &&
        previewInfo.hasCancel,
      reason:
        "import previews the validated archive (format v2, record count) with explicit confirm/cancel controls — nothing written yet",
    });

    // Cancel import → focus restored to the import trigger, no result.
    await evaluate(`document.querySelector('button[data-action="cancel-import"]').click()`);
    await wait(250);
    const cancelImportInfo = await evaluate(String.raw`
(() => {
  const previewGone = !document.querySelector('button[data-action="confirm-import"]');
  const active = document.activeElement;
  const focusRestored = active ? active.getAttribute('data-action') === 'import' : false;
  const noResult = !document.body.innerText.includes('Imported ');
  return { previewGone, focusRestored, noResult };
})()`);
    record("archive-import-cancel", {
      ...cancelImportInfo,
      pass:
        cancelImportInfo.previewGone && cancelImportInfo.focusRestored && cancelImportInfo.noResult,
      reason:
        "cancel-import closes the preview without writes and restores focus to the Import trigger; no result is reported",
    });

    // Collision: mutate the captured archive (rename task-authored v2 title),
    // recompute the v2 payload digest so structural validation passes, then
    // import → preview classifies the mutated entity as a non-identical
    // collision. Cancel without confirming.
    const collisionJson = await evaluate(
      String.raw`
(async () => {
  const archive = JSON.parse(${JSON.stringify(capturedArchiveText)});
  // Mutate one task version's title (same taskId+version, different content).
  const versions = archive.tasks && archive.tasks.taskVersions ? archive.tasks.taskVersions : [];
  const target = versions.find((v) => v.taskId === 'task-authored' && v.version === 2) || versions.find((v) => v.taskId === 'task-authored');
  if (target) {
    target.version_ = target.version_ ? { ...target.version_, title: 'COLLISION MUTATED TITLE' } : target.version_;
    if (target.title !== undefined) target.title = 'COLLISION MUTATED TITLE';
  }
  // Recompute the v2 payload digest (canonical JSON + SHA-256).
  const sortKeys = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(sortKeys);
    const o = {}; for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]); return o;
  };
  const payload = { runs: archive.runs, rubrics: archive.rubrics, suites: archive.suites, experiments: archive.experiments, fusion: archive.fusion, tasks: archive.tasks };
  const canonical = JSON.stringify(sortKeys(payload));
  const bytes = new TextEncoder().encode(canonical);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  archive.manifest.payloadDigest = 'sha256:' + hex;
  return JSON.stringify(archive);
})()`,
    );
    await feedArchive(collisionJson, "collision-v2.json");
    await waitFor(
      "Boolean([...document.querySelectorAll('[role=status]')].some((s) => s.textContent.includes('Import preview')))",
      "collision preview",
    );
    const collisionInfo = await evaluate(String.raw`
(() => {
  const preview = [...document.querySelectorAll('[role=status]')].find((s) => s.textContent.includes('Import preview'));
  const text = preview ? preview.textContent : '';
  const body = document.body.innerText;
  const hasCollision = text.includes('collision') || body.includes('Colliding records');
  return { hasPreview: Boolean(preview), hasCollision };
})()`);
    record("archive-import-collision", {
      ...collisionInfo,
      pass: collisionInfo.hasPreview && collisionInfo.hasCollision,
      reason:
        "non-identical ID collision (mutated content, valid digest) is reported in the preview before any write — never overwrites",
    });
    // Cancel the collision preview.
    await evaluate(`document.querySelector('button[data-action="cancel-import"]').click()`);
    await wait(200);

    // Successful import (identical reuse): feed the unmodified captured
    // archive → 0 create, N reuse → confirm → success result.
    await feedArchive(capturedArchiveText, "success-v2.json");
    await waitFor(
      "Boolean(document.querySelector('button[data-action=\"confirm-import\"]'))",
      "success preview",
    );
    await evaluate(`document.querySelector('button[data-action="confirm-import"]').click()`);
    await waitFor(
      "Boolean([...document.querySelectorAll('[role=status]')].some((s) => s.textContent.includes('Imported ')))",
      "import success result",
    );
    const successInfo = await evaluate(String.raw`
(() => {
  const status = [...document.querySelectorAll('[role=status]')].map((s) => s.textContent).join(' | ');
  const imported = /Imported \d+ records? — \d+ reused/.test(status);
  return { status, imported };
})()`);
    record("archive-import-success", {
      ...successInfo,
      pass: successInfo.imported,
      reason:
        "confirming the identical-reuse preview commits atomically and reports 'Imported N records — M reused' (idempotent reuse, no writes)",
    });

    // --- Secret-shaped content / no-echo probe (1440) -----------------------
    // Feed an archive whose payload carries a prohibited credential key AND
    // a credential-like value, with a recomputed digest. The v2 validator
    // rejects prohibited keys; the UI must surface a classified error that
    // NEVER echoes the secret-shaped value.
    const SECRET_VALUE = "sk-test-not-a-real-credential-XYZ";
    const secretJson = await evaluate(
      String.raw`
(async () => {
  const archive = JSON.parse(${JSON.stringify(capturedArchiveText)});
  // Inject a prohibited credential/transport key into a task record.
  if (archive.tasks && archive.tasks.tasks && archive.tasks.tasks[0]) {
    archive.tasks.tasks[0].apiKey = ${JSON.stringify(SECRET_VALUE)};
  }
  const sortKeys = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(sortKeys);
    const o = {}; for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]); return o;
  };
  const payload = { runs: archive.runs, rubrics: archive.rubrics, suites: archive.suites, experiments: archive.experiments, fusion: archive.fusion, tasks: archive.tasks };
  const canonical = JSON.stringify(sortKeys(payload));
  const bytes = new TextEncoder().encode(canonical);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  archive.manifest.payloadDigest = 'sha256:' + hex;
  return JSON.stringify(archive);
})()`,
    );
    // Clear any prior error/result text.
    await wait(150);
    await feedArchive(secretJson, "secret-v2.json");
    await wait(600);
    const secretInfo = await evaluate(String.raw`
(() => {
  const alerts = [...document.querySelectorAll('[role=alert]')].map((a) => a.textContent).join(' | ');
  const body = document.body.innerText;
  const hasError = alerts.length > 0 || /invalid|prohibited|credential/i.test(body);
  const leaked = body.includes(${JSON.stringify(SECRET_VALUE)}) || alerts.includes(${JSON.stringify(SECRET_VALUE)});
  const noPreview = !document.querySelector('button[data-action="confirm-import"]');
  return { hasError, leaked, noPreview, alerts };
})()`);
    record("archive-secret-no-echo", {
      ...secretInfo,
      pass: secretInfo.hasError && secretInfo.leaked === false && secretInfo.noPreview,
      reason:
        "archive carrying a prohibited credential key is rejected with a classified error that never echoes the secret-shaped value; no preview is offered",
    });

    // --- Empty catalog state (spec: empty/archived/migration-error states) ---
    // Reset IndexedDB to a truly empty workbench, reload, and confirm the
    // catalog surfaces `data-task-empty` ("No tasks yet.") with a New task
    // action — never a zero-row blank or an error.
    // Reopen and clear every store's rows in a single transaction.
    await evaluate(String.raw`
(async () => {
  const DB = "rsemble-evaluation";
  const openDb = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const db = await openDb();
  const storeNames = [...db.objectStoreNames];
  const tx = db.transaction(storeNames, "readwrite");
  await new Promise((resolve, reject) => {
    for (const store of storeNames) tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
  return storeNames.join(",");
})().catch((e) => ({ __seedError: (e && (e.message || String(e))) }))`);
    await send("Page.navigate", { url: `${BROWSER_BASE}#/tasks` });
    await waitFor(
      "Boolean(document.querySelector('[data-task-empty]')) || Boolean(document.querySelector('a[data-task-row]'))",
      "empty catalog",
      120,
    );
    await wait(300);
    const emptyState = await evaluate(String.raw`
(() => {
  const empty = document.querySelector('[data-task-empty]');
  const rows = document.querySelectorAll('a[data-task-row]').length;
  const newAction = document.querySelector('[data-action="new-task"]');
  const body = document.body.innerText;
  return {
    emptyState: Boolean(empty),
    rowCount: rows,
    noTasksText: Boolean(empty && empty.textContent.includes("No tasks yet")),
    hasNewAction: Boolean(newAction),
    overflowX: document.documentElement.scrollWidth > innerWidth,
  };
})()`);
    record("catalog-empty-state", {
      ...emptyState,
      pass:
        emptyState.emptyState &&
        emptyState.rowCount === 0 &&
        emptyState.noTasksText &&
        emptyState.hasNewAction &&
        !emptyState.overflowX,
      reason:
        "fresh empty workbench renders the explicit empty-catalog state ('No tasks yet.') with a New task action and no horizontal overflow",
    });
    await screenshot("qa-catalog-empty");

    // --- Migration / load-error state (spec: empty/archived/migration-error) ---
    // Deterministically trigger the bounded canonical-Task migration-error
    // path. Two phases:
    //   1. Seed a legacy suite + experiment, reload → migration creates the
    //      canonical legacy Task + version for scope (suite-err, t1).
    //   2. Corrupt that version's source.legacyScopeKey, delete the migration
    //      marker, reload → migration's consistency check throws
    //      StorageError("validation") → taskMigrationError → taskRepo = null
    //      → catalog must surface data-task-error-state (alert role, Retry,
    //      "storage is unavailable") rather than recovering or going blank.

    // --- Phase 1: seed legacy suite + experiment ---
    await send("Page.navigate", { url: BROWSER_BASE });
    await waitFor(
      "Boolean(document.querySelector('main, [role=main], #root > *'))",
      "shell before seed",
    );
    await waitFor("Boolean(window.indexedDB)", "indexedDB");
    const SEED_LEGACY = String.raw`
(async () => {
  const DB = "rsemble-evaluation";
  const openDb = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("open blocked"));
  });
  const put = (db, store, value) => new Promise((resolve, reject) => {
    const r = db.transaction(store, "readwrite").objectStore(store).put(value);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
  const db = await openDb();
  const NOW = 1700000000000;
  const legacyTask = {
    id: "t1", title: "Error probe", prompt: "Summarize.",
    systemPrompt: "Bullets.", evaluation: { kind: "inherit" },
    judgeInstructionOverride: "", order: 0,
  };
  const suite = {
    id: "suite-err", revision: 1, version: 1, name: "Error Suite",
    description: "", tasks: [legacyTask], modelSlots: [],
    defaultJudge: { providerId: "openrouter", model: "judge" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: NOW, updatedAt: NOW, archivedAt: null,
  };
  await put(db, "suites", {
    id: suite.id, suite, revision: 1, version: suite.version,
    updatedAt: NOW, archivedAt: null,
  });
  const experiment = {
    id: "exp-err", revision: 1, suiteId: "suite-err", suiteVersion: 1,
    protocolFingerprint: "sha256:err", status: "completed", execution: null,
    snapshot: {
      suiteId: "suite-err", suiteVersion: 1, tasks: [legacyTask], modelSlots: [],
      defaultJudge: suite.defaultJudge, defaultEvaluation: suite.defaultEvaluation,
      profiles: [], protocolFingerprint: "sha256:err", createdAt: NOW,
    },
    tasks: [], createdAt: NOW, updatedAt: NOW,
  };
  await put(db, "experiments", {
    id: experiment.id, experiment, revision: 1, suiteId: experiment.suiteId,
    suiteVersion: experiment.suiteVersion, protocolFingerprint: experiment.protocolFingerprint,
    createdAt: NOW, status: experiment.status,
  });
  db.close();
  return true;
})().catch((e) => ({ __seedError: (e && (e.name ? e.name + ": " : "") + (e.message || String(e))) }))`;
    let seededLegacy = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      seededLegacy = await evaluate(SEED_LEGACY);
      if (!seededLegacy?.__seedError) break;
      if (attempt < 2) {
        await wait(300);
        await send("Page.navigate", { url: BROWSER_BASE });
        await waitFor("Boolean(window.indexedDB)", "indexedDB");
      }
    }
    if (seededLegacy?.__seedError)
      throw new Error(`Legacy seed failed: ${seededLegacy.__seedError}`);
    // Reload so startup migration consumes the legacy suite and creates the
    // canonical Task + version for scope (suite-err, t1).
    await send("Page.navigate", { url: BROWSER_BASE });
    await waitFor(
      "Boolean(document.querySelector('main, [role=main], #root > *'))",
      "shell after migration reload",
    );
    await wait(800);
    await send("Page.navigate", { url: `${BROWSER_BASE}#/tasks` });
    await waitFor(
      "Boolean(document.querySelector('a[data-task-row]')) || Boolean(document.querySelector('[data-task-empty]')) || Boolean(document.querySelector('[data-task-error-state]'))",
      "catalog settled after migration",
      120,
    );
    await wait(300);

    // --- Phase 2: corrupt the migrated Task version ---
    await send("Page.navigate", { url: BROWSER_BASE });
    await waitFor("Boolean(window.indexedDB)", "indexedDB");
    const CORRUPT = String.raw`
(async () => {
  const DB = "rsemble-evaluation";
  const openDb = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("open blocked"));
  });
  const db = await openDb();
  const tasks = await new Promise((resolve, reject) => {
    const r = db.transaction("tasks", "readonly").objectStore("tasks").getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const legacy = tasks.find((t) => t.origin === "legacy-task-set");
  if (!legacy) throw new Error("no legacy task found to corrupt");
  const versions = await new Promise((resolve, reject) => {
    const idx = db.transaction("taskVersions", "readonly").objectStore("taskVersions").index("taskId");
    const r = idx.getAll(legacy.id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  if (versions.length === 0) throw new Error("no versions for legacy task");
  for (const v of versions) {
    const corrupted = { ...v };
    corrupted.version_ = { ...v.version_ };
    corrupted.version_.source = { ...v.version_.source, legacyScopeKey: "CORRUPTED-SCOPE" };
    await new Promise((resolve, reject) => {
      const r = db.transaction("taskVersions", "readwrite").objectStore("taskVersions").put(corrupted);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  }
  await new Promise((resolve, reject) => {
    const r = db.transaction("storageMeta", "readwrite").objectStore("storageMeta").delete("canonical-task-migration:v1");
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
  db.close();
  return { corrupted: versions.length, taskId: legacy.id };
})().catch((e) => ({ __corruptError: (e && (e.name ? e.name + ": " : "") + (e.message || String(e))) }))`;
    let corrupted = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      corrupted = await evaluate(CORRUPT);
      if (!corrupted?.__corruptError) break;
      if (attempt < 2) {
        await wait(300);
        await send("Page.navigate", { url: BROWSER_BASE });
        await waitFor("Boolean(window.indexedDB)", "indexedDB");
      }
    }
    if (corrupted?.__corruptError)
      throw new Error(`Corrupt failed: ${corrupted.__corruptError}`);
    // Reload: migration re-runs, finds the inconsistent version, throws
    // StorageError("validation") → taskMigrationError → taskRepo = null →
    // the catalog must surface data-task-error-state (alert role, Retry,
    // "storage is unavailable") rather than recovering or going blank.
    await send("Page.navigate", { url: BROWSER_BASE });
    await waitFor(
      "Boolean(document.querySelector('main, [role=main], #root > *'))",
      "shell after error reload",
    );
    await wait(800);
    await send("Page.navigate", { url: `${BROWSER_BASE}#/tasks` });
    await waitFor(
      "Boolean(document.querySelector('[data-task-error-state]'))",
      "migration error state",
      120,
    );
    await wait(300);
    const loadError = await evaluate(String.raw`
(() => {
  const err = document.querySelector('[data-task-error-state]');
  const retry = document.querySelector('[data-action="retry"]');
  const body = document.body.innerText;
  return {
    errorState: Boolean(err),
    alertRole: Boolean(err && err.getAttribute('role') === 'alert'),
    hasRetry: Boolean(retry),
    unavailableOrFailed: err ? /unavailable|Failed to load/i.test(err.textContent) : false,
    rowCount: document.querySelectorAll('a[data-task-row]').length,
    leaked: body.includes("smuggled"),
  };
})()`);
    record("catalog-migration-error-state", {
      ...loadError,
      reason:
        loadError.errorState && loadError.alertRole && loadError.hasRetry && loadError.unavailableOrFailed && !loadError.leaked
          ? "deterministic migration-error surfaces the classified load/error state (alert role, Retry action, unavailable text) and never echoes secret-shaped content"
          : "migration-error state was not surfaced — the catalog recovered or went blank instead of showing the required error UI",
    });
    // Strict verdict: the error state MUST appear with all required affordances.
    // Recovery, empty, or rows are NOT acceptable for this probe.
    record("catalog-migration-error-state-verdict", {
      pass:
        loadError.errorState &&
        loadError.alertRole &&
        loadError.hasRetry &&
        loadError.unavailableOrFailed &&
        !loadError.leaked,
      reason: loadError.errorState
        ? "classified migration-error state renders with alert role + Retry + unavailable/failed text, no secret echo"
        : "the migration-error state was not surfaced (recovery or blank) — FAIL",
    });
    await screenshot("qa-catalog-error-state");

    // --- Console / page error / provider-call verdicts ----------------------
    record("console-errors", {
      count: results.consoleErrors.length,
      errors: results.consoleErrors,
      pass: results.consoleErrors.length === 0,
      reason: "no console.error calls during the full matrix",
    });
    record("page-errors", {
      count: results.pageErrors.length,
      errors: results.pageErrors,
      pass: results.pageErrors.length === 0,
      reason: "no uncaught page exceptions during the full matrix",
    });
    record("no-provider-calls", {
      providerCalls: results.providerCalls,
      externalRequestCount: results.networkRequests.length,
      pass: results.providerCalls.length === 0,
      reason: "no product provider endpoint was contacted during the Task/archive matrix",
    });

    fs.writeFileSync(join(OUT_DIR, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
    process.stdout.write(
      `\n${GATE_NAME} --browser: PASS — Child 02 browser/a11y matrix green (${results.probes.length} probes).\nEvidence: ${OUT_DIR}\n`,
    );
    process.exit(0);
  } catch (error) {
    results.error = error instanceof Error ? error.message : String(error);
    try {
      fs.writeFileSync(join(OUT_DIR, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
    } catch {}
    process.stderr.write(`\n${GATE_NAME} --browser: FAIL — ${results.error}\n`);
    process.exitCode = 1;
  } finally {
    try {
      if (socket) socket.close();
    } catch {}
    try {
      if (chrome) chrome.kill();
    } catch {}
    viteCleanup();
  }
}

// --- Entry point -------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--browser")) {
    void runBrowserMatrix();
    return;
  }
  runClosureGate();
}

main();
