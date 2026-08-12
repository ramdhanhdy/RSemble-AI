import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("compact state geometry", () => {
  it("reserves stable geometry for reset, run, and status states", () => {
    expect(source("src/rsemble.tsx")).toContain('data-geometry="reset-action"');
    expect(source("src/ui/RunButton.tsx")).toContain('data-geometry="run-action"');
    expect(source("src/ui/RunButton.tsx")).toContain('data-geometry="run-shortcut"');
    expect(source("src/ui/StatusMark.tsx")).toContain("data-status-icon");
  });

  it("keeps disclosure panels instant and reserves their trigger geometry", () => {
    const disclosure = source("src/ui/EvaluationDisclosure.tsx");
    const rubricEditor = source("src/ui/EvaluationRubricEditor.tsx");
    const suiteEditor = source("src/workspaces/evaluations/SuiteEditor.tsx");

    expect(disclosure).toContain('data-geometry="evaluation-disclosure"');
    expect(disclosure).toContain('data-geometry="evaluation-panel"');
    expect(disclosure).toMatch(/transition-transform duration-150 ease-out/);
    expect(rubricEditor).toContain('data-geometry="criterion-header"');
    expect(rubricEditor).toMatch(/transition-transform duration-150 ease-out/);
    expect(suiteEditor).toContain('data-geometry="suite-settings-trigger"');
    expect(suiteEditor).toContain('data-geometry="suite-settings-panel"');
    expect(suiteEditor).toMatch(/transition-transform duration-150 ease-out/);
    expect(source("src/index.css")).toMatch(
      /\.disclosure-chevron,[\s\S]*transition-duration: 0ms !important/,
    );
  });

  it("reserves the suite archive slot width across the arm-to-confirm swap", () => {
    // Identity spec §5.2 / Task 12: the slot must carry a fixed min-width
    // (widest armed state: "Archive?" + cancel) with end alignment, so arming
    // the confirm pair never shifts the row's action cluster. The floor is
    // responsive (sm:) — on phones the slot takes natural width so the row's
    // content column is never crushed (Task 14 mobile finding).
    const suiteList = source("src/workspaces/evaluations/SuiteList.tsx");
    expect(suiteList).toContain('data-geometry="suite-archive-slot"');
    expect(suiteList).toMatch(/min-w-\[136px\]/);
    expect(suiteList).toMatch(/justify-end/);
  });
});
