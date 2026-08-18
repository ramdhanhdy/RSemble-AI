// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { InMemoryLabAssetRepository } from "../../lib/persistence/lab-asset-repository";
import { InMemoryStudyRepository } from "../../lib/persistence/study-repository";
import { StorageError } from "../../lib/persistence/database";
import { LabRecipeList } from "./LabRecipeList";
import { DIGEST, makeRecipeRecord, makeRecipeVersion, makeStudyRecord } from "./lab-test-fixtures";

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

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await flush();
    });
  }
}

function renderList(
  labAssetRepo: InMemoryLabAssetRepository | null,
  studyRepo: InMemoryStudyRepository | null = null,
): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/lab/recipes"]}>
        <LabRecipeList labAssetRepo={labAssetRepo} studyRepo={studyRepo} />
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

describe("LabRecipeList", () => {
  it("renders empty purpose copy and New Recipe", async () => {
    const h = renderList(new InMemoryLabAssetRepository());
    await settle();
    expect(h.container.textContent).toMatch(/Fusion is a method term/);
    expect(h.container.textContent).toMatch(/No fusion recipes yet|New Recipe/);
    expect(h.$("[data-action='new-recipe']")?.textContent).toMatch(/New Recipe/);
    expect(h.container.textContent).not.toMatch(/Routing|Workflow|coming soon/i);
    cleanup(h);
  });

  it("links each row to the latest version route and shows version summary", async () => {
    const repo = new InMemoryLabAssetRepository();
    await repo.createRecipeRecord(
      makeRecipeRecord("recipe-1", { name: "Blind Raw" }),
      makeRecipeVersion("recipe-1", 1),
    );
    await repo.appendRecipeVersion(
      makeRecipeVersion("recipe-1", 2, { promptVersion: "blind-raw-v2" }),
      0,
    );
    await repo.appendRecipeVersion(
      makeRecipeVersion("recipe-1", 3, { promptVersion: "blind-raw-v3" }),
      1,
    );
    const h = renderList(repo);
    await settle();
    expect(h.$("a[href='/lab/recipes/recipe-1/versions/3']")).toBeTruthy();
    expect(h.container.textContent).toMatch(/v3/);
    expect(h.container.textContent).toMatch(/blind raw|BlindRaw|rubric hidden/i);
    cleanup(h);
  });

  it("counts referencing studies on the meta line", async () => {
    const assets = new InMemoryLabAssetRepository();
    const studies = new InMemoryStudyRepository();
    await assets.createRecipeRecord(makeRecipeRecord(), makeRecipeVersion());
    await studies.createStudy(
      makeStudyRecord({
        id: "s1",
        definition: {
          ...makeStudyRecord().definition,
          fusionRecipes: [{ recipeId: "recipe-1", version: 1, digest: DIGEST }],
        },
      }),
    );
    const h = renderList(assets, studies);
    await settle();
    expect(h.container.textContent).toMatch(/referenced by 1 study/);
    cleanup(h);
  });

  it("hides archived recipes until shown", async () => {
    const repo = new InMemoryLabAssetRepository();
    await repo.createRecipeRecord(makeRecipeRecord("live"), makeRecipeVersion("live"));
    await repo.createRecipeRecord(makeRecipeRecord("old"), makeRecipeVersion("old"));
    const rec = await repo.getRecipeRecord("old");
    await repo.archiveRecipeRecord("old", rec!.revision, 8_000);
    const h = renderList(repo);
    await settle();
    expect(h.container.textContent).toMatch(/Blind Raw/);
    expect(h.$("a[href='/lab/recipes/old/versions/1']")).toBeNull();
    act(() => {
      h.$("[data-action='show-archived']")!.click();
    });
    await settle();
    expect(h.$("a[href='/lab/recipes/old/versions/1']")).toBeTruthy();
    expect(h.container.textContent).toMatch(/Archived/);
    cleanup(h);
  });

  it("renders load failure with Retry", async () => {
    const repo = new InMemoryLabAssetRepository();
    vi.spyOn(repo, "listRecipeRecords").mockRejectedValue(
      new StorageError("unavailable", "recipes down"),
    );
    const h = renderList(repo);
    await settle();
    expect(h.container.textContent).toMatch(/Failed to load recipes/);
    expect(h.container.textContent).toMatch(/recipes down/);
    expect(h.$("[data-action='retry-recipes']")).toBeTruthy();
    cleanup(h);
  });
});
