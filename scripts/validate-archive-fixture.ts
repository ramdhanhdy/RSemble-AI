// One-off validation: parse the PulseFit archive fixture through the real
// import parser, execute the full import into a fresh database, and check
// the execution gate. Run: npx tsx scripts/validate-archive-fixture.ts
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { parseWorkbenchArchive, importWorkbenchArchive } from "../src/lib/persistence/archive";
import { validateSuiteForExecution } from "../src/lib/evaluations/suite-validation";
import { RSembleEvaluationDB } from "../src/lib/persistence/database";

const raw = JSON.parse(
  readFileSync("docs/evaluations/pulsefit-business-analytics.archive.json", "utf8"),
);
const parsed = parseWorkbenchArchive(raw);
if (!parsed.ok) {
  console.error("PARSE FAILED:", parsed.errors);
  process.exit(1);
}
const suite = parsed.archive.suites[0];
const gate = validateSuiteForExecution(suite);
console.log(
  `parse: OK — ${parsed.archive.suites.length} suite, ` +
    `${parsed.archive.profiles.versions.length} profile version, ` +
    `${suite.tasks.length} tasks, ${suite.modelSlots.filter((s) => s.enabled).length} enabled slots`,
);
console.log("execution gate:", gate.valid ? "PASS" : `FAIL ${JSON.stringify(gate.errors)}`);
console.log(
  "profile criteria:",
  parsed.archive.profiles.versions[0].criteria.map((c) => `${c.id}(w${c.weight})`).join(", "),
);
if (!gate.valid) process.exit(1);

// Full end-to-end import into a fresh database, then read back.
const db = new RSembleEvaluationDB(`fixture-check-${crypto.randomUUID()}`);
const result = await importWorkbenchArchive(db, parsed.archive);
console.log(`import: created ${result.created.length}, skipped ${result.skipped.length}, conflicting ${result.conflicting.length}`);
const suiteRow = await db.suites.get(suite.id);
const profileRow = await db.profileVersions.get(["profile-biz-analytics", 1]);
console.log("read-back: suite", suiteRow ? "PRESENT" : "MISSING", "· profile v1", profileRow ? "PRESENT" : "MISSING");
if (!suiteRow || !profileRow || result.conflicting.length > 0) process.exit(1);
// A second import must skip, not duplicate.
const second = await importWorkbenchArchive(db, parsed.archive);
console.log(`re-import: created ${second.created.length}, skipped ${second.skipped.length}`);
db.close();
await db.delete();
