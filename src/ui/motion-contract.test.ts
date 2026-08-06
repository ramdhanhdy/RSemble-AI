import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const productionUi = filesUnder(SRC).filter(
  (path) => /\.(css|tsx)$/.test(path) && !path.endsWith(".test.tsx"),
);

function offenders(pattern: RegExp): string[] {
  return productionUi.flatMap((path) =>
    readFileSync(path, "utf8")
      .split("\n")
      .flatMap((line, index) =>
        pattern.test(line) ? [`${relative(process.cwd(), path)}:${index + 1} ${line.trim()}`] : [],
      ),
  );
}

describe("motion contract", () => {
  it("does not use transition-all, UI ease-in, or scale(0) entrances", () => {
    expect(offenders(/transition-all|\bease-in\b(?!-out)|scale\(0\)/)).toEqual([]);
  });

  it("does not animate the keyboard-first command palette", () => {
    const source = readFileSync(join(SRC, "ui", "CommandPalette.tsx"), "utf8");
    expect(source).not.toMatch(/animate-cmd-pop|data-entering|data-exiting/);
  });

  it("uses linear timing for infinite rotation", () => {
    const css = readFileSync(join(SRC, "index.css"), "utf8");
    expect(css).toMatch(/\.animate-spin[^}]*animation:[^;]*linear[^;]*infinite/s);
  });

  // Identity upgrade guards (spec evaluations-identity-ux, Task 13).

  it("record-row list surfaces do not hover-transform", () => {
    // Row identity comes from the eyebrow/chip grammar, never from layout
    // shift on hover — hover-transforms would fight truncation and the
    // trailing action cluster. Covers the shared row surface and both lists.
    const offendersList = [
      "src/ui/RecordRow.tsx",
      "src/workspaces/evaluations/SuiteList.tsx",
      "src/workspaces/evaluations/ProfileList.tsx",
    ].flatMap((file) => {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      return source.match(/hover:-translate|hover:scale/g) ?? [];
    });
    expect(offendersList).toEqual([]);
  });

  it("new identity components use no ease-in, transition-all, or scale(0)", () => {
    // Named guard for the identity primitives so the contract holds even if
    // the whole-tree scan above is ever narrowed.
    for (const file of ["src/ui/KindEyebrow.tsx", "src/ui/ProfileRefChip.tsx"]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/transition-all|\bease-in\b(?!-out)|scale\(0\)/);
    }
  });
});
