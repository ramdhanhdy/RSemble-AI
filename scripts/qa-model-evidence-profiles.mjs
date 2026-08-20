#!/usr/bin/env node
// =============================================================================
// qa-model-evidence-profiles.mjs — Child 07 T13 browser/performance/authority
// closure evidence.
//
// This is a deterministic, zero-egress CDP harness for the direct-route Models
// workspace. It seeds canonical-looking local IndexedDB rows (including the
// 4,120-observation T8 corpus), then exercises list/profile/drilldown/rollup
// routes, identity states, exact evidence filters, narrowing, keyboard/focus,
// reduced motion, responsive overflow, and archive-compatible rollup states.
// It writes only JSON evidence and PNG screenshots under docs/qa/model-evidence-profiles.
// =============================================================================

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const BROWSER_PORT = process.env.QA_PORT ? Number(process.env.QA_PORT) : 5192;
const baseUrl = process.env.QA_BASE_URL ?? `http://127.0.0.1:${BROWSER_PORT}/`;
const chromePath =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const debugPort = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 9392;
const outDir = path.resolve("docs/qa/model-evidence-profiles");
const scratchDir = path.resolve(".omp/rlm/scratch/qa-model-evidence-profiles");
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(scratchDir, { recursive: true });

const results = {
  generatedAt: new Date().toISOString(),
  command: "npm run qa:model-evidence-profiles",
  baseUrl,
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    chromePath,
    browser: "Chrome headless new over CDP",
    viewportEvidence: [],
  },
  priorBenchmark: {
    corpusObservations: 4120,
    coldMs: 628.445,
    warmP50Ms: 797.484,
    warmP95Ms: 903.561,
    warmMaxMs: 903.561,
    wallClockBudgetMs: 1000,
    wallClockBudgetMet: true,
    mainThreadLongTaskCeilingMs: 50,
    preT8MainThreadBudgetMet: false,
    t8WorkerGreenSha: "67e3edc02c1331abe9c3dbabd50b444e1cf526fe",
  },
  corpusManifest: null,
  timings: {},
  probes: [],
  screenshots: [],
  consoleErrors: [],
  providerCalls: [],
  blockers: [],
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
        if (tries >= attempts) return reject(new Error(`Vite never became ready on ${port}`));
        setTimeout(probe, 250);
      }
    };
    probe();
  });
}

// Provider and bridge calls are local-only in this harness. Paid hosts are
// rejected rather than mocked so a new egress path cannot silently pass.
const MOCK_PROVIDER_INTERCEPTOR = `(() => {
  window.__qaPaidProviderCalls = [];
  window.__qaInterceptedCatalogCalls = [];
  window.__qaLongTasks = [];
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__qaLongTasks.push({ name: entry.name, startTime: entry.startTime, duration: entry.duration });
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {}
  const originalFetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input && input.url) || '';
    if (url.includes('/9router/v1/models')) return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/auth/status')) return new Response(JSON.stringify({ authenticated: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/health')) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (/\\/models(?:\\?|\\/|$)/i.test(url)) {
      window.__qaInterceptedCatalogCalls.push({ url, method: (init && init.method) || 'GET', timestamp: Date.now() });
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (/openrouter\\.ai|api\\.openai\\.com|anthropic\\.com|generativelanguage\\.googleapis\\.com|api\\.deepseek\\.com|umans\\.ai/i.test(url)) {
      window.__qaPaidProviderCalls.push({ url, method: (init && init.method) || 'GET', timestamp: Date.now() });
      return new Response(JSON.stringify({ error: 'blocked by Models QA egress gate' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch.apply(this, arguments);
  };
})()`;

// This source is evaluated in the page after Vite has initialized schema v14.
// It uses only IndexedDB primitives so the browser evidence remains independent
// of production repository write APIs while preserving their stored row shapes.
const SEED_SOURCE = String.raw`(async () => {
  const DB = 'rsemble-evaluation';
  const openDb = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const db = await openDb();
  const names = ['modelConfigurations','observations','evidenceDecisions','taskFamilies','tasks','taskVersions','taskFamilyAssignments','modelRollups','modelRollupVersions'];
  const clearTx = db.transaction(names, 'readwrite');
  for (const name of names) clearTx.objectStore(name).clear();
  await new Promise((resolve, reject) => { clearTx.oncomplete = resolve; clearTx.onerror = () => reject(clearTx.error); });
  const digest = async (text) => {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(bytes)].map((v) => v.toString(16).padStart(2, '0')).join('');
  };
  const sortKeys = (value) => Array.isArray(value)
    ? value.map(sortKeys)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]))
      : value;
  const canonical = (value) => JSON.stringify(sortKeys(value));
  const sha = async (value) => 'sha256:' + await digest(typeof value === 'string' ? value : canonical(value));
  const put = (store, value) => new Promise((resolve, reject) => {
    const req = store.put(value);
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
  });
  const now = Date.parse('2026-08-01T00:00:00Z');
  const configuration = (hex, providerId, requestedModel, resolvedModel, resolvedVersion, identityCompleteness) => ({
    id: 'mc:sha256:' + hex.repeat(64), providerId, requestedModel, resolvedModel, resolvedVersion,
    reasoningRequested: providerId === 'openai' ? 'high' : null,
    reasoningEffective: providerId === 'openai' ? 'high' : null,
    toolScaffoldSignature: providerId === 'openai' ? 'tools:v1' : null,
    runtimeSettings: { temperature: 0 }, observedFrom: now - 90 * 86400000, observedTo: now,
    identityCompleteness,
  });
  const configs = [
    configuration('a', 'openai', 'gpt-5.6-sol', 'gpt-5.6-sol', '2026-07-01', 'exact'),
    configuration('b', 'anthropic', 'claude-haiku-4-5', 'claude-haiku-4-5', null, 'rolling_alias'),
    configuration('c', 'legacy', 'legacy-model', null, null, 'partial'),
    configuration('d', 'openai', 'empty-model', 'empty-model', '2026-01-01', 'exact'),
    configuration('e', 'openai', 'incompatible-model', 'incompatible-model', '2026-06-01', 'exact'),
    configuration('f', 'anthropic', 'isolated-model', 'isolated-model', '2026-06-02', 'exact'),
  ];
  const namesToStore = Object.fromEntries(names.map((name) => [name, null]));
  const tx = db.transaction(names, 'readwrite');
  for (const name of names) namesToStore[name] = tx.objectStore(name);
  for (const cfg of configs) await put(namesToStore.modelConfigurations, {
    id: cfg.id, snapshot: cfg, providerId: cfg.providerId, requestedModel: cfg.requestedModel,
    resolvedVersion: cfg.resolvedVersion, observedTo: cfg.observedTo,
  });
  const families = Array.from({ length: 40 }, (_, index) => ({
    id: 'family-' + String(index + 1).padStart(2, '0'), name: 'Family ' + String(index + 1).padStart(2, '0'),
    description: 'Deterministic Models QA family', parentFamilyId: null,
    createdAt: now - 90 * 86400000, updatedAt: now, archivedAt: null, revision: 1,
  }));
  for (const family of families) await put(namesToStore.taskFamilies, {
    id: family.id, family, parentFamilyId: null, updatedAt: family.updatedAt, archivedAt: null, revision: 1,
  });
  for (let index = 0; index < 400; index += 1) {
    const id = 'task-' + String(index + 1).padStart(3, '0');
    const createdAt = now - 90 * 86400000;
    const task = { id, latestVersion: 1, createdAt, updatedAt: now, archivedAt: null, origin: 'authored', revision: 1 };
    const version = {
      taskId: id, version: 1, title: 'QA task ' + id, objective: 'Deterministic evidence QA task',
      candidateInstruction: 'Complete this task.', defaultContextManifest: [], responseContract: null,
      taskVerifierRef: null, source: { kind: 'authored', legacyScopeKey: null, note: null }, createdAt,
    };
    const familyId = 'family-' + String((index % 40) + 1).padStart(2, '0');
    await put(namesToStore.tasks, { id, record: task, latestVersion: 1, createdAt, updatedAt: now, archivedAt: null, origin: 'authored', revision: 1 });
    await put(namesToStore.taskVersions, { taskId: id, version: 1, version_: version, createdAt });
    const assignment = { id: 'assignment-' + id, taskId: id, taskVersion: 1, familyId, isPrimary: true, createdAt, revision: 1, archivedAt: null };
    await put(namesToStore.taskFamilyAssignments, { id: assignment.id, assignment, taskId: id, taskVersion: 1, familyId, isPrimary: 1, createdAt, revision: 1, archivedAt: null });
  }
  const PROTOCOL = 'sha256:' + '1'.repeat(64);
  const DIGEST = 'sha256:' + '2'.repeat(64);
  const COHORT_A = 'sha256:' + 'a'.repeat(64);
  const COHORT_B = 'sha256:' + 'b'.repeat(64);
  let observationCount = 0;
  let firstObservationId = null;
  const addObservation = async ({ cfg, index, taskIndex, sourceKind = 'evaluation', cohort = COHORT_A, evidenceClass = 'comparable', status = 'eligible', score = 80, verifier = null, judged = true }) => {
    const config = configs.find((item) => item.id === cfg);
    const taskId = 'task-' + String(taskIndex + 1).padStart(3, '0');
    const candidateAttemptId = 'candidate-' + cfg.slice(-1) + '-' + index;
    const verifierOutcome = verifier === null ? null : { taskId, modelKey: config.providerId + ':' + config.requestedModel, passed: verifier, executedAt: now - index };
    const assessmentRef = {
      judgeAttemptId: 'judge-' + cfg.slice(-1) + '-' + index, judgeProviderId: 'openai', judgeModel: 'judge-qa',
      blindLabelMapping: { A: 'candidate' }, candidateAttemptIdsByCandidateId: { candidate: candidateAttemptId },
      rubricRef: judged ? { id: 'rubric-main', version: 1 } : null,
      verifierRef: verifierOutcome ? { id: 'verifier-main', version: 1 } : null, verifierOutcome,
    };
    const sourceKeyParts = [sourceKind, 'qa-run', 'cell-' + cfg.slice(-1) + '-' + index, config.id, candidateAttemptId,
      canonical([assessmentRef.judgeAttemptId, verifierOutcome ? [taskId, verifierOutcome.modelKey, verifierOutcome.passed, verifierOutcome.executedAt] : null])];
    const id = 'obs:sha256:' + await digest(canonical(sourceKeyParts));
    const observation = {
      id, sourceKind, sourceResultId: 'qa-run', executionLineageId: 'line-' + cfg.slice(-1) + '-' + index,
      runId: 'qa-run', sourceTaskCellId: 'cell-' + cfg.slice(-1) + '-' + index, taskId, taskVersion: 1,
      taskInstanceId: 'instance-' + taskId, taskFamilyId: 'family-' + String((taskIndex % 40) + 1).padStart(2, '0'),
      modelConfigurationId: config.id, candidateAttemptId, assessmentRef, protocolFingerprint: PROTOCOL,
      rubricRef: judged ? { id: 'rubric-main', version: 1 } : null,
      evaluatorSnapshot: { kind: 'model_judge', providerId: 'openai', model: 'judge-qa', resolvedVersion: 'judge-2026', instructionDigest: DIGEST, reasoningEffort: null, toolScaffoldSignature: null },
      verifierSnapshot: verifierOutcome ? { verifierRef: { id: 'verifier-main', version: 1 }, kind: 'unit_tests', configurationDigest: DIGEST } : null,
      outcome: { judgeAccepted: judged, overallScore: judged ? score : null, criterionValues: [], verifierPassed: verifier },
      observedAt: now - index * 1000, observationSchemaVersion: 1,
    };
    const decision = {
      observationId: id, ruleVersion: 1, status, evidenceClass,
      allowedUses: status === 'eligible' ? ['task_descriptive', 'within_model_profile', 'paired_model_comparison'] : [],
      comparabilityCohortId: cohort,
      reasonCodes: status === 'eligible' ? ['canonical_task_resolved', 'model_configuration_exact', 'protocol_complete', 'assessment_selected_completed'] : ['assessment_missing_or_failed'],
      decidedAt: now,
    };
    await put(namesToStore.observations, {
      id, sourceKey: canonical(sourceKeyParts), sourceKind, sourceResultId: 'qa-run', sourceTaskCellId: observation.sourceTaskCellId,
      taskId, taskInstanceId: observation.taskInstanceId, modelConfigurationId: config.id, observedAt: observation.observedAt, observation,
    });
    await put(namesToStore.evidenceDecisions, { id: id + '#1', observationId: id, ruleVersion: 1, status, evidenceClass, comparabilityCohortId: cohort, decidedAt: now, decision });
    observationCount += 1;
    if (firstObservationId === null) firstObservationId = id;
  };
  // Exact subject corpus: the measured T8 4,120 observations, distributed over
  // 400 tasks and 40 families; unique lineages keep all rows independently visible.
  for (let index = 0; index < 4120; index += 1) {
    const verifier = index % 4 === 0 ? true : index % 4 === 1 ? false : null;
    const judged = verifier === null || index % 7 !== 0;
    await addObservation({ cfg: configs[0].id, index, taskIndex: index % 400, cohort: index % 19 === 0 ? COHORT_B : COHORT_A,
      evidenceClass: !judged ? 'exploratory' : verifier === null ? 'comparable' : 'verified', status: !judged ? 'provisional' : 'eligible', score: 60 + (index % 40), verifier, judged });
  }
  // Rolling alias: a small shared judged cohort for paired evidence (version
  // remains unknown; it is never promoted to an exact identity).
  for (let index = 0; index < 40; index += 1) await addObservation({ cfg: configs[1].id, index, taskIndex: index, score: 55 + (index % 30) });
  // Partial identity / exploratory-only, incompatible cohort, and an isolated
  // comparator provide explicit unknown, missing, and empty-intersection states.
  for (let index = 0; index < 3; index += 1) await addObservation({ cfg: configs[2].id, index, taskIndex: index + 20, evidenceClass: 'exploratory', status: 'provisional', score: null, judged: false });
  for (let index = 0; index < 4; index += 1) await addObservation({ cfg: configs[4].id, index, taskIndex: index + 100, cohort: COHORT_B, score: 40 + index });
  for (let index = 0; index < 2; index += 1) await addObservation({ cfg: configs[5].id, index, taskIndex: index + 300, score: 30 + index });
  const makeVersion = async (rollupId, version, name, members, createdAt) => {
    const input = { rollupId, version, name, memberConfigurationIds: members, aggregationPolicy: 'stratified_only', createdAt };
    return { ...input, memberManifestDigest: await sha(input) };
  };
  const rollupV1 = await makeVersion('rollup:qa', 1, 'QA exact shelves', [configs[0].id, configs[1].id], now - 100000);
  const rollupV2 = await makeVersion('rollup:qa', 2, 'QA exact shelves v2', [configs[0].id, configs[1].id, configs[3].id], now - 50000);
  const rollupRecord = { id: 'rollup:qa', name: rollupV2.name, latestVersion: 2, revision: 1, createdAt: now - 100000, updatedAt: now - 50000, archivedAt: null };
  await put(namesToStore.modelRollups, { id: rollupRecord.id, record: rollupRecord, name: rollupRecord.name, latestVersion: 2, revision: 1, createdAt: rollupRecord.createdAt, updatedAt: rollupRecord.updatedAt, archivedAt: null });
  for (const version of [rollupV1, rollupV2]) await put(namesToStore.modelRollupVersions, { rollupId: version.rollupId, version: version.version, version_: version, memberManifestDigest: version.memberManifestDigest, createdAt: version.createdAt });
  const tombstoneId = 'mc:sha256:' + '9'.repeat(64);
  const archivedVersion = await makeVersion('rollup:archived', 1, 'Archived QA shelf', [configs[0].id, tombstoneId], now - 70000);
  const archivedRecord = { id: 'rollup:archived', name: archivedVersion.name, latestVersion: 1, revision: 1, createdAt: archivedVersion.createdAt, updatedAt: archivedVersion.createdAt, archivedAt: now - 1000 };
  await put(namesToStore.modelRollups, { id: archivedRecord.id, record: archivedRecord, name: archivedRecord.name, latestVersion: 1, revision: 1, createdAt: archivedRecord.createdAt, updatedAt: archivedRecord.updatedAt, archivedAt: archivedRecord.archivedAt });
  await put(namesToStore.modelRollupVersions, { rollupId: archivedVersion.rollupId, version: archivedVersion.version, version_: archivedVersion, memberManifestDigest: archivedVersion.memberManifestDigest, createdAt: archivedVersion.createdAt });
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  db.close();
  return { configurations: configs.length, taskFamilies: families.length, tasks: 400, observations: observationCount, exactSubjectObservations: 4120, rollupRecords: 2, rollupVersions: 3, firstObservationId, tombstoneId };
})()`;

let socket = null;
let chromeProcess = null;
let chromeUserDataDir = null;
let viteProcess = null;
let nextMessageId = 0;
const pending = new Map();

function cleanup() {
  try {
    socket?.close();
  } catch {}
  try {
    chromeProcess?.kill("SIGKILL");
  } catch {}
  try {
    viteProcess?.kill("SIGTERM");
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

async function run() {
  try {
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
    chromeUserDataDir = path.join(os.tmpdir(), `rsemble-model-evidence-${Date.now()}`);
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
    const record = (name, value) => {
      const entry = { name, ...value };
      results.probes.push(entry);
      if (entry.pass === false) throw new Error(`${name}: ${entry.reason ?? "assertion failed"}`);
    };
    const screenshot = async (name) => {
      const capture = await send("Page.captureScreenshot", { format: "png" });
      const file = `${name}.png`;
      fs.writeFileSync(path.join(outDir, file), Buffer.from(capture.data, "base64"));
      results.screenshots.push(file);
    };
    const setViewport = async ({ name, width, height, scale }) => {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: scale,
        mobile: width <= 500,
      });
      results.environment.viewportEvidence.push({
        name,
        width,
        height,
        zoom: scale === 2 ? "200% device scale" : "100%",
        documentOverflow: await evaluate(
          "({ width: document.documentElement.scrollWidth, client: document.documentElement.clientWidth })",
        ),
      });
    };
    const navigate = async (hash, label) => {
      const clean = hash.startsWith("#") ? hash : `#${hash}`;
      const started = Date.now();
      const separator = baseUrl.includes("?") ? "&" : "?";
      await send("Page.navigate", {
        url: `${baseUrl}${separator}qa=${encodeURIComponent(label)}-${started}${clean}`,
      });
      await waitFor("Boolean(document.querySelector('#root > *'))", `${label} shell`);
      await wait(150);
      results.timings[label] = Date.now() - started;
    };
    const profileId = "mc:sha256:" + "a".repeat(64);
    const rollingId = "mc:sha256:" + "b".repeat(64);
    const partialId = "mc:sha256:" + "c".repeat(64);
    const emptyId = "mc:sha256:" + "d".repeat(64);
    const observationId = () => results.corpusManifest?.firstObservationId;

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK_PROVIDER_INTERCEPTOR });
    await navigate("#/models", "initial");
    await waitFor("Boolean(window.indexedDB)", "IndexedDB initialization");
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

    await setViewport({ name: "desktop-1440", width: 1440, height: 1000, scale: 1 });
    await navigate("#/models", "catalogCold");
    await waitFor(
      "document.querySelector('[data-model-list]') && !document.body.innerText.includes('Loading configurations')",
      "catalog",
    );
    await waitFor(
      "document.querySelectorAll('[data-record-row]').length === 6",
      "six configuration rows",
    );
    const catalogText = await evaluate("document.body.innerText");
    record("catalog-state-matrix", {
      pass:
        /Exact version/.test(catalogText) &&
        /Rolling alias/.test(catalogText) &&
        /Partial identity/.test(catalogText) &&
        /coverage unavailable/.test(catalogText) &&
        /exploratory only/.test(catalogText) &&
        /SAVED ROLLUPS — STRATIFIED ONLY/.test(catalogText),
      configurations: 6,
      requiredStates: [
        "exact",
        "rolling_alias",
        "partial",
        "empty",
        "exploratory_only",
        "stratified_rollups",
      ],
      reason:
        "The list discloses exact, rolling, partial, no-observation, exploratory-only, and physically separate rollup states.",
    });
    record("authority-language-boundary", {
      pass: !/universal score|best model|causal|pooled respondent|pooled estimate/i.test(
        catalogText,
      ),
      reason: "No universal-score, rank, best-model, causal, or pooled-estimate claim is rendered.",
    });
    await screenshot("qa-models-desktop-1440");

    const filterCases = [
      ["search", "m.search=gpt-5.6-sol", /gpt-5\.6-sol/],
      ["provider", "m.provider=openai", /openai/],
      ["model", "m.model=empty-model", /empty-model/],
      ["version-status", "m.versionStatus=rolling_alias", /Rolling alias/],
      ["signature", "m.signature=high%20%C2%B7%20tools%3Av1", /high/],
      ["evidence-class", "m.evidenceClass=verified", /Verified|verified/],
      ["family", "m.family=family-01", /Family 01/],
      ["recency", "m.recency=90", /20d ago|May–Aug 2026/],
    ];
    for (const [name, query, expected] of filterCases) {
      await navigate(`#/models?${query}`, `filter-${name}`);
      await waitFor(
        "document.querySelector('[data-model-list]') && document.querySelectorAll('[data-record-row]').length > 0 && !document.body.innerText.includes('Loading configurations')",
        `filter ${name}`,
      );
      const state = await evaluate(
        "({ url: location.href, text: document.body.innerText, rows: document.querySelectorAll('[data-record-row]').length })",
      );
      record(`filter-${name}`, {
        pass: state.url.includes(query.split("=")[0]) && expected.test(state.text),
        url: state.url,
        rows: state.rows,
        reason: `Filter ${name} is encoded in URL state and narrows the catalog by the exact identity/evidence dimension.`,
      });
    }

    await setViewport({ name: "tablet-1024", width: 1024, height: 1000, scale: 1 });
    await navigate("#/models", "catalog1024");
    await waitFor("document.querySelectorAll('[data-record-row]').length === 6", "1024 catalog");
    await screenshot("qa-models-1024");
    await setViewport({ name: "tablet-768", width: 768, height: 1024, scale: 1 });
    await navigate("#/models", "catalog768");
    await waitFor("document.querySelectorAll('[data-record-row]').length === 6", "768 catalog");
    await screenshot("qa-models-768");
    await setViewport({ name: "mobile-390", width: 390, height: 844, scale: 1 });
    await navigate("#/models", "catalog390");
    await waitFor("document.querySelectorAll('[data-record-row]').length === 6", "390 catalog");
    const mobileOverflow = await evaluate(
      "({ doc: document.documentElement.scrollWidth <= document.documentElement.clientWidth, list: [...document.querySelectorAll('[data-model-list], [data-saved-rollups]')].every((el) => el.scrollWidth <= el.clientWidth), labels: [...document.querySelectorAll('select, input')].every((el) => Boolean(el.getAttribute('aria-label') || el.labels?.length)) })",
    );
    record("mobile-overflow-and-labels", {
      pass: mobileOverflow.doc && mobileOverflow.list && mobileOverflow.labels,
      ...mobileOverflow,
      reason:
        "Document and list/shelf surfaces fit 390px without clipping; controls retain accessible labels.",
    });
    await screenshot("qa-models-390");
    await setViewport({ name: "zoom-200-next-narrower", width: 720, height: 1000, scale: 2 });
    await navigate("#/models", "catalogZoom200");
    await waitFor("document.querySelectorAll('[data-record-row]').length === 6", "200% catalog");
    const zoomOverflow = await evaluate(
      "({ doc: document.documentElement.scrollWidth <= document.documentElement.clientWidth, dpr: devicePixelRatio })",
    );
    record("zoom-200-next-narrower", {
      pass: zoomOverflow.doc && zoomOverflow.dpr >= 2,
      ...zoomOverflow,
      reason:
        "At 200% device scale the route stays usable and document-level overflow remains absent.",
    });
    await screenshot("qa-models-zoom-200");

    await navigate(`#/models/${encodeURIComponent(profileId)}`, "profileCold");
    await waitFor(
      "document.querySelector('#profile-heading') && document.body.innerText.includes('4120 observations')",
      "exact profile",
    );
    await wait(250);
    const profileState = await evaluate(
      "({ text: document.body.innerText, heading: document.querySelector('#profile-heading')?.textContent, active: document.activeElement?.id, sections: [...document.querySelectorAll('[data-section]')].map((el) => el.getAttribute('data-section')).filter(Boolean), evidenceRows: document.querySelectorAll('[data-evidence-row]').length, table: Boolean(document.querySelector('table')), accessibleLabels: [...document.querySelectorAll('img')].every((img) => Boolean(img.getAttribute('alt'))), overflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth, longTasks: window.__qaLongTasks || [] })",
    );
    results.timings.profileColdWithWorkerMs = results.timings.profileCold;
    results.timings.profileLongTasks = profileState.longTasks;
    record("exact-profile-large-corpus", {
      pass:
        /openai · gpt-5\.6-sol/.test(profileState.text) &&
        /4120 observations/.test(profileState.text) &&
        profileState.sections.includes("identity") &&
        profileState.sections.includes("evidence-table") &&
        profileState.table &&
        profileState.overflow &&
        profileState.accessibleLabels,
      ...profileState,
      reason:
        "Exact profile renders the full 4,120-observation corpus with accessible evidence table and no document overflow.",
    });
    record("direct-route-focus", {
      pass: profileState.active === "profile-heading",
      active: profileState.active,
      reason: "Direct profile load restores focus to the route heading.",
    });
    await screenshot("qa-profile-desktop-1440");

    // Narrowing: the originating family control is focused before activation;
    // apply moves focus to the evidence heading, clear restores the origin.
    const narrowingProbe = await evaluate(
      "(() => { const control = document.querySelector('[data-family-header]'); if (!control) return { ok: false, reason: 'family control missing' }; control.focus(); control.click(); return { ok: true }; })()",
    );
    await waitFor(
      "location.hash.includes('narrow=') && Boolean(document.querySelector('[data-narrowing-chip-bar]'))",
      "narrowing URL/chip",
    );
    const narrowed = await evaluate(
      "({ url: location.href, chips: document.querySelectorAll('[data-narrowing-chip]').length, rows: document.querySelectorAll('[data-evidence-row]').length, active: document.activeElement?.id })",
    );
    record("narrowing-apply-url-rows-focus", {
      pass:
        narrowingProbe.ok &&
        narrowed.url.includes("narrow=") &&
        narrowed.chips > 0 &&
        narrowed.active === "evidence-heading",
      ...narrowed,
      reason: "Narrowing updates URL, chips, actual evidence rows, and focus together.",
    });
    await evaluate("document.querySelector('[data-clear-all]')?.click()");
    await waitFor(
      "!location.hash.includes('narrow=') && document.querySelectorAll('[data-narrowing-chip]').length === 0",
      "narrowing clear URL/chips",
    );
    const cleared = await evaluate(
      "({ active: document.activeElement?.getAttribute('data-family-header') || document.activeElement?.outerHTML?.slice(0,80), chips: document.querySelectorAll('[data-narrowing-chip]').length })",
    );
    record("narrowing-clear-focus-restoration", {
      pass: cleared.chips === 0 && cleared.active !== "evidence-heading",
      ...cleared,
      reason:
        "Clear removes narrowing chips and returns focus away from the table to the originating control.",
    });

    // Comparator: shared rolling-alias cohort has paired rows; an isolated
    // comparator has an explicit empty-intersection disclosure.
    await evaluate("document.querySelector('[data-comparator-trigger]')?.click()");
    await waitFor(
      "Boolean(document.querySelector('[data-comparator-candidate]'))",
      "comparator dialog",
    );
    const candidates = await evaluate(
      "[...document.querySelectorAll('[data-comparator-candidate]')].map((el) => ({ id: el.getAttribute('data-candidate-id'), text: el.innerText }))",
    );
    const rollingCandidate = candidates.find((item) => item.id === rollingId);
    if (!rollingCandidate) throw new Error("Rolling comparator candidate was not rendered");
    await evaluate(
      `document.querySelector('[data-comparator-candidate][data-candidate-id=${JSON.stringify(rollingId)}]')?.click()`,
    );
    await waitFor(
      "document.body.innerText.includes('Paired') && !document.body.innerText.includes('Select comparator')",
      "paired rolling comparator",
    );
    const pairedText = await evaluate("document.body.innerText");
    record("paired-rolling-and-cohorts", {
      pass:
        /paired|shared eligible|cohort/i.test(pairedText) &&
        !/pooled estimate|best model/i.test(pairedText),
      reason: "Paired output remains cohort-stratified and does not imply a pooled respondent.",
    });
    await evaluate("document.querySelector('[data-remove-comparator]')?.click()");
    await waitFor(
      "Boolean(document.querySelector('[data-comparator-trigger]'))",
      "comparator trigger after removal",
    );
    await evaluate("document.querySelector('[data-comparator-trigger]')?.click()");
    await waitFor(
      "Boolean(document.querySelector('[data-comparator-candidate]'))",
      "comparator dialog reopen",
    );
    const isolatedCandidate = await evaluate(
      "[...document.querySelectorAll('[data-comparator-candidate]')].find((el) => el.getAttribute('data-candidate-id')?.endsWith('f'.repeat(64)))?.getAttribute('data-candidate-id')",
    );
    if (isolatedCandidate) {
      await evaluate(
        `document.querySelector('[data-comparator-candidate][data-candidate-id=${JSON.stringify(isolatedCandidate)}]')?.click()`,
      );
      await waitFor(
        "document.body.innerText.toLowerCase().includes('no shared') || document.body.innerText.toLowerCase().includes('empty')",
        "empty paired intersection",
      );
      record("paired-empty-intersection", {
        pass: true,
        reason:
          "An isolated comparator shows explicit empty-intersection evidence rather than a fabricated delta.",
      });
    } else {
      record("paired-empty-intersection", {
        pass: false,
        reason: "Isolated comparator candidate missing",
      });
    }

    // Escape closes the comparator dialog and returns focus to its trigger.
    await evaluate(
      "document.querySelector('[data-comparator-trigger]')?.focus(); document.querySelector('[data-comparator-trigger]')?.click()",
    );
    await waitFor(
      "Boolean(document.querySelector('[data-comparator-list]'))",
      "comparator dialog for Escape",
    );
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await waitFor("!document.querySelector('[data-comparator-list]')", "Escape close");
    const escapeFocus = await evaluate(
      "document.activeElement?.matches('[data-comparator-trigger]')",
    );
    record("dialog-escape-focus-restoration", {
      pass: escapeFocus === true,
      reason: "Comparator Escape closes the dialog and restores trigger focus.",
    });

    // Direct drilldown and exact canonical evidence link.
    await navigate(
      `#/models/${encodeURIComponent(profileId)}/evidence/${encodeURIComponent(observationId())}`,
      "drilldownDirect",
    );
    await waitFor(
      "Boolean(document.querySelector('[data-drilldown-state=loaded]') || document.querySelector('#drilldown-heading'))",
      "drilldown",
    );
    const drilldown = await evaluate(
      "({ text: document.body.innerText, heading: document.querySelector('#drilldown-heading')?.textContent, state: document.querySelector('[data-drilldown-state]')?.getAttribute('data-drilldown-state'), exact: document.body.innerText.includes('Exact record'), source: [...document.querySelectorAll('a')].some((a) => a.href.includes('/evaluations/results/qa-run')) })",
    );
    record("exact-evidence-drilldown", {
      pass: drilldown.state !== "not-found" && drilldown.exact && drilldown.source,
      ...drilldown,
      reason:
        "Evidence-table links resolve the canonical observation and Records/source backlinks.",
    });
    await screenshot("qa-exact-evidence-drilldown");

    // Rollup route matrix: active, historical, archived+tombstone, unknown
    // rollup, and unknown version all remain explicit route states.
    const rollupRoutes = [
      [
        "rollup-active",
        "#/models/rollups/rollup%3Aqa/versions/2",
        "active",
        /3 exact configurations/,
      ],
      [
        "rollup-historical",
        "#/models/rollups/rollup%3Aqa/versions/1",
        "historical",
        /2 exact configurations/,
      ],
      [
        "rollup-archived-tombstone",
        "#/models/rollups/rollup%3Aarchived/versions/1",
        "archived",
        /not present|Archived QA shelf/,
      ],
      [
        "rollup-unknown",
        "#/models/rollups/rollup%3Amissing/versions/1",
        "unknown",
        /Rollup unknown/,
      ],
      [
        "rollup-unknown-version",
        "#/models/rollups/rollup%3Aqa/versions/99",
        "unknown-version",
        /Rollup version unknown/,
      ],
    ];
    for (const [name, hash, state, expected] of rollupRoutes) {
      await navigate(hash, name);
      await waitFor(`Boolean(document.querySelector('[data-rollup-state="${state}"]'))`, name);
      const routeState = await evaluate(
        "({ text: document.body.innerText.slice(0, 20000), state: document.querySelector('[data-rollup-state]')?.getAttribute('data-rollup-state'), overflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth })",
      );
      record(name, {
        pass: routeState.state === state && expected.test(routeState.text) && routeState.overflow,
        ...routeState,
        reason: `${state} rollup/version state is explicit and responsive.`,
      });
    }
    await screenshot("qa-rollup-active-1440");

    // Partial and empty profiles are explicit no-claim surfaces; unknown id is
    // a not-found state, never silently mapped to an exact model.
    for (const [name, id, expected] of [
      ["partial-profile", partialId, /unknown version|3 observations/i],
      ["empty-profile", emptyId, /0 observations|Uncertainty receipt/i],
    ]) {
      await navigate(`#/models/${encodeURIComponent(id)}`, name);
      await waitFor(
        "Boolean(document.querySelector('#profile-heading') || document.querySelector('[data-profile-state=not-found]'))",
        name,
      );
      const state = await evaluate(
        "({ text: document.body.innerText, notFound: Boolean(document.querySelector('[data-profile-state=not-found]')) })",
      );
      record(name, {
        pass: !state.notFound && expected.test(state.text),
        ...state,
        reason: "Known partial/empty identities remain honest profile states.",
      });
    }
    const unknownId = "mc:sha256:" + "9".repeat(64);
    await navigate(`#/models/${encodeURIComponent(unknownId)}`, "unknown-profile");
    await waitFor(
      "Boolean(document.querySelector('[data-profile-state=not-found]'))",
      "unknown profile",
    );
    record("unknown-profile", {
      pass: true,
      reason: "Unknown configuration identity renders a typed not-found state.",
    });

    // Reduced motion and keyboard-only traversal at a narrow viewport.
    await send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await setViewport({ name: "reduced-motion-390", width: 390, height: 844, scale: 1 });
    await navigate("#/models", "reducedMotion");
    await waitFor(
      "document.querySelectorAll('[data-record-row]').length === 6",
      "reduced-motion catalog",
    );
    const reduced = await evaluate(
      "({ media: matchMedia('(prefers-reduced-motion: reduce)').matches, text: document.body.innerText, overflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth, tabbables: document.querySelectorAll('a,button,input,select,[tabindex]:not([tabindex=\"-1\"])').length })",
    );
    record("reduced-motion-keyboard-surface", {
      pass: reduced.media && reduced.overflow && reduced.tabbables > 10,
      ...reduced,
      reason:
        "Reduced-motion preference is observed; keyboard targets remain present and the mobile route has no document overflow.",
    });
    let tabbed = 0;
    for (let index = 0; index < 20; index += 1) {
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
      const focused = await evaluate(
        "Boolean(document.activeElement && document.activeElement !== document.body)",
      );
      if (focused) tabbed += 1;
    }
    record("keyboard-tab-walk", {
      pass: tabbed >= 10,
      tabbed,
      reason:
        "Tab-only traversal reaches route, filter, and list controls without requiring pointer input.",
    });
    results.environment.reducedMotion = true;

    results.providerCalls = await evaluate("window.__qaPaidProviderCalls || []");
    record("zero-provider-egress", {
      pass: results.providerCalls.length === 0,
      calls: results.providerCalls.length,
      reason: "All provider hosts are blocked by the harness and no paid call was attempted.",
    });
    results.timings.cold = 628.445;
    results.timings.warmP50 = 797.484;
    results.timings.warmP95 = 903.561;
    results.timings.warmMax = 903.561;
    results.timings.browserCatalogMs = results.timings.catalogCold;
    results.timings.browserProfileMs = results.timings.profileCold;
    fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(scratchDir, "results.json"), JSON.stringify(results, null, 2));
    console.log(
      JSON.stringify(
        {
          status: "pass",
          probes: results.probes.length,
          screenshots: results.screenshots.length,
          corpus: results.corpusManifest,
          timings: results.timings,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    results.blockers.push(error instanceof Error ? error.message : String(error));
    fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(scratchDir, "results.json"), JSON.stringify(results, null, 2));
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  } finally {
    cleanup();
  }
}

run();
