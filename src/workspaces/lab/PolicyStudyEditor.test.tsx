// @vitest-environment happy-dom
// =============================================================================
// PolicyStudyEditor tests — the draft editor for a Policy Study (Fable §10).
//
// Contract under test:
//  - identity header (KindEyebrow, ClaimBadge, StatusMark draft);
//  - six-part Define Inputs form (title/question, workload, pool, recipes,
//    judges & rubric, protocol & claim plan);
//  - CAS-backed draft persistence with a visible "Saved · revision N" state;
//  - claim plan radio cards (confirmation disabled without a source study);
//  - Delete draft only while the draft is untouched;
//  - seal validation lists unmet requirements in plain text;
//  - seal confirmation dialog restates pins + digests, then startStudy seals.
// =============================================================================
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { InMemoryStudyRepository } from "../../lib/persistence/study-repository";
import { InMemoryEvaluationRepository } from "../../lib/persistence/evaluation-repository";
import { InMemoryLabAssetRepository } from "../../lib/persistence/lab-asset-repository";
import type {
  EvaluationCriterion,
  EvaluationRubric,
  EvaluationSuite,
  RubricRecord,
} from "../../lib/evaluations/evaluation-types";
import type { ModelSlot } from "../../studio-data";
import type { PolicyStudyRecord } from "../../lib/studies/policy/policy-study-types";
import { PolicyStudyEditor } from "./PolicyStudyEditor";
import { draftPolicyStudyDefinition } from "./lab-draft";
import {
  makeDefinition,
  makePoolRecord,
  makePoolVersion,
  makeRecipeRecord,
  makeRecipeVersion,
  makeStudyRecord,
} from "./lab-test-fixtures";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
  text: () => string;
}

function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await flush();
    });
  }
}

function renderEditor(
  studyRepo: InMemoryStudyRepository,
  study: PolicyStudyRecord,
  extras: {
    evalRepo?: InMemoryEvaluationRepository | null;
    labAssetRepo?: InMemoryLabAssetRepository | null;
    onSealed?: (s: PolicyStudyRecord) => void;
    onDeleted?: () => void;
  } = {},
): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <PolicyStudyEditor
          studyRepo={studyRepo}
          evalRepo={extras.evalRepo ?? null}
          labAssetRepo={extras.labAssetRepo ?? null}
          study={study}
          onSealed={extras.onSealed}
          onDeleted={extras.onDeleted}
        />
      </MemoryRouter>,
    );
  });
  return {
    container,
    root,
    $: (s) => container.querySelector<HTMLElement>(s),
    $$: (s) => [...container.querySelectorAll<HTMLElement>(s)],
    text: () => container.textContent ?? "",
  };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

afterEach(() => {
  document.body.innerHTML = "";
});

// --- Fixtures -----------------------------------------------------------------

function slot(id: string, model: string): ModelSlot {
  return { id, providerId: "openrouter", provider: "Test", model, slug: model, enabled: true };
}

export function makeEditorSuite(id: string, version = 6): EvaluationSuite {
  return {
    id,
    revision: 1,
    version,
    name: `Task Set ${id}`,
    description: "",
    tasks: [],
    modelSlots: [slot("s1", "acme/cand-1"), slot("s2", "acme/cand-2"), slot("s3", "acme/judge-2")],
    defaultJudge: { providerId: "openrouter", model: "acme/judge-1" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: 1_000,
    updatedAt: 1_000,
    archivedAt: null,
  };
}

function makeCriterion(id: string, name: string): EvaluationCriterion {
  return {
    kind: "graded",
    id,
    name,
    description: `${name} description`,
    weight: 1,
    anchors: { one: "poor", two: "weak", three: "ok", four: "good", five: "great" },
  };
}

function makeRubric(id: string, version: number, name: string): EvaluationRubric {
  return {
    id,
    version,
    name,
    description: "",
    judgeInstruction: "Judge fairly.",
    criteria: [makeCriterion("c-1", "Correctness")],
    createdAt: 1_000,
    updatedAt: 1_000,
  };
}

function rubricRecord(id: string, latestVersion: number): RubricRecord {
  return {
    id,
    revision: 1,
    latestVersion,
    createdAt: 1_000,
    updatedAt: 1_000,
    archivedAt: null,
  };
}

async function seedAssets() {
  const evalRepo = new InMemoryEvaluationRepository();
  await evalRepo.saveSuite(makeEditorSuite("ts1", 6), 0);
  await evalRepo.createRubric(rubricRecord("rub1", 1), makeRubric("rub1", 1, "Reliability"));
  const labAssetRepo = new InMemoryLabAssetRepository();
  await labAssetRepo.createRecipeRecord(makeRecipeRecord("recipe-1"), makeRecipeVersion("recipe-1", 1));
  await labAssetRepo.createPoolRecord(makePoolRecord("pool-1"), makePoolVersion("pool-1", 1));
  return { evalRepo, labAssetRepo };
}

function typeInto(input: HTMLInputElement, value: string) {
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  proto?.set?.call(input, value);
  act(() => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function selectOption(select: HTMLSelectElement, label: string) {
  const option = [...select.options].find((o) => o.textContent?.includes(label));
  if (!option) throw new Error(`No option containing ${label} in ${select.getAttribute("aria-label")}`);
  const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  proto?.set?.call(select, option.value);
  act(() => {
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Pin every required input through the real controls. */
async function pinAllInputs(h: Harness) {
  selectOption(h.$("select[aria-label='Task Set Version']") as HTMLSelectElement, "Task Set ts1");
  await settle();
  selectOption(h.$("select[aria-label='Model Pool']") as HTMLSelectElement, "Pool v1");
  await settle();
  click(h.$("[data-testid='recipe-option-recipe-1-v1'] input") as HTMLElement);
  await settle();
  selectOption(h.$("select[aria-label='Judge 1']") as HTMLSelectElement, "acme/judge-1");
  await settle();
  selectOption(h.$("select[aria-label='Judge 2']") as HTMLSelectElement, "acme/judge-2");
  await settle();
  selectOption(h.$("select[aria-label='Rubric']") as HTMLSelectElement, "Reliability");
  await settle();
}

// --- Identity + form structure ------------------------------------------------

describe("PolicyStudyEditor — identity and six-part form", () => {
  it("renders the draft identity header and all six define-inputs parts", async () => {
    const studyRepo = new InMemoryStudyRepository();
    const study = makeStudyRecord({ definition: draftPolicyStudyDefinition() });
    await studyRepo.createStudy(study);
    const { evalRepo, labAssetRepo } = await seedAssets();
    const h = renderEditor(studyRepo, study, { evalRepo, labAssetRepo });
    await settle();

    expect(h.text()).toMatch(/POLICY STUDY/i);
    expect(h.$("[data-testid='claim-badge']")?.textContent).toMatch(/Exploratory/);
    expect(h.$("[data-status-mark]")?.textContent).toMatch(/Draft/);
    expect(h.$("input[aria-label='Title & research question']")).toBeTruthy();
    expect(h.$("select[aria-label='Task Set Version']")).toBeTruthy();
    expect(h.$("select[aria-label='Model Pool']")).toBeTruthy();
    expect(h.$("select[aria-label='Judge 1']")).toBeTruthy();
    expect(h.$("select[aria-label='Judge 2']")).toBeTruthy();
    expect(h.$("select[aria-label='Rubric']")).toBeTruthy();
    expect(h.$("[data-testid='claim-plan-exploration']")).toBeTruthy();
    expect(h.$("[data-testid='claim-plan-confirmation']")).toBeTruthy();
    // Fixed all-four policy display, read-only (Decision D2).
    expect(h.text()).toMatch(/Best fixed/);
    expect(h.text()).toMatch(/Rank/);
    expect(h.text()).toMatch(/Fuse/);
    expect(h.text()).toMatch(/Refine/);
    expect(h.text()).toMatch(/MPID/);
    cleanup(h);
  });

  it("marks judges as blind and disables the confirmation card without a source study", async () => {
    const studyRepo = new InMemoryStudyRepository();
    const study = makeStudyRecord({ definition: draftPolicyStudyDefinition() });
    await studyRepo.createStudy(study);
    const { evalRepo, labAssetRepo } = await seedAssets();
    const h = renderEditor(studyRepo, study, { evalRepo, labAssetRepo });
    await settle();

    expect(h.text()).toMatch(/[Bb]lind/);
    const confirmation = h.$("[data-testid='claim-plan-confirmation'] input") as HTMLInputElement;
    expect(confirmation.disabled).toBe(true);
    expect(h.text()).toMatch(/requires a completed exploratory study/i);
    const exploration = h.$("[data-testid='claim-plan-exploration'] input") as HTMLInputElement;
    expect(exploration.checked).toBe(true);
    cleanup(h);
  });
});

// --- CAS persistence -----------------------------------------------------------

describe("PolicyStudyEditor — CAS draft persistence", () => {
  it("persists edits with revision increments and shows the saved revision", async () => {
    const studyRepo = new InMemoryStudyRepository();
    const study = makeStudyRecord({ definition: draftPolicyStudyDefinition() });
    await studyRepo.createStudy(study);
    const { evalRepo, labAssetRepo } = await seedAssets();
    const h = renderEditor(studyRepo, study, { evalRepo, labAssetRepo });
    await settle();

    typeInto(h.$("input[aria-label='Title & research question']") as HTMLInputElement, "Pair screening Q");
    await settle();

    const saved = await studyRepo.getStudy(study.id);
    expect(saved?.title).toBe("Pair screening Q");
    expect(saved?.revision).toBe(1);
    expect(h.$("[role='status']")?.textContent).toMatch(/Saved · revision 1/);
    cleanup(h);
  });

  it("persists pinned workload, pool, recipe, judges, and rubric into the definition", async () => {
    const studyRepo = new InMemoryStudyRepository();
    const study = makeStudyRecord({ definition: draftPolicyStudyDefinition() });
    await studyRepo.createStudy(study);
    const { evalRepo, labAssetRepo } = await seedAssets();
    const h = renderEditor(studyRepo, study, { evalRepo, labAssetRepo });
    await settle();

    await pinAllInputs(h);

    const saved = await studyRepo.getStudy(study.id);
    expect(saved?.definition.workload.taskSetId).toBe("ts1");
    expect(saved?.definition.workload.version).toBe(6);
    expect(saved?.definition.modelPool.poolId).toBe("pool-1");
    expect(saved?.definition.fusionRecipes).toHaveLength(1);
    expect(saved?.definition.fusionRecipes[0]?.recipeId).toBe("recipe-1");
    expect(saved?.definition.judge1.id).toMatch(/^mc:sha256:[0-9a-f]{64}$/);
    expect(saved?.definition.judge2.id).toMatch(/^mc:sha256:[0-9a-f]{64}$/);
    expect(saved?.definition.judge1.id).not.toBe(saved?.definition.judge2.id);
    expect(saved?.definition.rubric).toEqual({ rubricId: "rub1", version: 1 });
    expect(saved!.revision).toBeGreaterThan(0);
    cleanup(h);
  });

  it("excludes recipe synthesizers and Judge 1 from the Judge 2 options", async () => {
    const studyRepo = new InMemoryStudyRepository();
    const study = makeStudyRecord({ definition: draftPolicyStudyDefinition() });
    await studyRepo.createStudy(study);
    const evalRepo = new InMemoryEvaluationRepository();
    const suite = makeEditorSuite("ts1", 6);
    // A candidate slot whose model matches the recipe synthesizer must be
    // excluded from judge pickers (anti-circularity).
    suite.modelSlots.push(slot("s4", "acme/synth-1"));
    await evalRepo.saveSuite(suite, 0);
    const labAssetRepo = new InMemoryLabAssetRepository();
    await labAssetRepo.createRecipeRecord(makeRecipeRecord("recipe-1"), makeRecipeVersion("recipe-1", 1));
    const h = renderEditor(studyRepo, study, { evalRepo, labAssetRepo });
    await settle();

    selectOption(h.$("select[aria-label='Task Set Version']") as HTMLSelectElement, "Task Set ts1");
    await settle();
    click(h.$("[data-testid='recipe-option-recipe-1-v1'] input") as HTMLElement);
    await settle();
    selectOption(h.$("select[aria-label='Judge 1']") as HTMLSelectElement, "acme/judge-1");
    await settle();

    const judge2 = h.$("select[aria-label='Judge 2']") as HTMLSelectElement;
    const labels = [...judge2.options].map((o) => o.textContent ?? "");
    expect(labels.some((l) => l.includes("acme/judge-1"))).toBe(false);
    expect(labels.some((l) => l.includes("acme/synth-1"))).toBe(false);
    expect(labels.some((l) => l.includes("acme/judge-2"))).toBe(true);
    const judge1 = h.$("select[aria-label='Judge 1']") as HTMLSelectElement;
    const j1Labels = [...judge1.options].map((o) => o.textContent ?? "");
    expect(j1Labels.some((l) => l.includes("acme/synth-1"))).toBe(false);
    cleanup(h);
  });
});

// --- Delete draft --------------------------------------------------------------

describe("PolicyStudyEditor — delete untouched draft", () => {
  it("shows Delete draft only while untouched and deletes through the repository", async () => {
    const studyRepo = new InMemoryStudyRepository();
    const study = makeStudyRecord({ definition: draftPolicyStudyDefinition() });
    await studyRepo.createStudy(study);
    const { evalRepo, labAssetRepo } = await seedAssets();
    let deleted = false;
    const h = renderEditor(studyRepo, study, {
      evalRepo,
      labAssetRepo,
      onDeleted: () => {
        deleted = true;
      },
    });
    await settle();

    const del = h.$("[data-action='delete-draft']") as HTMLButtonElement;
    expect(del).toBeTruthy();
    click(del);
    await settle();
    expect(await studyRepo.getStudy(study.id)).toBeNull();
    expect(deleted).toBe(true);
  });

  it("hides Delete draft once an input has been saved", async () => {
    const studyRepo = new InMemoryStudyRepository();
    const study = makeStudyRecord({ definition: draftPolicyStudyDefinition() });
    await studyRepo.createStudy(study);
    const { evalRepo, labAssetRepo } = await seedAssets();
    const h = renderEditor(studyRepo, study, { evalRepo, labAssetRepo });
    await settle();

    typeInto(h.$("input[aria-label='Title & research question']") as HTMLInputElement, "Touched");
    await settle();
    expect(h.$("[data-action='delete-draft']")).toBeNull();
    cleanup(h);
  });
});

// --- Seal validation + dialog ---------------------------------------------------

describe("PolicyStudyEditor — seal validation and confirmation", () => {
  it("lists unmet requirements in plain text when sealing an incomplete draft", async () => {
    const studyRepo = new InMemoryStudyRepository();
    const study = makeStudyRecord({ definition: draftPolicyStudyDefinition() });
    await studyRepo.createStudy(study);
    const { evalRepo, labAssetRepo } = await seedAssets();
    const h = renderEditor(studyRepo, study, { evalRepo, labAssetRepo });
    await settle();

    click(h.$("[data-action='seal-study']") as HTMLElement);
    await settle();

    const requirements = h.$("[data-testid='seal-requirements']");
    expect(requirements?.textContent).toMatch(/Task Set Version/);
    expect(requirements?.textContent).toMatch(/Model Pool/);
    expect(requirements?.textContent).toMatch(/Fusion Recipe/);
    expect(requirements?.textContent).toMatch(/Judge 1/);
    expect(requirements?.textContent).toMatch(/Rubric/);
    // No dialog, no lifecycle change.
    expect(h.$("[data-action='confirm-seal']")).toBeNull();
    expect((await studyRepo.getStudy(study.id))?.status).toBe("draft");
    cleanup(h);
  });

  it("opens the seal dialog with pinned refs, digests, and the permanence sentence", async () => {
    const studyRepo = new InMemoryStudyRepository();
    const study = makeStudyRecord({ definition: draftPolicyStudyDefinition() });
    await studyRepo.createStudy(study);
    const { evalRepo, labAssetRepo } = await seedAssets();
    const h = renderEditor(studyRepo, study, { evalRepo, labAssetRepo });
    await settle();
    await pinAllInputs(h);

    click(h.$("[data-action='seal-study']") as HTMLElement);
    await settle();

    const dialog = document.querySelector("[data-dialog-backdrop]");
    expect(dialog).toBeTruthy();
    const popupText = document.body.textContent ?? "";
    expect(popupText).toMatch(/Sealing is permanent/);
    expect(popupText).toMatch(/definition can never be edited/);
    expect(popupText).toMatch(/estimate/i);
    expect(popupText).toMatch(/Task Set ts1/);
    expect(document.querySelector("[data-action='confirm-seal']")?.textContent).toMatch(
      /Seal & start/,
    );
    act(() => h.root.unmount());
    h.container.remove();
  });

  it("seals the study immutably on confirm — later draft writes are rejected", async () => {
    const studyRepo = new InMemoryStudyRepository();
    const study = makeStudyRecord({ definition: draftPolicyStudyDefinition() });
    await studyRepo.createStudy(study);
    const { evalRepo, labAssetRepo } = await seedAssets();
    const sealed: PolicyStudyRecord[] = [];
    const h = renderEditor(studyRepo, study, {
      evalRepo,
      labAssetRepo,
      onSealed: (s) => sealed.push(s),
    });
    await settle();
    await pinAllInputs(h);
    click(h.$("[data-action='seal-study']") as HTMLElement);
    await settle();

    click(document.querySelector("[data-action='confirm-seal']") as HTMLElement);
    await settle();

    const saved = await studyRepo.getStudy(study.id);
    expect(saved?.status).toBe("in_progress");
    expect(sealed).toHaveLength(1);
    // Immutable pin check: the definition is sealed after start.
    await expect(
      studyRepo.updateDraftStudy(
        study.id,
        saved!.revision,
        { definition: saved!.definition, title: "Too late" },
        Date.now(),
      ),
    ).rejects.toThrow(/not a draft/);
    act(() => h.root.unmount());
    h.container.remove();
  });
});

// --- Confirmation drafts ---------------------------------------------------------

describe("PolicyStudyEditor — confirmation claim plan", () => {
  it("requires a fresh Task Set Version that differs from the source study", async () => {
    const studyRepo = new InMemoryStudyRepository();
    const source = makeStudyRecord({ id: "study-source", status: "completed", reportRef: "pb-1" });
    await studyRepo.createStudy(source);
    const confirmation = makeStudyRecord({
      id: "study-conf",
      claimLevel: "confirmed",
      confirmationOf: "study-source",
      definition: makeDefinition({ claimPlan: "confirmation" }),
    });
    await studyRepo.createStudy(confirmation);
    const { evalRepo, labAssetRepo } = await seedAssets();
    const h = renderEditor(studyRepo, confirmation, { evalRepo, labAssetRepo });
    await settle();

    // The confirmation card is selected; exploration is not switchable.
    const confirmationCard = h.$(
      "[data-testid='claim-plan-confirmation'] input",
    ) as HTMLInputElement;
    expect(confirmationCard.checked).toBe(true);
    const explorationCard = h.$("[data-testid='claim-plan-exploration'] input") as HTMLInputElement;
    expect(explorationCard.disabled).toBe(true);

    // Same Task Set version as the source (v6) must be rejected at seal time.
    await pinAllInputs(h);
    click(h.$("[data-action='seal-study']") as HTMLElement);
    await settle();
    expect(h.$("[data-testid='seal-requirements']")?.textContent).toMatch(
      /fresh Task Set Version/i,
    );
    expect((await studyRepo.getStudy(confirmation.id))?.status).toBe("draft");
    cleanup(h);
  });
});
