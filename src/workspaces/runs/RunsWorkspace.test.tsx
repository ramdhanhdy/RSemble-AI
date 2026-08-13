// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { RunsWorkspace } from "../RunsWorkspace";
import { InMemoryRunRepository } from "../../lib/persistence/run-repository";
import { RepositoryContext } from "../../lib/persistence/repository-context";
import type { RunRecordV2, FullRunSummaryV2 } from "../../lib/persistence/run-types";

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
function renderWithRouter(initialEntry = "/runs", repo: InMemoryRunRepository): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <RepositoryContext.Provider
        value={{
        taskRepo: null,
        runRepo: repo,
          evalRepo: null,
          fusionRepo: null,
          db: null,
          storageState: "ready",
          retry: () => {},
        }}
      >
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/runs" element={<RunsWorkspace />} />
            <Route path="/runs/:runId" element={<RunsWorkspace />} />
          </Routes>
        </MemoryRouter>
      </RepositoryContext.Provider>,
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
  vi.restoreAllMocks();
});

// Stub matchMedia — default to desktop (>=1024px)
function stubMatchMedia(desktop: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: desktop ? q.includes("1024") : false,
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

// --- Fixtures -----------------------------------------------------------------

function makeSummary(id: string, createdAt: number): FullRunSummaryV2 {
  return {
    kind: "full",
    schemaVersion: 2,
    id,
    revision: 1,
    createdAt,
    completedAt: createdAt + 1000,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    taskTitle: `Task ${id}`,
    taskExcerpt: `Task ${id}`,
    modelKeys: ["openrouter:gpt-4o"],
    winnerKeys: ["openrouter:gpt-4o"],
    scoresByModelKey: { "openrouter:gpt-4o": 4.5 },
    judgeModelKey: "openrouter:judge",
    evaluationProfileId: null,
    evaluationProfileVersion: null,
    detailAvailable: true,
    searchText: `task ${id}`,
  };
}

function makeRecord(id: string, createdAt: number): RunRecordV2 {
  return {
    schemaVersion: 2,
    id,
    revision: 1,
    execution: { ownerId: "tab-1", fence: 1 },
    createdAt,
    updatedAt: createdAt + 1000,
    completedAt: createdAt + 1000,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: { title: `Task ${id}`, prompt: "do it", systemPrompt: "helpful", temperature: 0.7 },
    evaluation: { profile: null, candidateMessages: [] },
    candidates: [],
    judge: { status: "idle", acceptedAttemptId: null, report: null, consensus: null, attempts: [] },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
  };
}

async function seedRepo(repo: InMemoryRunRepository, entries: Array<[string, number]>) {
  for (const [id, createdAt] of entries) {
    await repo.create(makeRecord(id, createdAt), makeSummary(id, createdAt));
  }
}

async function settle() {
  await act(async () => {
    await flush();
  });
}

// --- Tests --------------------------------------------------------------------

describe("RunsWorkspace", () => {
  it("desktop /runs shows list with select-a-run detail state", async () => {
    stubMatchMedia(true);
    const repo = new InMemoryRunRepository();
    await seedRepo(repo, [
      ["run-1", 1000],
      ["run-2", 2000],
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
          text: () => Promise.resolve(""),
        }),
      ),
    );

    const h = renderWithRouter("/runs", repo);
    await settle();

    // List is visible
    const links = h.$$("a[href^='/runs/']");
    expect(links.length).toBeGreaterThanOrEqual(1);
    // Select-a-run detail state visible on desktop
    expect(h.container.textContent).toMatch(/select|choose|pick/i);
    cleanup(h);
  });

  it("desktop /runs/:id shows list plus selected detail", async () => {
    stubMatchMedia(true);
    const repo = new InMemoryRunRepository();
    await seedRepo(repo, [["run-1", 1000]]);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
          text: () => Promise.resolve(""),
        }),
      ),
    );

    const h = renderWithRouter("/runs/run-1", repo);
    await settle();

    // List still visible
    expect(h.$$("a[href^='/runs/']")).toHaveLength(1);
    // Detail panel visible with record content
    expect(h.$("[data-run-detail]")).toBeTruthy();
    cleanup(h);
  });

  it("mobile /runs shows list only (no detail pane)", async () => {
    stubMatchMedia(false);
    const repo = new InMemoryRunRepository();
    await seedRepo(repo, [["run-1", 1000]]);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
          text: () => Promise.resolve(""),
        }),
      ),
    );

    const h = renderWithRouter("/runs", repo);
    await settle();

    // List visible
    expect(h.$$("a[href^='/runs/']")).toHaveLength(1);
    // No detail pane
    expect(h.$("[data-run-detail]")).toBeNull();
    cleanup(h);
  });

  it("mobile /runs/:id shows detail with Back to Runs", async () => {
    stubMatchMedia(false);
    const repo = new InMemoryRunRepository();
    await seedRepo(repo, [["run-1", 1000]]);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
          text: () => Promise.resolve(""),
        }),
      ),
    );

    const h = renderWithRouter("/runs/run-1", repo);
    await settle();

    // Detail visible
    expect(h.$("[data-run-detail]")).toBeTruthy();
    // Back to Runs link
    const backLink = h.$("a[href='/runs']");
    expect(backLink).toBeTruthy();
    cleanup(h);
  });

  it("no duplicate h1 headings", async () => {
    stubMatchMedia(true);
    const repo = new InMemoryRunRepository();
    await seedRepo(repo, [["run-1", 1000]]);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
          text: () => Promise.resolve(""),
        }),
      ),
    );

    const h = renderWithRouter("/runs/run-1", repo);
    await settle();
    const h1s = h.$$("h1");
    expect(h1s.length).toBeLessThanOrEqual(1);
    cleanup(h);
  });
});
