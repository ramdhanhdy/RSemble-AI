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
import {
  importWorkbenchArchive,
  type WorkbenchArchiveV1,
} from "../lib/persistence/archive";
import type { EvaluationSuite } from "../lib/evaluations/evaluation-types";
import type { RunRecordV2 } from "../lib/persistence/run-types";

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
    root.render(
      <RepositoryContext.Provider value={value}>{node}</RepositoryContext.Provider>,
    );
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
      { id: "s1", providerId: "openrouter", provider: "OpenRouter", model: "m1", slug: "m1", enabled: true },
      { id: "s2", providerId: "gemini", provider: "Gemini", model: "m2", slug: "m2", enabled: true },
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

function contextValue(db: RSembleEvaluationDB | null, storageState: RepositoryContextValue["storageState"]): RepositoryContextValue {
  return { runRepo: null, evalRepo: null, fusionRepo: null, db, storageState, retry: () => undefined };
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
