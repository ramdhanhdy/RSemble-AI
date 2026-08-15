// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { EvaluationTask } from "../../lib/evaluations/evaluation-types";
import { TaskSetTaskList } from "./TaskSetTaskList";

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

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function makeTask(id: string, order: number, overrides: Partial<EvaluationTask> = {}): EvaluationTask {
  return {
    id,
    title: `Task ${id}`,
    prompt: `Prompt for ${id}`,
    systemPrompt: "",
    evaluation: { kind: "inherit" },
    judgeInstructionOverride: "",
    order,
    ...overrides,
  };
}

describe("TaskSetTaskList — deterministic order and member rendering", () => {
  it("renders members in deterministic order with titles and numbering", async () => {
    const tasks = [
      makeTask("t-1", 0, { title: "First Task" }),
      makeTask("t-2", 1, { title: "Second Task" }),
      makeTask("t-3", 2, { title: "Third Task" }),
    ];

    const h = render(
      <TaskSetTaskList
        tasks={tasks}
        selectedTaskId="t-1"
        onSelect={vi.fn()}
        onAddClick={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    await settle();

    const items = h.$$("[data-task-item], li");
    expect(items.length).toBe(3);
    expect(h.container.textContent).toContain("First Task");
    expect(h.container.textContent).toContain("Second Task");
    expect(h.container.textContent).toContain("Third Task");
    expect(h.container.textContent).toContain("1.");
    expect(h.container.textContent).toContain("2.");
    expect(h.container.textContent).toContain("3.");
    cleanup(h);
  });

  it("displays pinned version, role, stratum, and weight metadata when provided", async () => {
    const tasks = [
      makeTask("t-1", 0, { title: "Classification Task" }),
    ];

    const h = render(
      <TaskSetTaskList
        tasks={tasks}
        selectedTaskId="t-1"
        onSelect={vi.fn()}
        onAddClick={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        resolveTaskInfo={() => ({
          pinnedVersion: 2,
          role: "anchor",
          stratum: "biology",
          weight: 1.5,
        })}
      />,
    );
    await settle();

    expect(h.container.textContent).toContain("v2");
    expect(h.container.textContent).toContain("anchor");
    expect(h.container.textContent).toContain("biology");
    expect(h.container.textContent).toContain("1.5");
    cleanup(h);
  });
});

describe("TaskSetTaskList — keyboard-operable reordering", () => {
  it("move up is disabled on the first item and move down is disabled on the last item", async () => {
    const tasks = [
      makeTask("t-1", 0),
      makeTask("t-2", 1),
    ];

    const h = render(
      <TaskSetTaskList
        tasks={tasks}
        selectedTaskId="t-1"
        onSelect={vi.fn()}
        onAddClick={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    await settle();

    const moveUpBtns = h.$$("button[aria-label*='up'], button[title*='up'], button[data-action='move-up']");
    const moveDownBtns = h.$$("button[aria-label*='down'], button[title*='down'], button[data-action='move-down']");

    expect((moveUpBtns[0] as HTMLButtonElement)?.disabled).toBe(true);
    expect((moveDownBtns[1] as HTMLButtonElement)?.disabled).toBe(true);
    cleanup(h);
  });

  it("clicking move down calls onMove with direction 1", async () => {
    const onMove = vi.fn();
    const tasks = [
      makeTask("t-1", 0),
      makeTask("t-2", 1),
    ];

    const h = render(
      <TaskSetTaskList
        tasks={tasks}
        selectedTaskId="t-1"
        onSelect={vi.fn()}
        onAddClick={vi.fn()}
        onMove={onMove}
        onDelete={vi.fn()}
      />,
    );
    await settle();

    const moveDownBtns = h.$$("button[aria-label*='down'], button[title*='down'], button[data-action='move-down']");
    await act(async () => {
      moveDownBtns[0]?.click();
    });
    await settle();

    expect(onMove).toHaveBeenCalledWith("t-1", 1);
    cleanup(h);
  });

  it("clicking move up calls onMove with direction -1", async () => {
    const onMove = vi.fn();
    const tasks = [
      makeTask("t-1", 0),
      makeTask("t-2", 1),
    ];

    const h = render(
      <TaskSetTaskList
        tasks={tasks}
        selectedTaskId="t-2"
        onSelect={vi.fn()}
        onAddClick={vi.fn()}
        onMove={onMove}
        onDelete={vi.fn()}
      />,
    );
    await settle();

    const moveUpBtns = h.$$("button[aria-label*='up'], button[title*='up'], button[data-action='move-up']");
    await act(async () => {
      moveUpBtns[1]?.click();
    });
    await settle();

    expect(onMove).toHaveBeenCalledWith("t-2", -1);
    cleanup(h);
  });
});

describe("TaskSetTaskList — actions, selection, and deletion", () => {
  it("clicking task row calls onSelect", async () => {
    const onSelect = vi.fn();
    const tasks = [makeTask("t-1", 0, { title: "Target Task" })];

    const h = render(
      <TaskSetTaskList
        tasks={tasks}
        selectedTaskId={null}
        onSelect={onSelect}
        onAddClick={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    await settle();

    const rowBtn = h.$("button[aria-label*='Target Task'], [data-task-item] button");
    await act(async () => {
      rowBtn?.click();
    });
    await settle();

    expect(onSelect).toHaveBeenCalledWith("t-1");
    cleanup(h);
  });

  it("clicking delete calls onDelete or asks for confirmation", async () => {
    const onDelete = vi.fn();
    const tasks = [makeTask("t-1", 0, { title: "Delete Me" })];

    const h = render(
      <TaskSetTaskList
        tasks={tasks}
        selectedTaskId="t-1"
        onSelect={vi.fn()}
        onAddClick={vi.fn()}
        onMove={vi.fn()}
        onDelete={onDelete}
      />,
    );
    await settle();

    const deleteBtn = h.$("button[data-action='delete-task']");
    expect(deleteBtn).toBeTruthy();
    await act(async () => {
      deleteBtn!.click();
    });
    await settle();

    // If confirmation is required, confirm
    const confirmBtn = h.$("button[data-action='confirm-delete-task']") ?? deleteBtn;
    if (confirmBtn && confirmBtn !== deleteBtn) {
      await act(async () => {
        confirmBtn.click();
      });
      await settle();
    }

    expect(onDelete).toHaveBeenCalledWith("t-1");
    cleanup(h);
  });

  it("clicking Add Task button calls onAddClick", async () => {
    const onAddClick = vi.fn();
    const h = render(
      <TaskSetTaskList
        tasks={[]}
        selectedTaskId={null}
        onSelect={vi.fn()}
        onAddClick={onAddClick}
        onMove={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    await settle();

    const addBtn = h.$("button[data-action='add-task']") ?? h.$$("button").find((b) => b.textContent?.includes("Add task"));
    expect(addBtn).toBeTruthy();
    await act(async () => {
      addBtn?.click();
    });
    await settle();

    expect(onAddClick).toHaveBeenCalledTimes(1);
    cleanup(h);
  });

  it("readOnly mode disables Add and reorder buttons", async () => {
    const tasks = [makeTask("t-1", 0), makeTask("t-2", 1)];
    const h = render(
      <TaskSetTaskList
        tasks={tasks}
        selectedTaskId="t-1"
        onSelect={vi.fn()}
        onAddClick={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        readOnly={true}
      />,
    );
    await settle();

    const addBtn = (h.$("button[data-action='add-task']") ?? h.$$("button").find((b) => b.textContent?.includes("Add task"))) as HTMLButtonElement | null;
    expect(addBtn?.disabled ?? true).toBe(true);

    const moveBtns = h.$$("button[aria-label*='up'], button[aria-label*='down']");
    for (const b of moveBtns) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    }
    cleanup(h);
  });
});
