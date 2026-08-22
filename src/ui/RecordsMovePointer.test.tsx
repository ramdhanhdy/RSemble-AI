// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useNavigate, type NavigateFunction } from "react-router-dom";
import { RecordsMovePointer, DISMISSED_STORAGE_KEY } from "./RecordsMovePointer";
import { InMemoryRunRepository } from "../lib/persistence/run-repository";
import { RepositoryContext } from "../lib/persistence/repository-context";
import type { FullRunSummaryV2, RunRecordV2 } from "../lib/persistence/run-types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
}

function render(node: React.ReactNode): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
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

function flush(ms = 0): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function makeRunRecord(id: string): { record: RunRecordV2; summary: FullRunSummaryV2 } {
  const now = Date.now();
  const summary: FullRunSummaryV2 = {
    kind: "full",
    schemaVersion: 2,
    id,
    revision: 1,
    createdAt: now,
    completedAt: now + 500,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    taskTitle: `Task ${id}`,
    taskExcerpt: `Excerpt ${id}`,
    modelKeys: ["openrouter:gpt-4o"],
    winnerKeys: ["openrouter:gpt-4o"],
    scoresByModelKey: { "openrouter:gpt-4o": 4.5 },
    judgeModelKey: "openrouter:judge",
    evaluationProfileId: null,
    evaluationProfileVersion: null,
    detailAvailable: true,
    searchText: `task ${id}`,
  };
  const record: RunRecordV2 = {
    schemaVersion: 2,
    id,
    revision: 1,
    execution: { ownerId: "test", leaseId: "test", fence: 1 },
    createdAt: now,
    updatedAt: now,
    completedAt: now + 500,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: { title: `Task ${id}`, prompt: "Test prompt", systemPrompt: "", temperature: 0.7 },
    evaluation: { profile: null, candidateMessages: [] },
    candidates: [],
    judge: {
      status: "done",
      acceptedAttemptId: null,
      report: null,
      consensus: null,
      attempts: [],
    },
    fusion: {
      status: "done",
      acceptedAttemptId: null,
      attempts: [],
    },
    winnerKeys: [],
  };
  return { record, summary };
}

describe("RecordsMovePointer (spec §O.1)", () => {
  it("does not render when already dismissed in localStorage", async () => {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, "true");
    const repo = new InMemoryRunRepository();
    const { record, summary } = makeRunRecord("run-1");
    await repo.create(record, summary);

    const h = render(
      <MemoryRouter initialEntries={["/compare"]}>
        <RepositoryContext.Provider
          value={{
            runRepo: repo,
            evalRepo: null,
            fusionRepo: null,
            taskRepo: null,
            db: null,
            storageState: "ready",
            retry: () => undefined,
          }}
        >
          <RecordsMovePointer />
        </RepositoryContext.Provider>
      </MemoryRouter>,
    );
    // Flush any async repository checks
    await act(async () => {
      await flush(10);
    });

    expect(h.$("[role='status']")).toBeNull();
    expect(h.container.textContent).not.toContain("Runs moved.");
    cleanup(h);
  });

  it("does not render on a fresh database with 0 runs", async () => {
    const repo = new InMemoryRunRepository();
    const h = render(
      <MemoryRouter initialEntries={["/compare"]}>
        <RepositoryContext.Provider
          value={{
            runRepo: repo,
            evalRepo: null,
            fusionRepo: null,
            taskRepo: null,
            db: null,
            storageState: "ready",
            retry: () => undefined,
          }}
        >
          <RecordsMovePointer />
        </RepositoryContext.Provider>
      </MemoryRouter>,
    );
    await act(async () => {
      await flush(10);
    });
    expect(h.$("[role='status']")).toBeNull();
    expect(h.container.textContent).not.toContain("Runs moved.");
    expect(window.localStorage.getItem(DISMISSED_STORAGE_KEY)).toBeNull();
    cleanup(h);
  });

  it("renders when ≥1 run record exists and not dismissed", async () => {
    const repo = new InMemoryRunRepository();
    const { record, summary } = makeRunRecord("run-1");
    await repo.create(record, summary);

    const h = render(
      <MemoryRouter initialEntries={["/compare"]}>
        <RepositoryContext.Provider
          value={{
            runRepo: repo,
            evalRepo: null,
            fusionRepo: null,
            taskRepo: null,
            db: null,
            storageState: "ready",
            retry: () => undefined,
          }}
        >
          <RecordsMovePointer />
        </RepositoryContext.Provider>
      </MemoryRouter>,
    );

    await act(async () => {
      await flush(10);
    });
    expect(h.container.textContent).toContain("Runs moved.");
    expect(h.container.textContent).toContain(
      "Exact execution records now live here — same history, same links, new address.",
    );
    const gotItBtn = h.$("button");
    expect(gotItBtn).not.toBeNull();
    expect(gotItBtn?.textContent?.trim()).toBe("Got it");
    cleanup(h);
  });

  it("Got it button satisfies min-h-[44px] touch target rule", async () => {
    const h = render(
      <MemoryRouter initialEntries={["/compare"]}>
        <RecordsMovePointer hasExistingRuns={true} />
      </MemoryRouter>,
    );

    const button = h.$("button");
    expect(button).not.toBeNull();
    expect(button?.className).toContain("min-h-[44px]");
    cleanup(h);
  });

  it("clicking Got it dismisses the pointer forever and sets localStorage", async () => {
    const h = render(
      <MemoryRouter initialEntries={["/compare"]}>
        <RecordsMovePointer hasExistingRuns={true} />
      </MemoryRouter>,
    );

    const button = h.$("button");
    expect(button).not.toBeNull();

    act(() => {
      button?.click();
    });

    expect(window.localStorage.getItem(DISMISSED_STORAGE_KEY)).toBe("true");
    expect(h.$("[role='status']")).toBeNull();
    cleanup(h);
  });

  it("opening the records drawer dismisses the pointer and sets localStorage", async () => {
    let recordsOpen = false;
    const h = render(
      <MemoryRouter initialEntries={["/compare"]}>
        <RecordsMovePointer hasExistingRuns={true} recordsOpen={recordsOpen} />
      </MemoryRouter>,
    );

    expect(h.$("[role='status']")).not.toBeNull();

    // Re-render with recordsOpen=true (simulating opening the drawer)
    act(() => {
      recordsOpen = true;
      h.root.render(
        <MemoryRouter initialEntries={["/compare"]}>
          <RecordsMovePointer hasExistingRuns={true} recordsOpen={recordsOpen} />
        </MemoryRouter>,
      );
    });

    expect(window.localStorage.getItem(DISMISSED_STORAGE_KEY)).toBe("true");
    expect(h.$("[role='status']")).toBeNull();
    cleanup(h);
  });

  it("navigating to another route dismisses the pointer and sets localStorage", async () => {
    let navigateFn: NavigateFunction | null = null;
    function NavTest() {
      navigateFn = useNavigate();
      return <RecordsMovePointer hasExistingRuns={true} />;
    }

    const h = render(
      <MemoryRouter initialEntries={["/compare"]}>
        <NavTest />
      </MemoryRouter>,
    );

    expect(h.$("[role='status']")).not.toBeNull();

    // Trigger navigation
    act(() => {
      void navigateFn?.("/evaluations");
    });

    expect(window.localStorage.getItem(DISMISSED_STORAGE_KEY)).toBe("true");
    expect(h.$("[role='status']")).toBeNull();
    cleanup(h);
  });
  it("retains pointer through initial root redirect from / to /compare", () => {
    let navigateFn: NavigateFunction | null = null;
    function RootRedirectTest() {
      navigateFn = useNavigate();
      return <RecordsMovePointer hasExistingRuns={true} />;
    }

    const h = render(
      <MemoryRouter initialEntries={["/"]}>
        <RootRedirectTest />
      </MemoryRouter>,
    );

    expect(h.$("[role='status']")).not.toBeNull();

    // Simulate the app router's initial redirect from / to /compare
    act(() => {
      void navigateFn?.("/compare", { replace: true });
    });

    expect(h.$("[role='status']")).not.toBeNull();
    expect(window.localStorage.getItem(DISMISSED_STORAGE_KEY)).toBeNull();

    // Subsequent navigation away from /compare DOES dismiss
    act(() => {
      void navigateFn?.("/records");
    });

    expect(window.localStorage.getItem(DISMISSED_STORAGE_KEY)).toBe("true");
    expect(h.$("[role='status']")).toBeNull();
    cleanup(h);
  });

  it("never traps focus and is non-modal", () => {
    const h = render(
      <MemoryRouter initialEntries={["/compare"]}>
        <div>
          <button id="records-btn">Records</button>
          <RecordsMovePointer hasExistingRuns={true} />
          <button id="connections-btn">Connections</button>
        </div>
      </MemoryRouter>,
    );

    const buttons = h.$$("button");
    expect(buttons.map((b) => b.id || b.textContent?.trim())).toEqual([
      "records-btn",
      "Got it",
      "connections-btn",
    ]);
    // Does not render a modal backdrop
    expect(h.$("[data-dialog-backdrop]")).toBeNull();
    cleanup(h);
  });

  it("handles storage exceptions gracefully without crashing", () => {
    const brokenStorage = {
      getItem: () => {
        throw new Error("SecurityError: Access is denied");
      },
      setItem: () => {
        throw new Error("SecurityError: Access is denied");
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };

    const h = render(
      <MemoryRouter initialEntries={["/compare"]}>
        <RecordsMovePointer hasExistingRuns={true} storage={brokenStorage} />
      </MemoryRouter>,
    );

    // Should still render without throwing
    expect(h.$("[role='status']")).not.toBeNull();
    const button = h.$("button");
    // Dismissing should not throw even if setItem throws
    expect(() => {
      act(() => {
        button?.click();
      });
    }).not.toThrow();
    expect(h.$("[role='status']")).toBeNull();
    cleanup(h);
  });
});
