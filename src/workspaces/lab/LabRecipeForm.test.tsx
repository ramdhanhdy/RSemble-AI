// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { InMemoryLabAssetRepository } from "../../lib/persistence/lab-asset-repository";
import { LabRecipeForm } from "./LabRecipeForm";
import { LabRecipeVersionPage } from "./LabRecipeVersionPage";
import { makeRecipeRecord, makeRecipeVersion } from "./lab-test-fixtures";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
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

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("LabRecipeForm — create", () => {
  it("creates a fusion recipe record and first immutable version", async () => {
    const repo = new InMemoryLabAssetRepository();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let createdId = "";
    act(() => {
      root.render(
        <LabRecipeForm
          labAssetRepo={repo}
          open
          onOpenChange={() => undefined}
          onCreated={(id) => {
            createdId = id;
          }}
        />,
      );
    });
    await settle();
    const name = container.querySelector<HTMLInputElement>("[data-field='recipe-name']");
    const desc = container.querySelector<HTMLTextAreaElement>("[data-field='recipe-description']");
    expect(name).toBeTruthy();
    const nameDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    nameDesc?.set?.call(name, "Blind holdout");
    act(() => {
      name!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const descDesc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
    descDesc?.set?.call(desc, "Anonymized candidates.");
    act(() => {
      desc!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-action='create-recipe']")!.click();
      await flush();
    });
    await settle();
    expect(createdId.length).toBeGreaterThan(0);
    const record = await repo.getRecipeRecord(createdId);
    expect(record?.name).toBe("Blind holdout");
    expect(record?.kind).toBe("fusion");
    expect(record?.latestVersion).toBe(1);
    const version = await repo.getRecipeVersion(createdId, 1);
    expect(version?.recipeFamily).toBeTruthy();
    act(() => root.unmount());
    container.remove();
  });
});

describe("LabRecipeVersionPage — version, archive, unknown", () => {
  it("renders an existing version and can archive the record", async () => {
    const repo = new InMemoryLabAssetRepository();
    await repo.createRecipeRecord(makeRecipeRecord(), makeRecipeVersion());
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/lab/recipes/recipe-1/versions/1"]}>
          <Routes>
            <Route
              path="/lab/recipes/:recipeId/versions/:version"
              element={<LabRecipeVersionPage labAssetRepo={repo} />}
            />
          </Routes>
        </MemoryRouter>,
      );
    });
    await settle();
    expect(container.textContent).toMatch(/Blind Raw/);
    expect(container.textContent).toMatch(/v1/);
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-action='archive-recipe']")!.click();
      await flush();
    });
    await settle();
    const rec = await repo.getRecipeRecord("recipe-1");
    expect(rec?.archivedAt).not.toBeNull();
    expect(await repo.getRecipeVersion("recipe-1", 1)).toBeTruthy();
    act(() => root.unmount());
    container.remove();
  });

  it("creates a new version from the current payload", async () => {
    const repo = new InMemoryLabAssetRepository();
    await repo.createRecipeRecord(makeRecipeRecord(), makeRecipeVersion());
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/lab/recipes/recipe-1/versions/1"]}>
          <Routes>
            <Route
              path="/lab/recipes/:recipeId/versions/:version"
              element={<LabRecipeVersionPage labAssetRepo={repo} />}
            />
          </Routes>
        </MemoryRouter>,
      );
    });
    await settle();
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-action='new-recipe-version']")!.click();
      await flush();
    });
    await settle();
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-action='create-recipe-version']")!.click();
      await flush();
    });
    await settle();
    const rec = await repo.getRecipeRecord("recipe-1");
    expect(rec?.latestVersion).toBe(2);
    act(() => root.unmount());
    container.remove();
  });

  it("names unknown recipe/version ids without guessing", async () => {
    const repo = new InMemoryLabAssetRepository();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/lab/recipes/missing/versions/9"]}>
          <Routes>
            <Route
              path="/lab/recipes/:recipeId/versions/:version"
              element={<LabRecipeVersionPage labAssetRepo={repo} />}
            />
          </Routes>
        </MemoryRouter>,
      );
    });
    await settle();
    expect(container.textContent).toMatch(/not found|unknown/i);
    expect(container.textContent).toMatch(/missing/);
    expect(container.textContent).toMatch(/9/);
    act(() => root.unmount());
    container.remove();
  });
});
