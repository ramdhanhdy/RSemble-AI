// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { render, cleanup } from "./models-test-harness";
import { DeterministicNarrative } from "./DeterministicNarrative";
import type { ClaimSentence } from "../../lib/model-profiles/profile-claims";

function sentences(n: number): ClaimSentence[] {
  return Array.from({ length: n }, (_, i) => ({
    text: `Sentence ${i + 1}.`,
    sourceMetricKey: `metric:${i + 1}`,
  }));
}

describe("DeterministicNarrative — Fable §5.8", () => {
  it("renders the OVERVIEW — TEMPLATE-GENERATED header and honesty footer", () => {
    const h = render(<DeterministicNarrative sentences={sentences(2)} />);
    expect(h.$("[data-narrative-header]")!.textContent).toBe("OVERVIEW — TEMPLATE-GENERATED");
    const footer = h.$("[data-narrative-footer]")!;
    expect(footer.className).toContain("honesty-note");
    expect(footer.textContent).toBe(
      "Every sentence is generated from fixed templates over the facts below. It adds no judgment.",
    );
    cleanup(h);
  });

  it("renders each sentence as a button with a trailing source chip", () => {
    const onApply = vi.fn();
    const h = render(<DeterministicNarrative sentences={sentences(2)} onApplySource={onApply} />);
    const buttons = h.$$("button[data-narrative-sentence]");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toContain("Sentence 1.");
    const chip = h.$("[data-source-chip]")!;
    expect(chip.textContent).toBe("metric:1");
    expect(chip.className).toContain("text-text-muted");
    buttons[0].click();
    expect(onApply).toHaveBeenCalledWith("metric:1");
    cleanup(h);
  });

  it("caps at five sentences (§12 cap 4)", () => {
    const h = render(<DeterministicNarrative sentences={sentences(7)} />);
    expect(h.$$("button[data-narrative-sentence]")).toHaveLength(5);
    cleanup(h);
  });

  it("uses a bordered-left block", () => {
    const h = render(<DeterministicNarrative sentences={sentences(1)} />);
    const block = h.$("[data-deterministic-narrative]")!;
    expect(block.className).toContain("border-l-2");
    expect(block.className).toContain("border-edge");
    cleanup(h);
  });
});
