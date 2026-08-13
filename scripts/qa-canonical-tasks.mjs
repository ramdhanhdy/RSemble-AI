// =============================================================================
// RSemble AI — Canonical Tasks automated closure gate (Child 02, Task 11A)
//
// `node scripts/qa-canonical-tasks.mjs`
//
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
// =============================================================================

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GATE_NAME = "qa-canonical-tasks";

// --- Closure check (run under tsx) -------------------------------------------
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

// --- Launcher ----------------------------------------------------------------

function main() {
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
    process.stdout.write(`\n${GATE_NAME}: PASS — Child 02 archive/repository closure invariants hold.\n`);
  } else {
    process.stderr.write(`\n${GATE_NAME}: FAIL — closure invariants did not hold (exit ${exitCode}).\n`);
  }
  process.exit(exitCode);
}

main();
