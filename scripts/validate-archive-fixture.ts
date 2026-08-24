// One-off validation for the PulseFit fixtures: the Workbench Archive (backup/
// restore path) and the suite package (content-authoring import path). Both are
// parsed, imported into a fresh database, read back, and re-imported to check
// identity semantics (archive skips; suite package creates new).
// Section 3 validates the Archive v3 Research Lab cutover (REV-1).
// Run: npx tsx scripts/validate-archive-fixture.ts
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import {
  parseWorkbenchArchive,
  importWorkbenchArchive,
  exportWorkbenchArchiveV3,
  previewWorkbenchArchive,
  commitPreviewWorkbenchArchiveV3,
} from "../src/lib/persistence/archive";
import { validateSuiteForExecution } from "../src/lib/evaluations/suite-validation";
import { RSembleEvaluationDB } from "../src/lib/persistence/database";
import { normalizeSuitePackage, parseSuitePackage } from "../src/lib/evaluations/suite-package";
import { importSuitePackage } from "../src/lib/persistence/suite-package-import";
import { seedCompleteV3Corpus } from "../src/lib/persistence/archive-v3-fixtures";
import {
  validateArchiveV3,
  ARCHIVE_V3_FORMAT_VERSION,
} from "../src/lib/persistence/archive-v3-types";

// --- 1. Workbench Archive (backup/restore) -------------------------------------------------
{
  const raw = JSON.parse(
    readFileSync("docs/evaluations/pulsefit-business-analytics.archive.json", "utf8"),
  );
  const parsed = parseWorkbenchArchive(raw);
  if (!parsed.ok) {
    console.error("ARCHIVE PARSE FAILED:", parsed.errors);
    process.exit(1);
  }
  const suite = parsed.archive.suites[0];
  const gate = validateSuiteForExecution(suite);
  console.log(
    `archive parse: OK — ${suite.tasks.length} tasks, ${suite.modelSlots.filter((s) => s.enabled).length} enabled slots · execution gate ${gate.valid ? "PASS" : "FAIL"}`,
  );
  if (!gate.valid) process.exit(1);

  const db = new RSembleEvaluationDB(`fixture-archive-${crypto.randomUUID()}`);
  const result = await importWorkbenchArchive(db, parsed.archive);
  const second = await importWorkbenchArchive(db, parsed.archive);
  console.log(
    `archive import: created ${result.created.length} · re-import: skipped ${second.skipped.length} (identity-preserving)`,
  );
  if (result.created.length !== 3 || second.skipped.length !== 3) process.exit(1);
  db.close();
  await db.delete();
}

// --- 2. Suite package (content authoring — always creates new) ------------------------------
{
  const raw = JSON.parse(
    readFileSync("docs/evaluations/pulsefit-business-analytics.suite.json", "utf8"),
  );
  const parsed = parseSuitePackage(raw);
  if (!parsed.ok) {
    console.error("SUITE PACKAGE PARSE FAILED:", parsed.errors);
    process.exit(1);
  }

  const db = new RSembleEvaluationDB(`fixture-suite-${crypto.randomUUID()}`);
  const suiteRows = await db.suites.toArray();
  const profileRows = await db.profiles.toArray();
  const taken = new Set([...suiteRows.map((r) => r.id), ...profileRows.map((r) => r.id)]);
  const normalized = normalizeSuitePackage(parsed.pkg, {
    takenIds: taken,
    existingProfileIds: new Set(profileRows.map((r) => r.id)),
  });
  if (!normalized.ok) {
    console.error("SUITE PACKAGE NORMALIZE FAILED:", normalized.errors);
    process.exit(1);
  }
  const gate = validateSuiteForExecution(normalized.result.suite);
  console.log(
    `suite-package parse+normalize: OK — ${normalized.result.suite.tasks.length} tasks, ` +
      `${normalized.result.profiles.length} profile(s) · execution gate ${gate.valid ? "PASS" : "draft"}`,
  );

  const first = await importSuitePackage(db, normalized.result);
  const suiteRow = await db.suites.get(first.suiteId);
  const profileRow = await db.profileVersions.get([first.rubricIds[0], 1]);
  console.log(
    `suite-package import: suite ${suiteRow ? "PRESENT" : "MISSING"} · profile v1 ${profileRow ? "PRESENT" : "MISSING"}`,
  );
  if (!suiteRow || !profileRow) process.exit(1);

  // Re-import the same file: a SECOND suite is created (not skipped).
  const taken2 = new Set([...taken, first.suiteId, ...first.rubricIds]);
  const normalized2 = normalizeSuitePackage(parsed.pkg, {
    takenIds: taken2,
    existingProfileIds: new Set(profileRows.map((r) => r.id)),
  });
  if (!normalized2.ok) process.exit(1);
  const second = await importSuitePackage(db, normalized2.result);
  const suiteCount = (await db.suites.toArray()).length;
  console.log(
    `suite-package re-import: second suite created (${suiteCount} suites in db) · notes: ${normalized2.result.notes.length}`,
  );
  if (second.suiteId === first.suiteId || suiteCount !== 2) process.exit(1);
  db.close();
  await db.delete();
}

// --- 3. Workbench Archive v3 (Research Lab cutover — REV-1) --------------------------------
{
  const sourceDb = new RSembleEvaluationDB(`fixture-v3-source-${crypto.randomUUID()}`);
  await seedCompleteV3Corpus(sourceDb);

  const exported = await exportWorkbenchArchiveV3(sourceDb, { now: 1_700_000_000_000 });
  const gate = validateArchiveV3(exported);
  console.log(
    `archive v3 export: format v${exported.manifest.formatVersion} · ${Object.keys(exported.manifest.counts).length} collections · validation ${gate.valid ? "PASS" : "FAIL"}`,
  );
  if (!gate.valid || exported.manifest.formatVersion !== ARCHIVE_V3_FORMAT_VERSION) process.exit(1);

  const targetDb = new RSembleEvaluationDB(`fixture-v3-target-${crypto.randomUUID()}`);
  const preview = await previewWorkbenchArchive(targetDb, exported);
  const result = await commitPreviewWorkbenchArchiveV3(targetDb, preview);
  const reexported = await exportWorkbenchArchiveV3(targetDb, { now: 1_700_000_000_000 });

  const byteIdentical = JSON.stringify(reexported) === JSON.stringify(exported);
  console.log(
    `archive v3 import: created ${result.created.length} · re-export byte identity: ${byteIdentical ? "PASS" : "FAIL"}`,
  );
  if (!byteIdentical) process.exit(1);

  sourceDb.close();
  await sourceDb.delete();
  targetDb.close();
  await targetDb.delete();
}

console.log("fixture validation: ALL PASS");
