// =============================================================================
// RSemble AI — Fusion Study authority allowlist regression (Child 06 T12, REV-6)
//
// Pins the post-T12 executable seam elimination:
//   - the live /evaluations/sets/:taskSetId/fusion/:studyId route is GONE from
//     app-router.tsx (no competing live Fusion Study product authority);
//   - FusionStudyView.tsx / FusionStudyPanel.tsx no longer exist as product
//     surfaces (the Lab replaces them);
//   - fusion-study-repository.ts exports only the allowlist: the
//     InMemoryFusionStudyRepository used by the Lab adapter, the
//     FusionStudyRepository interface (hard type/shape reference), and the
//     validateTrialAttemptLink helper used by the in-memory implementation —
//     the Dexie-backed createFusionStudyRepository phenotype is removed;
//   - the RetiredFusionRoute static notice stays for :suiteId/fusion/:studyId;
//   - no product module imports the deleted view/panel or the Dexie phenotype.
//
// Allowlisted methodology modules that STAY (consumed behind canonical Lab /
// Compare authority) are asserted present so a future over-zealous sweep
// cannot silently remove them:
//   - fusion-study-orchestration + fusion-confirmation (policy-study-adapter)
//   - fusion-live-executor (PolicyStudyPage)
//   - fusion-recipes renderers/consts (pipeline / run-controller)
//   - InMemoryFusionStudyRepository (Lab adapter)
//
// This is a static source/integration guard. It does not mount React.
// =============================================================================

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SRC = join(ROOT, "src");

function readSrc(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

/** Recursively collect files under a directory (relative to SRC), filtered by
 *  extension. Returns POSIX-style relative paths. */
function listSrcFiles(dirRel: string, exts: string[]): string[] {
  const out: string[] = [];
  const stack: string[] = [join(SRC, dirRel)];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    // Use readdirSync directly — this test runs under node, not the browser.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const entries = require("node:fs").readdirSync(cur, { withFileTypes: true });
    for (const e of entries) {
      const full = join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (exts.some((ext) => e.name.endsWith(ext))) {
        out.push(relative(SRC, full).split("\\").join("/"));
      }
    }
  }
  return out;
}

describe("REV-6 — live Fusion Study route removed from app-router", () => {
  it("does not register the live /evaluations/sets/:taskSetId/fusion/:studyId route branch", () => {
    const src = readSrc("app-router.tsx");
    // The live route branch template must not appear as a Route path.
    expect(src).not.toContain('path="sets/:taskSetId/fusion/:studyId"');
    // The wrapper that mounted the live Fusion study view must be gone.
    expect(src).not.toContain("FusionStudyRouteWrapper");
  });

  it("does not import FusionStudyView / FusionStudyRoute", () => {
    const src = readSrc("app-router.tsx");
    expect(src).not.toMatch(/from\s+["']\.\/workspaces\/evaluations\/FusionStudyView["']/);
    expect(src).not.toContain("FusionStudyRoute");
  });

  it("keeps the RetiredFusionRoute static notice for :suiteId/fusion/:studyId", () => {
    const src = readSrc("app-router.tsx");
    expect(src).toContain("RetiredFusionRoute");
    expect(src).toContain(':suiteId/fusion/:studyId');
    expect(src).toContain("Fusion Study pages no longer exist");
  });
});

describe("REV-6 — Fusion Study view/panel product surfaces deleted", () => {
  it("FusionStudyView.tsx and FusionStudyPanel.tsx no longer exist", () => {
    expect(existsSync(join(SRC, "workspaces/evaluations/FusionStudyView.tsx"))).toBe(false);
    expect(existsSync(join(SRC, "workspaces/evaluations/FusionStudyPanel.tsx"))).toBe(false);
    expect(existsSync(join(SRC, "workspaces/evaluations/FusionStudyView.test.tsx"))).toBe(false);
    expect(existsSync(join(SRC, "workspaces/evaluations/FusionStudyPanel.test.tsx"))).toBe(false);
  });

  it("no product module imports the deleted view/panel", () => {
    const productFiles = listSrcFiles(".", [".ts", ".tsx"]).filter(
      (rel) =>
        !rel.endsWith(".test.ts") &&
        !rel.endsWith(".test.tsx") &&
        !rel.startsWith("workspaces/evaluations/FusionStudyView.") &&
        !rel.startsWith("workspaces/evaluations/FusionStudyPanel."),
    );
    const offenders: string[] = [];
    for (const rel of productFiles) {
      const text = readSrc(rel);
      if (
        /from\s+["'][^"']*FusionStudyView["']/.test(text) ||
        /from\s+["'][^"']*FusionStudyPanel["']/.test(text)
      ) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("REV-6 — fusion-study-repository exports trimmed to the allowlist", () => {
  it("does not export the Dexie-backed createFusionStudyRepository phenotype", () => {
    const src = readSrc("lib/persistence/fusion-study-repository.ts");
    expect(src).not.toContain("export function createFusionStudyRepository");
    expect(src).not.toMatch(/export\s+\{[^}]*createFusionStudyRepository[^}]*\}/);
  });

  it("still exports the allowlisted InMemoryFusionStudyRepository", () => {
    const src = readSrc("lib/persistence/fusion-study-repository.ts");
    expect(src).toContain("export class InMemoryFusionStudyRepository");
  });

  it("still exports the FusionStudyRepository interface (hard type/shape reference)", () => {
    const src = readSrc("lib/persistence/fusion-study-repository.ts");
    expect(src).toContain("export interface FusionStudyRepository");
  });

  it("no product module imports the removed Dexie phenotype", () => {
    const productFiles = listSrcFiles(".", [".ts", ".tsx"]).filter(
      (rel) =>
        !rel.endsWith(".test.ts") &&
        !rel.endsWith(".test.tsx") &&
        rel !== "lib/persistence/fusion-study-repository.ts",
    );
    const offenders: string[] = [];
    for (const rel of productFiles) {
      const text = readSrc(rel);
      if (/import\s+\{[^}]*createFusionStudyRepository[^}]*\}/.test(text)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("REV-6 — allowlisted methodology modules remain reachable", () => {
  it("policy-study-adapter still consumes fusion-study-orchestration + fusion-confirmation", () => {
    const src = readSrc("lib/studies/policy/policy-study-adapter.ts");
    expect(src).toMatch(/from\s+["'][^"']*fusion-study-orchestration["']/);
    expect(src).toMatch(/from\s+["'][^"']*fusion-confirmation["']/);
    expect(src).toContain("InMemoryFusionStudyRepository");
  });

  it("PolicyStudyPage still consumes fusion-live-executor", () => {
    const src = readSrc("workspaces/lab/PolicyStudyPage.tsx");
    expect(src).toMatch(/from\s+["'][^"']*fusion-live-executor["']/);
  });

  it("pipeline + run-controller still consume fusion-recipes renderers/consts", () => {
    const pipeline = readSrc("lib/pipeline.ts");
    const controller = readSrc("lib/run-controller.ts");
    expect(pipeline).toMatch(/from\s+["'][^"']*fusion-recipes["']/);
    expect(controller).toMatch(/from\s+["'][^"']*fusion-recipes["']/);
  });
});
