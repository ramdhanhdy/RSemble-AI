import { describe, it, expect } from "vitest";
import {
  EXAMPLE_TASKS,
  nextExampleIndex,
  type ExampleTask,
} from "./test-cases";

const CONSTRAINT_MARKERS = [
  "must",
  "should",
  "no more than",
  "no fewer than",
  "exactly",
  "at least",
  "at most",
  "in under",
  "within",
  "avoid",
  "include",
  "do not",
  "format",
  "word",
  "sentence",
  "step",
  "tone",
  "audience",
  "constraint",
  "require",
  "limit",
  "length",
  "structure",
  "label",
] as const;

function hasConstraint(text: string): boolean {
  const lower = text.toLowerCase();
  return CONSTRAINT_MARKERS.some((m) => lower.includes(m));
}

describe("EXAMPLE_TASKS — curated comparison tasks", () => {
  it("ships enough diverse examples to rotate without quick repeats", () => {
    expect(EXAMPLE_TASKS.length).toBeGreaterThanOrEqual(6);
  });

  it("every example has stable identity metadata", () => {
    for (const t of EXAMPLE_TASKS as ExampleTask[]) {
      expect(typeof t.id).toBe("string");
      expect(t.id.length).toBeGreaterThan(0);
      expect(typeof t.family).toBe("string");
      expect(t.family.length).toBeGreaterThan(0);
      expect(typeof t.title).toBe("string");
      expect(t.title.length).toBeGreaterThan(0);
      expect(typeof t.prompt).toBe("string");
    }
  });

  it("ids are unique", () => {
    const ids = (EXAMPLE_TASKS as ExampleTask[]).map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers at least four distinct task families", () => {
    const families = new Set((EXAMPLE_TASKS as ExampleTask[]).map((t) => t.family));
    expect(families.size).toBeGreaterThanOrEqual(4);
  });

  it("every prompt is self-contained and constraint-rich, not a toy greeting", () => {
    for (const t of EXAMPLE_TASKS as ExampleTask[]) {
      // Meaningful length — exposes model differences, not "say hello".
      expect(t.prompt.length).toBeGreaterThanOrEqual(140);
      // No unfilled template placeholders.
      expect(t.prompt).not.toMatch(/\{\{|\}\}/);
      expect(t.prompt).not.toMatch(/<[^>]+>/);
      // No dangling references to external context.
      expect(t.prompt.toLowerCase()).not.toContain("as described above");
      expect(t.prompt.toLowerCase()).not.toContain("as mentioned");
      // Must carry an explicit constraint that differentiates models.
      expect(hasConstraint(t.prompt)).toBe(true);
    }
  });
});

describe("nextExampleIndex — rotation", () => {
  it("starts at the first example when none has been loaded (-1)", () => {
    expect(nextExampleIndex(-1)).toBe(0);
  });

  it("advances by one and wraps to zero at the end", () => {
    const n = EXAMPLE_TASKS.length;
    expect(nextExampleIndex(0)).toBe(1 % n);
    expect(nextExampleIndex(n - 1)).toBe(0);
  });

  it("never returns the same index it was given (no immediate repeat)", () => {
    for (let i = 0; i < EXAMPLE_TASKS.length; i += 1) {
      expect(nextExampleIndex(i)).not.toBe(i);
    }
  });

  it("produces a different prompt on each of two consecutive loads", () => {
    const first = nextExampleIndex(-1);
    const second = nextExampleIndex(first);
    expect(EXAMPLE_TASKS[first].prompt).not.toBe(EXAMPLE_TASKS[second].prompt);
  });
});
