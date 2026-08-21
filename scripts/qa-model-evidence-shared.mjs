#!/usr/bin/env node
// =============================================================================
// qa-model-evidence-shared.mjs — shared harness pieces for the Child 07 Models
// browser QA scripts (dev-server QA and production-build QA).
//
// One source of truth for:
//  - the provider/egress interceptor (also installs the Worker construction
//    tracker and the long-task observer used by the performance gates);
//  - the deterministic 4,120-observation IndexedDB seed;
//  - small transport helpers (wait / pollReady).
// =============================================================================

import http from "node:http";

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function pollReady(port, host = "127.0.0.1", attempts = 120) {
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
        if (tries >= attempts) return reject(new Error(`Server never became ready on ${port}`));
        setTimeout(probe, 250);
      }
    };
    probe();
  });
}

// Provider and bridge calls are local-only in this harness. Paid hosts are
// rejected rather than mocked so a new egress path cannot silently pass.
//
// The interceptor also installs:
//  - a long-task PerformanceObserver feeding `window.__qaLongTasks` (the
//    performance gates reset this buffer immediately before the measured
//    interaction and FAIL when Child-07 statistical computation blocks the
//    main thread for more than 50ms);
//  - a `Worker` constructor wrapper feeding `window.__qaWorkers` so the QA can
//    prove that a real Worker was constructed for the profile/comparator
//    computation, that its script URL is a built `.js` asset in production,
//    and that cancellation/supersession really terminate it (no silent
//    synchronous fallback and no orphaned computation).
export const MOCK_PROVIDER_INTERCEPTOR = `(() => {
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
  window.__qaWorkers = [];
  try {
    const RealWorker = window.Worker;
    if (typeof RealWorker === 'function') {
      window.Worker = class extends RealWorker {
        constructor(url, options) {
          const entry = {
            url: String(url),
            options: options ? { type: options.type || null } : null,
            terminated: false,
            errors: [],
            createdAt: Date.now(),
          };
          window.__qaWorkers.push(entry);
          super(url, options);
          this.addEventListener('error', (event) => {
            entry.errors.push((event && event.message) || 'worker error');
          });
          const originalTerminate = this.terminate.bind(this);
          this.terminate = () => {
            entry.terminated = true;
            originalTerminate();
          };
        }
      };
    }
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
export const SEED_SOURCE = String.raw`(async () => {
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
  const archivedRecord = { id: 'rollup:archived', name: archivedVersion.name, latestVersion: 1, revision: 1, createdAt: now - 70000, updatedAt: archivedVersion.createdAt, archivedAt: now - 1000 };
  await put(namesToStore.modelRollups, { id: archivedRecord.id, record: archivedRecord, name: archivedRecord.name, latestVersion: 1, revision: 1, createdAt: archivedRecord.createdAt, updatedAt: archivedRecord.updatedAt, archivedAt: archivedRecord.archivedAt });
  await put(namesToStore.modelRollupVersions, { rollupId: archivedVersion.rollupId, version: archivedVersion.version, version_: archivedVersion, memberManifestDigest: archivedVersion.memberManifestDigest, createdAt: archivedVersion.createdAt });
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  db.close();
  return { configurations: configs.length, taskFamilies: families.length, tasks: 400, observations: observationCount, exactSubjectObservations: 4120, rollupRecords: 2, rollupVersions: 3, firstObservationId, tombstoneId };
})()`;
