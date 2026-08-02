import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const header = read("src/ui/Header.tsx");
const runButton = read("src/ui/RunButton.tsx");
const shell = read("src/rsemble.tsx");

describe("primary action motion", () => {
  it("removes the redundant header running gradient", () => {
    expect(header).not.toMatch(/bg-gradient|bg-march|animate-\[/);
  });

  it("uses a solid, pressable Run control with fine-pointer hover lift", () => {
    expect(runButton).toContain("pressable");
    expect(runButton).toContain("bg-accent text-on-accent hover-lift");
    expect(runButton).not.toContain("bg-gradient");
    expect(runButton).not.toContain("hover:-translate");
  });

  it("uses the shared primary-control treatment in FocusStrip", () => {
    expect(shell).toContain("pressable mt-auto flex h-11 w-11");
    expect(shell).toContain("bg-accent text-on-accent hover-lift");
    expect(shell).not.toContain("hover:-translate-y-0.5");
  });

  it("keeps ResetButton geometry stable while armed", () => {
    expect(shell).toContain("min-w-[132px]");
    expect(shell).not.toContain('armed ? "px-3" : "w-11"');
  });
});
