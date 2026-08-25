// Generic mechanical validation for suite-package fixtures (content-authoring
// import path). Each file is parsed with the structural guards, normalized
// with the real importer (rubric validation + record guards + id minting),
// and checked against the execution gate. Complements the PulseFit-specific
// validate-archive-fixture.ts.
// Run: npx tsx scripts/validate-suite-package.ts [files...]
//      (no args: validates every docs/evaluations/*.suite.json)
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { normalizeSuitePackage, parseSuitePackage } from "../src/lib/evaluations/suite-package";
import { validateSuiteForExecution } from "../src/lib/evaluations/suite-validation";

const args = process.argv.slice(2);
const files =
  args.length > 0
    ? args
    : readdirSync("docs/evaluations")
        .filter((f) => f.endsWith(".suite.json"))
        .map((f) => join("docs/evaluations", f));

let failed = false;
for (const file of files) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const parsed = parseSuitePackage(raw);
  if (!parsed.ok) {
    console.error(`${file}\n  PARSE FAILED:`, parsed.errors);
    failed = true;
    continue;
  }
  const normalized = normalizeSuitePackage(parsed.pkg, {
    takenIds: new Set(),
    existingRubricIds: new Set(),
  });
  if (!normalized.ok) {
    console.error(`${file}\n  NORMALIZE FAILED:`, normalized.errors);
    failed = true;
    continue;
  }
  const { suite, profiles, executionReady, notes } = normalized.result;
  const gate = validateSuiteForExecution(suite);
  console.log(
    `${file}\n  parse OK — "${parsed.pkg.name}": ${suite.tasks.length} tasks, ` +
      `${suite.modelSlots.filter((s) => s.enabled).length} enabled slots, ` +
      `${profiles.length} embedded rubric(s) ` +
      `(${profiles.map((p) => `${p.profile.criteria.length} criteria`).join(", ")})` +
      `\n  execution gate ${gate.valid ? "PASS" : "FAIL"}` +
      `${executionReady ? "" : ` — ${gate.errors[0]?.message ?? "not ready"}`}` +
      `${notes.length ? `\n  notes: ${notes.join(" · ")}` : ""}`,
  );
  if (!gate.valid) failed = true;
}
process.exit(failed ? 1 : 0);
