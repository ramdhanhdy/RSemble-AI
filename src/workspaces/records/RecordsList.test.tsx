// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordsRepository } from "../../lib/records/records-repository";
import { RecordsList } from "./RecordsList";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function repository(): RecordsRepository {
  return {
    list: vi.fn(async () => ({ items: [], total: 0, offset: 0, limit: 200 })),
    getReference: vi.fn(async () => null),
    getTaskExecution: vi.fn(async () => null),
    getLegacySummary: vi.fn(async () => null),
    getObservation: vi.fn(async () => null),
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

describe("RecordsList", () => {
  it("adds Type to the preserved filter query", async () => {
    const repo = repository();
    const harness = await renderList(repo);
    const typeSelect = harness.container.querySelector<HTMLSelectElement>(
      "select[data-filter='type']",
    )!;
    act(() => {
      typeSelect.value = "policy-study";
      typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(repo.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "policy-study", limit: 200, offset: 0 }),
    );
    act(() => harness.root.unmount());
  });

  it("commits search only after the preserved 200ms debounce", async () => {
    vi.useFakeTimers();
    const repo = repository();
    const harness = await renderList(repo);
    const search = harness.container.querySelector<HTMLInputElement>("input[data-filter='search']")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(search, "run-exact");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => vi.advanceTimersByTime(199));
    expect(repo.list).not.toHaveBeenCalledWith(expect.objectContaining({ text: "run-exact" }));
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(repo.list).toHaveBeenLastCalledWith(expect.objectContaining({ text: "run-exact" }));
    act(() => harness.root.unmount());
  });
});
