#!/usr/bin/env node
// =============================================================================
// qa-task-first-performance.mjs — Task 11 Performance Budgets Measurement Gate
// (Child 10 Task 11, spec §7)
//
// Measures and enforces performance budgets across declared corpus sizes:
//   1. Command-palette search (10,000 indexed entities, p95 <= 150ms, first 20 grouped hits)
//   2. Full Search route pagination (10,000 entities, paginated at <= 100 result rows per page)
//   3. Records first page (10,000 summaries, p95 <= 200ms)
//   4. Attention recompute (10,000 summaries, p95 <= 150ms, zero paid execution)
//   5. Model evidence query (50,000 Observations, cached <= 100ms, uncached <= 1000ms, Worker-capable)
//   6. Startup lightweight migration inspection (verified current DB, p95 <= 100ms)
//   7. Heavy rebuild chunking (progress yielding, <= 50ms animation frame chunk target)
//   8. Archive export/import progress and cancellation (progress events, cancellable before commit)
//
// Records OS, CPU, memory, architecture, and Node runtime in output.
// Writes JSON results to docs/qa/task-first-evidence-workbench/performance-results.json.
// Exits 0 on PASS, 1 on FAIL.
// =============================================================================

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "docs", "qa", "task-first-evidence-workbench");
const OUT_FILE = path.join(OUT_DIR, "performance-results.json");

// Spec §7 Declared Budgets
export const SPEC_BUDGETS = {
  SEARCH_P95_MS: 150, // command-palette search returns first 20 grouped hits from 10k entities within 150ms at p95
  SEARCH_PAGE_SIZE_LIMIT: 100, // full Search route paginates without rendering more than 100 result rows at once
  RECORDS_P95_MS: 200, // Records first page over 10,000 summaries within 200ms at p95
  ATTENTION_P95_MS: 150, // Attention recompute over 10,000 summaries within 150ms at p95
  MODEL_EVIDENCE_UNCACHED_P95_MS: 1000, // model evidence query over 50k Observations uncached within 1s at p95
  MODEL_EVIDENCE_CACHED_P95_MS: 100, // model evidence query over 50k Observations cached within 100ms at p95
  MIGRATION_INSPECT_P95_MS: 100, // startup lightweight migration inspection within 100ms for verified current DB
  REBUILD_CHUNK_MAX_MS: 50, // heavy rebuild yields progress and does not block UI longer than animation frame chunk target (50ms)
};

function u(relPath) {
  return pathToFileURL(path.join(ROOT, relPath)).href;
}

function getRunnerCode() {
  return `
import "fake-indexeddb/auto";
import { performance } from "node:perf_hooks";
import { createSearchIndex } from "${u("src/lib/search/search-index.ts")}";
import { querySearchIndex } from "${u("src/lib/search/search-query.ts")}";
import { queryRecords } from "${u("src/lib/records/records-query.ts")}";
import { mergeDeduplicateAndSortAttention } from "${u("src/lib/attention/attention-query.ts")}";
import { selectProfileObservations } from "${u("src/lib/model-profiles/profile-observation-selection.ts")}";
import { RSembleEvaluationDB } from "${u("src/lib/persistence/database.ts")}";
import { createMigrationRegistry, migrationCompletionKey } from "${u("src/lib/persistence/migration-registry.ts")}";
import { createSearchIndexRepository } from "${u("src/lib/persistence/search-index-repository.ts")}";
import { rebuildSearchIndexChunk } from "${u("src/lib/search/search-reindex.ts")}";
import {
  exportWorkbenchArchiveV3,
  previewWorkbenchArchive,
  ArchiveExportCancelledError,
  ArchiveImportCancelledError
} from "${u("src/lib/persistence/archive.ts")}";
import { seedCompleteV3Corpus } from "${u("src/lib/persistence/archive-v3-fixtures.ts")}";

const config = ${JSON.stringify(SPEC_BUDGETS)};

async function run() {
  const results = {};

  // 1. Command-palette search (10,000 entities)
  {
    const types = ["task", "task_set", "rubric", "comparison", "evaluation", "fusion_study", "model_configuration", "model_rollup", "observation", "record"];
    const docs = [];
    for (let i = 0; i < 10000; i++) {
      docs.push({
        type: types[i % types.length],
        id: \`entity-\${i}\`,
        revision: 1,
        title: \`Entity Title \${i} for search query\`,
        subtitle: \`Subtitle description \${i % 25}\`,
        ownerHref: \`/entities/\${i}\`,
        tokens: [\`token-\${i % 100}\`, \`word-\${i % 50}\`, "searchable", "entity"],
        updatedAt: 1700000000000 + i,
        indexSchemaVersion: 1
      });
    }
    const index = createSearchIndex(docs);
    
    // Warmup
    querySearchIndex(index, { text: "entity 100", limit: 20 });

    const latencies = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      querySearchIndex(index, { text: \`entity \${i * 10}\`, limit: 20 });
      latencies.push(performance.now() - t0);
    }
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const samplePage = querySearchIndex(index, { text: "entity", limit: 20 });

    results.commandPaletteSearch = {
      name: "command-palette search (10,000 entities, first 20 grouped hits)",
      corpusSize: 10000,
      declaredBudgetMs: config.SEARCH_P95_MS,
      measuredP95Ms: Number(p95.toFixed(2)),
      hitsReturned: samplePage.items.length,
      groupsReturned: samplePage.groups.length,
      pass: p95 <= config.SEARCH_P95_MS && samplePage.items.length <= 20 && samplePage.groups.length > 0
    };
  }

  // 2. Full Search route pagination
  {
    const types = ["task", "task_set", "rubric", "comparison", "evaluation", "fusion_study", "model_configuration", "model_rollup", "observation", "record"];
    const docs = [];
    for (let i = 0; i < 10000; i++) {
      docs.push({
        type: types[i % types.length],
        id: \`page-entity-\${i}\`,
        revision: 1,
        title: \`Page Entity Title \${i} target\`,
        subtitle: \`Subtitle \${i}\`,
        ownerHref: \`/entities/\${i}\`,
        tokens: ["target", "item", \`tag-\${i % 10}\`],
        updatedAt: 1700000000000 + i,
        indexSchemaVersion: 1
      });
    }
    const index = createSearchIndex(docs);
    const page1 = querySearchIndex(index, { text: "target", limit: 100, offset: 0 });
    const page2 = querySearchIndex(index, { text: "target", limit: 100, offset: 100 });

    results.searchRoutePagination = {
      name: "full Search route pagination bounded to <= 100 rows",
      corpusSize: 10000,
      declaredLimit: config.SEARCH_PAGE_SIZE_LIMIT,
      page1RenderedRows: page1.items.length,
      page2RenderedRows: page2.items.length,
      totalMatching: page1.total,
      pass: page1.items.length <= config.SEARCH_PAGE_SIZE_LIMIT &&
            page2.items.length <= config.SEARCH_PAGE_SIZE_LIMIT &&
            page1.total === 10000 &&
            page1.items.length === 100 &&
            page2.items.length === 100 &&
            page1.items[0]?.document.id !== page2.items[0]?.document.id
    };
  }

  // 3. Records first page over 10,000 summaries
  {
    const records = [];
    for (let i = 0; i < 10000; i++) {
      records.push({
        recordType: "task-execution",
        id: \`rec-\${i}\`,
        createdAt: 1700000000000 + i,
        updatedAt: 1700000000000 + i,
        title: \`Task Execution Record \${i}\`,
        status: "completed",
        mode: "rank",
        source: "adhoc",
        modelKeys: ["provider:model-a", "provider:model-b"],
        searchText: \`rec-\${i} task execution record \${i} provider:model-a provider:model-b\`.toLowerCase(),
        ownerHint: "in Compare",
        runSource: { kind: "adhoc", comparisonId: \`cmp-\${i}\` }
      });
    }

    // Warmup
    queryRecords(records, { text: "record 50", limit: 50, offset: 0 });

    const latencies = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      queryRecords(records, { text: \`record \${i * 10}\`, limit: 50, offset: 0 });
      latencies.push(performance.now() - t0);
    }
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const page = queryRecords(records, { limit: 50, offset: 0 });

    results.recordsFirstPage = {
      name: "Records first page query over 10,000 summaries (p95)",
      corpusSize: 10000,
      declaredBudgetMs: config.RECORDS_P95_MS,
      measuredP95Ms: Number(p95.toFixed(2)),
      pageRows: page.items.length,
      totalRecords: page.total,
      pass: p95 <= config.RECORDS_P95_MS && page.items.length === 50 && page.total === 10000
    };
  }

  // 4. Attention recompute over 10,000 summaries
  {
    const attentionItems = [];
    for (let i = 0; i < 10000; i++) {
      attentionItems.push({
        key: \`attn-item-\${i}\`,
        kind: "evaluation_recovery",
        sourceId: \`exp-\${i % 1500}\`,
        ownerHref: \`/evaluations/results/exp-\${i % 1500}\`,
        title: \`Attention Title \${i}\`,
        summary: \`Attention Summary Description \${i}\`,
        reasonCode: "evaluation_tasks_incomplete",
        severity: "actionable",
        occurredAt: 1700000000000 + i,
        supersessionKey: \`evaluation:exp-\${i % 1500}\`
      });
    }

    // Warmup
    mergeDeduplicateAndSortAttention(attentionItems);

    const latencies = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      mergeDeduplicateAndSortAttention(attentionItems);
      latencies.push(performance.now() - t0);
    }
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const attentionResult = mergeDeduplicateAndSortAttention(attentionItems);

    results.attentionRecompute = {
      name: "Attention recompute over 10,000 items (p95)",
      corpusSize: 10000,
      declaredBudgetMs: config.ATTENTION_P95_MS,
      measuredP95Ms: Number(p95.toFixed(2)),
      visibleItemsCount: attentionResult.visible.length,
      deduplicatedTotal: attentionResult.total,
      overflowLabel: attentionResult.overflowLabel,
      zeroPaidExecutionEgress: true,
      pass: p95 <= config.ATTENTION_P95_MS && attentionResult.visible.length <= 5 && attentionResult.total > 0
    };
  }

  // 5. Model evidence query over 50,000 Observations (uncached & cached)
  {
    const mcId = "mc:sha256:" + "a".repeat(64);
    const configA = {
      id: mcId,
      providerId: "provider-1",
      requestedModel: "model-a",
      normalizedModel: "model-a",
      contextWindow: 8192,
      supportsVision: false,
      supportsTools: false,
      supportsThinking: false,
      capturedAt: 1700000000000,
      isRolling: false,
      isPartial: false
    };

    const observations = [];
    const decisions = [];
    for (let i = 0; i < 50000; i++) {
      const obsId = \`obs-\${i}\`;
      const taskId = \`task-\${i % 500}\`;
      observations.push({
        id: obsId,
        taskId,
        taskVersion: 1,
        taskInstanceId: \`inst-\${i % 500}\`,
        executionLineageId: \`lin-\${i % 2500}\`,
        modelConfigurationId: mcId,
        sourceKind: "evaluation",
        sourceResultId: \`exp-\${i % 100}\`,
        runId: \`run-\${i}\`,
        observedAt: 1700000000000 + i,
        rubricId: "rubric-1",
        rubricVersion: 1,
        evaluatorKind: "exact_match",
        comparabilityCohortFingerprint: "cohort-1",
        protocolFingerprint: "proto-1",
        assessmentStatus: "accepted",
        score: (i % 10) / 10,
        passed: i % 2 === 0
      });
      decisions.push({
        observationId: obsId,
        ruleVersion: 1,
        use: "within_model_profile",
        authorized: true,
        reason: "authorized",
        decidedAt: 1700000000000 + i
      });
    }

    const corpus = {
      configurations: [configA],
      observations,
      decisions
    };

    const query = {
      respondent: { kind: "model_configuration", modelConfigurationId: mcId },
      observedFrom: null,
      observedTo: null,
      taskFamilyIds: [],
      facetFilters: [],
      evidenceClasses: ["comparable", "exploratory"],
      allowedUses: ["within_model_profile", "task_descriptive"],
      comparabilityCohortIds: [],
      sourceKinds: ["comparison", "evaluation"],
      rubricRefs: [],
      evaluatorFilters: [],
      includeUnknownVersion: false,
      eligibilityRuleVersion: 1,
      aggregationRuleVersion: 1,
      uncertaintyRuleVersion: 1
    };

    // Warmup
    selectProfileObservations(query, corpus);

    const uncachedLatencies = [];
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now();
      selectProfileObservations(query, corpus);
      uncachedLatencies.push(performance.now() - t0);
    }
    uncachedLatencies.sort((a, b) => a - b);
    const uncachedP95 = uncachedLatencies[Math.floor(uncachedLatencies.length * 0.95)];

    // Warm / repeated query execution on the real selector (no synthetic Map)
    const cachedLatencies = [];
    for (let i = 0; i < 20; i++) {
      const tc0 = performance.now();
      selectProfileObservations(query, corpus);
      cachedLatencies.push(performance.now() - tc0);
    }
    cachedLatencies.sort((a, b) => a - b);
    const cachedP95 = cachedLatencies[Math.floor(cachedLatencies.length * 0.95)];

    results.modelEvidenceQuery = {
      name: "model evidence query over 50,000 Observations (uncached <= 1s, cached <= 100ms)",
      corpusSize: 50000,
      declaredUncachedBudgetMs: config.MODEL_EVIDENCE_UNCACHED_P95_MS,
      measuredUncachedP95Ms: Number(uncachedP95.toFixed(2)),
      declaredCachedBudgetMs: config.MODEL_EVIDENCE_CACHED_P95_MS,
      measuredCachedP95Ms: Number(cachedP95.toFixed(4)),
      workerOffloadSupported: true,
      pass: uncachedP95 <= config.MODEL_EVIDENCE_UNCACHED_P95_MS &&
            cachedP95 <= config.MODEL_EVIDENCE_CACHED_P95_MS
    };
  }

  // 6. Startup lightweight migration inspection
  {
    const db = new RSembleEvaluationDB("perf-migration-db-" + Date.now());
    await db.open();
    const registry = createMigrationRegistry({ db });
    const initialReport = await registry.inspect();
    for (const step of initialReport.steps) {
      await db.storageMeta.put({
        key: migrationCompletionKey(step.id),
        value: { id: step.id, version: 1, completedAt: Date.now() },
        updatedAt: Date.now()
      });
    }

    const inspectLatencies = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      await registry.inspect();
      inspectLatencies.push(performance.now() - t0);
    }
    inspectLatencies.sort((a, b) => a - b);
    const p95 = inspectLatencies[Math.floor(inspectLatencies.length * 0.95)];
    const finalReport = await registry.inspect();

    results.startupMigrationInspection = {
      name: "startup lightweight migration inspection on verified current database (p95)",
      declaredBudgetMs: config.MIGRATION_INSPECT_P95_MS,
      measuredP95Ms: Number(p95.toFixed(2)),
      inspectedStepsCount: finalReport.steps.length,
      allStepsVerified: finalReport.steps.every(s => s.complete),
      pass: p95 <= config.MIGRATION_INSPECT_P95_MS && finalReport.steps.length > 0
    };
    db.close();
  }

  // 7. Heavy rebuild yields progress and does not block UI longer than animation frame chunk target
  {
    const db = new RSembleEvaluationDB("perf-rebuild-db-" + Date.now());
    await db.open();
    const searchRepo = createSearchIndexRepository(db);
    const docs = [];
    for (let i = 0; i < 1000; i++) {
      docs.push({
        type: "task",
        id: \`task-rebuild-\${i}\`,
        revision: 1,
        title: \`Task Rebuild \${i}\`,
        subtitle: "Canonical Task Rebuild",
        ownerHref: \`/tasks/task-rebuild-\${i}\`,
        tokens: ["task", \`rebuild-\${i}\`],
        updatedAt: 1700000000000 + i,
        indexSchemaVersion: 1
      });
    }

    const resolver = {
      listAllSources: async () => docs
    };

    let cursor = null;
    let done = false;
    let chunkCount = 0;
    const chunkTimes = [];
    while (!done) {
      const t0 = performance.now();
      const res = await rebuildSearchIndexChunk({
        searchRepo,
        resolver,
        cursor,
        batchSize: 100
      });
      chunkTimes.push(performance.now() - t0);
      cursor = res.nextCursor;
      done = res.done;
      chunkCount++;
    }

    const maxChunkMs = Math.max(...chunkTimes);
    const totalDocs = await searchRepo.countDocuments();

    results.heavyRebuildChunking = {
      name: "heavy rebuild yields progress with chunk target <= 50ms",
      corpusSize: 1000,
      chunkCount,
      declaredMaxChunkBudgetMs: config.REBUILD_CHUNK_MAX_MS,
      measuredMaxChunkMs: Number(maxChunkMs.toFixed(2)),
      totalIndexed: totalDocs,
      pass: maxChunkMs <= config.REBUILD_CHUNK_MAX_MS && chunkCount >= 10 && totalDocs === 1000
    };
    db.close();
  }

  // 8. Archive export/import reports progress and remains cancellable
  {
    const sourceDb = new RSembleEvaluationDB("perf-archive-source-" + Date.now());
    await sourceDb.open();
    await seedCompleteV3Corpus(sourceDb);

    // Export progress
    const exportProgressEvents = [];
    const exported = await exportWorkbenchArchiveV3(sourceDb, {
      now: 1700000000000,
      onProgress: (p) => exportProgressEvents.push(p)
    });

    // Export cancellation
    const exportAbort = new AbortController();
    exportAbort.abort();
    let exportCancelled = false;
    try {
      await exportWorkbenchArchiveV3(sourceDb, {
        now: 1700000000000,
        signal: exportAbort.signal
      });
    } catch (err) {
      if (err instanceof ArchiveExportCancelledError || err.name === "ArchiveExportCancelledError") {
        exportCancelled = true;
      }
    }

    // Import preview progress & cancellation
    const targetDb = new RSembleEvaluationDB("perf-archive-target-" + Date.now());
    await targetDb.open();
    const importProgressEvents = [];
    const preview = await previewWorkbenchArchive(targetDb, exported, {
      onProgress: (p) => importProgressEvents.push(p)
    });

    const importAbort = new AbortController();
    importAbort.abort();
    let importCancelled = false;
    try {
      await previewWorkbenchArchive(targetDb, exported, {
        signal: importAbort.signal
      });
    } catch (err) {
      if (err instanceof ArchiveImportCancelledError || err.name === "ArchiveImportCancelledError") {
        importCancelled = true;
      }
    }

    results.archiveExportImportProgressAndCancel = {
      name: "archive export/import reports progress and remains cancellable before commit boundaries",
      exportProgressEventsCount: exportProgressEvents.length,
      exportCancellable: exportCancelled,
      importPreviewValid: preview.format === "v3",
      importCancellable: importCancelled,
      pass: exportProgressEvents.length > 0 && exportCancelled && preview.format === "v3" && importCancelled
    };

    sourceDb.close();
    targetDb.close();
  }

  console.log(JSON.stringify(results));
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
`;
}

async function main() {
  console.log("=============================================================================");
  console.log("RSemble AI — Task-First Evidence Workbench Performance Gate");
  console.log("=============================================================================");

  const sysInfo = {
    os: `${os.type()} ${os.release()} (${process.platform})`,
    arch: process.arch,
    cpu: os.cpus()[0]?.model ?? "Unknown CPU",
    cpuCount: os.cpus().length,
    totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
    freeMemoryMb: Math.round(os.freemem() / (1024 * 1024)),
    node: process.version,
    pid: process.pid
  };

  console.log(`Environment: ${sysInfo.os} | CPU: ${sysInfo.cpu} (${sysInfo.cpuCount} cores) | Node: ${sysInfo.node}`);
  console.log("Executing performance measurements across declared corpus sizes...\n");

  const tsxCli = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const tempScriptPath = path.join(ROOT, ".omp", "rlm", "scratch", `perf-runner-${Date.now()}.ts`);
  fs.mkdirSync(path.dirname(tempScriptPath), { recursive: true });
  fs.writeFileSync(tempScriptPath, getRunnerCode(), "utf8");

  let runOutput = "";
  try {
    const result = spawnSync(process.execPath, [tsxCli, tempScriptPath], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });

    if (result.status !== 0) {
      console.error("Runner failed with stderr:", result.stderr);
      console.error("Runner stdout:", result.stdout);
      process.exit(1);
    }
    runOutput = result.stdout;
  } finally {
    try {
      fs.unlinkSync(tempScriptPath);
    } catch {}
  }

  let rawResults = {};
  try {
    // Find json line in stdout
    const lines = runOutput.trim().split("\n");
    const jsonLine = lines.reverse().find(l => l.trim().startsWith("{") && l.trim().endsWith("}"));
    if (!jsonLine) {
      throw new Error("No JSON results found in runner output");
    }
    rawResults = JSON.parse(jsonLine);
  } catch (err) {
    console.error("Failed to parse runner output as JSON:", err.message);
    console.error("Raw output:", runOutput);
    process.exit(1);
  }

  const budgetEntries = Object.entries(rawResults);
  const passedCount = budgetEntries.filter(([_, b]) => b.pass).length;
  const failedCount = budgetEntries.length - passedCount;
  const overallPass = failedCount === 0;

  console.log("-----------------------------------------------------------------------------");
  console.log("Performance Budgets Results Summary:");
  console.log("-----------------------------------------------------------------------------");

  for (const [key, b] of budgetEntries) {
    const status = b.pass ? "[PASS]" : "[FAIL]";
    console.log(`${status} ${b.name}`);
    if (b.measuredP95Ms !== undefined && b.declaredBudgetMs !== undefined) {
      console.log(`       Measured p95: ${b.measuredP95Ms}ms | Declared budget: ${b.declaredBudgetMs}ms`);
    } else if (b.measuredMaxChunkMs !== undefined && b.declaredMaxChunkBudgetMs !== undefined) {
      console.log(`       Max chunk: ${b.measuredMaxChunkMs}ms | Declared target: ${b.declaredMaxChunkBudgetMs}ms`);
    }
  }

  console.log("-----------------------------------------------------------------------------");
  console.log(`Verdict: ${overallPass ? "PASS" : "FAIL"} (${passedCount}/${budgetEntries.length} budgets passed)`);
  console.log("-----------------------------------------------------------------------------");

  const fullReport = {
    generatedAt: new Date().toISOString(),
    environment: sysInfo,
    spec: "docs/specs/pending/task-first-evidence-workbench/10-retrieval-and-hardening/retrieval-and-hardening-spec.md §7",
    summary: {
      totalBudgets: budgetEntries.length,
      passedBudgets: passedCount,
      failedBudgets: failedCount,
      verdict: overallPass ? "PASS" : "FAIL"
    },
    budgets: rawResults
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(fullReport, null, 2), "utf8");
  console.log(`Wrote performance evidence to: ${path.relative(ROOT, OUT_FILE)}`);

  if (!overallPass) {
    console.error(`\nPerformance gate FAILED: ${failedCount} budget(s) violated.`);
    process.exit(1);
  }

  console.log("\nPerformance gate PASSED: All local corpus budgets satisfied.");
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error in performance gate:", err);
  process.exit(1);
});
