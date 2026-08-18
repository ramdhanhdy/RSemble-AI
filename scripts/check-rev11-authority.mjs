#!/usr/bin/env node
/**
 * REV-11 authority/document consistency checker.
 *
 * Deterministic golden-list grep script: asserts that the CORRECT
 * (reconciled) statements are present in the program authority files.
 *
 * At HEAD before T13c GREEN the drifted (wrong) statements are still in
 * place, so the golden statements are absent and this script FAILS —
 * proving the authority tables disagree with shipped reality.
 * After T13c GREEN the reconciled statements are written and the script
 * PASSES.
 *
 * Run:  node scripts/check-rev11-authority.mjs
 * Exit: 0 = all golden statements present; 1 = drift detected (missing).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

const SPEC =
  "docs/specs/pending/task-first-evidence-workbench/task-first-evidence-workbench-spec.md";
const README = "docs/specs/pending/task-first-evidence-workbench/README.md";
const SPECS_README = "docs/specs/README.md";
const PRODUCT = "PRODUCT.md";

/**
 * Each assertion: { file, label, test }.
 * `test` returns true when the GOLDEN (correct) statement is present.
 */
const assertions = [
  // ── 1. Child statuses (program README) ──────────────────────────
  {
    file: README,
    label: "README child 03 row is Shipped (not Pending)",
    test: (t) => /^\| 03 \|.*\| Shipped/im.test(t),
  },
  {
    file: README,
    label: "README child 06 row is In progress (not Pending)",
    test: (t) => /^\| 06 \|.*\| In progress/im.test(t),
  },

  // ── 2. Parent §15 numbering + statuses ───────────────────────────
  {
    file: SPEC,
    label: "§15 row 06 is Research Lab / Policy Studies (not Model Profiles)",
    test: (t) => /^\| 06 Research Lab/im.test(t),
  },
  {
    file: SPEC,
    label: "§15 row 07 is Model evidence profiles",
    test: (t) => /^\| 07 Model evidence profiles/im.test(t),
  },
  {
    file: SPEC,
    label: "§15 row 08 is Shell / Records",
    test: (t) => /^\| 08 Shell \/ Records/im.test(t),
  },
  {
    file: SPEC,
    label: "§15 row 09 is Attention",
    test: (t) => /^\| 09 Attention/im.test(t),
  },
  {
    file: SPEC,
    label: "§15 row 10 is Hardening (program has ten children)",
    test: (t) => /^\| 10 Hardening/im.test(t),
  },
  {
    file: SPEC,
    label: "§15 row 02 status is Archived (not Pending)",
    test: (t) => /^\| 02 Tasks \|.*\| Archived/im.test(t),
  },
  {
    file: SPEC,
    label: "§15 row 03 status is Shipped (not Pending)",
    test: (t) => /^\| 03 Task Sets\/Evaluations \|.*Shipped/im.test(t),
  },
  {
    file: SPEC,
    label: "§15 row 04 status is Shipped (not Pending)",
    test: (t) => /^\| 04 Observations\/Evidence \|.*Shipped/im.test(t),
  },
  {
    file: SPEC,
    label: "§15 row 05 status is Shipped (not Pending)",
    test: (t) => /^\| 05 Compare Results \|.*Shipped/im.test(t),
  },
  {
    file: SPEC,
    label: "§15 row 06 status is In progress (not Pending)",
    test: (t) => /^\| 06 Research Lab.*\| In progress/im.test(t),
  },

  // ── 3. Topology: current-vs-target distinction ───────────────────
  {
    file: SPEC,
    label: "§4.1 target primary nav includes Lab: Compare · Evaluations · Lab · Models",
    test: (t) => t.includes("Compare · Evaluations · Lab · Models"),
  },
  {
    file: SPEC,
    label: "§4.1 distinguishes current state after Child 06",
    test: (t) => /Current state.*after Child 06/i.test(t),
  },
  {
    file: SPEC,
    label: "P03 target primary nav includes Lab",
    test: (t) => /P03 \| Primary navigation becomes Compare · Evaluations · Lab · Models/.test(t),
  },

  // ── 4. Sibling references use new numbering ──────────────────────
  {
    file: SPEC,
    label: "§11.5 references child 10 (not only child 09) for hardening",
    test: (t) => /child 10/i.test(t),
  },
  {
    file: SPEC,
    label: "§14.2 references child 10 (not child 09) for invariant suite",
    test: (t) => /Child 10 must create or consolidate/i.test(t),
  },
  {
    file: SPEC,
    label: "§18 says ten children (not nine)",
    test: (t) => /all ten children are archived/i.test(t),
  },

  // ── 5. specs/README.md no longer claims 03–10 all pending ────────
  {
    file: SPECS_README,
    label: "specs/README no longer says 'Children 03–10 remain pending'",
    test: (t) => !t.includes("Children 03–10 remain pending"),
  },
  {
    file: SPECS_README,
    label: "specs/README acknowledges Children 03–05 shipped",
    test: (t) => /03.{0,3}05.*[Ss]hipped/.test(t),
  },

  // ── 6. PRODUCT.md reconciled note ────────────────────────────────
  {
    file: PRODUCT,
    label: "PRODUCT.md has Reconciled (Child 06) note",
    test: (t) => /Reconciled \(Child 06/.test(t),
  },
];

let failures = 0;
const cache = new Map();

for (const a of assertions) {
  let text = cache.get(a.file);
  if (text === undefined) {
    text = read(a.file);
    cache.set(a.file, text);
  }
  const ok = a.test(text);
  const status = ok ? "PASS" : "FAIL";
  console.log(`[${status}] ${a.file}: ${a.label}`);
  if (!ok) failures++;
}

console.log("");
if (failures === 0) {
  console.log("REV-11 authority consistency: all golden statements present.");
  process.exit(0);
} else {
  console.log(
    `REV-11 authority consistency: ${failures} drift(s) detected — authority tables disagree with shipped reality.`,
  );
  process.exit(1);
}
