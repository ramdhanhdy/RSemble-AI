import { describe, it, expect } from "vitest";
import { reducer, initialState } from "./studio-engine";
import { EXAMPLE_TASKS } from "./lib/test-cases";

describe("reducer — LOAD_EXAMPLE fills a curated comparison task", () => {
  it("loads the first example and records its index from a fresh session", () => {
    const next = reducer(initialState, { type: "LOAD_EXAMPLE" });
    expect(next.prompt).toBe(EXAMPLE_TASKS[0].prompt);
    expect(next.exampleIndex).toBe(0);
  });

  it("rotates to the next example on repeated loads (no immediate repeat)", () => {
    let s = reducer(initialState, { type: "LOAD_EXAMPLE" });
    const firstPrompt = s.prompt;
    s = reducer(s, { type: "LOAD_EXAMPLE" });
    expect(s.prompt).not.toBe(firstPrompt);
    expect(s.exampleIndex).toBe(1);
    // Two more loads never reproduce the immediately-prior prompt.
    const second = s.prompt;
    s = reducer(s, { type: "LOAD_EXAMPLE" });
    expect(s.prompt).not.toBe(second);
  });

  it("wraps around after exhausting the catalog", () => {
    const n = EXAMPLE_TASKS.length;
    let s = { ...initialState, exampleIndex: n - 1 };
    s = reducer(s, { type: "LOAD_EXAMPLE" });
    expect(s.exampleIndex).toBe(0);
    expect(s.prompt).toBe(EXAMPLE_TASKS[0].prompt);
  });

  it("only fills when the current task is empty (does not silently destroy user text)", () => {
    const withText = { ...initialState, prompt: "my own task that I typed" };
    const next = reducer(withText, { type: "LOAD_EXAMPLE" });
    // The reducer must NOT overwrite meaningful user text without consent.
    expect(next.prompt).toBe("my own task that I typed");
    expect(next.exampleIndex).toBe(withText.exampleIndex);
  });

  it("treats whitespace-only input as empty and fills it", () => {
    const blankish = { ...initialState, prompt: "   \n\t " };
    const next = reducer(blankish, { type: "LOAD_EXAMPLE" });
    expect(next.prompt).toBe(EXAMPLE_TASKS[0].prompt);
  });

  it("honors an explicit force flag to replace non-empty text (confirm affordance)", () => {
    const withText = { ...initialState, prompt: "my own task" };
    const next = reducer(withText, { type: "LOAD_EXAMPLE", force: true });
    expect(next.prompt).toBe(EXAMPLE_TASKS[0].prompt);
  });
});

describe("reducer — RESET_SESSION resets the example index", () => {
  it("restores exampleIndex to its initial value after reset", () => {
    const loaded = reducer(initialState, { type: "LOAD_EXAMPLE" });
    expect(loaded.exampleIndex).not.toBe(initialState.exampleIndex);
    const reset = reducer(loaded, { type: "RESET_SESSION" });
    expect(reset.exampleIndex).toBe(initialState.exampleIndex);
    expect(reset.prompt).toBe(initialState.prompt);
  });
});
