// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { RubricList } from "./RubricList";
import { RubricDetail } from "./RubricDetail";
import { InMemoryEvaluationRepository } from "../../lib/persistence/evaluation-repository";
import type {
  EvaluationCriterion,
  EvaluationRubric,
  EvaluationSuite,
  RubricRecord,
} from "../../lib/evaluations/evaluation-types";

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

function renderWithRouter(node: React.ReactNode, initialEntries?: string[]): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(<MemoryRouter initialEntries={initialEntries ?? ["/"]}>{node}</MemoryRouter>),
  );
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

afterEach(() => {
  document.body.innerHTML = "";
});

async function settle() {
  await act(async () => {
    await flush();
  });
}

// --- Fixtures ----------------------------------------------------------------

function makeCriterion(id: string, name: string): EvaluationCriterion {
  return {
    id,
    name,
    description: `${name} description`,
    weight: 1,
    anchors: { one: "poor", three: "ok", five: "great" },
  };
}

function makeRubric(
  id: string,
  version: number,
  name: string,
  overrides: Partial<EvaluationRubric> = {},
): EvaluationRubric {
  const now = Date.now();
  return {
    id,
    version,
    name,
    description: "",
    judgeInstruction: "Judge fairly.",
    criteria: [makeCriterion("c-1", "Correctness")],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRecord(
  id: string,
  latestVersion: number,
  overrides: Partial<RubricRecord> = {},
): RubricRecord {
  const now = Date.now();
  return {
    id,
    revision: 1,
    latestVersion,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...overrides,
  };
}

async function seedRubric(
  repo: InMemoryEvaluationRepository,
  id: string,
  name: string,
  criteriaCount = 1,
): Promise<void> {
  const criteria = Array.from({ length: criteriaCount }, (_, i) =>
    makeCriterion(`c-${i + 1}`, `Criterion ${i + 1}`),
  );
  const record = makeRecord(id, 1);
  const rubric = makeRubric(id, 1, name, { criteria });
  await repo.createRubric(record, rubric);
}

async function appendVersion(
  repo: InMemoryEvaluationRepository,
  id: string,
  name: string,
): Promise<void> {
  const rec = await repo.getRubricRecord(id);
  if (!rec) throw new Error("record missing");
  const latest = await repo.getRubricVersion(id, rec.latestVersion);
  if (!latest) throw new Error("version missing");
  await repo.appendRubricVersion(
    { ...rec },
    { ...latest, name, updatedAt: Date.now() },
    rec.revision,
  );
}

// --- Tests -------------------------------------------------------------------

describe("RubricList", () => {
  it("shows the rubric kind eyebrow and reusable status, not completed", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "p-1", "Quality");
    const h = renderWithRouter(<RubricList repo={repo} />);
    await settle();
    const text = h.container.textContent ?? "";
    expect(text).toContain("Rubric");
    expect(text).toContain("Reusable");
    expect(text).not.toContain("Completed");
    cleanup(h);
  });

  it("previews the first criterion name and counts the rest", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "p-1", "Quality", 3);
    const h = renderWithRouter(<RubricList repo={repo} />);
    await settle();
    const text = h.container.textContent ?? "";
    expect(text).toContain("Criterion 1");
    expect(text).toContain("+2 more");
    cleanup(h);
  });

  it("lists latest revisions and rows link to /evaluations/rubrics/:id", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "p-1", "Quality");
    await seedRubric(repo, "p-2", "Safety");
    const h = renderWithRouter(<RubricList repo={repo} />);
    await settle();
    const links = h.$$("a[href^='/evaluations/rubrics/']");
    expect(links).toHaveLength(2);
    expect(links.some((l) => l.getAttribute("href") === "/evaluations/rubrics/p-1")).toBe(true);
    expect(links.some((l) => l.getAttribute("href") === "/evaluations/rubrics/p-2")).toBe(true);
    cleanup(h);
  });

  it("shows criterion count and version in the row summary", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "p-1", "Quality", 3);
    const h = renderWithRouter(<RubricList repo={repo} />);
    await settle();
    const text = h.container.textContent ?? "";
    expect(text).toContain("3 criteria");
    expect(text).toContain("v1");
    cleanup(h);
  });

  it("empty state shows 'No rubrics yet' and a Create rubric button", async () => {
    const repo = new InMemoryEvaluationRepository();
    const h = renderWithRouter(<RubricList repo={repo} />);
    await settle();
    expect(h.container.textContent).toMatch(/No rubrics yet/i);
    const createBtn = h.$("button[data-action='create-rubric']");
    expect(createBtn).toBeTruthy();
    cleanup(h);
  });

  it("empty state cross-links suites so first-run users learn the split", async () => {
    const repo = new InMemoryEvaluationRepository();
    const h = renderWithRouter(<RubricList repo={repo} />);
    await settle();
    const link = h.$("a[href='/evaluations']");
    expect(link).toBeTruthy();
    expect(link?.textContent).toContain("Suites");
    expect(h.container.textContent).toMatch(/pin rubrics to score their tasks/i);
    cleanup(h);
  });

  it("Create rubric persists a valid draft that appears in the list", async () => {
    const repo = new InMemoryEvaluationRepository();
    const h = renderWithRouter(<RubricList repo={repo} />);
    await settle();
    const createBtn = h.$("button[data-action='create-rubric']");
    await act(async () => {
      createBtn!.click();
      await flush();
    });
    await settle();
    // The repository's strict guard accepted the draft AND it lists.
    const records = await repo.listRubrics(true);
    expect(records).toHaveLength(1);
    expect(h.container.textContent).not.toMatch(/validation/i);
    cleanup(h);
  });

  it("Show archived toggle reveals archived rubrics and hides them by default", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "p-active", "Active");
    await seedRubric(repo, "p-archived", "Archived");
    // archive the second
    const rec = await repo.getRubricRecord("p-archived");
    await repo.archiveRubric("p-archived", rec!.revision);

    const h = renderWithRouter(<RubricList repo={repo} />);
    await settle();
    // By default, archived is hidden
    expect(h.$$("a[href^='/evaluations/rubrics/']")).toHaveLength(1);
    expect(h.container.textContent).toContain("Active");
    expect(h.container.textContent).not.toContain("Archived");

    // Toggle archived on
    const toggle = h.$("button[data-action='toggle-archived']");
    expect(toggle).toBeTruthy();
    act(() => toggle!.click());
    await settle();
    expect(h.$$("a[href^='/evaluations/rubrics/']")).toHaveLength(2);
    expect(h.container.textContent).toContain("Archived");
    cleanup(h);
  });

  it("Archive removes from the default list", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "p-1", "One");
    await seedRubric(repo, "p-2", "Two");
    const h = renderWithRouter(<RubricList repo={repo} />);
    await settle();
    expect(h.$$("a[href^='/evaluations/rubrics/']")).toHaveLength(2);

    // archive the first row's rubric
    const buttons = h.$$("button[data-action='archive']");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    act(() => buttons[0]!.click());
    await settle();
    expect(h.$$("a[href^='/evaluations/rubrics/']")).toHaveLength(1);
    cleanup(h);
  });

  it("Restore makes the rubric selectable again", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "p-1", "One");
    // pre-archive
    const rec = await repo.getRubricRecord("p-1");
    await repo.archiveRubric("p-1", rec!.revision);

    const h = renderWithRouter(<RubricList repo={repo} />);
    await settle();
    // archived is hidden by default; toggle to reveal
    expect(h.$$("a[href^='/evaluations/rubrics/']")).toHaveLength(0);
    act(() => h.$("button[data-action='toggle-archived']")!.click());
    await settle();
    expect(h.$$("a[href^='/evaluations/rubrics/']")).toHaveLength(1);

    // Restore it
    const restoreBtn = h.$("button[data-action='restore']");
    expect(restoreBtn).toBeTruthy();
    act(() => restoreBtn!.click());
    await settle();
    // now visible without the archived toggle
    act(() => h.$("button[data-action='toggle-archived']")!.click());
    await settle();
    expect(h.$$("a[href^='/evaluations/rubrics/']")).toHaveLength(1);
    cleanup(h);
  });

  it("Duplicate creates a new rubric identity row", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "p-1", "Original");
    const h = renderWithRouter(<RubricList repo={repo} />);
    await settle();
    const dupBtn = h.$("button[data-action='duplicate']");
    expect(dupBtn).toBeTruthy();
    act(() => dupBtn!.click());
    await settle();
    // two rows now, the new one navigates elsewhere; both exist in repo
    const records = await repo.listRubrics(true);
    expect(records).toHaveLength(2);
    cleanup(h);
  });

  it("all interactive controls meet 44px minimum target", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "p-1", "Quality");
    const h = renderWithRouter(<RubricList repo={repo} />);
    await settle();
    const interactives = [...h.$$("button"), ...h.$$("a[href^='/evaluations/rubrics/']")];
    for (const el of interactives) {
      const cls = el.getAttribute("class") ?? "";
      // 44px is expressed via min-h-[44px] or h-11 (44px)
      expect(cls).toMatch(/min-h-\[44px\]|h-11/);
    }
    cleanup(h);
  });
});

describe("RubricDetail", () => {
  it("shows name, version, description, judge instruction for the latest version", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "p-1", "Quality");
    const h = renderWithRouter(<RubricDetail repo={repo} rubricId="p-1" />);
    await settle();
    const nameInput = h.$("#rubric-name") as HTMLInputElement;
    expect(nameInput).toBeTruthy();
    expect(nameInput.value).toBe("Quality");
    const judge = h.$("#rubric-judge") as HTMLTextAreaElement;
    expect(judge).toBeTruthy();
    expect(judge.value).toBe("Judge fairly.");
    const text = h.container.textContent ?? "";
    expect(text).toContain("v1 (latest)");
    cleanup(h);
  });

  it("non-latest version shows read-only banner + Edit as new version", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "p-1", "v1-name");
    await appendVersion(repo, "p-1", "v2-name");
    const h = renderWithRouter(<RubricDetail repo={repo} rubricId="p-1" />);
    await settle();
    // default view is latest (v2); select v1
    const select = h.$("select[data-action='version-selector']") as HTMLSelectElement;
    expect(select).toBeTruthy();
    act(() => {
      select.value = "1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    const text = h.container.textContent ?? "";
    // banner copy
    expect(text).toContain("v1");
    expect(text).toContain("read-only");
    expect(text).toContain("latest v2");
    // Edit as new version button present
    const editBtn = h.$("button[data-action='edit-as-new-version']");
    expect(editBtn).toBeTruthy();
    // name field is read-only
    const nameInput = h.$("#rubric-name") as HTMLInputElement;
    expect(nameInput.readOnly).toBe(true);
    expect(nameInput.value).toBe("v1-name");
    cleanup(h);
  });

  it("Edit as new version preserves prior revisions", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "p-1", "v1-name");
    await appendVersion(repo, "p-1", "v2-name");
    const h = renderWithRouter(<RubricDetail repo={repo} rubricId="p-1" />);
    await settle();
    // go to v1 (read-only)
    const select = h.$("select[data-action='version-selector']") as HTMLSelectElement;
    act(() => {
      select.value = "1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    // prior revisions exist
    expect(await repo.getRubricVersion("p-1", 1)).not.toBeNull();
    expect(await repo.getRubricVersion("p-1", 2)).not.toBeNull();

    // Edit as new version from v1
    const editBtn = h.$("button[data-action='edit-as-new-version']");
    act(() => editBtn!.click());
    await settle();

    // latest is now v3, and prior revisions preserved
    const rec = await repo.getRubricRecord("p-1");
    expect(rec!.latestVersion).toBe(3);
    expect(await repo.getRubricVersion("p-1", 1)).not.toBeNull();
    expect(await repo.getRubricVersion("p-1", 2)).not.toBeNull();
    // new version based on v1 content
    const v3 = await repo.getRubricVersion("p-1", 3);
    expect(v3?.name).toBe("v1-name");
    cleanup(h);
  });

  it("Archive and Restore toggle the record archivedAt", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "p-1", "Quality");
    const h = renderWithRouter(<RubricDetail repo={repo} rubricId="p-1" />);
    await settle();

    const archiveBtn = h.$("button[data-action='archive']");
    expect(archiveBtn).toBeTruthy();
    act(() => archiveBtn!.click());
    await settle();
    let rec = await repo.getRubricRecord("p-1");
    expect(rec!.archivedAt).not.toBeNull();
    expect(h.container.textContent).toMatch(/archived/i);

    const restoreBtn = h.$("button[data-action='restore']");
    expect(restoreBtn).toBeTruthy();
    act(() => restoreBtn!.click());
    await settle();
    rec = await repo.getRubricRecord("p-1");
    expect(rec!.archivedAt).toBeNull();
    cleanup(h);
  });

  it("latest version is editable (Save commits a new version)", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "p-1", "Quality");
    const h = renderWithRouter(<RubricDetail repo={repo} rubricId="p-1" />);
    await settle();

    // name is editable
    const nameInput = h.$("#rubric-name") as HTMLInputElement;
    expect(nameInput.readOnly).toBe(false);
    // Save button present on latest
    const saveBtn = h.$("button[data-action='save']");
    expect(saveBtn).toBeTruthy();

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(nameInput, "Renamed");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    act(() => saveBtn!.click());
    await settle();

    const rec = await repo.getRubricRecord("p-1");
    expect(rec!.latestVersion).toBe(2);
    const v2 = await repo.getRubricVersion("p-1", 2);
    expect(v2?.name).toBe("Renamed");
    // prior version preserved
    const v1 = await repo.getRubricVersion("p-1", 1);
    expect(v1?.name).toBe("Quality");
    cleanup(h);
  });

  it("lists suites pinned to the viewed version", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "p-1", "Quality");
    const suite: EvaluationSuite = {
      id: "s-1",
      revision: 1,
      version: 1,
      name: "My suite",
      description: "",
      tasks: [],
      modelSlots: [],
      defaultJudge: { providerId: "openrouter", model: "gpt-4o" },
      defaultEvaluation: { kind: "profile", profile: { id: "p-1", version: 1 } },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      archivedAt: null,
    };
    await repo.saveSuite(suite, 0);

    const h = renderWithRouter(<RubricDetail repo={repo} rubricId="p-1" />);
    await settle();
    const text = h.container.textContent ?? "";
    expect(text).toContain("My suite");
    expect(text).toMatch(/suites pinned/i);
    cleanup(h);
  });

  it("missing rubric shows not-found state with back link", async () => {
    const repo = new InMemoryEvaluationRepository();
    const h = renderWithRouter(<RubricDetail repo={repo} rubricId="nope" />);
    await settle();
    expect(h.container.textContent).toMatch(/not found/i);
    const back = h.$("a[href='/evaluations/rubrics']");
    expect(back).toBeTruthy();
    cleanup(h);
  });
});

// --- Facet mapping editor (spec §5.3 / §6.2) --------------------------------

describe("RubricDetail — facet mapping editor", () => {
  it("discloses an optional evidence-metadata section with empty state", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "p-1", "Quality");
    const h = renderWithRouter(<RubricDetail repo={repo} rubricId="p-1" />);
    await settle();
    const details = h.$("details[data-facet-mappings]");
    expect(details).toBeTruthy();
    expect(h.container.textContent).toMatch(/evidence metadata/i);
    expect(h.$("[data-facet-mapping-empty]")).toBeTruthy();
    cleanup(h);
  });

  it("lists existing authored mappings read-only on a historical version", async () => {
    const repo = new InMemoryEvaluationRepository();
    // v1 carries an authored mapping.
    await repo.createRubric(
      makeRecord("p-1", 1),
      makeRubric("p-1", 1, "With mapping", {
        criteria: [makeCriterion("c-1", "Correctness")],
        facetMappings: [
          { criterionId: "c-1", facetId: "reasoning", mappingKind: "direct", source: "authored" },
        ],
      }),
    );
    // append v2 without mappings so v1 becomes historical.
    await appendVersion(repo, "p-1", "v2 no mapping");
    const h = renderWithRouter(<RubricDetail repo={repo} rubricId="p-1" />);
    await settle();
    // switch to v1 (read-only)
    const select = h.$("select[data-action='version-selector']") as HTMLSelectElement;
    act(() => {
      select.value = "1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    const list = h.$("[data-facet-mapping-list]");
    expect(list).toBeTruthy();
    expect(h.container.textContent).toContain("c-1");
    expect(h.container.textContent).toContain("reasoning");
    // read-only historical version has no add form and no remove button
    expect(h.$("[data-facet-mapping-add]")).toBeNull();
    expect(h.$("button[data-action='remove-facet-mapping']")).toBeNull();
    cleanup(h);
  });

  it("latest version can author a mapping and Save persists it", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRubric(repo, "p-1", "Quality");
    const h = renderWithRouter(<RubricDetail repo={repo} rubricId="p-1" />);
    await settle();

    // The add form is present on the latest version.
    const addForm = h.$("[data-facet-mapping-add]");
    expect(addForm).toBeTruthy();

    const criterionSelect = h.$("select[data-field='criterion']") as HTMLSelectElement;
    const facetInput = h.$("input[data-field='facet']") as HTMLInputElement;
    const addBtn = h.$("button[data-action='add-facet-mapping']") as HTMLButtonElement;

    act(() => {
      criterionSelect.value = "c-1";
      criterionSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(facetInput, "reasoning");
      facetInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    act(() => addBtn.click());
    await settle();

    // The mapping now appears in the list (draft state).
    const list = h.$("[data-facet-mapping-list]");
    expect(list).toBeTruthy();
    expect(h.container.textContent).toContain("reasoning");

    // Save commits a new immutable version carrying the mapping.
    const saveBtn = h.$("button[data-action='save']") as HTMLButtonElement;
    act(() => saveBtn.click());
    await settle();

    const rec = await repo.getRubricRecord("p-1");
    expect(rec!.latestVersion).toBe(2);
    const v2 = await repo.getRubricVersion("p-1", 2);
    expect(v2?.facetMappings).toEqual([
      { criterionId: "c-1", facetId: "reasoning", mappingKind: "direct", source: "authored" },
    ]);
    cleanup(h);
  });

  it("Remove drops a mapping from the draft before save", async () => {
    const repo = new InMemoryEvaluationRepository();
    await repo.createRubric(
      makeRecord("p-1", 1),
      makeRubric("p-1", 1, "With mapping", {
        criteria: [makeCriterion("c-1", "Correctness")],
        facetMappings: [
          { criterionId: "c-1", facetId: "reasoning", mappingKind: "direct", source: "authored" },
        ],
      }),
    );
    const h = renderWithRouter(<RubricDetail repo={repo} rubricId="p-1" />);
    await settle();

    // Latest version shows a remove button for the existing mapping.
    const removeBtn = h.$("button[data-action='remove-facet-mapping']") as HTMLButtonElement;
    expect(removeBtn).toBeTruthy();
    act(() => removeBtn.click());
    await settle();

    // Draft no longer lists the mapping; empty state returns.
    expect(h.$("[data-facet-mapping-list]")).toBeNull();
    expect(h.$("[data-facet-mapping-empty]")).toBeTruthy();

    // Save persists the cleared mapping on a new version.
    const saveBtn = h.$("button[data-action='save']") as HTMLButtonElement;
    act(() => saveBtn.click());
    await settle();
    const v2 = await repo.getRubricVersion("p-1", 2);
    expect(v2?.facetMappings ?? []).toEqual([]);
    cleanup(h);
  });
});
