// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, cleanup } from "./models-test-harness";
import { EvidenceMixChips } from "./EvidenceMixChips";

describe("EvidenceMixChips — Fable §5.3", () => {
  it("renders four count chips in fixed order with class words", () => {
    const h = render(
      <EvidenceMixChips counts={{ exploratory: 12, comparable: 8, verified: 5, benchmark: 2 }} />,
    );
    const chips = h.$$("[data-evidence-class-chip]");
    expect(chips).toHaveLength(4);
    expect(chips.map((c) => c.dataset.evidenceClass)).toEqual([
      "exploratory",
      "comparable",
      "verified",
      "benchmark",
    ]);
    expect(chips[0].textContent).toBe("12 exploratory");
    expect(chips[3].textContent).toBe("2 benchmark");
    cleanup(h);
  });

  it("zero-count classes render dimmed, not absent", () => {
    const h = render(
      <EvidenceMixChips counts={{ exploratory: 3, comparable: 0, verified: 0, benchmark: 0 }} />,
    );
    const chips = h.$$("[data-evidence-class-chip]");
    expect(chips).toHaveLength(4);
    expect(chips[1].textContent).toBe("0 comparable");
    expect(chips[1].className).toContain("opacity-50");
    expect(chips[0].className).not.toContain("opacity-50");
    cleanup(h);
  });

  it("separates chips with the · divider and joins into one row", () => {
    const h = render(
      <EvidenceMixChips counts={{ exploratory: 12, comparable: 8, verified: 5, benchmark: 2 }} />,
    );
    expect(h.text().replace(/\s+/g, " ").trim()).toBe(
      "12 exploratory · 8 comparable · 5 verified · 2 benchmark",
    );
    cleanup(h);
  });
});
