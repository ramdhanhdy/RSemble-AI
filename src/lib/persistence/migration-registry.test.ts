// =============================================================================
// RSemble AI — Migration registry orchestration contract (RED)
//
// Child 10 Task 8: the registry owns dependency-ordered orchestration of every
// child migration behind one inspect/apply/verify lifecycle. These tests pin
// the contract with synthetic steps so orchestration is proven independently
// of any single migration's internals:
//
//  1. dependency topological order; unmet dependencies never run;
//  2. missing dependency ids and cycles are errors, never silent skips;
//  3. inspect → apply → verify lifecycle; no completion marker before verify;
//  4. a fully-migrated DB inspects fast with no pending steps;
//  5. blocking steps gate readiness; background steps report progress;
//  6. interrupted apply resumes from the persisted cursor, not from scratch;
//  7. the completion marker is written only after verify passes;
//  8. a foreign owner lease yields read-only progress, never concurrent apply;
//  9. repeated startup on a migrated DB is a no-op.
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import { RSembleEvaluationDB, StorageError } from "./database";
import {
  createMigrationRegistry,
  createDefaultMigrationSteps,
  MIGRATION_OWNER_LEASE_KEY,
  migrationCompletionKey,
  migrationCursorKey,
  MigrationRegistryError,
  planMigrationSteps,
  type MigrationCursor,
  type MigrationProgress,
  type MigrationStep,
  type MigrationStepState,
} from "./migration-registry";

const dbs: RSembleEvaluationDB[] = [];
afterEach(async () => {
  while (dbs.length) {
    const db = dbs.pop()!;
    db.close();
    await db.delete();
  }
});

async function openDb(): Promise<RSembleEvaluationDB> {
  const db = new RSembleEvaluationDB(`test-migreg-${crypto.randomUUID()}`);
  dbs.push(db);
  await db.open();
  return db;
}

interface FakeStep {
  step: MigrationStep;
  calls: string[];
  inspectMock: Mock;
  applyMock: Mock;
  verifyMock: Mock;
}

interface FakeStepControls {
  needed?: boolean;
  verifyOk?: boolean;
  failApply?: boolean;
  /** Queued apply results consumed in order; last one repeats when exhausted. */
  applyResults?: MigrationProgress[];
  /** Side effect executed inside apply (e.g. writing an underlying marker). */
  onApply?: (cursor: MigrationCursor) => Promise<void> | void;
}

function fakeStep(
  id: string,
  dependencies: string[],
  blocking: boolean,
  controls: FakeStepControls = {},
): FakeStep {
  const calls: string[] = [];
  const queue = [...(controls.applyResults ?? [{ done: true }])];
  const inspectMock = vi.fn(async () => {
    calls.push("inspect");
    return { needed: controls.needed ?? true, blocking };
  });
  const applyMock = vi.fn(async (cursor: MigrationCursor): Promise<MigrationProgress> => {
    calls.push(`apply:${cursor.position ?? "null"}`);
    await controls.onApply?.(cursor);
    if (controls.failApply) {
      throw new StorageError("validation", `${id} apply failed`);
    }
    return queue.length > 1 ? queue.shift()! : queue[0];
  });
  const verifyMock = vi.fn(async () => {
    calls.push("verify");
    return { ok: controls.verifyOk ?? true };
  });
  const step: MigrationStep = {
    id,
    version: 1,
    dependencies,
    blocking,
    inspect: inspectMock,
    apply: applyMock,
    verify: verifyMock,
  };
  return { step, calls, inspectMock, applyMock, verifyMock };
}

function stateOf(report: { steps: MigrationStepState[] }, id: string): MigrationStepState {
  const state = report.steps.find((s) => s.id === id);
  if (!state) throw new Error(`missing step state for ${id}`);
  return state;
}

describe("planMigrationSteps", () => {
  it("orders steps so every dependency executes before its dependents", () => {
    const a = fakeStep("a", [], true);
    const b = fakeStep("b", ["a"], true);
    const c = fakeStep("c", ["b"], true);
    const d = fakeStep("d", ["a"], true);
    // Deliberately scrambled input order.
    const planned = planMigrationSteps([d.step, c.step, b.step, a.step]);
    const order = planned.map((s) => s.id);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("d"));
  });

  it("reports a missing dependency id as an error, never a silent skip", () => {
    const orphan = fakeStep("orphan", ["ghost-step"], true);
    expect(() => planMigrationSteps([orphan.step])).toThrow(MigrationRegistryError);
    expect(() => planMigrationSteps([orphan.step])).toThrow(/missing/i);
  });

  it("reports a circular dependency as an error, never a silent skip", () => {
    const a = fakeStep("a", ["b"], true);
    const b = fakeStep("b", ["a"], true);
    expect(() => planMigrationSteps([a.step, b.step])).toThrow(MigrationRegistryError);
    expect(() => planMigrationSteps([a.step, b.step])).toThrow(/cycle/i);
  });
});

describe("migration registry orchestration", () => {
  it("runs steps in dependency order at execution time", async () => {
    const db = await openDb();
    const execution: string[] = [];
    const mk = (id: string, deps: string[]) =>
      fakeStep(id, deps, true, {
        onApply: () => {
          execution.push(id);
        },
      });
    const a = mk("a", []);
    const b = mk("b", ["a"]);
    const c = mk("c", ["b"]);
    const d = mk("d", ["a"]);
    const registry = createMigrationRegistry({ db, steps: [d.step, c.step, b.step, a.step] });
    const report = await registry.run();
    expect(report.ready).toBe(true);
    expect(execution.indexOf("a")).toBeLessThan(execution.indexOf("b"));
    expect(execution.indexOf("b")).toBeLessThan(execution.indexOf("c"));
    expect(execution.indexOf("a")).toBeLessThan(execution.indexOf("d"));
  });

  it("never runs a step whose dependency failed", async () => {
    const db = await openDb();
    const a = fakeStep("a", [], true, { failApply: true });
    const b = fakeStep("b", ["a"], true);
    const registry = createMigrationRegistry({ db, steps: [a.step, b.step] });
    const report = await registry.run();
    expect(report.ready).toBe(false);
    expect(stateOf(report, "a").status).toBe("failed");
    expect(stateOf(report, "b").status).toBe("blocked-dependency");
    expect(b.applyMock).not.toHaveBeenCalled();
    expect(report.errors.length).toBeGreaterThan(0);
  });

  it("surfaces dependency graph errors in the run report instead of crashing", async () => {
    const db = await openDb();
    const a = fakeStep("a", ["b"], true);
    const b = fakeStep("b", ["a"], true);
    const registry = createMigrationRegistry({ db, steps: [a.step, b.step] });
    const report = await registry.run();
    expect(report.ready).toBe(false);
    expect(report.errors.join(" ")).toMatch(/cycle/i);
  });

  it("drives the inspect → apply → verify lifecycle in order", async () => {
    const db = await openDb();
    const a = fakeStep("a", [], true);
    const registry = createMigrationRegistry({ db, steps: [a.step] });
    const report = await registry.run();
    expect(report.ready).toBe(true);
    expect(a.calls).toEqual(["inspect", "apply:null", "verify"]);
    const completion = await db.storageMeta.get(migrationCompletionKey("a"));
    expect(completion?.value).toMatchObject({ id: "a", version: 1 });
  });

  it("inspects a fully-migrated database quickly with no pending steps and no apply", async () => {
    const db = await openDb();
    const a = fakeStep("a", [], true, { needed: false });
    const b = fakeStep("b", ["a"], false, { needed: false });
    const registry = createMigrationRegistry({ db, steps: [a.step, b.step] });
    const inspection = await registry.inspect();
    expect(inspection.steps).toHaveLength(2);
    for (const step of inspection.steps) {
      expect(step.needed).toBe(false);
    }
    expect(typeof inspection.inspectionMs).toBe("number");
    expect(inspection.inspectionMs).toBeGreaterThanOrEqual(0);
    expect(inspection.inspectionMs).toBeLessThan(1000);

    const report = await registry.run();
    expect(report.ready).toBe(true);
    expect(a.applyMock).not.toHaveBeenCalled();
    expect(b.applyMock).not.toHaveBeenCalled();
  });

  it("completes blocking steps before ready while background steps defer and report progress", async () => {
    const db = await openDb();
    const blocking = fakeStep("blocking", [], true);
    const background = fakeStep("background", ["blocking"], false);
    const registry = createMigrationRegistry({ db, steps: [blocking.step, background.step] });

    const report = await registry.run();
    expect(report.ready).toBe(true);
    expect(stateOf(report, "blocking").status).toBe("complete");
    expect(stateOf(report, "background").status).toBe("deferred");
    expect(background.applyMock).not.toHaveBeenCalled();

    const progressEvents: MigrationStepState[] = [];
    const backgroundReport = await registry.runBackground({
      onProgress: (state) => progressEvents.push(state),
    });
    expect(background.applyMock).toHaveBeenCalledTimes(1);
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents.some((e) => e.id === "background")).toBe(true);
    expect(stateOf(backgroundReport, "background").status).toBe("complete");
  });

  it("resumes an interrupted step from the persisted cursor, not from scratch", async () => {
    const db = await openDb();
    const a = fakeStep("a", [], true, {
      applyResults: [
        { done: false, processed: 5, cursor: { position: "batch-2" } },
        { done: true, processed: 3 },
      ],
    });
    const first = createMigrationRegistry({ db, steps: [a.step] });
    const firstReport = await first.run();
    expect(firstReport.ready).toBe(false);
    expect(stateOf(firstReport, "a").status).toBe("pending");
    const cursorRow = await db.storageMeta.get(migrationCursorKey("a"));
    expect(cursorRow?.value).toMatchObject({ position: "batch-2" });

    // A later startup (fresh registry, same DB) resumes from the cursor.
    const second = createMigrationRegistry({ db, steps: [a.step] });
    const secondReport = await second.run();
    expect(secondReport.ready).toBe(true);
    expect(stateOf(secondReport, "a").status).toBe("complete");
    expect(a.calls).toEqual(["inspect", "apply:null", "inspect", "apply:batch-2", "verify"]);
    expect(await db.storageMeta.get(migrationCursorKey("a"))).toBeUndefined();
  });

  it("writes the completion marker only after verify passes, never before", async () => {
    const db = await openDb();
    const a = fakeStep("a", [], true, {
      verifyOk: false,
      onApply: async () => {
        // The underlying migration finished its own work; the registry-level
        // completion marker must still wait for a passing verify.
        await db.storageMeta.put({ key: "fake-underlying-marker", value: { done: true } });
      },
    });
    const registry = createMigrationRegistry({ db, steps: [a.step] });
    const report = await registry.run();
    expect(report.ready).toBe(false);
    expect(stateOf(report, "a").status).toBe("failed");
    expect(await db.storageMeta.get("fake-underlying-marker")).toBeDefined();
    expect(await db.storageMeta.get(migrationCompletionKey("a"))).toBeUndefined();
  });

  it("yields read-only progress when another tab holds the owner lease", async () => {
    const db = await openDb();
    await db.storageMeta.put({
      key: MIGRATION_OWNER_LEASE_KEY,
      value: { ownerId: "other-tab", expiresAt: Date.now() + 60_000 },
    });
    const a = fakeStep("a", [], true);
    const registry = createMigrationRegistry({ db, steps: [a.step], ownerId: "this-tab" });
    const report = await registry.run();
    expect(report.owner).toBe(false);
    expect(report.ready).toBe(false);
    expect(stateOf(report, "a").status).toBe("skipped-owner");
    expect(a.applyMock).not.toHaveBeenCalled();
    // Read-only progress is still visible: every step reports a state.
    expect(report.steps).toHaveLength(1);
  });

  it("treats repeated startup on a fully-migrated database as a no-op", async () => {
    const db = await openDb();
    const a = fakeStep("a", [], true);
    const b = fakeStep("b", ["a"], true);
    for (let startup = 0; startup < 3; startup += 1) {
      const registry = createMigrationRegistry({ db, steps: [a.step, b.step] });
      const report = await registry.run();
      expect(report.ready).toBe(true);
    }
    expect(a.applyMock).toHaveBeenCalledTimes(1);
    expect(b.applyMock).toHaveBeenCalledTimes(1);
  });
});

describe("default production steps", () => {
  it("registers every child migration in dependency order", () => {
    const dbPlaceholder = null as unknown as RSembleEvaluationDB;
    // createDefaultMigrationSteps only wires closures; no DB access at construction.

    const steps = createDefaultMigrationSteps(dbPlaceholder);
    const ids = steps.map((s) => s.id);
    for (const required of [
      "legacy-history",
      "canonical-tasks",
      "fusion-to-research-lab",
      "task-sets",
      "comparison-results",
      "search-index",
      "attention",
    ]) {
      expect(ids).toContain(required);
    }
    const byId = new Map(steps.map((s) => [s.id, s]));
    expect(byId.get("legacy-history")!.dependencies).toEqual([]);
    expect(byId.get("canonical-tasks")!.dependencies).toEqual([]);
    expect(byId.get("fusion-to-research-lab")!.dependencies).toContain("canonical-tasks");
    expect(byId.get("task-sets")!.dependencies).toContain("canonical-tasks");
    expect(byId.get("comparison-results")!.dependencies).toContain("task-sets");
    expect(byId.get("attention")!.dependencies).toContain("comparison-results");
    const searchDeps = byId.get("search-index")!.dependencies;
    for (const dep of [
      "legacy-history",
      "canonical-tasks",
      "fusion-to-research-lab",
      "task-sets",
      "comparison-results",
    ]) {
      expect(searchDeps).toContain(dep);
    }
    expect(byId.get("search-index")!.blocking).toBe(false);
    expect(byId.get("attention")!.blocking).toBe(true);
  });
});
