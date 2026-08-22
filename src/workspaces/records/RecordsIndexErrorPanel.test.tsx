// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RecordsIndexBuildError,
  type RecordsRepository,
} from "../../lib/records/records-repository";
import { RecordsList } from "./RecordsList";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function repository(): RecordsRepository {
  return {
    list: vi.fn(async () => ({ items: [], total: 0, offset: 0, limit: 200 })),
    getReference: vi.fn(async () => null),
    getTaskExecution: vi.fn(async () => null),
    getLegacySummary: vi.fn(async () => null),
    getObservation: vi.fn(async () => null),
    getObservationDecision: vi.fn(async () => null),
    getPolicyStudyRecord: vi.fn(async () => null),
    getPolicyStudyChildren: vi.fn(async () => ({
      trialCount: 0,
      observationCount: 0,
      exactRunCount: 0,
      items: [],
    })),
  };
}

async function renderList(repo: RecordsRepository) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <RecordsList repository={repo} selected={null} />
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return { container, root };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

// §K.5 — the list pane renders a blocking, rebuildable diagnostics panel when
// the derived index cannot be built. Source data is explicitly unaffected.
describe("RecordsIndexErrorPanel (§K.5)", () => {
  it("renders the rebuildable-index diagnostics panel when a source store fails", async () => {
    const repo = repository();
    const failure = new RecordsIndexBuildError([
      { entityType: "observations", id: "observations", reason: "Database closed" },
    ]);
    (repo.list as ReturnType<typeof vi.fn>).mockRejectedValue(failure);
    const h = await renderList(repo);
    expect(h.container.textContent).toContain("The records index could not be built.");
    expect(h.container.textContent).toContain("observations");
    expect(h.container.textContent).toContain("Database closed");
    expect(h.container.querySelector("button[data-action='retry-rebuild']")).not.toBeNull();
    expect(h.container.querySelector("button[data-action='copy-diagnostics']")).not.toBeNull();
    expect(h.container.textContent).toContain(
      "Your runs and results are unaffected — this index is derived and rebuildable.",
    );
    // Retry rebuild re-runs the index build and clears the panel.
    (repo.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [],
      total: 0,
      offset: 0,
      limit: 200,
    });
    const retry = h.container.querySelector<HTMLButtonElement>(
      "button[data-action='retry-rebuild']",
    )!;
    act(() => retry.click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.container.querySelector("[data-index-error-panel]")).toBeNull();
    act(() => h.root.unmount());
  });
});
