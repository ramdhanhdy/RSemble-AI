// @vitest-environment happy-dom
// =============================================================================
// RSemble AI — DataArchiveActions tests (plan 8.1 items 7/8 + UI behavior)
//
// Export/import controls wired to the repository context: truthful disabled
// states, byte validation before decoding, parse-error surfacing, import count
// reporting, conflict listing, and the invariant that imported Markdown text
// renders through the safe renderer (never executed as HTML).
// =============================================================================

import "fake-indexeddb/auto";
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { DataArchiveActions } from "./DataArchiveActions";
import { Markdown } from "./Markdown";
import {
  RepositoryContext,
  type RepositoryContextValue,
} from "../lib/persistence/repository-context";
import { RSembleEvaluationDB } from "../lib/persistence/database";
import { importWorkbenchArchive, type WorkbenchArchiveV1 } from "../lib/persistence/archive";
import type { EvaluationSuite } from "../lib/evaluations/evaluation-types";
import type { RunRecordV2 } from "../lib/persistence/run-types";
import * as fx from "../lib/persistence/archive-v2-fixtures";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
}

function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function renderWithContext(node: React.ReactNode, value: RepositoryContextValue): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<RepositoryContext.Provider value={value}>{node}</RepositoryContext.Provider>);
  });
  return {
    container,
    root,
    $: (s) => container.querySelector<HTMLElement>(s),
    $$: (s) => [...container.querySelectorAll<HTMLElement>(s)],
  };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await flush();
  });
}

// --- Fixtures -------------------------------------------------------------------

function makeSuite(id: string, name = `Suite ${id}`): EvaluationSuite {
  return {
    id,
    revision: 1,
    version: 1,
    name,
    description: "test suite",
    tasks: [
      {
        id: "task-1",
        title: "Task 1",
        prompt: "Do something",
        systemPrompt: "",
        evaluation: { kind: "holistic" },
        judgeInstructionOverride: "",
        order: 0,
      },
    ],
    modelSlots: [
      {
        id: "s1",
        providerId: "openrouter",
        provider: "OpenRouter",
        model: "m1",
        slug: "m1",
        enabled: true,
      },
      {
        id: "s2",
        providerId: "gemini",
        provider: "Gemini",
        model: "m2",
        slug: "m2",
        enabled: true,
      },
    ],
    defaultJudge: { providerId: "openrouter", model: "judge" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  };
}

function makeRunWithOutput(id: string, output: string): RunRecordV2 {
  return {
    schemaVersion: 2,
    id,
    revision: 1,
    execution: { ownerId: "owner", fence: 1 },
    createdAt: 1000,
    updatedAt: 1000,
    completedAt: 2000,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: { title: "Task", prompt: "Prompt", systemPrompt: "", temperature: 0.7 },
    evaluation: { profile: null, candidateMessages: [] },
    candidates: [
      {
        candidateId: "c-1",
        slotId: "s-1",
        modelKey: "openrouter:foo",
        providerId: "openrouter",
        model: "Foo",
        slug: "foo",
        acceptedAttemptId: "att-1",
        attempts: [
          {
            attemptId: "att-1",
            messages: [{ role: "user", content: "Prompt" }],
            startedAt: 1000,
            finishedAt: 2000,
            status: "completed",
            output,
            tokensIn: 1,
            tokensOut: 1,
            error: null,
          },
        ],
      },
    ],
    judge: { status: "idle", acceptedAttemptId: null, report: null, consensus: null, attempts: [] },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
  };
}

function archiveWithSuites(suites: EvaluationSuite[]): WorkbenchArchiveV1 {
  return {
    schemaVersion: 1,
    exportedAt: 1000,
    runs: { summaries: [], details: [] },
    profiles: { identities: [], versions: [] },
    suites,
    experiments: [],
  };
}

function contextValue(
  db: RSembleEvaluationDB | null,
  storageState: RepositoryContextValue["storageState"],
): RepositoryContextValue {
  return {
    taskRepo: null,
    runRepo: null,
    evalRepo: null,
    fusionRepo: null,
    db,
    storageState,
    retry: () => undefined,
  };
}

async function chooseFile(h: Harness, file: File) {
  const input = h.$('input[type="file"]') as HTMLInputElement | null;
  expect(input).not.toBeNull();
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input!.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
  });
  await settle();
}

// --- Setup ----------------------------------------------------------------------

let db: RSembleEvaluationDB;
const cleanups: Harness[] = [];

beforeEach(async () => {
  db = new RSembleEvaluationDB("test-archive-ui-" + Math.random());
  await db.open();
});

afterEach(async () => {
  while (cleanups.length > 0) cleanup(cleanups.pop()!);
  document.body.innerHTML = "";
  vi.clearAllMocks();
  db.close();
  await db.delete();
});

function renderActions(value: RepositoryContextValue): Harness {
  const h = renderWithContext(<DataArchiveActions />, value);
  cleanups.push(h);
  return h;
}

// --- Tests ----------------------------------------------------------------------

describe("DataArchiveActions — disabled states", () => {
  it("disables export with a truthful helper when the database is null", () => {
    const h = renderActions(contextValue(null, "unavailable"));
    const exportButton = h.$('button[data-action="export"]') as HTMLButtonElement | null;
    expect(exportButton).not.toBeNull();
    expect(exportButton!.disabled).toBe(true);
    expect(h.container.textContent).toContain("Storage is unavailable");
  });

  it("disables controls with upgrade guidance while storage is blocked", () => {
    const h = renderActions(contextValue(db, "blocked"));
    const exportButton = h.$('button[data-action="export"]') as HTMLButtonElement | null;
    const importButton = h.$('button[data-action="import"]') as HTMLButtonElement | null;
    expect(exportButton!.disabled).toBe(true);
    expect(importButton!.disabled).toBe(true);
    expect(h.container.textContent).toContain(
      "Close other RSemble tabs to finish the storage upgrade, then retry.",
    );
  });
});

describe("DataArchiveActions — import flow", () => {
  it("imports a crafted archive file and reports Created/Skipped/Conflicts", async () => {
    const h = renderActions(contextValue(db, "ready"));
    const archive = archiveWithSuites([makeSuite("suite-a"), makeSuite("suite-b")]);
    const file = new File([JSON.stringify(archive)], "archive.json", {
      type: "application/json",
    });
    await chooseFile(h, file);

    const status = h.$('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.textContent).toContain("Created 2 · Skipped 0 · Conflicts 0");
    expect(await db.suites.count()).toBe(2);
  });

  it("reports conflicting IDs without overwriting existing data", async () => {
    await importWorkbenchArchive(db, archiveWithSuites([makeSuite("suite-a", "Original")]));
    const h = renderActions(contextValue(db, "ready"));
    const archive = archiveWithSuites([makeSuite("suite-a", "Changed")]);
    const file = new File([JSON.stringify(archive)], "archive.json", {
      type: "application/json",
    });
    await chooseFile(h, file);

    const status = h.$('[role="status"]');
    expect(status!.textContent).toContain("Created 0 · Skipped 0 · Conflicts 1");
    expect(status!.textContent).toContain("suite-a");
    const row = await db.suites.get("suite-a");
    expect((row?.suite as EvaluationSuite).name).toBe("Original");
  });

  it("shows an invalid-archive line for malformed JSON without importing", async () => {
    const h = renderActions(contextValue(db, "ready"));
    const file = new File(["{not json"], "archive.json", { type: "application/json" });
    await chooseFile(h, file);

    const alert = h.$('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain("The archive is invalid — nothing was imported.");
    expect(await db.suites.count()).toBe(0);
  });

  it("lists validation errors for a schema-mismatched archive", async () => {
    const h = renderActions(contextValue(db, "ready"));
    const file = new File([JSON.stringify({ schemaVersion: 2 })], "archive.json", {
      type: "application/json",
    });
    await chooseFile(h, file);

    const alert = h.$('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toMatch(/schema/i);
    expect(await db.suites.count()).toBe(0);
  });
});

describe("imported Markdown safety invariant (plan 8.1 item 8)", () => {
  it("renders imported output through the safe Markdown renderer — text stays text", async () => {
    const payload = `<script>alert("x")</script>\n**bold claim** <img src=x onerror=alert(1)>`;
    const archive = archiveWithSuites([]);
    archive.runs.details.push(makeRunWithOutput("run-html", payload));
    await importWorkbenchArchive(db, archive);

    const row = await db.runDetails.get("run-html");
    const record = row?.record as RunRecordV2;
    const importedOutput = record.candidates[0].attempts[0].output;
    expect(importedOutput).toBe(payload);

    const h = renderWithContext(
      <Markdown text={importedOutput ?? ""} />,
      contextValue(db, "ready"),
    );
    cleanups.push(h);
    expect(h.container.querySelector("script")).toBeNull();
    expect(h.container.querySelector("img")).toBeNull();
    expect(h.container.textContent).toContain('<script>alert("x")</script>');
    expect(h.container.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});

// --- Task 10B: v2 export flow ---------------------------------------------------

/** Seed a complete canonical corpus so the v2 export exercises every stage. */
async function seedV2Corpus(target: RSembleEvaluationDB): Promise<void> {
  const bytes = new TextEncoder().encode("candidate-visible artifact text");
  await target.runSummaries.put(fx.runSummaryRow(fx.makeRunSummary("run-1")));
  await target.runDetails.put(fx.runDetailRow(fx.makeRunDetail("run-1")));
  await target.profiles.put(fx.profileRow(fx.makeRubricRecord("rubric-1")));
  await target.profileVersions.put(fx.profileVersionRow(fx.makeRubricVersion("rubric-1", 1)));
  await target.suites.put(fx.suiteRow(fx.makeSuite("suite-1")));
  await target.experiments.put(fx.experimentRow(fx.makeExperiment("exp-1", "suite-1")));
  await target.fusionRecipes.put(fx.fusionRecipeRow(fx.makeRecipe("recipe-1", 1)));
  await target.poolManifests.put(fx.poolManifestRow(fx.makePoolManifest("pool-1", 1)));
  await target.fusionStudies.put(fx.fusionStudyRow(fx.makeStudy("study-1")));
  await target.fusionTrials.put(fx.fusionTrialRow(fx.makeTrial("trial-1", "study-1")));
  await target.fusionAttempts.put(fx.fusionAttemptRow(fx.makeAttempt("attempt-1", "study-1")));
  await target.fusionObservations.put(
    fx.fusionObservationRow(fx.makeObservation("obs-1", "trial-1")),
  );
  await target.fusionPlaybooks.put(
    fx.fusionPlaybookRow(fx.makePlaybook("playbook-1", "study-1")),
  );
  await target.tasks.put(fx.taskRecordRow(fx.makeTaskRecord("task-1")));
  await target.taskVersions.put(fx.taskVersionRow(fx.makeTaskVersion("task-1", 1, "art-1")));
  await target.taskArtifacts.put(fx.taskArtifactRow(fx.makeTaskArtifact("art-1", bytes)));
  await target.taskArtifactBytes.put(fx.taskArtifactBytesRow("art-1", bytes));
  await target.taskInstances.put(
    fx.taskInstanceRow(fx.makeTaskInstance("inst-1", "task-1", 1, "art-1")),
  );
  await target.taskFamilies.put(fx.taskFamilyRow(fx.makeTaskFamily("fam-1")));
  await target.taskFamilyAssignments.put(
    fx.taskFamilyAssignmentRow(fx.makeTaskFamilyAssignment("fa-1", "task-1", 1, "fam-1")),
  );
  await target.taskFamilyRelations.put(
    fx.taskFamilyRelationRow(fx.makeTaskFamilyRelation("rel-1", "fam-1", "fam-1")),
  );
  await target.taskFacetAnnotations.put(
    fx.taskFacetAnnotationRow(fx.makeTaskFacetAnnotation("ann-1", "task-1")),
  );
  await target.taskMigrationCrosswalk.put(
    fx.taskMigrationCrosswalkRow(fx.makeCrosswalk("task-1", 1)),
  );
}

describe("DataArchiveActions — v2 export flow", () => {
  it("downloads the complete task-first v2 archive and reports the exported entity total", async () => {
    await seedV2Corpus(db);
    const downloaded: HTMLAnchorElement[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloaded.push(this);
      });

    const h = renderActions(contextValue(db, "ready"));
    const exportButton = h.$('button[data-action="export-v2"]') as HTMLButtonElement | null;
    expect(exportButton).not.toBeNull();
    await act(async () => {
      exportButton!.click();
      await flush();
    });
    await settle();

    expect(downloaded.length).toBe(1);
    expect(downloaded[0].download).toMatch(/^rsemble-archive-v2-\d{8}-\d{6}\.json$/);
    const status = h.$('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.textContent).toMatch(/exported/i);
    clickSpy.mockRestore();
  });

  it("cancels a running export before delivery — no download, truthful guidance", async () => {
    await seedV2Corpus(db);
    const downloaded: HTMLAnchorElement[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloaded.push(this);
      });

    const h = renderActions(contextValue(db, "ready"));
    const exportButton = h.$('button[data-action="export-v2"]') as HTMLButtonElement;
    await act(async () => {
      exportButton.click();
      await flush();
    });
    const cancelButton = h.$('button[data-action="cancel-export"]') as HTMLButtonElement | null;
    expect(cancelButton).not.toBeNull();
    await act(async () => {
      cancelButton!.click();
      await flush();
    });
    await settle();

    expect(downloaded.length).toBe(0);
    expect(h.container.textContent).toContain(
      "Export was cancelled — no archive was delivered.",
    );
    clickSpy.mockRestore();
  });

  it("blocks an unsafe export before download with redacted entity/type diagnostics", async () => {
    const secret = fx.makeRunDetail("run-secret");
    secret.task.prompt = "Bearer abc123def456 is the header to use";
    await db.runDetails.put(fx.runDetailRow(secret));
    const downloaded: HTMLAnchorElement[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloaded.push(this);
      });

    const h = renderActions(contextValue(db, "ready"));
    const exportButton = h.$('button[data-action="export-v2"]') as HTMLButtonElement;
    await act(async () => {
      exportButton.click();
      await flush();
    });
    await settle();

    expect(downloaded.length).toBe(0);
    const alert = h.$('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain("runs.details");
    expect(alert!.textContent).toContain("run-secret");
    expect(alert!.textContent).not.toContain("Bearer abc123def456");
    clickSpy.mockRestore();
  });
});
