// =============================================================================
// Rubric terminology boundary — scoring-Profile inventory guard (Child 01, Task 1)
//
// Purpose
//   Child 01 renames the scoring objects currently called "Profile" to "Rubric"
//   everywhere a user sees or creates them and everywhere new domain code reasons
//   about them, while leaving frozen serialized/store boundaries readable
//   (spec §3.3, §7.6). This guard inventories every scoring-Profile term across
//   the `src` TypeScript/TSX source set and fails when any non-allowlisted term
//   remains, so the rename in Tasks 2–6 cannot land half-finished.
//
// Intentionally RED
//   Against the current production baseline every user-facing scoring surface
//   still says Profile (types, repository API, routes, list/detail/ref UI,
//   cross-surface copy, tests). The assertion below is therefore expected to
//   FAIL on HEAD, listing the surfaces that Tasks 2–6 must convert. Do NOT
//   weaken the allowlist to make this guard pass; shrink the violation list by
//   renaming production terminology instead.
//
// Frozen compatibility boundaries (explicit, narrow allowlist)
//   The following keep legacy `profile*` names because changing them would
//   create avoidable migration risk (spec §3.3). They are allowlisted here and
//   must NOT be renamed:
//     • evaluationProfileId / evaluationProfileVersion
//         — frozen RunRecordV2 / ExperimentRecord serialized fields.
//     • profileVersions / ProfileVersionRow / profileVersionRow
//         — physical IndexedDB store + its row type/factory.
//     • ProfileRow / profileRow
//         — physical IndexedDB row type/factory for the `profiles` store.
//     • the standalone `profiles` token where it is a physical Dexie store
//       declaration/access (`db.profiles`) or a v1 archive/import payload field
//       (archive v1 envelope, suite-package v1 import schema).
//   Anything else carrying the Profile word — type names, repository methods,
//   component names, route segments, user-facing strings, comments, test
//   helpers — is a scoring-Profile term and must become Rubric.
// =============================================================================

import { readFileSync, readdirSync, statSync, type Stats } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// --- Source set -------------------------------------------------------------

const SRC_ROOT = join(process.cwd(), "src");
const GUARD_FILE = "rubric-terminology.test.ts";

/** File extensions that carry scoring terminology. */
const SOURCE_EXTENSIONS: Record<string, true> = {
  ".ts": true,
  ".tsx": true,
};

/** Directories that never carry scoring terminology (snapshots, build art). */
const SKIP_DIRS: Record<string, true> = {
  __snapshots__: true,
  node_modules: true,
  dist: true,
  coverage: true,
};

function listSourceFiles(root: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    if (entry === GUARD_FILE) continue; // never scan the guard itself
    const abs = join(root, entry);
    let st: Stats;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (entry in SKIP_DIRS) continue;
      listSourceFiles(abs, acc);
    } else if (st.isFile()) {
      const dot = entry.lastIndexOf(".");
      if (dot >= 0 && SOURCE_EXTENSIONS[entry.slice(dot)] === true) acc.push(abs);
    }
  }
  return acc;
}

// --- Allowlist ---------------------------------------------------------------

/**
 * Identifiers allowlisted in ANY file because they are frozen serialized
 * field names or physical-store row types/factories (spec §3.3, §7.6).
 * Case-sensitive — these are exact TypeScript identifiers.
 */
const FROZEN_IDENTIFIERS: Record<string, true> = {
  // Frozen RunRecordV2 / ExperimentRecord serialized fields.
  evaluationProfileId: true,
  evaluationProfileVersion: true,
  // Physical IndexedDB `profileVersions` store + row type/factory.
  profileVersions: true,
  ProfileVersionRow: true,
  profileVersionRow: true,
  // Physical IndexedDB `profiles` store row type/factory.
  ProfileRow: true,
  profileRow: true,
};

/**
 * Files in which the standalone lowercase token `profiles` is a frozen physical
 * Dexie store declaration or a v1 archive/import payload field (spec §3.3, §7).
 * In every other file `profiles` is a route segment, nav label, public API
 * field, or local variable that must become Rubric.
 */
const PROFILES_TOKEN_FILES: Record<string, true> = {
  // `profiles` Dexie store declaration + schema.
  "lib/persistence/database.ts": true,
  // v1 archive envelope `profiles` payload field + `db.profiles` reads.
  "lib/persistence/archive.ts": true,
  // v1 suite-package import payload field `profiles` (import reads v1 profiles).
  "lib/evaluations/suite-package.ts": true,
};

/**
 * Files in which ALL Profile-bearing tokens are explicit compatibility /
 * legacy-adapter boundaries (spec §3.3, §7.6). These files either re-export
 * deprecated aliases (rubric-compat), declare the legacy type aliases and
 * guards that hard-no-edit consumers depend on (evaluation-types,
 * evaluation-rubric), provide the legacy ad-hoc compat shim for an excluded
 * consumer (evaluation-rubric-adhoc), implement the physical repository
 * adapter whose method names are frozen public API (evaluation-repository),
 * or are hard-no-edit compatibility consumers themselves (pipeline.ts,
 * studio-engine.ts, studio-data.ts). New consumers must migrate to canonical
 * Rubric names and must NOT appear here.
 */
const COMPAT_FILES: Record<string, true> = {
  // Legacy type aliases + guards needed by excluded pipeline.ts.
  "lib/evaluations/evaluation-types.ts": true,
  // Legacy function aliases (validateProfile, isComplianceOnlyProfile) needed
  // by excluded pipeline.ts + internal `profile` param in frozen-boundary code.
  "lib/evaluations/evaluation-rubric.ts": true,
  // Explicit deprecated re-exports for migration safety.
  "lib/evaluations/rubric-compat.ts": true,
  // Legacy ad-hoc compat shim re-exported for excluded studio-engine.ts.
  "lib/evaluations/evaluation-rubric-adhoc.ts": true,
  // Legacy repository adapter — method names are frozen public API.
  "lib/persistence/evaluation-repository.ts": true,
  // Hard-no-edit compatibility consumers.
  "lib/pipeline.ts": true,
  "studio-engine.ts": true,
  "studio-data.ts": true,
};

/**
 * Test files that exercise the legacy compat surface and therefore reference
 * deprecated aliases by name. These are the test counterparts of the
 * COMPAT_FILES above.
 */
const COMPAT_TEST_FILES: Record<string, true> = {
  "lib/evaluations/evaluation-rubric.test.ts": true,
  "lib/persistence/evaluation-repository.test.ts": true,
};

// --- Scanner -----------------------------------------------------------------

/**
 * Matches one identifier-shaped token (also matches bare words inside string
 * literals, JSX text, comments, and route paths — the regex is context-blind
 * by design so user-facing copy is inventoried alongside code). A separate
 * case-insensitive `PROFILE_FRAGMENT` test then keeps only tokens that carry
 * the scoring term, wherever it sits in the identifier: Profile, profiles,
 * profileId, ProfileListRoute, EvaluationProfile, isComplianceOnlyProfile,
 * PROFILES, etc. Captured text preserves original case so the frozen-identifier
 * and `profiles`-token checks stay case-sensitive.
 */
const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;
const PROFILE_FRAGMENT = /profile/i;

interface Violation {
  file: string; // path relative to src, forward slashes
  line: number; // 1-based
  col: number; // 1-based
  token: string;
}

/**
 * Classify one matched token. Frozen serialized fields and physical-store row
 * types are allowed anywhere. The standalone lowercase `profiles` token is
 * allowed only at physical Dexie stores (`db.profiles`) or v1 archive/import
 * payload fields; capital `Profiles` (nav labels, headings) and all-caps
 * `PROFILES` are user-facing/API terms and stay flagged.
 *
 * The standalone lowercase `profile` token is allowed when it is a frozen
 * serialized field access (property access `.profile`, property key `profile:`,
 * kind discriminant string literal `"profile"`). In every other context it is
 * a local variable / parameter that must become `rubric`.
 */
function isAllowed(token: string, relFile: string, line: string, idx: number): boolean {
  if (token in FROZEN_IDENTIFIERS) return true;

  // Explicit compat/legacy-adapter files — all Profile tokens allowed.
  if (relFile in COMPAT_FILES) return true;
  if (relFile in COMPAT_TEST_FILES) return true;

  if (token === "profiles") {
    // `db.profiles` — physical Dexie store access (frozen, any file).
    if (/\bdb\.\s*$/.test(line.slice(0, idx))) return true;
    // `.profiles` — frozen serialized field access (e.g. snapshot.profiles).
    if (line[idx - 1] === ".") return true;
    // `profiles:` — frozen serialized property key in object literal (not a
    // variable declaration like `const profiles:`).
    const afterProfiles = line.slice(idx + token.length);
    if (/^\s*:/.test(afterProfiles)) {
      const beforeProfiles = line.slice(0, idx).trimEnd();
      if (!/(?:const|let|var)\s*$/.test(beforeProfiles)) return true;
    }
    // v1 archive envelope / v1 import payload `profiles` field.
    if (relFile in PROFILES_TOKEN_FILES) return true;
  }

  if (token === "profile") {
    // `.profile` — frozen serialized field access (e.g. evaluation.profile,
    // evalConfig.profile, record.evaluation.profile).
    if (line[idx - 1] === ".") return true;
    // `profile:` — frozen serialized property key in object literal (not a
    // variable declaration like `const profile:`).
    const after = line.slice(idx + token.length);
    if (/^\s*:/.test(after)) {
      const before = line.slice(0, idx).trimEnd();
      // Exclude variable declarations (const/let/var profile: Type).
      if (!/(?:const|let|var)\s*$/.test(before)) return true;
    }
    // `"profile"` or `'profile'` — frozen kind discriminant string literal.
    const beforeChar = line[idx - 1] ?? "";
    const afterChar = line[idx + token.length] ?? "";
    if ((beforeChar === '"' || beforeChar === "'") && (afterChar === '"' || afterChar === "'")) {
      return true;
    }
  }

  return false;
}

function scanFile(absPath: string, srcRoot: string): Violation[] {
  const relFile = relative(srcRoot, absPath).split(sep).join("/");
  let text: string;
  try {
    text = readFileSync(absPath, "utf8");
  } catch {
    return [];
  }
  const lines = text.split(/\r?\n/);
  const out: Violation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    IDENTIFIER.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IDENTIFIER.exec(line)) !== null) {
      const token = m[0];
      if (!PROFILE_FRAGMENT.test(token)) continue;
      const idx = m.index;
      if (isAllowed(token, relFile, line, idx)) continue;
      out.push({ file: relFile, line: i + 1, col: idx + 1, token });
    }
  }
  return out;
}

function collectViolations(): Violation[] {
  const files = listSourceFiles(SRC_ROOT).sort();
  const all: Violation[] = [];
  for (const f of files) {
    const v = scanFile(f, SRC_ROOT);
    for (const x of v) all.push(x);
  }
  // Deterministic order: file → line → column.
  all.sort((a, b) =>
    a.file === b.file
      ? a.line === b.line
        ? a.col - b.col
        : a.line - b.line
      : a.file < b.file
        ? -1
        : 1,
  );
  return all;
}

function renderReport(violations: Violation[]): string {
  const byFile = new Map<string, Violation[]>();
  for (const v of violations) {
    const arr = byFile.get(v.file) ?? [];
    arr.push(v);
    byFile.set(v.file, arr);
  }
  const files = [...byFile.keys()].sort();
  const MAX_FILES = 80;
  const MAX_TOKENS = 12;
  const MAX_SAMPLE_LINES = 6;
  const lines: string[] = [];
  lines.push(
    `Rubric terminology boundary violated: ${violations.length} non-allowlisted scoring-Profile term(s) across ${files.length} file(s).`,
  );
  lines.push("");
  lines.push("Allowlisted frozen boundaries: evaluationProfileId, evaluationProfileVersion,");
  lines.push("profileVersions/ProfileVersionRow/profileVersionRow, ProfileRow/profileRow, and the");
  lines.push("standalone `profiles` token at physical Dexie stores / v1 archive+import payloads.");
  lines.push("");
  lines.push("Surfaces to convert (Tasks 2–6):");
  const shown = files.slice(0, MAX_FILES);
  for (const file of shown) {
    const vs = byFile.get(file)!;
    const distinct = [...new Set(vs.map((v) => v.token))].sort();
    const sampleLines = vs.slice(0, MAX_SAMPLE_LINES).map((v) => `L${v.line}:${v.token}`);
    const tokenList = distinct.slice(0, MAX_TOKENS).join(", ");
    const tokenTail =
      distinct.length > MAX_TOKENS ? ` (+${distinct.length - MAX_TOKENS} more tokens)` : "";
    const lineTail =
      vs.length > MAX_SAMPLE_LINES ? ` …(+${vs.length - MAX_SAMPLE_LINES} more)` : "";
    lines.push(
      `  ${file} — ${vs.length} hit(s); tokens: ${tokenList}${tokenTail}; e.g. ${sampleLines.join(", ")}${lineTail}`,
    );
  }
  if (files.length > MAX_FILES) {
    lines.push(`  …and ${files.length - MAX_FILES} more file(s).`);
  }
  return lines.join("\n");
}

// --- Guard -------------------------------------------------------------------

describe("rubric terminology boundary (Child 01, Task 1)", () => {
  it("has zero non-allowlisted scoring-Profile terms across src", () => {
    const violations = collectViolations();
    expect(violations, renderReport(violations)).toEqual([]);
  });
});
