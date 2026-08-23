import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const ATTENTION_PATHS = [
  "src/lib/attention",
  "src/ui/AttentionPopover.tsx",
  "src/ui/AttentionHost.tsx",
  "src/workspaces/attention",
  "src/workspaces/evaluations/AttentionOwnerHandoff.tsx",
];

const FORBIDDEN = [
  /\bretryIncomplete\s*\(/,
  /\bstartExperiment\s*\(/,
  /\bextendRoster\s*\(/,
  /\bonRetry\b/,
  /\bonResume\b/,
  /\bonAddModel\b/,
  /^(?!import type).*from ["'][^"']*experiment-controller["']/m,
];

function collectFiles(rel: string): string[] {
  const abs = join(ROOT, rel);
  try {
    const statFiles = readdirSync(abs, { withFileTypes: true });
    return statFiles.flatMap((entry) => {
      const next = `${rel}/${entry.name}`;
      if (entry.isDirectory()) return collectFiles(next);
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) return [];
      if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) return [];
      return [next];
    });
  } catch {
    return [rel];
  }
}

describe("Attention never executes recovery", () => {
  const files = ATTENTION_PATHS.flatMap(collectFiles);

  it("scans every Attention module", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)("forbids paid/mutation calls in %s", (rel) => {
    const source = readFileSync(join(ROOT, rel), "utf8");
    for (const pattern of FORBIDDEN) {
      expect(source).not.toMatch(pattern);
    }
  });
});
