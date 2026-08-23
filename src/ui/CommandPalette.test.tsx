// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi, type Mock } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { CommandPalette } from "./CommandPalette";
import type { WorkspaceKind } from "./useActionShortcuts";
import type { SearchDocument, SearchDocumentType } from "../lib/search/search-types";
import {
  createInMemorySearchIndexRepository,
  type SearchIndexRepository,
} from "../lib/persistence/search-index-repository";
import type { SearchSourceResolver } from "../lib/search/search-reindex";

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
    $: (s) => document.querySelector<HTMLElement>(s),
    $$: (s) => [...document.querySelectorAll<HTMLElement>(s)],
  };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

// --- Helpers ------------------------------------------------------------------

interface PaletteProps {
  workspace?: WorkspaceKind;
  activeExperimentId?: string | null;
  canRun?: boolean;
  searchRepo?: SearchIndexRepository | null;
  resolver?: SearchSourceResolver | null;
}

interface Spies {
  onClose: Mock;
  onRun: Mock;
  onAbort: Mock;
  onToggleMode: Mock;
  onAddModel: Mock;
  onOpenConnections: Mock;
  onToggleFocusMode: Mock;
  onExport: Mock;
  onNavigate: Mock;
  onFindRecord: Mock;
  onViewExperiment: Mock;
  onAbortExperiment: Mock;
}

function renderPalette(overrides: PaletteProps = {}): { h: Harness; spies: Spies } {
  const spies: Spies = {
    onClose: vi.fn(),
    onRun: vi.fn(),
    onAbort: vi.fn(),
    onToggleMode: vi.fn(),
    onAddModel: vi.fn(),
    onOpenConnections: vi.fn(),
    onToggleFocusMode: vi.fn(),
    onExport: vi.fn(),
    onNavigate: vi.fn(),
    onFindRecord: vi.fn(),
    onViewExperiment: vi.fn(),
    onAbortExperiment: vi.fn(),
  };
  const h = render(
    <CommandPalette
      open={true}
      onClose={spies.onClose}
      onRun={spies.onRun}
      onAbort={spies.onAbort}
      onToggleMode={spies.onToggleMode}
      onAddModel={spies.onAddModel}
      onOpenConnections={spies.onOpenConnections}
      onToggleFocusMode={spies.onToggleFocusMode}
      onExport={spies.onExport}
      running={false}
      canRun={overrides.canRun ?? true}
      workspace={overrides.workspace}
      onNavigate={spies.onNavigate}
      onFindRecord={spies.onFindRecord}
      activeExperimentId={overrides.activeExperimentId}
      onViewExperiment={spies.onViewExperiment}
      onAbortExperiment={spies.onAbortExperiment}
      searchRepo={overrides.searchRepo}
      resolver={overrides.resolver}
    />,
  );
  return { h, spies };
}

/** Labels of every rendered command option, in DOM order. */
function optionLabels(h: Harness): string[] {
  return h
    .$$('[role="option"]')
    .map((el) => el.querySelector(".truncate")?.textContent?.trim() ?? "");
}

function findOption(h: Harness, label: string): HTMLElement | null {
  return (
    h
      .$$('[role="option"]')
      .find((el) => el.querySelector(".truncate")?.textContent?.trim() === label) ?? null
  );
}

function typeQuery(h: Harness, value: string) {
  const input = h.$('input[aria-label="Search commands"]') as HTMLInputElement | null;
  expect(input).toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// --- Tests --------------------------------------------------------------------

describe("CommandPalette workspace awareness (plan 8.2)", () => {
  it("opens with a Navigate group first containing exactly the six task-first destinations", async () => {
    const { h } = renderPalette();
    await settle();

    const headers = h.$$("[cmdk-group-heading]").map((el) => el.textContent?.trim() ?? "");
    expect(headers[0]).toBe("Navigate");
    // Child 08 §G.7: the Navigate group is exactly these six commands in
    // this order. There is no "Go to Runs" command anywhere.
    expect(optionLabels(h).slice(0, 6)).toEqual([
      "Go to Compare",
      "Go to Evaluations",
      "Go to Lab",
      "Go to Models",
      "Go to Records",
      "Go to Tasks",
    ]);
    expect(findOption(h, "Go to Runs")).toBeNull();
    cleanup(h);
  });

  it("selecting a navigate command calls onNavigate with the path and closes the palette", async () => {
    const { h, spies } = renderPalette();
    await settle();

    const goRecords = findOption(h, "Go to Records");
    expect(goRecords).toBeTruthy();
    act(() => {
      goRecords!.click();
    });
    expect(spies.onClose).toHaveBeenCalledTimes(1);
    expect(spies.onNavigate).toHaveBeenCalledWith("/records");
    cleanup(h);
  });

  it.each([
    ["Go to Compare", "/compare"],
    ["Go to Evaluations", "/evaluations"],
  ])("selecting %s navigates to %s", async (label, path) => {
    const { h, spies } = renderPalette();
    await settle();
    act(() => {
      findOption(h, label)!.click();
    });
    expect(spies.onNavigate).toHaveBeenCalledWith(path);
    cleanup(h);
  });

  it("omits Compare-only commands outside Compare and keeps Open connections global", async () => {
    const { h } = renderPalette({ workspace: "runs" });
    await settle();

    const labels = optionLabels(h);
    // Compare-only commands are absent (not disabled) outside Compare.
    expect(labels).not.toContain("Run pipeline");
    expect(labels).not.toContain("Abort run");
    expect(labels).not.toContain("Toggle Rank ↔ Fuse");
    expect(labels).not.toContain("Toggle focus mode");
    expect(labels).not.toContain("Add a model");
    expect(labels).not.toContain("Add evaluation criterion");
    expect(labels).not.toContain("Export result");
    // Global commands survive on every workspace.
    expect(labels).toContain("Open connections");
    expect(labels).toContain("Go to Compare");
    expect(labels).toContain("Go to Records");
    expect(labels).toContain("Go to Evaluations");
    expect(labels).toContain("Go to Lab");
    expect(labels).toContain("Go to Models");
    cleanup(h);
  });

  it("omits Compare-only commands in the evaluations and experiments workspaces too", async () => {
    for (const workspace of ["evaluations", "experiments"] as WorkspaceKind[]) {
      const { h } = renderPalette({ workspace });
      await settle();
      const labels = optionLabels(h);
      expect(labels).not.toContain("Run pipeline");
      expect(labels).not.toContain("Add a model");
      expect(labels).toContain("Open connections");
      cleanup(h);
    }
  });

  it("shows every Compare command on the compare workspace", async () => {
    const { h } = renderPalette({ workspace: "compare" });
    await settle();

    const labels = optionLabels(h);
    expect(labels).toContain("Run pipeline");
    expect(labels).toContain("Toggle Rank ↔ Fuse");
    expect(labels).toContain("Toggle focus mode");
    expect(labels).toContain("Add a model");
    expect(labels).not.toContain("Add evaluation criterion");
    expect(labels).toContain("Export result");
    expect(labels).toContain("Open connections");
    cleanup(h);
  });

  it("does not expose the unsupported inert criterion command", async () => {
    const { h } = renderPalette({ workspace: "compare" });
    await settle();

    expect(findOption(h, "Add evaluation criterion")).toBeNull();
    expect(findOption(h, "Add rubric criterion")).toBeNull();
    expect(document.body.textContent).not.toContain("rubric criterion");
    cleanup(h);
  });

  it("exposes View/Abort experiment commands only while an experiment is active", async () => {
    const active = renderPalette({ activeExperimentId: "exp-1" });
    await settle();

    const view = findOption(active.h, "View experiment");
    const abort = findOption(active.h, "Abort experiment");
    expect(view).toBeTruthy();
    expect(abort).toBeTruthy();

    act(() => {
      view!.click();
    });
    expect(active.spies.onViewExperiment).toHaveBeenCalledTimes(1);
    expect(active.spies.onAbortExperiment).not.toHaveBeenCalled();
    cleanup(active.h);

    const second = renderPalette({ activeExperimentId: "exp-1" });
    await settle();
    act(() => {
      findOption(second.h, "Abort experiment")!.click();
    });
    expect(second.spies.onAbortExperiment).toHaveBeenCalledTimes(1);
    cleanup(second.h);

    const idle = renderPalette({ activeExperimentId: null });
    await settle();
    expect(findOption(idle.h, "View experiment")).toBeNull();
    expect(findOption(idle.h, "Abort experiment")).toBeNull();
    cleanup(idle.h);
  });

  it("still narrows commands with the fuzzy filter", async () => {
    const { h } = renderPalette();
    await settle();

    typeQuery(h, "records");
    const labels = optionLabels(h);
    expect(labels).toContain("Go to Records");
    expect(labels).not.toContain("Go to Compare");
    expect(labels).not.toContain("Go to Evaluations");
    cleanup(h);
  });

  it.each(["runs", "history", "ledger", "audit"])(
    "typing the legacy keyword '%s' resolves Go to Records",
    async (keyword) => {
      const { h } = renderPalette();
      await settle();

      typeQuery(h, keyword);
      expect(optionLabels(h)).toContain("Go to Records");
      expect(optionLabels(h)).not.toContain("Go to Runs");
      cleanup(h);
    },
  );

  it("offers Find record by ID… and hands off to the Records search surface", async () => {
    const { h, spies } = renderPalette();
    await settle();

    const find = findOption(h, "Find record by ID…");
    expect(find).toBeTruthy();
    act(() => {
      find!.click();
    });
    expect(spies.onClose).toHaveBeenCalledTimes(1);
    expect(spies.onFindRecord).toHaveBeenCalledTimes(1);
    cleanup(h);
  });
});

describe("CommandPalette cmdk interaction contract", () => {
  it("opens without an entrance animation", async () => {
    const { h } = renderPalette();
    await settle();

    const dialog = h.$("[cmdk-dialog]");
    expect(dialog).toBeTruthy();
    expect(dialog?.className).not.toContain("animate-cmd-pop");
    expect(dialog?.outerHTML).not.toContain("data-entering");
    expect(dialog?.outerHTML).not.toContain("data-exiting");
    cleanup(h);
  });

  it("filters commands and selects the active command with Enter", async () => {
    const { h, spies } = renderPalette();
    await settle();

    typeQuery(h, "records");
    const input = h.$('input[aria-label="Search commands"]');
    act(() => {
      input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(spies.onClose).toHaveBeenCalledTimes(1);
    expect(spies.onNavigate).toHaveBeenCalledWith("/records");
    cleanup(h);
  });

  it("offers Go to Tasks in the Navigate group and routes to /tasks on click", async () => {
    const { h, spies } = renderPalette();
    await settle();

    const goTasks = findOption(h, "Go to Tasks");
    expect(goTasks).toBeTruthy();
    act(() => {
      goTasks!.click();
    });
    expect(spies.onClose).toHaveBeenCalledTimes(1);
    expect(spies.onNavigate).toHaveBeenCalledWith("/tasks");
    cleanup(h);
  });

  it("Go to Tasks is keyboard-operable: filter + Enter navigates to /tasks", async () => {
    const { h, spies } = renderPalette();
    await settle();

    typeQuery(h, "tasks");
    const input = h.$('input[aria-label="Search commands"]');
    act(() => {
      input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(spies.onClose).toHaveBeenCalledTimes(1);
    expect(spies.onNavigate).toHaveBeenCalledWith("/tasks");
    cleanup(h);
  });

  it("offers Go to Lab in the Navigate group and routes to /lab on click", async () => {
    const { h, spies } = renderPalette();
    await settle();

    const goLab = findOption(h, "Go to Lab");
    expect(goLab).toBeTruthy();
    act(() => {
      goLab!.click();
    });
    expect(spies.onClose).toHaveBeenCalledTimes(1);
    expect(spies.onNavigate).toHaveBeenCalledWith("/lab");
    cleanup(h);
  });

  it("does not execute disabled commands", async () => {
    const { h, spies } = renderPalette({ canRun: false });
    await settle();

    const run = findOption(h, "Run pipeline");
    expect(run?.getAttribute("aria-disabled")).toBe("true");
    act(() => {
      run!.click();
    });

    expect(spies.onRun).not.toHaveBeenCalled();
    expect(spies.onClose).not.toHaveBeenCalled();
    cleanup(h);
  });
});

describe("CommandPalette cross-entity local search integration", () => {
  function makeDoc(
    id: string,
    type: SearchDocumentType,
    title: string,
    subtitle = "",
    ownerHref = `/${type}/${id}`,
    tokens: string[] = [],
  ): SearchDocument {
    return {
      type,
      id,
      revision: 1,
      title,
      subtitle,
      ownerHref,
      tokens: tokens.length > 0 ? tokens : title.toLowerCase().split(/\s+/),
      updatedAt: 1000,
      indexSchemaVersion: 1,
    };
  }
  const SEARCH_CORPUS: SearchDocument[] = [
    makeDoc(
      "t_eval_1",
      "task",
      "Evaluation benchmark task",
      "Core task for eval",
      "/tasks/t_eval_1",
      ["evaluation", "benchmark", "task"],
    ),
    makeDoc(
      "rubric_score_1",
      "rubric",
      "Quality scoring rubric",
      "Rubric with grading criteria",
      "/evaluations/rubrics/rubric_score_1",
      ["quality", "scoring", "rubric"],
    ),
    makeDoc(
      "model_sonnet_1",
      "model_configuration",
      "Claude 3.5 Sonnet config",
      "Temperature 0.7",
      "/models/profiles/model_sonnet_1",
      ["claude", "sonnet", "config"],
    ),
    makeDoc(
      "eval_nightly_1",
      "evaluation",
      "Nightly eval run",
      "Automated execution",
      "/evaluations/results/eval_nightly_1",
      ["nightly", "eval", "run"],
    ),
    makeDoc("rec_1042", "record", "Record #1042", "Historical run", "/records/run/rec_1042", [
      "record",
      "1042",
    ]),
  ];

  it("renders grouped search hits from searchRepo when query is typed", async () => {
    const searchRepo = createInMemorySearchIndexRepository(SEARCH_CORPUS);
    const { h } = renderPalette({ searchRepo });
    await settle();

    typeQuery(h, "sonnet");
    await settle();

    const optionText = optionLabels(h);
    expect(optionText).toContain("Claude 3.5 Sonnet config");

    const headers = h.$$("[cmdk-group-heading]").map((el) => el.textContent?.trim() ?? "");
    expect(headers).toContain("Model Configurations");
    cleanup(h);
  });

  it("caps rendered search hits at 20", async () => {
    const hugeCorpus: SearchDocument[] = Array.from({ length: 30 }, (_, i) =>
      makeDoc(`item-${i}`, "task", `Search item task ${i}`, `Subtitle ${i}`, `/tasks/item-${i}`, [
        "search",
        "item",
      ]),
    );
    const searchRepo = createInMemorySearchIndexRepository(hugeCorpus);
    const { h } = renderPalette({ searchRepo });
    await settle();

    typeQuery(h, "search item");
    await settle();

    const searchHitOptions = h
      .$$('[role="option"]')
      .filter((el) => el.textContent?.includes("Search item task"));
    expect(searchHitOptions.length).toBeLessThanOrEqual(20);
    expect(searchHitOptions.length).toBe(20);
    cleanup(h);
  });

  it("selecting a search hit calls onNavigate with ownerHref and closes the palette", async () => {
    const searchRepo = createInMemorySearchIndexRepository(SEARCH_CORPUS);
    const { h, spies } = renderPalette({ searchRepo });
    await settle();

    typeQuery(h, "scoring");
    await settle();

    const rubricOption = findOption(h, "Quality scoring rubric");
    expect(rubricOption).toBeTruthy();
    act(() => {
      rubricOption!.click();
    });

    expect(spies.onClose).toHaveBeenCalledTimes(1);
    expect(spies.onNavigate).toHaveBeenCalledWith("/evaluations/rubrics/rubric_score_1");
    cleanup(h);
  });

  it("renders 'View all results' option and routes to /search?q=...", async () => {
    const searchRepo = createInMemorySearchIndexRepository(SEARCH_CORPUS);
    const { h, spies } = renderPalette({ searchRepo });
    await settle();

    typeQuery(h, "benchmark");
    await settle();

    const viewAll = h
      .$$('[role="option"]')
      .find((el) => el.textContent?.includes("View all results"));
    expect(viewAll).toBeTruthy();

    act(() => {
      viewAll!.click();
    });

    expect(spies.onClose).toHaveBeenCalledTimes(1);
    expect(spies.onNavigate).toHaveBeenCalledWith("/search?q=benchmark");
    cleanup(h);
  });

  it("never renders secrets or credential patterns in search hit rows", async () => {
    const searchRepo = createInMemorySearchIndexRepository(SEARCH_CORPUS);
    const { h } = renderPalette({ searchRepo });
    await settle();

    typeQuery(h, "eval");
    await settle();

    const html = h.container.innerHTML;
    expect(html).not.toMatch(/sk-[A-Za-z0-9_-]{6,}|AIza[A-Za-z0-9_-]{10,}|Bearer\s+\S+/i);
    cleanup(h);
  });

  it("handles search repository errors gracefully without crashing the palette", async () => {
    const failingRepo: SearchIndexRepository = {
      ...createInMemorySearchIndexRepository(),
      search: vi.fn().mockRejectedValue(new Error("Index access failed")),
    };
    const { h } = renderPalette({ searchRepo: failingRepo });
    await settle();

    typeQuery(h, "benchmark");
    await settle();

    // Palette dialog must still be mounted and responsive
    expect(h.$("[cmdk-dialog]")).toBeTruthy();
    cleanup(h);
  });

  it("preserves existing static commands when query matches both commands and entities", async () => {
    const searchRepo = createInMemorySearchIndexRepository(SEARCH_CORPUS);
    const { h } = renderPalette({ searchRepo });
    await settle();

    typeQuery(h, "record");
    await settle();

    const labels = optionLabels(h);
    expect(labels).toContain("Go to Records");
    expect(labels).toContain("Record #1042");
    cleanup(h);
  });

  it("keeps type groups visible and does not coerce entity types", async () => {
    const searchRepo = createInMemorySearchIndexRepository(SEARCH_CORPUS);
    const { h } = renderPalette({ searchRepo });
    await settle();

    typeQuery(h, "eval");
    await settle();

    const headers = h.$$("[cmdk-group-heading]").map((el) => el.textContent?.trim() ?? "");
    // Both Tasks and Evaluations groups should be present if both match
    expect(headers).toContain("Tasks");
    expect(headers).toContain("Evaluations");
    cleanup(h);
  });
  it("reproduction C3: verifies and does not navigate when selecting deleted stale hit in CommandPalette", async () => {
    const searchRepo = createInMemorySearchIndexRepository([
      makeDoc("deleted-item", "task", "Deleted Item", "Sub", "/tasks/deleted-item", [
        "deleted",
        "item",
      ]),
    ]);
    const resolver: SearchSourceResolver = {
      async resolveDocument(ref) {
        if (ref.id === "deleted-item") return null;
        return null;
      },
    };

    const { h, spies } = renderPalette({ searchRepo, resolver });
    await settle();

    typeQuery(h, "deleted");
    await settle();

    const option = findOption(h, "Deleted Item");
    expect(option).toBeTruthy();

    await act(async () => {
      option!.click();
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    });

    expect(spies.onClose).toHaveBeenCalledTimes(1);
    expect(spies.onNavigate).not.toHaveBeenCalled();
    expect(await searchRepo.getDocument("task", "deleted-item")).toBeNull();
    cleanup(h);
  });
});
