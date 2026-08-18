// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { InMemoryStudyRepository } from "../../lib/persistence/study-repository";
import { InMemoryLabAssetRepository } from "../../lib/persistence/lab-asset-repository";
import { LabWorkspace } from "./LabWorkspace";
import {
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
}

function flush(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await flush();
    });
  }
}

function renderLab(
  initialEntry: string,
  opts: {
    studyRepo?: InMemoryStudyRepository;
    labAssetRepo?: InMemoryLabAssetRepository;
  } = {},
): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const studyRepo = opts.studyRepo ?? new InMemoryStudyRepository();
  const labAssetRepo = opts.labAssetRepo ?? new InMemoryLabAssetRepository();
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/lab/*"
            element={<LabWorkspace studyRepo={studyRepo} labAssetRepo={labAssetRepo} />}
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
  };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("LabWorkspace — section rail (Fable §5.1)", () => {
  it("renders exactly three section entries and no future study kinds", async () => {
    const h = renderLab("/lab");
    await settle();
    const links = h.$$("nav[aria-label='Research Lab'] a");
    expect(links).toHaveLength(3);
    expect(links.map((el) => el.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Policy Studies/),
        expect.stringMatching(/Fusion Recipes/),
        expect.stringMatching(/Model Pools/),
      ]),
    );
    const text = h.container.textContent ?? "";
    expect(text).not.toMatch(/Routing/);
    expect(text).not.toMatch(/Workflow/);
    expect(text).not.toMatch(/Judge study/i);
    expect(text).not.toMatch(/coming soon/i);
    cleanup(h);
  });

  it("marks Policy Studies current on /lab and does not invent /lab/studies index", async () => {
    const h = renderLab("/lab");
    await settle();
    const current = h
      .$$("nav[aria-label='Research Lab'] a")
      .find((el) => el.getAttribute("aria-current") === "page");
    expect(current?.textContent).toMatch(/Policy Studies/);
    expect(h.container.textContent).toMatch(/Policy Studies/);
    expect(h.container.textContent).toMatch(/RESEARCH LAB/);
    cleanup(h);
  });

  it("URL-drives Fusion Recipes and Model Pools sections", async () => {
    const recipes = renderLab("/lab/recipes");
    await settle();
    expect(recipes.container.textContent).toMatch(/Fusion Recipes/);
    expect(
      recipes
        .$$("nav[aria-label='Research Lab'] a")
        .find((el) => el.getAttribute("aria-current") === "page")?.textContent,
    ).toMatch(/Fusion Recipes/);
    cleanup(recipes);

    const pools = renderLab("/lab/model-pools");
    await settle();
    expect(pools.container.textContent).toMatch(/Model Pools/);
    expect(
      pools
        .$$("nav[aria-label='Research Lab'] a")
        .find((el) => el.getAttribute("aria-current") === "page")?.textContent,
    ).toMatch(/Model Pools/);
    cleanup(pools);
  });

  it("shows rail counts from repositories", async () => {
    const studyRepo = new InMemoryStudyRepository();
    const labAssetRepo = new InMemoryLabAssetRepository();
    await studyRepo.createStudy(makeStudyRecord({ id: "s1" }));
    await studyRepo.createStudy(makeStudyRecord({ id: "s2", title: "Second" }));
    await labAssetRepo.createRecipeRecord(makeRecipeRecord(), makeRecipeVersion());
    await labAssetRepo.createPoolRecord(makePoolRecord(), makePoolVersion());
    const h = renderLab("/lab", { studyRepo, labAssetRepo });
    await settle();
    const studies = h
      .$$("nav[aria-label='Research Lab'] a")
      .find((el) => el.textContent?.includes("Policy Studies"));
    expect(studies?.textContent).toMatch(/2/);
    cleanup(h);
  });

  it("does not render a primary Lab tab", async () => {
    const h = renderLab("/lab");
    await settle();
    expect(h.$("nav[aria-label='Primary']")).toBeNull();
    cleanup(h);
  });
});

describe("LabWorkspace — unknown and archived study ids", () => {
  it("renders an honest not-found for an unknown study id", async () => {
    const h = renderLab("/lab/studies/missing-study");
    await settle();
    expect(h.container.textContent).toMatch(/not found|unknown/i);
    expect(h.container.textContent).toMatch(/missing-study/);
    expect(h.$("a[href='/lab']")).toBeTruthy();
    cleanup(h);
  });

  it("renders an archived study instead of hiding it", async () => {
    const studyRepo = new InMemoryStudyRepository();
    await studyRepo.createStudy(
      makeStudyRecord({
        id: "archived-1",
        title: "Archived holdout",
        status: "archived",
        archivedAt: 9_000,
      }),
    );
    const h = renderLab("/lab/studies/archived-1", { studyRepo });
    await settle();
    expect(h.container.textContent).toMatch(/Archived holdout/);
    expect(h.container.textContent).toMatch(/Archived/);
    cleanup(h);
  });
});
