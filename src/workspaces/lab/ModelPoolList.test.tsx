// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { InMemoryLabAssetRepository } from "../../lib/persistence/lab-asset-repository";
import { InMemoryStudyRepository } from "../../lib/persistence/study-repository";
import { StorageError } from "../../lib/persistence/database";
import { ModelPoolList } from "./ModelPoolList";
import { DIGEST, makePoolRecord, makePoolVersion, makeStudyRecord } from "./lab-test-fixtures";

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

function renderList(
  labAssetRepo: InMemoryLabAssetRepository | null,
  studyRepo: InMemoryStudyRepository | null = null,
): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/lab/model-pools"]}>
        <ModelPoolList labAssetRepo={labAssetRepo} studyRepo={studyRepo} />
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

describe("ModelPoolList", () => {
  it("renders empty purpose copy and New Model Pool", async () => {
    const h = renderList(new InMemoryLabAssetRepository());
    await settle();
    expect(h.container.textContent).toMatch(/selection manifest/);
    expect(h.container.textContent).toMatch(/never merge model evidence|synthetic respondent/i);
    expect(h.$("[data-action='new-model-pool']")?.textContent).toMatch(/New Model Pool/);
    expect(h.container.textContent).not.toMatch(/Routing|Workflow|coming soon/i);
    cleanup(h);
  });

  it("links each row to the latest version and shows member counts", async () => {
    const repo = new InMemoryLabAssetRepository();
    await repo.createPoolRecord(
      makePoolRecord("pool-1", { name: "Diversity pool A" }),
      makePoolVersion("pool-1", 1),
    );
    await repo.appendPoolVersion(makePoolVersion("pool-1", 2, { rationale: "v2" }), 0);
    await repo.appendPoolVersion(makePoolVersion("pool-1", 3, { rationale: "v3" }), 1);
    await repo.appendPoolVersion(makePoolVersion("pool-1", 4, { rationale: "v4" }), 2);
    const h = renderList(repo);
    await settle();
    expect(h.$("a[href='/lab/model-pools/pool-1/versions/4']")).toBeTruthy();
    expect(h.container.textContent).toMatch(/3 core/);
    expect(h.container.textContent).toMatch(/2 challenger/);
    cleanup(h);
  });

  it("counts referencing studies", async () => {
    const assets = new InMemoryLabAssetRepository();
    const studies = new InMemoryStudyRepository();
    await assets.createPoolRecord(makePoolRecord(), makePoolVersion());
    await studies.createStudy(
      makeStudyRecord({
        id: "s1",
        definition: {
          ...makeStudyRecord().definition,
          modelPool: { poolId: "pool-1", version: 1, digest: DIGEST },
        },
      }),
    );
    const h = renderList(assets, studies);
    await settle();
    expect(h.container.textContent).toMatch(/referenced by 1 study/);
    cleanup(h);
  });

  it("hides archived pools until shown", async () => {
    const repo = new InMemoryLabAssetRepository();
    await repo.createPoolRecord(makePoolRecord("live"), makePoolVersion("live"));
    await repo.createPoolRecord(makePoolRecord("old"), makePoolVersion("old"));
    const rec = await repo.getPoolRecord("old");
    await repo.archivePoolRecord("old", rec!.revision, 8_000);
    const h = renderList(repo);
    await settle();
    expect(h.$("a[href='/lab/model-pools/old/versions/1']")).toBeNull();
    act(() => {
      h.$("[data-action='show-archived']")!.click();
    });
    await settle();
    expect(h.$("a[href='/lab/model-pools/old/versions/1']")).toBeTruthy();
    cleanup(h);
  });

  it("renders load failure with Retry", async () => {
    const repo = new InMemoryLabAssetRepository();
    vi.spyOn(repo, "listPoolRecords").mockRejectedValue(new StorageError("unavailable", "pools down"));
    const h = renderList(repo);
    await settle();
    expect(h.container.textContent).toMatch(/Failed to load pools|Failed to load model pools/i);
    expect(h.container.textContent).toMatch(/pools down/);
    expect(h.$("[data-action='retry-pools']")).toBeTruthy();
    cleanup(h);
  });
});
