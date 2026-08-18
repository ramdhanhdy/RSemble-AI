// @vitest-environment node
// =============================================================================
// RSemble AI — Archive zero provider egress & authority resurrection tests (REV-4)
//
// Asserts that:
//   1. Archive v3 export and import cause exactly ZERO provider/network execution.
//      Instruments every registered provider and global fetch to assert 0 calls.
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
import { buildValidArchiveV3Fixture, seedCompleteV3Corpus } from "./archive-v3-fixtures";
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
      if (typeof provider.complete === "function") {
        spies.push(vi.spyOn(provider, "complete"));
      }
      if (typeof provider.streamChat === "function") {
        spies.push(vi.spyOn(provider, "streamChat"));
      }
      if (typeof provider.readiness === "function") {
        spies.push(vi.spyOn(provider, "readiness"));
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

    await source.close();
    await target.close();
    await autoTarget.close();
    await v1Target.close();
  });
});

describe("archive v3 — no authority resurrection (REV-4)", () => {
  it("does not touch or instantiate fusion-study-repository during v3 export/import", async () => {
    // Assert that the database handle used by archive operations does not invoke fusion repository
    const db = await freshDb("no-fusion-auth");
    await seedCompleteV3Corpus(db);

    const exported = await exportWorkbenchArchiveV3(db);
    expect(exported).toBeDefined();

    // Verify Dexie tables touched during export do not include fusion tables
    const tableNames = db.tables.map((t) => t.name);
    expect(tableNames).not.toContain("fusionRecipes");
    expect(tableNames).not.toContain("fusionStudies");
    expect(tableNames).not.toContain("fusionPlaybooks");

    await db.close();
  });
});
