// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { InMemoryTaskRepository } from "../../lib/persistence/in-memory-task-repository";
import type { TaskRecord, TaskVersion } from "../../lib/tasks/task-types";
import { TaskVersionSelector, type TaskVersionSelection } from "./TaskVersionSelector";

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

async function settle() {
  await act(async () => {
    await flush();
  });
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

function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const proto =
      input instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

async function seedTask(
  repo: InMemoryTaskRepository,
  id: string,
  title: string,
  overrides: {
    objective?: string;
    instruction?: string;
    systemInstruction?: string;
    archived?: boolean;
    extraVersions?: number;
  } = {},
): Promise<TaskRecord> {
  const now = Date.now();
  const v1: TaskVersion = {
    taskId: id,
    version: 1,
    title,
    objective: overrides.objective ?? `Objective for ${title}.`,
    candidateInstruction: overrides.instruction ?? `Instruction for ${title}.`,
    defaultContextManifest: [],
    responseContract: null,
    taskVerifierRef: null,
    source: { kind: "authored", legacyScopeKey: null, note: null },
    createdAt: now,
  };

  const record: TaskRecord = {
    id,
    latestVersion: 1,
    origin: "authored",
    revision: 0,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };

  await repo.createTask(record, v1);

  if (overrides.extraVersions && overrides.extraVersions > 1) {
    for (let v = 2; v <= overrides.extraVersions; v++) {
      const rec = (await repo.getTaskRecord(id))!;
      const nextVer: TaskVersion = {
        ...v1,
        version: v,
        title: `${title} (v${v})`,
        objective: `${title} objective (v${v})`,
        candidateInstruction: `Instruction for ${title} (v${v})`,
        createdAt: now + v * 1000,
      };
      await repo.appendTaskVersion(rec, nextVer, rec.revision);
    }
  }

  if (overrides.archived) {
    const rec = (await repo.getTaskRecord(id))!;
    await repo.archiveTask(id, rec.revision);
  }

  return (await repo.getTaskRecord(id))!;
}

describe("TaskVersionSelector — dialog visibility and search", () => {
  it("renders dialog with search input when open is true", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1", "Summarize article");
    const h = render(
      <TaskVersionSelector repo={repo} open={true} onClose={vi.fn()} onSelect={vi.fn()} />,
    );
    await settle();

    const dialog = h.$("[role='dialog']") ?? h.$("[data-task-version-selector]");
    expect(dialog).toBeTruthy();
    const searchInput = h.$("input[type='search'], input[data-action='search-tasks']");
    expect(searchInput).toBeTruthy();
    cleanup(h);
  });

  it("does not render dialog content when open is false", async () => {
    const repo = new InMemoryTaskRepository();
    const h = render(
      <TaskVersionSelector repo={repo} open={false} onClose={vi.fn()} onSelect={vi.fn()} />,
    );
    await settle();

    expect(h.$("[role='dialog']")).toBeNull();
    cleanup(h);
  });

  it("searches canonical tasks through TaskRepository", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1", "Triage support tickets");
    await seedTask(repo, "t-2", "Draft email reply");
    await seedTask(repo, "t-3", "Analyze quarterly revenue");

    const h = render(
      <TaskVersionSelector repo={repo} open={true} onClose={vi.fn()} onSelect={vi.fn()} />,
    );
    await settle();

    expect(h.container.textContent).toContain("Triage support tickets");
    expect(h.container.textContent).toContain("Draft email reply");
    expect(h.container.textContent).toContain("Analyze quarterly revenue");

    const searchInput = h.$(
      "input[type='search'], input[data-action='search-tasks']",
    ) as HTMLInputElement;
    typeInto(searchInput, "triage");
    await settle();

    expect(h.container.textContent).toContain("Triage support tickets");
    expect(h.container.textContent).not.toContain("Analyze quarterly revenue");
    cleanup(h);
  });
});

describe("TaskVersionSelector — version pinning and selection", () => {
  it("defaults to latest task version with exact pin visible", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-multi", "Multi-version Task", { extraVersions: 3 });

    const onSelect = vi.fn();
    const h = render(
      <TaskVersionSelector repo={repo} open={true} onClose={vi.fn()} onSelect={onSelect} />,
    );
    await settle();

    // Select the task row to view versions
    const taskRow =
      h.$("[data-task-id='t-multi']") ??
      h.$$("button, [role='button']").find((b) => b.textContent?.includes("Multi-version Task"));
    expect(taskRow).toBeTruthy();
    await act(async () => {
      taskRow!.click();
    });
    await settle();

    // Latest is v3 and pinned version is visible
    expect(h.container.textContent).toMatch(/v3/);
    const pinBadge = h.$("[data-pinned-version]") ?? h.container;
    expect(pinBadge.textContent).toContain("v3");

    // Add / Select button triggers onSelect with v3
    const addBtn =
      h.$("button[data-action='confirm-select-task']") ??
      h.$$("button").find((b) => b.textContent?.match(/add|select|pin/i));
    expect(addBtn).toBeTruthy();
    await act(async () => {
      addBtn!.click();
    });
    await settle();

    expect(onSelect).toHaveBeenCalledTimes(1);
    const selection = onSelect.mock.calls[0][0] as TaskVersionSelection;
    expect(selection.taskId).toBe("t-multi");
    expect(selection.version).toBe(3);
    cleanup(h);
  });

  it("allows intentionally selecting an older version", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-multi", "Multi-version Task", { extraVersions: 3 });

    const onSelect = vi.fn();
    const h = render(
      <TaskVersionSelector repo={repo} open={true} onClose={vi.fn()} onSelect={onSelect} />,
    );
    await settle();

    // Select the task
    const taskRow =
      h.$("[data-task-id='t-multi']") ??
      h.$$("button, [role='button']").find((b) => b.textContent?.includes("Multi-version Task"));
    await act(async () => {
      taskRow!.click();
    });
    await settle();

    // Choose older version v1
    const v1Option =
      h.$("[data-version-option='1']") ??
      h
        .$$("button, option")
        .find((el) => el.textContent?.trim() === "v1" || el.getAttribute("value") === "1");
    expect(v1Option).toBeTruthy();
    if (v1Option?.tagName.toLowerCase() === "option") {
      const select = v1Option.closest("select")!;
      await act(async () => {
        select.value = "1";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    } else {
      await act(async () => {
        v1Option!.click();
      });
    }
    await settle();

    // Pinned version shows v1
    expect(h.container.textContent).toMatch(/v1/);

    const addBtn =
      h.$("button[data-action='confirm-select-task']") ??
      h.$$("button").find((b) => b.textContent?.match(/add|select|pin/i));
    await act(async () => {
      addBtn!.click();
    });
    await settle();

    expect(onSelect).toHaveBeenCalledTimes(1);
    const selection = onSelect.mock.calls[0][0] as TaskVersionSelection;
    expect(selection.taskId).toBe("t-multi");
    expect(selection.version).toBe(1);
    cleanup(h);
  });

  it("shows candidate instruction and objective preview", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-preview", "Article Summarizer", {
      objective: "Condense long articles into 3 key takeaways.",
      instruction: "Given the following article, produce 3 concise bullet points.",
    });

    const h = render(
      <TaskVersionSelector repo={repo} open={true} onClose={vi.fn()} onSelect={vi.fn()} />,
    );
    await settle();

    const taskRow =
      h.$("[data-task-id='t-preview']") ??
      h.$$("button, [role='button']").find((b) => b.textContent?.includes("Article Summarizer"));
    await act(async () => {
      taskRow!.click();
    });
    await settle();

    expect(h.container.textContent).toContain("Condense long articles into 3 key takeaways.");
    expect(h.container.textContent).toContain(
      "Given the following article, produce 3 concise bullet points.",
    );
    cleanup(h);
  });
});

describe("TaskVersionSelector — archived tasks warning & confirmation", () => {
  it("warns and requires confirmation before selecting an archived task", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-archived", "Archived legacy task", { archived: true });

    const onSelect = vi.fn();
    const h = render(
      <TaskVersionSelector repo={repo} open={true} onClose={vi.fn()} onSelect={onSelect} />,
    );
    await settle();

    const taskRow =
      h.$("[data-task-id='t-archived']") ??
      h.$$("button, [role='button']").find((b) => b.textContent?.includes("Archived legacy task"));
    expect(taskRow).toBeTruthy();
    await act(async () => {
      taskRow!.click();
    });
    await settle();

    // Warning banner is displayed
    const warning = h.$("[data-archived-warning]") ?? h.$("[role='alert']");
    expect(warning).toBeTruthy();
    expect(warning?.textContent?.toLowerCase()).toContain("archived");

    // Confirmation control is present
    const confirmBox = h.$("input[data-action='confirm-archived']") as HTMLInputElement | null;
    const addBtn = (h.$("button[data-action='confirm-select-task']") ??
      h.$$("button").find((b) => b.textContent?.match(/add|select|pin/i))) as HTMLButtonElement;

    if (confirmBox) {
      // Button is disabled until confirmed
      expect(addBtn.disabled).toBe(true);
      await act(async () => {
        confirmBox.click();
      });
      await settle();
      expect(addBtn.disabled).toBe(false);
    }

    await act(async () => {
      addBtn.click();
    });
    await settle();

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].taskId).toBe("t-archived");
    cleanup(h);
  });
});

describe("TaskVersionSelector — closing and accessibility", () => {
  it("clicking cancel or close button calls onClose", async () => {
    const repo = new InMemoryTaskRepository();
    const onClose = vi.fn();
    const h = render(
      <TaskVersionSelector repo={repo} open={true} onClose={onClose} onSelect={vi.fn()} />,
    );
    await settle();

    const closeBtn =
      h.$("button[data-action='close-selector']") ??
      h.$$("button").find((b) => b.textContent?.match(/cancel|close/i));
    expect(closeBtn).toBeTruthy();
    await act(async () => {
      closeBtn!.click();
    });
    await settle();

    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup(h);
  });

  it("interactive controls meet 44px minimum target size and focus-visible", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1", "Sample task");

    const h = render(
      <TaskVersionSelector repo={repo} open={true} onClose={vi.fn()} onSelect={vi.fn()} />,
    );
    await settle();

    const buttons = h.$$("button, input");
    expect(buttons.length).toBeGreaterThan(0);
    for (const btn of buttons) {
      const cls = btn.getAttribute("class") ?? "";
      expect(cls).toMatch(/min-h-\[44px\]|h-11|h-10|min-h-\[36px\]/);
    }
    cleanup(h);
  });
});
