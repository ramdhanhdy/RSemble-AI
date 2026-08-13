// @vitest-environment happy-dom
//
// TaskFacetEditor tests — Child 02 (Canonical Tasks) Task 8B (RED first).
//
// Covers the facet annotation contract from canonical-tasks spec §3.6 and the
// Task 8B acceptance list:
//   - authored facet annotations created from the shipped taxonomy allowlist;
//   - imported/suggested source, author kind, confidence, taxonomy version,
//     and supersession provenance all displayed honestly;
//   - suggested annotations never become accepted without explicit user
//     confirmation; acceptance appends an authored annotation that supersedes
//     the suggestion instead of mutating history;
//   - disabled (archived Task) mode is read-only;
//   - long/unknown value identifiers render unabridged.
//
// Uses the repo's happy-dom createRoot/act harness — no testing-library.

import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { InMemoryTaskRepository } from "../../lib/persistence/in-memory-task-repository";
import { TaskFacetEditor } from "./TaskFacetEditor";
import type { TaskFacetAnnotation, TaskRecord, TaskVersion } from "../../lib/tasks/task-types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// --- Fixtures ---------------------------------------------------------------

const NOW = 1_700_000_000_000;

async function seedTask(repo: InMemoryTaskRepository, id = "t-1"): Promise<TaskRecord> {
  const version: TaskVersion = {
    taskId: id,
    version: 1,
    title: `Task ${id}`,
    objective: `Objective for ${id}.`,
    candidateInstruction: `Do: ${id}.`,
    defaultContextManifest: [],
    responseContract: null,
    taskVerifierRef: null,
    source: { kind: "authored", legacyScopeKey: null, note: null },
    createdAt: NOW,
  };
  const record: TaskRecord = {
    id,
    latestVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    origin: "authored",
    revision: 0,
  };
  await repo.createTask(record, version);
  return record;
}

function annotation(overrides: Partial<TaskFacetAnnotation>): TaskFacetAnnotation {
  return {
    id: "ann-1",
    taskId: "t-1",
    taskVersion: null,
    facetId: "domain",
    valueId: "nlp",
    source: "authored",
    authorKind: "user",
    confidence: null,
    taxonomyVersion: 1,
    createdAt: NOW,
    supersedesId: null,
    ...overrides,
  };
}

// --- Harness -----------------------------------------------------------------

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
}

function renderEditor(repo: InMemoryTaskRepository, taskId = "t-1", disabled = false): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <TaskFacetEditor repo={repo} taskId={taskId} disabled={disabled} />
      </MemoryRouter>,
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

async function settle(turns = 6) {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
}

function selectValue(el: HTMLElement, value: string) {
  act(() => {
    (el as HTMLSelectElement).value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function click(el: HTMLElement | null) {
  if (!el) throw new Error("click target not found");
  act(() => {
    (el as HTMLButtonElement).click();
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

// --- Tests --------------------------------------------------------------------

describe("TaskFacetEditor — provenance display (spec §3.6)", () => {
  it("displays effective annotations per dimension with source/author/taxonomy chips", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo);
    await repo.annotateTaskFacet(annotation({ id: "ann-1", facetId: "domain", valueId: "nlp" }));
    await repo.annotateTaskFacet(
      annotation({
        id: "ann-2",
        facetId: "modality",
        valueId: "text-in-text-out",
        source: "imported",
        authorKind: "migration",
        confidence: 0.8,
      }),
    );
    const h = renderEditor(repo);
    await settle();
    expect(h.$("[data-facet-editor]")).toBeTruthy();
    // Effective values resolve to taxonomy labels.
    const domainRow = h.$("[data-facet-row='domain']");
    expect(domainRow?.textContent).toContain("Natural language");
    expect(domainRow?.querySelector("[data-facet-source]")?.textContent).toMatch(/authored/i);
    const modalityRow = h.$("[data-facet-row='modality']");
    expect(modalityRow?.textContent).toContain("Text → Text");
    expect(modalityRow?.querySelector("[data-facet-source]")?.textContent).toMatch(/imported/i);
    expect(modalityRow?.querySelector("[data-facet-author]")?.textContent).toMatch(/migration/i);
    expect(modalityRow?.querySelector("[data-facet-confidence]")?.textContent).toContain("0.8");
    expect(modalityRow?.querySelector("[data-facet-taxonomy]")?.textContent).toContain("1");
    cleanup(h);
  });

  it("shows supersession provenance on the superseding row and keeps the superseded row in history", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo);
    await repo.annotateTaskFacet(annotation({ id: "ann-old", facetId: "domain", valueId: "nlp" }));
    await repo.annotateTaskFacet(
      annotation({
        id: "ann-new",
        facetId: "domain",
        valueId: "code",
        supersedesId: "ann-old",
        createdAt: NOW + 10,
      }),
    );
    const h = renderEditor(repo);
    await settle();
    const domainRow = h.$("[data-facet-row='domain']");
    expect(domainRow?.textContent).toContain("Code & software");
    expect(domainRow?.querySelector("[data-facet-supersedes]")?.textContent).toMatch(/supersedes/i);
    // History keeps the superseded annotation — never mutated or removed.
    const history = h.$$("[data-facet-history-row]");
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history.some((r) => r.textContent?.includes("Natural language"))).toBe(true);
    cleanup(h);
  });

  it("renders unknown value identifiers raw and unabridged (long values)", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo);
    const longValue = `imported-${"v".repeat(300)}`;
    await repo.annotateTaskFacet(
      annotation({
        id: "ann-x",
        facetId: "domain",
        valueId: longValue,
        source: "imported",
        authorKind: "migration",
      }),
    );
    const h = renderEditor(repo);
    await settle();
    expect(h.$("[data-facet-row='domain']")?.textContent).toContain(longValue);
    cleanup(h);
  });
});

describe("TaskFacetEditor — authored annotations (spec §3.6)", () => {
  it("adds an authored annotation from the taxonomy allowlist", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo);
    const h = renderEditor(repo);
    await settle();
    const dimension = h.$("select[data-field='facet-dimension']") as HTMLSelectElement;
    expect(dimension).toBeTruthy();
    selectValue(dimension, "task-form");
    const value = h.$("select[data-field='facet-value']") as HTMLSelectElement;
    const optionLabels = [...value.querySelectorAll("option")].map((o) => o.textContent ?? "");
    expect(optionLabels.join(",")).toContain("Summarization");
    selectValue(value, "summarization");
    click(h.$("button[data-action='add-facet']"));
    await settle();
    const annotations = await repo.listTaskFacetAnnotations("t-1");
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({
      facetId: "task-form",
      valueId: "summarization",
      source: "authored",
      authorKind: "user",
      taxonomyVersion: 1,
      supersedesId: null,
    });
    // The editor re-reads stored state and shows the new effective value.
    expect(h.$("[data-facet-row='task-form']")?.textContent).toContain("Summarization");
    cleanup(h);
  });

  it("adding a value where an effective annotation exists appends a superseding annotation", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo);
    await repo.annotateTaskFacet(annotation({ id: "ann-old", facetId: "domain", valueId: "nlp" }));
    const h = renderEditor(repo);
    await settle();
    selectValue(h.$("select[data-field='facet-dimension']")!, "domain");
    selectValue(h.$("select[data-field='facet-value']")!, "math");
    click(h.$("button[data-action='add-facet']"));
    await settle();
    const annotations = await repo.listTaskFacetAnnotations("t-1");
    expect(annotations).toHaveLength(2);
    const added = annotations.find((a) => a.valueId === "math")!;
    expect(added.supersedesId).toBe("ann-old");
    expect(added.source).toBe("authored");
    // The old annotation is intact — append, never mutate.
    const old = annotations.find((a) => a.id === "ann-old")!;
    expect(old.valueId).toBe("nlp");
    cleanup(h);
  });

  it("keeps Add disabled until a dimension and a value are chosen", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo);
    const h = renderEditor(repo);
    await settle();
    const add = h.$("button[data-action='add-facet']") as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    selectValue(h.$("select[data-field='facet-dimension']")!, "domain");
    selectValue(h.$("select[data-field='facet-value']")!, "nlp");
    expect(add.disabled).toBe(false);
    cleanup(h);
  });
});

describe("TaskFacetEditor — suggested annotation acceptance (spec §3.6)", () => {
  it("renders suggested annotations with an explicit Accept action, never auto-accepting", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo);
    await repo.annotateTaskFacet(
      annotation({
        id: "ann-sug",
        facetId: "setting",
        valueId: "research",
        source: "suggested",
        authorKind: "system",
        confidence: 0.6,
      }),
    );
    const h = renderEditor(repo);
    await settle();
    // Still suggested in storage — nothing auto-accepted on load.
    const stored = await repo.listTaskFacetAnnotations("t-1");
    expect(stored).toHaveLength(1);
    expect(stored[0].source).toBe("suggested");
    const row = h.$("[data-facet-row='setting']");
    expect(row?.textContent).toMatch(/suggested/i);
    expect(h.$("button[data-action='accept-suggestion']")).toBeTruthy();
    cleanup(h);
  });

  it("accepting requires explicit confirmation; cancel writes nothing", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo);
    await repo.annotateTaskFacet(
      annotation({
        id: "ann-sug",
        facetId: "setting",
        valueId: "research",
        source: "suggested",
        authorKind: "system",
        confidence: 0.6,
      }),
    );
    const h = renderEditor(repo);
    await settle();
    click(h.$("button[data-action='accept-suggestion']"));
    await settle();
    // Confirmation boundary: nothing accepted yet.
    expect(
      (await repo.listTaskFacetAnnotations("t-1")).filter((a) => a.source === "authored"),
    ).toHaveLength(0);
    expect(h.$("button[data-action='confirm-accept-suggestion']")).toBeTruthy();
    click(h.$("button[data-action='cancel-accept-suggestion']"));
    await settle();
    expect(
      (await repo.listTaskFacetAnnotations("t-1")).filter((a) => a.source === "authored"),
    ).toHaveLength(0);
    // The suggestion is still pending.
    expect(h.$("button[data-action='accept-suggestion']")).toBeTruthy();
    cleanup(h);
  });

  it("committing acceptance appends an authored annotation superseding the suggestion", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo);
    await repo.annotateTaskFacet(
      annotation({
        id: "ann-sug",
        facetId: "setting",
        valueId: "research",
        source: "suggested",
        authorKind: "system",
        confidence: 0.6,
      }),
    );
    const h = renderEditor(repo);
    await settle();
    click(h.$("button[data-action='accept-suggestion']"));
    await settle();
    click(h.$("button[data-action='confirm-accept-suggestion']"));
    await settle();
    const annotations = await repo.listTaskFacetAnnotations("t-1");
    expect(annotations).toHaveLength(2);
    const accepted = annotations.find((a) => a.source === "authored")!;
    expect(accepted).toMatchObject({
      facetId: "setting",
      valueId: "research",
      authorKind: "user",
      supersedesId: "ann-sug",
    });
    // The suggestion row survives unmutated (history is append-only).
    const suggestion = annotations.find((a) => a.id === "ann-sug")!;
    expect(suggestion.source).toBe("suggested");
    expect(suggestion.supersedesId).toBeNull();
    // The pending Accept action is gone — the effective value is now authored.
    expect(h.$("button[data-action='accept-suggestion']")).toBeNull();
    expect(
      h.$("[data-facet-row='setting']")?.querySelector("[data-facet-source]")?.textContent,
    ).toMatch(/authored/i);
    cleanup(h);
  });
});

describe("TaskFacetEditor — read-only mode (archived Task, spec §4.5)", () => {
  it("disabled mode shows provenance but no add/accept controls", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo);
    await repo.annotateTaskFacet(annotation({ id: "ann-1", facetId: "domain", valueId: "nlp" }));
    await repo.annotateTaskFacet(
      annotation({
        id: "ann-sug",
        facetId: "setting",
        valueId: "research",
        source: "suggested",
        authorKind: "system",
      }),
    );
    const h = renderEditor(repo, "t-1", true);
    await settle();
    expect(h.$("[data-facet-row='domain']")?.textContent).toContain("Natural language");
    expect(h.$("button[data-action='add-facet']")).toBeNull();
    expect(h.$("button[data-action='accept-suggestion']")).toBeNull();
    expect(h.$("select[data-field='facet-dimension']")).toBeNull();
    cleanup(h);
  });
});
