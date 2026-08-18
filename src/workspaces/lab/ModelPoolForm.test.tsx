// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { InMemoryLabAssetRepository } from "../../lib/persistence/lab-asset-repository";
import { ModelPoolForm } from "./ModelPoolForm";
import { ModelPoolVersionPage } from "./ModelPoolVersionPage";
import { makePoolRecord, makePoolVersion } from "./lab-test-fixtures";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

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

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ModelPoolForm — create", () => {
  it("creates a pool record and first immutable version", async () => {
    const repo = new InMemoryLabAssetRepository();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let createdId = "";
    act(() => {
      root.render(
        <ModelPoolForm
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
    const name = container.querySelector<HTMLInputElement>("[data-field='pool-name']");
    const purpose = container.querySelector<HTMLTextAreaElement>("[data-field='pool-purpose']");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      name,
      "Holdout pool",
    );
    act(() => {
      name!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      purpose,
      "Stage B pair screening.",
    );
    act(() => {
      purpose!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-action='create-pool']")!.click();
      await flush();
    });
    await settle();
    expect(createdId.length).toBeGreaterThan(0);
    const record = await repo.getPoolRecord(createdId);
    expect(record?.name).toBe("Holdout pool");
    const version = await repo.getPoolVersion(createdId, 1);
    expect(version?.core.length).toBeGreaterThan(0);
    act(() => root.unmount());
    container.remove();
  });
});

describe("ModelPoolVersionPage — version, archive, unknown", () => {
  it("renders members and can archive the record", async () => {
    const repo = new InMemoryLabAssetRepository();
    await repo.createPoolRecord(makePoolRecord(), makePoolVersion());
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/lab/model-pools/pool-1/versions/1"]}>
          <Routes>
            <Route
              path="/lab/model-pools/:poolId/versions/:version"
              element={<ModelPoolVersionPage labAssetRepo={repo} />}
            />
          </Routes>
        </MemoryRouter>,
      );
    });
    await settle();
    expect(container.textContent).toMatch(/Diversity pool A/);
    expect(container.textContent).toMatch(/selection manifest/);
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-action='archive-pool']")!.click();
      await flush();
    });
    await settle();
    expect((await repo.getPoolRecord("pool-1"))?.archivedAt).not.toBeNull();
    expect(await repo.getPoolVersion("pool-1", 1)).toBeTruthy();
    act(() => root.unmount());
    container.remove();
  });

  it("creates a new version from the current members", async () => {
    const repo = new InMemoryLabAssetRepository();
    await repo.createPoolRecord(makePoolRecord(), makePoolVersion());
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/lab/model-pools/pool-1/versions/1"]}>
          <Routes>
            <Route
              path="/lab/model-pools/:poolId/versions/:version"
              element={<ModelPoolVersionPage labAssetRepo={repo} />}
            />
          </Routes>
        </MemoryRouter>,
      );
    });
    await settle();
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-action='new-pool-version']")!.click();
      await flush();
    });
    await settle();
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-action='create-pool-version']")!.click();
      await flush();
    });
    await settle();
    expect((await repo.getPoolRecord("pool-1"))?.latestVersion).toBe(2);
    act(() => root.unmount());
    container.remove();
  });

  it("names unknown pool/version ids", async () => {
    const repo = new InMemoryLabAssetRepository();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/lab/model-pools/ghost/versions/4"]}>
          <Routes>
            <Route
              path="/lab/model-pools/:poolId/versions/:version"
              element={<ModelPoolVersionPage labAssetRepo={repo} />}
            />
          </Routes>
        </MemoryRouter>,
      );
    });
    await settle();
    expect(container.textContent).toMatch(/not found|unknown/i);
    expect(container.textContent).toMatch(/ghost/);
    expect(container.textContent).toMatch(/4/);
    act(() => root.unmount());
    container.remove();
  });
});
