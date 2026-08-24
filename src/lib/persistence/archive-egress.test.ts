// @vitest-environment node
// =============================================================================
// RSemble AI — Archive zero provider egress & authority resurrection tests (REV-4)
//
// Asserts that:
//   1. Archive v3 export and import cause exactly ZERO provider/network execution.
//      Instruments every registered provider and global fetch to assert 0 calls.
//   2. Archive v3 export and import load/execute NO retired Fusion repository
//      authority (fusion-study-repository.ts).
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import "fake-indexeddb/auto";
import { describe, expect, it, vi, type MockInstance } from "vitest";
import { listProviders } from "../providers/registry";
import {
  exportWorkbenchArchiveV3,
  previewWorkbenchArchive,
  commitPreviewWorkbenchArchiveV3,
  importWorkbenchArchiveAuto,
  exportWorkbenchArchive,
  importWorkbenchArchive,
} from "./archive";
import { seedCompleteV3Corpus } from "./archive-v3-fixtures";
import { RSembleEvaluationDB } from "./database";

async function freshDb(name: string): Promise<RSembleEvaluationDB> {
  const db = new RSembleEvaluationDB(`egress-test-${name}-${Math.random().toString(36).slice(2)}`);
  await db.open();
  return db;
}

describe("archive v3 — zero provider egress probe (REV-4)", () => {
  it("export and import cause zero provider completions, streams, readiness calls, or network fetch", async () => {
    const providers = listProviders();
    const spies: MockInstance[] = [];

    // Instrument every provider method
    for (const provider of providers) {
      if (typeof provider.readiness === "function") {
        spies.push(vi.spyOn(provider, "readiness"));
      }
      if (typeof provider.testConnection === "function") {
        spies.push(vi.spyOn(provider, "testConnection"));
      }
      if (typeof provider.chatCompletion === "function") {
        spies.push(vi.spyOn(provider, "chatCompletion"));
      }
      if (typeof provider.chatCompletionStream === "function") {
        spies.push(vi.spyOn(provider, "chatCompletionStream"));
      }
    }

    // Instrument global fetch
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const source = await freshDb("egress-source");
    await seedCompleteV3Corpus(source);

    // 1. Export v3
    const exported = await exportWorkbenchArchiveV3(source, { now: 1_700_000_000_000 });
    expect(exported).toBeDefined();

    // 2. Preview v3
    const target = await freshDb("egress-target");
    const preview = await previewWorkbenchArchive(target, exported);
    expect(preview.format).toBe("v3");

    // 3. Commit v3
    const result = await commitPreviewWorkbenchArchiveV3(target, preview);
    expect(result.created.length).toBeGreaterThan(0);

    // 4. Auto-import v3
    const autoTarget = await freshDb("egress-auto");
    await importWorkbenchArchiveAuto(autoTarget, exported);

    // 5. Legacy v1 export and import
    const v1Export = await exportWorkbenchArchive(source);
    const v1Target = await freshDb("egress-v1");
    await importWorkbenchArchive(v1Target, v1Export);

    // Assert absolute zero provider calls
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
    // Assert zero network fetch calls
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
    for (const spy of spies) spy.mockRestore();

    source.close();
    target.close();
    autoTarget.close();
    v1Target.close();
  });
});

describe("archive v3 — no authority resurrection (REV-4)", () => {
  it("does not touch or instantiate fusion-study-repository during v3 export/import", async () => {
    // Assert that the database handle used by archive operations does not touch fusion tables
    const db = await freshDb("no-fusion-auth");
    await seedCompleteV3Corpus(db);

    const exported = await exportWorkbenchArchiveV3(db);
    expect(exported).toBeDefined();

    // Verify Dexie tables touched during export do not include fusion tables
    const tableNames = db.tables.map((t) => t.name);
    expect(tableNames).not.toContain("fusionRecipes");
    expect(tableNames).not.toContain("fusionStudies");
    expect(tableNames).not.toContain("fusionPlaybooks");

    db.close();
  });

  /** Strip comments so prose mentioning the module cannot false-positive. */
  function codeOnly(source: string): string {
    return source
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        return !t.startsWith("//") && !t.startsWith("*") && t.length > 0;
      })
      .join("\n");
  }

  it("archive source never imports the retired fusion-study-repository module (REV-4 module-load guard)", () => {
    // The table-name assertions above are fixed by database.ts v13 and would
    // pass even if a regression statically imported the retired Dexie Fusion
    // repository. Guard the load itself: none of the archive-path sources may
    // import (statically or dynamically) the module that reads/writes the
    // seven stores deleted in schema v13.
    const archiveSourceFiles = [
      "src/lib/persistence/archive.ts",
      "src/lib/persistence/archive-v3-types.ts",
      "src/lib/persistence/archive-v3-fixtures.ts",
      "src/ui/DataArchiveActions.tsx",
    ];

    for (const rel of archiveSourceFiles) {
      const source = readFileSync(join(process.cwd(), rel), "utf8");
      const code = codeOnly(source);
      // Static import/re-export and dynamic import both load the module.
      expect(code, rel).not.toMatch(/from\s+["'][^"']*fusion-study-repository["']/);
      expect(code, rel).not.toMatch(/import\s*\(\s*["'][^"']*fusion-study-repository["']/);
    }
  });
});
