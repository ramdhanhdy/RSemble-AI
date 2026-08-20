// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { InMemoryEvidenceRepository } from "../../lib/persistence/evidence-repository";
import { InMemoryTaskRepository } from "../../lib/persistence/in-memory-task-repository";
import { queryModelConfigurationCatalog } from "../../lib/model-profiles/model-configuration-query";
import {
  MILESTONE_A_GOLDEN,
  milestoneAObservations,
  milestoneADecisions,
} from "../../lib/model-profiles/__fixtures__/milestone-a-golden";
import type { EvidenceRepository } from "../../lib/persistence/evidence-repository";
import { ModelsWorkspace } from "./ModelsWorkspace";

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
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await flush();
    });
  }
}

const GOLDEN_CONFIGS = Object.values(MILESTONE_A_GOLDEN.configurations);

async function seedGolden(): Promise<EvidenceRepository> {
  const repo = new InMemoryEvidenceRepository();
  for (const cfg of GOLDEN_CONFIGS) await repo.putModelConfiguration(cfg);
  for (const obs of milestoneAObservations()) await repo.putObservation(obs);
  for (const dec of milestoneADecisions()) await repo.putDecision(dec);
  return repo;
}

async function seedFamilies(): Promise<InMemoryTaskRepository> {
  const taskRepo = new InMemoryTaskRepository();
  for (const fam of MILESTONE_A_GOLDEN.families) {
    await taskRepo.createTaskFamily({ ...fam });
  }
  return taskRepo;
}

function throwingRepo(message: string): EvidenceRepository {
  const base = new InMemoryEvidenceRepository();
  return {
    ...base,
    listModelConfigurations: () => Promise.reject(new Error(message)),
  } as EvidenceRepository;
}

function renderModels(
  initialEntry: string,
  opts: {
    evidenceRepo?: EvidenceRepository | null;
    taskRepo?: InMemoryTaskRepository | null;
  } = {},
): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/models/*"
            element={
              <ModelsWorkspace
                evidenceRepo={opts.evidenceRepo}
                taskRepo={opts.taskRepo ?? null}
              />
            }
          />
        </Routes>
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

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ModelsWorkspace — header (Fable §6.1)", () => {
  it("renders the MODELS eyebrow, title, count, and standing subtitle", async () => {
    const repo = await seedGolden();
    const taskRepo = await seedFamilies();
    const h = renderModels("/models", { evidenceRepo: repo, taskRepo });
    await settle();
    expect(h.text()).toContain("MODELS");
    expect(h.text()).toContain("Models");
    expect(h.text()).toMatch(/\d+ configurations/);
    expect(h.text()).toContain("No scores, no ranks");
    act(() => h.root.unmount());
  });
});

describe("ModelsWorkspace — direct-load /models works", () => {
  it("renders the list rows for the golden catalog on a direct load", async () => {
    const repo = await seedGolden();
    const taskRepo = await seedFamilies();
    const h = renderModels("/models", { evidenceRepo: repo, taskRepo });
    await settle();
    const rows = h.$$("[data-record-row-surface]");
    expect(rows.length).toBe(GOLDEN_CONFIGS.length);
    act(() => h.root.unmount());
  });
});

describe("ModelsWorkspace — URL state drives filters", () => {
  it("a provider filter in the URL restricts the rendered rows", async () => {
    const repo = await seedGolden();
    const taskRepo = await seedFamilies();
    const providerId = GOLDEN_CONFIGS[0].providerId;
    const h = renderModels(`/models?m.provider=${encodeURIComponent(providerId)}`, {
      evidenceRepo: repo,
      taskRepo,
    });
    await settle();
    const rows = h.$$("[data-record-row-surface]");
    const { entries } = await queryModelConfigurationCatalog(repo, {
      providerIds: [providerId],
    });
    expect(rows.length).toBe(entries.length);
    act(() => h.root.unmount());
  });

  it("changing a filter updates the selected value", async () => {
    const repo = await seedGolden();
    const taskRepo = await seedFamilies();
    const h = renderModels("/models", { evidenceRepo: repo, taskRepo });
    await settle();
    const select = h.$("[data-filter='versionStatus']") as HTMLSelectElement;
    act(() => {
      select.value = "rolling_alias";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    const after = h.$("[data-filter='versionStatus']") as HTMLSelectElement;
    expect(after.value).toBe("rolling_alias");
    act(() => h.root.unmount());
  });
});

describe("ModelsWorkspace — D1 sort (canonical default, latest toggle)", () => {
  it("default sort is the catalog canonical identity order", async () => {
    const repo = await seedGolden();
    const taskRepo = await seedFamilies();
    const h = renderModels("/models", { evidenceRepo: repo, taskRepo });
    await settle();
    const renderedIds = h.$$("[data-model-id]").map((el) => el.getAttribute("data-model-id"));
    const { entries } = await queryModelConfigurationCatalog(repo);
    const canonicalIds = entries.map((e) => e.modelConfigurationId);
    expect(renderedIds).toEqual(canonicalIds);
    act(() => h.root.unmount());
  });

  it("sort=latest orders rows by latestActivity descending", async () => {
    const repo = await seedGolden();
    const taskRepo = await seedFamilies();
    const h = renderModels("/models?m.sort=latest", { evidenceRepo: repo, taskRepo });
    await settle();
    const renderedIds = h.$$("[data-model-id]").map((el) => el.getAttribute("data-model-id")!);
    const { entries } = await queryModelConfigurationCatalog(repo);
    const byId = new Map(entries.map((e) => [e.modelConfigurationId, e.latestActivity]));
    const expected = [...entries]
      .sort(
        (a, b) =>
          b.latestActivity - a.latestActivity ||
          a.modelConfigurationId.localeCompare(b.modelConfigurationId),
      )
      .map((e) => e.modelConfigurationId);
    expect(renderedIds).toEqual(expected);
    expect(byId.get(renderedIds[0])).toBe(Math.max(...entries.map((e) => e.latestActivity)));
    act(() => h.root.unmount());
  });
});

describe("ModelsWorkspace — four list states (§6.5)", () => {
  it("first-use: an empty repo renders the first-use block and no Saved rollups", async () => {
    const repo = new InMemoryEvidenceRepository();
    const taskRepo = await seedFamilies();
    const h = renderModels("/models", { evidenceRepo: repo, taskRepo });
    await settle();
    expect(h.$("[data-list-state='first-use']")).not.toBeNull();
    expect(h.$("[data-saved-rollups]")).toBeNull();
    act(() => h.root.unmount());
  });

  it("filters-zero-match: a search matching nothing renders the zero-match block + Clear filters", async () => {
    const repo = await seedGolden();
    const taskRepo = await seedFamilies();
    const h = renderModels("/models?m.search=zzznotmatching", { evidenceRepo: repo, taskRepo });
    await settle();
    expect(h.$("[data-list-state='zero-match']")).not.toBeNull();
    expect(h.text()).toContain("No matching configurations.");
    expect(h.$("[data-action='clear-filters']")).not.toBeNull();
    expect(h.$("[data-saved-rollups]")).not.toBeNull();
    act(() => h.root.unmount());
  });

  it("load-error: a rejecting repo renders the error panel + Retry", async () => {
    const taskRepo = await seedFamilies();
    const h = renderModels("/models", { evidenceRepo: throwingRepo("storage offline"), taskRepo });
    await settle();
    expect(h.$("[data-list-state='error']")).not.toBeNull();
    expect(h.text()).toContain("Failed to load configurations.");
    expect(h.text()).toContain("storage offline");
    expect(h.$("[data-action='retry']")).not.toBeNull();
    act(() => h.root.unmount());
  });

  it("configurations-none-eligible: configs with no eligible evidence render the list + honesty-note banner", async () => {
    const repo = new InMemoryEvidenceRepository();
    for (const cfg of GOLDEN_CONFIGS) await repo.putModelConfiguration(cfg);
    for (const obs of milestoneAObservations()) await repo.putObservation(obs);
    const taskRepo = await seedFamilies();
    const h = renderModels("/models", { evidenceRepo: repo, taskRepo });
    await settle();
    expect(h.$$("[data-record-row-surface]").length).toBeGreaterThan(0);
    expect(h.text()).toContain("All current evidence is exploratory or excluded");
    expect(h.$("[data-saved-rollups]")).not.toBeNull();
    act(() => h.root.unmount());
  });
});

describe("ModelsWorkspace — Saved rollups section presence", () => {
  it("renders the Saved rollups section on a populated list", async () => {
    const repo = await seedGolden();
    const taskRepo = await seedFamilies();
    const h = renderModels("/models", { evidenceRepo: repo, taskRepo });
    await settle();
    const section = h.$("[data-saved-rollups]")!;
    expect(section).not.toBeNull();
    expect(section.textContent).toContain("SAVED ROLLUPS — STRATIFIED ONLY");
    expect(section.textContent).toContain("No saved rollups.");
    expect(h.$("[data-action='create-rollup']")).toBeNull();
    act(() => h.root.unmount());
  });
});

describe("ModelsWorkspace — no scores, no ranks, no aria-sort", () => {
  it("emits no aria-sort and no score/rank language on the list", async () => {
    const repo = await seedGolden();
    const taskRepo = await seedFamilies();
    const h = renderModels("/models", { evidenceRepo: repo, taskRepo });
    await settle();
    expect(h.$$("[aria-sort]").length).toBe(0);
    expect(h.text()).not.toMatch(/overall score/i);
    expect(h.text()).not.toMatch(/best model/i);
    act(() => h.root.unmount());
  });
});
