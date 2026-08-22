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

const originalClipboard = navigator.clipboard;
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  Object.defineProperty(navigator, "clipboard", {
    value: originalClipboard,
    configurable: true,
    writable: true,
  });
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

  it("renders the exact diagnostic count (§K.5, F9)", async () => {
    const repo = repository();
    const failure = new RecordsIndexBuildError([
      { entityType: "observations", id: "observations", reason: "Database closed" },
      { entityType: "policy-study-trials", id: "study-1", reason: "Disk read error" },
      { entityType: "policy-study-observations", id: "study-2", reason: "Network timeout" },
    ]);
    (repo.list as ReturnType<typeof vi.fn>).mockRejectedValue(failure);
    const h = await renderList(repo);
    expect(h.container.textContent).toContain("3 diagnostics");
    act(() => h.root.unmount());
  });

  it("renders singular diagnostic count for a single failure (§K.5, F9)", async () => {
    const repo = repository();
    const failure = new RecordsIndexBuildError([
      { entityType: "runs", id: "runs", reason: "Disk error" },
    ]);
    (repo.list as ReturnType<typeof vi.fn>).mockRejectedValue(failure);
    const h = await renderList(repo);
    expect(h.container.textContent).toContain("1 diagnostic");
    act(() => h.root.unmount());
  });

  it("provides visible and accessible feedback when copy diagnostics fails (§K.5, F10)", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Clipboard permission denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    const repo = repository();
    const failure = new RecordsIndexBuildError([
      { entityType: "observations", id: "observations", reason: "Database closed" },
    ]);
    (repo.list as ReturnType<typeof vi.fn>).mockRejectedValue(failure);
    const h = await renderList(repo);
    const copyBtn = h.container.querySelector<HTMLButtonElement>(
      "button[data-action='copy-diagnostics']",
    )!;
    await act(async () => {
      copyBtn.click();
      await Promise.resolve();
    });
    expect(copyBtn.textContent).toContain("Failed to copy");
    expect(copyBtn.getAttribute("aria-label")).toBe("Failed to copy diagnostics");
    const liveRegion = h.container.querySelector("[role='status'][aria-live='polite']");
    expect(liveRegion).not.toBeNull();
    expect(liveRegion?.textContent).toContain("Failed to copy diagnostics to clipboard.");
    act(() => h.root.unmount());
  });

  it("provides accessible announcement when copy diagnostics succeeds (§K.5, F10)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    const repo = repository();
    const failure = new RecordsIndexBuildError([
      { entityType: "observations", id: "observations", reason: "Database closed" },
    ]);
    (repo.list as ReturnType<typeof vi.fn>).mockRejectedValue(failure);
    const h = await renderList(repo);
    const copyBtn = h.container.querySelector<HTMLButtonElement>(
      "button[data-action='copy-diagnostics']",
    )!;
    await act(async () => {
      copyBtn.click();
      await Promise.resolve();
    });
    expect(copyBtn.textContent).toContain("Copied!");
    expect(copyBtn.getAttribute("aria-label")).toBe("Diagnostics copied");
    const liveRegion = h.container.querySelector("[role='status'][aria-live='polite']");
    expect(liveRegion?.textContent).toContain("Diagnostics copied to clipboard.");
    act(() => h.root.unmount());
  });
});
