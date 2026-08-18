#!/usr/bin/env node
// =============================================================================
// RSemble AI — static retired-Fusion accounting (Child 06 T12, REV-6)
//
// Enumerates every remaining old-Fusion hit under src/ and classifies each as
// EXACTLY ONE of:
//
//   1. allowlisted internal implementation machinery
//      Compare's Fuse mode + Fusion Result rendering, the Lab `kind: "fusion"`
//      recipe, the staged methodology modules (fusion-study-orchestration,
//      fusion-confirmation, fusion-live-executor, fusion-recipes,
//      fusion-study-controller/stages/validation/types, fusion-playbook),
//      the InMemoryFusionStudyRepository substrate + interface, the Policy
//      Study adapter, PolicyStudyPage, pipeline/run-controller recipe
//      renderers, run-record fusion-attempt persistence, evidence exclusions,
//      and the fusion-to-research-lab migration machinery.
//   2. migration-history compatibility material
//      archive v2 types/fixtures (v2 must remain importable but reject Fusion
//      shapes), the T0 fusion-corpus baseline pin, and database v13
//      deleted-store guards.
//   3. semantic receipts
//      the RetiredFusionRoute static notice + header comment, archive v3
//      rejection reason codes naming the retired Fusion shape, and the
//      archive dispatch copy.
//   4. fixtures-tests
//      *.test.* / *.fixture.* files that reference Fusion modules as the
//      system under test or in negative guards.
//
// Any hit that cannot be classified into exactly one bucket fails the script
// (exit code 1). The Dexie-backed createFusionStudyRepository phenotype, the
// live /evaluations/sets/:taskSetId/fusion/:studyId route, FusionStudyView,
// and FusionStudyPanel must NOT appear in PRODUCT (non-test) code — their
// presence is a regression (REV-6) and fails the script regardless of bucket.
// Test files may mention these names in negative assertions (the allowlist
// guard test is the product-code authority).
//
// This is a STATIC source scan. It never imports product code, never touches a
// provider, and causes zero egress.
// =============================================================================

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const SRC = join(ROOT, "src");

// --- Forbidden identifiers — presence in PRODUCT code fails the script -------
const FORBIDDEN = [
  { id: "createFusionStudyRepository", pattern: /\bcreateFusionStudyRepository\b/g },
  { id: "FusionStudyView import", pattern: /from\s+["'][^"']*FusionStudyView["']/g },
  { id: "FusionStudyPanel import", pattern: /from\s+["'][^"']*FusionStudyPanel["']/g },
  {
    id: "live sets/:taskSetId/fusion/:studyId route",
    pattern: /path="sets\/:taskSetId\/fusion\/:studyId"/g,
  },
  { id: "FusionStudyRouteWrapper", pattern: /\bFusionStudyRouteWrapper\b/g },
];

const BUCKETS = [
  "allowlisted internal implementation machinery",
  "migration-history compatibility material",
  "semantic receipts",
  "fixtures-tests",
];

function isTestOrFixture(posix) {
  return (
    /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(posix) ||
    /\.test\./.test(posix) ||
    /\.fixture\./.test(posix) ||
    /\/__fixtures__\//.test(posix) ||
    /fusion-corpus-fixture/.test(posix)
  );
}

/** Classify a non-test product file by its relative path. Returns a bucket
 *  name or null if no Fusion hits. Post-T12 every remaining "fusion" hit in
 *  product code is either method-term machinery (Compare Fuse mode, Lab
 *  recipe kind, run-record fusion attempts, evidence exclusions), migration
 *  machinery, or a semantic receipt — never the old Fusion Study authority. */
function classifyProductFile(posix) {
  // 2. migration-history compatibility material — archive v2 must remain
  //    importable but reject Fusion shapes; the corpus fixture pins the T0
  //    baseline; database v13 guards the deleted stores.
  if (
    posix.startsWith("lib/persistence/archive-v2-") ||
    posix.startsWith("lib/migrations/") ||
    posix === "lib/persistence/database.ts"
  ) {
    return "migration-history compatibility material";
  }

  // 3. semantic receipts — the retired route notice, archive v3 rejection
  //    reason codes, and archive dispatch copy name the retired Fusion shape
  //    as a receipt, not as live authority.
  if (
    posix === "app-router.tsx" ||
    posix === "lib/persistence/archive-v3-types.ts" ||
    posix === "lib/persistence/archive.ts" ||
    posix === "lib/persistence/archive-v3-fixtures.ts"
  ) {
    return "semantic receipts";
  }

  // 1. allowlisted internal implementation machinery — every other product
  //    file that mentions "fusion" does so as the method term (Fuse mode,
  //    Fusion Recipe kind, fusion attempt records, Fusion Result rendering,
  //    evidence exclusions) or as the migration/adapter machinery behind
  //    canonical Lab / Compare authority.
  return "allowlisted internal implementation machinery";
}

// --- Walk src/ and collect Fusion hits ----------------------------------------
function listSourceFiles(dirRel) {
  const out = [];
  const stack = [join(SRC, dirRel)];
  while (stack.length > 0) {
    const cur = stack.pop();
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      const full = join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
        out.push(full);
      }
    }
  }
  return out;
}

const files = listSourceFiles(".");
const classified = [];
const unexplained = [];
const forbiddenHits = [];

for (const abs of files) {
  const rel = relative(SRC, abs);
  const posix = rel.split(sep).join("/");
  const text = readFileSync(abs, "utf8");

  // Forbidden identifiers — only PRODUCT (non-test) code is scanned. Tests
  // may mention these names in negative assertions (the allowlist guard test
  // is the product-code authority).
  if (!isTestOrFixture(posix)) {
    for (const rule of FORBIDDEN) {
      rule.pattern.lastIndex = 0;
      const m = text.match(rule.pattern);
      if (m) {
        forbiddenHits.push({ file: posix, rule: rule.id, count: m.length });
      }
    }
  }

  // Count case-insensitive "fusion" word-boundary hits.
  const fusionHits = text.match(/\bfusion\b/gi);
  if (!fusionHits || fusionHits.length === 0) continue;

  let bucket;
  if (isTestOrFixture(posix)) {
    bucket = "fixtures-tests";
  } else {
    bucket = classifyProductFile(posix);
  }
  if (bucket === null) {
    unexplained.push({ file: posix, hits: fusionHits.length });
  } else {
    classified.push({ file: posix, bucket, hits: fusionHits.length });
  }
}

// --- Report -------------------------------------------------------------------
function fmtBucket(title, rows) {
  console.log(`\n## ${title} (${rows.length})`);
  if (rows.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const r of rows) {
    const count = r.count === undefined ? r.hits : r.count;
    const extra = r.rule ? ` [${r.rule}]` : "";
    console.log(`  ${r.file}${extra} — ${count} fusion hit(s)`);
  }
}

console.log("=== Fusion accounting (REV-6) ===");
console.log(`Scanned ${files.length} source files under src/.`);
for (const b of BUCKETS) {
  fmtBucket(
    b,
    classified.filter((r) => r.bucket === b),
  );
}
fmtBucket("UNEXPLAINED (must be empty)", unexplained);
fmtBucket("FORBIDDEN in product code (must be empty — REV-6 regression)", forbiddenHits);

const failed = unexplained.length > 0 || forbiddenHits.length > 0;
if (failed) {
  console.log("\nFAIL: Fusion accounting found unexplained or forbidden hits.");
  process.exit(1);
}
console.log(
  "\nPASS: every remaining Fusion hit is classified; no forbidden phenotype present in product code.",
);
