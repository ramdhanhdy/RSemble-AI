// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi, type Mock } from "vitest";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { SuiteTaskEditor } from "./SuiteTaskEditor";
import type {
  EvaluationTask,
  EvaluationSelection,
  ProfileRecord,
} from "../../lib/evaluations/evaluation-types";

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

/** Type into a React controlled input by bypassing React's value tracker. */
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

// --- Helpers ------------------------------------------------------------------

function makeTask(overrides: Partial<EvaluationTask> = {}): EvaluationTask {
  return {
    id: "t1",
    title: "Pricing diagnosis",
    prompt: "Diagnose the pricing strategy.",
    systemPrompt: "",
    evaluation: { kind: "inherit" },
    judgeInstructionOverride: "",
    order: 0,
    ...overrides,
  };
}

function makeProfileRecord(id: string, latestVersion = 2): ProfileRecord {
  const now = Date.now();
  return {
    id,
    revision: 1,
    latestVersion,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

const HOLISTIC_DEFAULT: EvaluationSelection = { kind: "holistic" };

function resolveProfileLabel(ref: { id: string; version: number }): string {
  return `Profile ${ref.id} v${ref.version}`;
}

/** Stateful wrapper so button clicks propagate the change back into props. */
function StatefulTaskEditor({
  initialTask,
  suiteDefaultEvaluation = HOLISTIC_DEFAULT,
  profileRecords = [],
  onChangeSpy,
}: {
  initialTask: EvaluationTask;
  suiteDefaultEvaluation?: EvaluationSelection;
  profileRecords?: ProfileRecord[];
  onChangeSpy?: Mock;
}) {
  const [task, setTask] = useState(initialTask);
  return (
    <SuiteTaskEditor
      task={task}
      suiteDefaultEvaluation={suiteDefaultEvaluation}
      onChange={(patch) => {
        setTask((prev) => ({ ...prev, ...patch }));
        onChangeSpy?.(patch);
      }}
      profileRecords={profileRecords}
      resolveProfileLabel={resolveProfileLabel}
    />
  );
}

// --- Tests --------------------------------------------------------------------

describe("SuiteTaskEditor — structure", () => {
  it("renders title, prompt, and system prompt inputs", () => {
    const h = render(
      <SuiteTaskEditor
        task={makeTask()}
        suiteDefaultEvaluation={HOLISTIC_DEFAULT}
        onChange={() => {}}
        profileRecords={[]}
        resolveProfileLabel={resolveProfileLabel}
      />,
    );
    expect(h.$("#task-title")).toBeTruthy();
    expect(h.$("#task-prompt")).toBeTruthy();
    expect(h.$("#task-system-prompt")).toBeTruthy();
    cleanup(h);
  });

  it("title input shows candidate-visible label", () => {
    const h = render(
      <SuiteTaskEditor
        task={makeTask()}
        suiteDefaultEvaluation={HOLISTIC_DEFAULT}
        onChange={() => {}}
        profileRecords={[]}
        resolveProfileLabel={resolveProfileLabel}
      />,
    );
    expect(h.container.textContent).toMatch(/candidate-visible/i);
    cleanup(h);
  });

  it("shows required validation for empty title and prompt", () => {
    const h = render(
      <SuiteTaskEditor
        task={makeTask({ title: "", prompt: "" })}
        suiteDefaultEvaluation={HOLISTIC_DEFAULT}
        onChange={() => {}}
        profileRecords={[]}
        resolveProfileLabel={resolveProfileLabel}
      />,
    );
    expect(h.container.textContent).toMatch(/title is required/i);
    expect(h.container.textContent).toMatch(/prompt is required/i);
    cleanup(h);
  });
});

describe("SuiteTaskEditor — evaluation tagged choice", () => {
  it("renders all three evaluation modes", () => {
    const h = render(
      <SuiteTaskEditor
        task={makeTask()}
        suiteDefaultEvaluation={HOLISTIC_DEFAULT}
        onChange={() => {}}
        profileRecords={[makeProfileRecord("p1")]}
        resolveProfileLabel={resolveProfileLabel}
      />,
    );
    const text = h.container.textContent ?? "";
    expect(text).toMatch(/inherit suite default/i);
    expect(text).toMatch(/holistic judgment/i);
    expect(text).toMatch(/pin profile version/i);
    cleanup(h);
  });

  it("inherit mode describes the suite default", () => {
    const h = render(
      <SuiteTaskEditor
        task={makeTask({ evaluation: { kind: "inherit" } })}
        suiteDefaultEvaluation={HOLISTIC_DEFAULT}
        onChange={() => {}}
        profileRecords={[]}
        resolveProfileLabel={resolveProfileLabel}
      />,
    );
    expect(h.container.textContent).toMatch(/inherits the suite default/i);
    cleanup(h);
  });

  it("holistic mode is selectable and shows description", () => {
    const h = render(
      <StatefulTaskEditor
        initialTask={makeTask({ evaluation: { kind: "inherit" } })}
        profileRecords={[]}
      />,
    );
    const buttons = h.$$("button[aria-pressed]");
    const holisticBtn = buttons.find((b) => b.textContent?.match(/holistic judgment/i));
    expect(holisticBtn).toBeTruthy();
    act(() => {
      holisticBtn!.click();
    });
    expect(holisticBtn!.getAttribute("aria-pressed")).toBe("true");
    expect(h.container.textContent).toMatch(/no explicit criteria/i);
    cleanup(h);
  });

  it("pin profile mode shows profile version picker when profiles exist", () => {
    const h = render(
      <StatefulTaskEditor
        initialTask={makeTask({ evaluation: { kind: "inherit" } })}
        profileRecords={[makeProfileRecord("p1", 2)]}
      />,
    );
    const buttons = h.$$("button[aria-pressed]");
    const pinBtn = buttons.find((b) => b.textContent?.match(/pin profile version/i));
    expect(pinBtn).toBeTruthy();
    act(() => {
      pinBtn!.click();
    });
    const select = h.$(
      "select[aria-label='Pinned profile version for this task']",
    ) as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.options.length).toBeGreaterThanOrEqual(1);
    cleanup(h);
  });

  it("pin profile mode shows empty state when no profiles", () => {
    const h = render(
      <StatefulTaskEditor
        initialTask={makeTask({ evaluation: { kind: "inherit" } })}
        profileRecords={[]}
      />,
    );
    const buttons = h.$$("button[aria-pressed]");
    const pinBtn = buttons.find((b) => b.textContent?.match(/pin profile version/i));
    expect(pinBtn).toBeTruthy();
    act(() => {
      pinBtn!.click();
    });
    expect(h.container.textContent).toMatch(/no profiles available/i);
    cleanup(h);
  });
});

describe("SuiteTaskEditor — judge instruction override", () => {
  it("judge override is visibly separate from candidate instructions", () => {
    const h = render(
      <SuiteTaskEditor
        task={makeTask()}
        suiteDefaultEvaluation={HOLISTIC_DEFAULT}
        onChange={() => {}}
        profileRecords={[]}
        resolveProfileLabel={resolveProfileLabel}
      />,
    );
    expect(h.$("#task-judge-override")).toBeTruthy();
    // Evaluator-only label present
    expect(h.container.textContent).toMatch(/evaluator-only/i);
    // Visually separated (in its own bordered section)
    const overrideSection = h.$("#task-judge-override")?.closest("div.rounded-md");
    expect(overrideSection).toBeTruthy();
    cleanup(h);
  });
});

describe("SuiteTaskEditor — editing", () => {
  it("title change calls onChange with title patch", () => {
    const onChange = vi.fn();
    const h = render(<StatefulTaskEditor initialTask={makeTask()} onChangeSpy={onChange} />);
    const input = h.$("#task-title") as HTMLInputElement;
    typeInto(input, "New Title");
    expect(onChange).toHaveBeenCalledWith({ title: "New Title" });
    cleanup(h);
  });

  it("prompt change calls onChange with prompt patch", () => {
    const onChange = vi.fn();
    const h = render(<StatefulTaskEditor initialTask={makeTask()} onChangeSpy={onChange} />);
    const input = h.$("#task-prompt") as HTMLTextAreaElement;
    typeInto(input, "New prompt");
    expect(onChange).toHaveBeenCalledWith({ prompt: "New prompt" });
    cleanup(h);
  });

  it("system prompt change calls onChange independently", () => {
    const onChange = vi.fn();
    const h = render(<StatefulTaskEditor initialTask={makeTask()} onChangeSpy={onChange} />);
    const input = h.$("#task-system-prompt") as HTMLTextAreaElement;
    typeInto(input, "System prompt");
    expect(onChange).toHaveBeenCalledWith({ systemPrompt: "System prompt" });
    cleanup(h);
  });
});

describe("SuiteTaskEditor — accessibility", () => {
  it("all interactive controls meet 44px target size", () => {
    const h = render(
      <SuiteTaskEditor
        task={makeTask()}
        suiteDefaultEvaluation={HOLISTIC_DEFAULT}
        onChange={() => {}}
        profileRecords={[makeProfileRecord("p1")]}
        resolveProfileLabel={resolveProfileLabel}
      />,
    );
    const buttons = h.$$("button");
    for (const el of buttons) {
      const cls = el.getAttribute("class") ?? "";
      expect(cls).toMatch(/min-h-\[44px\]/);
    }
    cleanup(h);
  });

  it("inputs have focus-visible rings", () => {
    const h = render(
      <SuiteTaskEditor
        task={makeTask()}
        suiteDefaultEvaluation={HOLISTIC_DEFAULT}
        onChange={() => {}}
        profileRecords={[]}
        resolveProfileLabel={resolveProfileLabel}
      />,
    );
    const inputs = [h.$("#task-title"), h.$("#task-prompt"), h.$("#task-system-prompt")];
    for (const input of inputs) {
      const cls = input?.getAttribute("class") ?? "";
      expect(cls).toMatch(/focus-visible:ring-2/);
    }
    cleanup(h);
  });
});
