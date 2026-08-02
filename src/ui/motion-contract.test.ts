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
        pattern.test(line)
          ? [`${relative(process.cwd(), path)}:${index + 1} ${line.trim()}`]
          : [],
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
});
