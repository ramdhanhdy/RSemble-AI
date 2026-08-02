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
    const profileEditor = source("src/ui/EvaluationProfileEditor.tsx");
    const suiteEditor = source("src/workspaces/evaluations/SuiteEditor.tsx");

    expect(disclosure).toContain('data-geometry="evaluation-disclosure"');
    expect(disclosure).toContain('data-geometry="evaluation-panel"');
    expect(disclosure).toMatch(/transition-transform duration-150 ease-out/);
    expect(profileEditor).toContain('data-geometry="criterion-header"');
    expect(profileEditor).toMatch(/transition-transform duration-150 ease-out/);
    expect(suiteEditor).toContain('data-geometry="suite-settings-trigger"');
    expect(suiteEditor).toContain('data-geometry="suite-settings-panel"');
    expect(suiteEditor).toMatch(/transition-transform duration-150 ease-out/);
  });
});
