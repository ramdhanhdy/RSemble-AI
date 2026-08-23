// @vitest-environment happy-dom
// =============================================================================
// RSemble AI — DataDiagnostics surface contract (RED)
//
// Child 10 Task 9 (spec §4.3): a non-destructive diagnostics surface at
// /records/diagnostics. It reports storage schema and migration versions,
// source/index counts, unresolved crosswalks and orphan references, derived
// rebuild status, and corrupted entities — and offers exactly three safe
// actions: Verify, Resume Migration, and Rebuild Derived Indexes. It never
// offers destructive delete/reset as a casual repair, displays classified
// storage errors safely, and renders an honest blocked state when storage is
// not ready.
// =============================================================================

import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import {
  RepositoryContext,
  type RepositoryContextValue,
} from "../../lib/persistence/repository-context";
import { RSembleEvaluationDB, type StorageState } from "../../lib/persistence/database";
import {
  runMigrationRegistry,
  verifyMigrationState,
} from "../../lib/persistence/migration-registry";
import { DataDiagnostics } from "./DataDiagnostics";

vi.mock("../../lib/persistence/migration-registry", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("../../lib/persistence/migration-registry")>();
  return {
    ...mod,
    verifyMigrationState: vi.fn(mod.verifyMigrationState),
    runMigrationRegistry: vi.fn(mod.runMigrationRegistry),
  };
});

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const dbs: RSembleEvaluationDB[] = [];
const cleanups: Array<() => void> = [];
afterEach(async () => {
  while (cleanups.length) cleanups.pop()!();
  while (dbs.length) {
    const db = dbs.pop()!;
    db.close();
    await db.delete();
  }
});

async function openDb(): Promise<RSembleEvaluationDB> {
  const db = new RSembleEvaluationDB(`test-diagnostics-${crypto.randomUUID()}`);
  dbs.push(db);
  await db.open();
  return db;
}

function contextValue(db: RSembleEvaluationDB | null, storageState: StorageState) {
  const value: RepositoryContextValue = {
    runRepo: null,
    evalRepo: null,
    fusionRepo: null,
    taskRepo: null,
    taskSetRepo: null,
    evidenceRepo: null,
    studyRepo: null,
    labAssetRepo: null,
    modelRollupRepo: null,
    recordsRepo: null,
    db,
    storageState,
    taskMigrationError: null,
    retry: () => undefined,
  };
  return value;
}

interface Harness {
  container: HTMLDivElement;
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
}

function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await flush();
  });
}

function renderDiagnostics(
  db: RSembleEvaluationDB | null,
  storageState: StorageState = "ready",
): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/records/diagnostics"]}>
        <RepositoryContext.Provider value={contextValue(db, storageState)}>
          <DataDiagnostics />
        </RepositoryContext.Provider>
      </MemoryRouter>,
    );
  });
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return {
    container,
    $: (s) => container.querySelector<HTMLElement>(s),
    $$: (s) => [...container.querySelectorAll<HTMLElement>(s)],
  };
}

async function seedMarker(db: RSembleEvaluationDB, key: string, kind: string) {
  await db.storageMeta.put({ key, value: { kind, version: 1, completedAt: 1_700_000_000_000 } });
}

describe("DataDiagnostics — reporting", () => {
  it("shows the storage schema version and migration marker versions", async () => {
    const db = await openDb();
    await seedMarker(db, "canonical-task-migration:v1", "canonical-task-migration");
    await seedMarker(db, "task-set-migration:v1", "task-set-migration");
    const h = renderDiagnostics(db);
    await settle();

    const schema = h.$('[data-diag="schema-version"]');
    expect(schema?.textContent).toContain("15");

    const markers = h.$$('[data-diag="marker"]');
    const markerText = markers.map((m) => m.textContent).join("\n");
    expect(markerText).toContain("canonical-task-migration:v1");
    expect(markerText).toContain("task-set-migration:v1");
    expect(markerText).toContain("version 1");
  });

  it("shows source and derived index counts for canonical entity types", async () => {
    const db = await openDb();
    await db.tasks.put({
      id: "task-1",
      record: {},
      latestVersion: 1,
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
      origin: "test",
      revision: 0,
    });
    await db.tasks.put({
      id: "task-2",
      record: {},
      latestVersion: 1,
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
      origin: "test",
      revision: 0,
    });
    await db.taskSets.put({
      id: "ts-1",
      record: {},
      latestVersion: 1,
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
      origin: "test",
      revision: 0,
    });
    await db.searchDocuments.put({
      type: "task",
      id: "task-1",
      revision: 0,
      title: "Task 1",
      subtitle: "",
      ownerHref: "/tasks/task-1",
      tokens: ["task"],
      updatedAt: 1,
      indexSchemaVersion: 1,
    });
    const h = renderDiagnostics(db);
    await settle();

    const counts = h.$$('[data-diag="count"]');
    const byLabel: Record<string, string> = {};
    for (const row of counts) {
      const label = row.querySelector('[data-diag="count-label"]')?.textContent ?? "";
      const value = row.querySelector('[data-diag="count-value"]')?.textContent ?? "";
      byLabel[label] = value;
    }
    expect(byLabel["Tasks"]).toBe("2");
    expect(byLabel["Task Sets"]).toBe("1");
    expect(byLabel["Search Documents"]).toBe("1");
  });

  it("reports unresolved crosswalks and orphan references with safe ids and types", async () => {
    const db = await openDb();
    // Valid crosswalk: target version exists → not an orphan.
    await db.taskVersions.put({ taskId: "task-ok", version: 1, version_: {}, createdAt: 1 });
    await db.taskMigrationCrosswalk.put({
      legacyScopeKey: "suite::v1::task-ok::digest",
      taskId: "task-ok",
      taskVersion: 1,
    });
    // Orphan crosswalk: target version missing.
    await db.taskMigrationCrosswalk.put({
      legacyScopeKey: "suite::v2::task-gone::digest",
      taskId: "task-gone",
      taskVersion: 1,
    });
    const h = renderDiagnostics(db);
    await settle();

    const orphans = h.$$('[data-diag="orphan"]');
    expect(orphans).toHaveLength(1);
    expect(orphans[0].textContent).toContain("task-crosswalk");
    expect(orphans[0].textContent).toContain("suite::v2::task-gone::digest");
  });

  it("shows observation/search rebuild status", async () => {
    const db = await openDb();
    await db.evidenceIndexJobs.put({
      sourceResultId: "run-1",
      sourceKind: "comparison",
      status: "complete",
      ruleVersion: 1,
      sourceRevision: 0,
      updatedAt: 1,
      errorKind: null,
      errorMessage: null,
      summary: null,
    });
    await db.evidenceIndexJobs.put({
      sourceResultId: "run-2",
      sourceKind: "comparison",
      status: "queued",
      ruleVersion: 1,
      sourceRevision: 0,
      updatedAt: 2,
      errorKind: null,
      errorMessage: null,
      summary: null,
    });
    const h = renderDiagnostics(db);
    await settle();

    const jobs = h.$('[data-diag="evidence-jobs"]');
    expect(jobs?.textContent).toContain("complete: 1");
    expect(jobs?.textContent).toContain("queued: 1");
    const search = h.$('[data-diag="search-index-count"]');
    expect(search?.textContent).toContain("0");
  });
});

describe("DataDiagnostics — actions", () => {
  it("Verify checks derived state consistency without writing anything", async () => {
    const db = await openDb();
    await seedMarker(db, "canonical-task-migration:v1", "canonical-task-migration");
    vi.mocked(verifyMigrationState).mockResolvedValueOnce({
      ok: true,
      steps: [
        { id: "canonical-tasks", needed: false, verified: true },
        { id: "task-sets", needed: false, verified: true },
      ],
    });
    const h = renderDiagnostics(db);
    await settle();
    const metaRowsBefore = await db.storageMeta.count();

    const verifyButton = h.$('button[data-action="verify"]') as HTMLButtonElement;
    expect(verifyButton).not.toBeNull();
    act(() => {
      verifyButton.click();
    });
    await settle();

    expect(verifyMigrationState).toHaveBeenCalledTimes(1);
    const status = h.$('[role="status"][data-diag="action-result"]');
    expect(status?.textContent).toContain("2");
    expect(status?.textContent?.toLowerCase()).toContain("verified");
    // Non-destructive: Verify performs reads only.
    expect(await db.storageMeta.count()).toBe(metaRowsBefore);
  });

  it("Resume Migration re-runs the migration registry for incomplete steps", async () => {
    const db = await openDb();
    vi.mocked(runMigrationRegistry).mockResolvedValueOnce({
      owner: true,
      ready: true,
      steps: [
        { id: "canonical-tasks", blocking: true, status: "complete" },
        { id: "task-sets", blocking: true, status: "complete" },
      ],
      errors: [],
      inspectionMs: 3,
    });
    const h = renderDiagnostics(db);
    await settle();

    const resumeButton = h.$('button[data-action="resume-migration"]') as HTMLButtonElement;
    expect(resumeButton).not.toBeNull();
    act(() => {
      resumeButton.click();
    });
    await settle();

    expect(runMigrationRegistry).toHaveBeenCalledTimes(1);
    const status = h.$('[role="status"][data-diag="action-result"]');
    expect(status?.textContent?.toLowerCase()).toContain("ready");
  });

  it("Rebuild Derived Indexes rebuilds disposable search indexes", async () => {
    const db = await openDb();
    const h = renderDiagnostics(db);
    await settle();

    const rebuildButton = h.$('button[data-action="rebuild-indexes"]') as HTMLButtonElement;
    expect(rebuildButton).not.toBeNull();
    act(() => {
      rebuildButton.click();
    });
    await settle();

    const status = h.$('[role="status"][data-diag="action-result"]');
    expect(status?.textContent?.toLowerCase()).toContain("rebuilt");
    expect(await db.searchDocuments.count()).toBe(0);
  });

  it("never offers destructive delete or reset as a repair", async () => {
    const db = await openDb();
    const h = renderDiagnostics(db);
    await settle();

    expect(h.container.textContent).not.toMatch(/\b(delete|reset|wipe|erase)\b/i);
    expect(h.$$('[data-action*="delete"]')).toHaveLength(0);
    expect(h.$$('[data-action*="reset"]')).toHaveLength(0);
  });

  it("displays storage errors safely without raw error echo", async () => {
    const db = await openDb();
    vi.mocked(verifyMigrationState).mockRejectedValueOnce(
      new Error("raw failure with secret apiKey=sk-test-998877"),
    );
    const h = renderDiagnostics(db);
    await settle();

    const verifyButton = h.$('button[data-action="verify"]') as HTMLButtonElement;
    act(() => {
      verifyButton.click();
    });
    await settle();

    const alert = h.$('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(h.container.textContent).not.toContain("sk-test-998877");
    expect(h.container.textContent).not.toContain("raw failure");
  });
});

describe("DataDiagnostics — storage lifecycle and accessibility", () => {
  it("shows an honest blocked state when storage is blocked, not a crash", async () => {
    const db = await openDb();
    const h = renderDiagnostics(db, "blocked");
    await settle();

    expect(h.container.textContent?.toLowerCase()).toContain("blocked");
    expect(h.$('[data-diag="storage-blocked"]')).not.toBeNull();
    // Actions must not run while storage is blocked.
    const verifyButton = h.$('button[data-action="verify"]') as HTMLButtonElement | null;
    expect(verifyButton === null || verifyButton.disabled).toBe(true);
  });

  it("keeps every action keyboard-reachable with visible focus styling", async () => {
    const db = await openDb();
    const h = renderDiagnostics(db);
    await settle();

    const buttons = h.$$("button[data-action]") as HTMLButtonElement[];
    expect(buttons.length).toBe(3);
    for (const button of buttons) {
      expect(button.disabled).toBe(false);
      expect(button.className).toContain("focus-visible:ring-2");
      expect(button.className).toContain("min-h-[44px]");
      act(() => {
        button.focus();
      });
      expect(document.activeElement).toBe(button);
    }
  });
});
