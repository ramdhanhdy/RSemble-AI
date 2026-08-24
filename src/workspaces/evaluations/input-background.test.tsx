// @vitest-environment happy-dom
// =============================================================================
// input-background regression (Phase 8, Task 8.3 audit)
//
// Audit finding: suite/rubric editor inputs used the class `bg-input`, which
// is NOT a theme token (tailwind.config.js defines no `input` color). The
// class was dead, so textareas fell back to the UA default white background
// while text stayed near-white — unreadable. These tests render each affected
// editor and assert no rendered element carries an undefined background class:
// form controls must use a defined dark token (bg-card / bg-panel / bg-shell).
// =============================================================================

import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { SuiteTaskEditor } from "./SuiteTaskEditor";
import { SuiteSettings } from "./SuiteSettings";
import { ModelProbeProvider } from "../../ui/ModelProbeContext";
import type { EvaluationSuite, EvaluationTask } from "../../lib/evaluations/evaluation-types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
}

function render(node: React.ReactNode): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<MemoryRouter>{node}</MemoryRouter>);
  });
  return { container, root };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

afterEach(() => {
  document.body.innerHTML = "";
});

/** Defined dark background tokens from tailwind.config.js theme.extend.colors. */
const DEFINED_BG_TOKENS = new Set([
  "bg-canvas",
  "bg-shell",
  "bg-panel",
  "bg-card",
  "bg-card-hover",
  "bg-raised",
  "bg-transparent",
]);

function controlsWithUndefinedBg(h: Harness): string[] {
  const offenders: string[] = [];
  const controls = h.container.querySelectorAll<HTMLElement>("input, textarea, select");
  for (const el of controls) {
    const bgClasses = [...el.classList].filter((c) => c.startsWith("bg-") && !c.includes("/"));
    for (const cls of bgClasses) {
      if (!DEFINED_BG_TOKENS.has(cls)) {
        offenders.push(
          `${el.tagName.toLowerCase()}[name=${el.getAttribute("name") ?? el.id ?? "?"}] .${cls}`,
        );
      }
    }
  }
  return offenders;
}

function makeTask(id: string, order: number): EvaluationTask {
  return {
    id,
    title: `Task ${id}`,
    prompt: "Prompt",
    systemPrompt: "",
    evaluation: { kind: "inherit" },
    judgeInstructionOverride: "",
    order,
  };
}

function makeSuite(): EvaluationSuite {
  const now = Date.now();
  return {
    id: "suite-1",
    revision: 1,
    version: 1,
    name: "Suite",
    description: "",
    tasks: [makeTask("t1", 0)],
    modelSlots: [],
    defaultJudge: { providerId: "openrouter", model: "judge" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

describe("editor form controls use defined dark background tokens", () => {
  it("SuiteTaskEditor inputs/textareas/selects carry no undefined bg-* class", () => {
    const suite = makeSuite();
    const task = suite.tasks[0];
    const h = render(
      <SuiteTaskEditor
        task={task}
        suiteDefaultEvaluation={suite.defaultEvaluation}
        onChange={() => undefined}
        rubricRecords={[]}
        resolveRubricLabel={() => "profile"}
      />,
    );
    expect(controlsWithUndefinedBg(h)).toEqual([]);
    cleanup(h);
  });

  it("SuiteSettings inputs/textareas/selects carry no undefined bg-* class", () => {
    const h = render(
      <ModelProbeProvider>
        <SuiteSettings
          suite={makeSuite()}
          models={[]}
          onChange={() => undefined}
          rubricRecords={[]}
          resolveRubricLabel={() => "profile"}
        />
      </ModelProbeProvider>,
    );
    expect(controlsWithUndefinedBg(h)).toEqual([]);
    cleanup(h);
  });
});
