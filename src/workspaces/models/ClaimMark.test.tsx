// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { render, cleanup } from "./models-test-harness";
import { ClaimMark } from "./ClaimMark";
import type { ClaimSentence } from "../../lib/model-profiles/profile-claims";

const sentence: ClaimSentence = {
  text: "Verified on 8 of 10 code-transformation Tasks under verifier cohort X.",
  sourceMetricKey: "boundary:ver-x@2",
};

describe("ClaimMark — Fable §5.6", () => {
  it("renders icon + word + sentence button for strongest_supported (success role)", () => {
    const onApply = vi.fn();
    const h = render(
      <ClaimMark
        label="strongest_supported"
        sentence={sentence}
        boundaryRef="verifier ver-x@2"
        onApply={onApply}
      />,
    );
    const mark = h.$("[data-claim-mark]")!;
    expect(mark.dataset.claimLabel).toBe("strongest_supported");
    expect(mark.className).toContain("text-success");
    expect(mark.querySelector("svg")).not.toBeNull();
    expect(mark.textContent).toContain("Strongest supported");
    const btn = h.$("button[data-claim-sentence]")!;
    expect(btn.textContent).toContain(sentence.text);
    btn.click();
    expect(onApply).toHaveBeenCalledWith(sentence);
    cleanup(h);
  });

  it("weakest_supported uses the error role (D5)", () => {
    const h = render(
      <ClaimMark
        label="weakest_supported"
        sentence={sentence}
        boundaryRef="verifier ver-x@2"
        onApply={() => {}}
      />,
    );
    const mark = h.$("[data-claim-mark]")!;
    expect(mark.dataset.claimLabel).toBe("weakest_supported");
    expect(mark.className).toContain("text-error");
    expect(mark.textContent).toContain("Weakest supported");
    cleanup(h);
  });

  it("missing marks are not links (no button)", () => {
    const h = render(<ClaimMark label="missing" sentence={sentence} />);
    const mark = h.$("[data-claim-mark]")!;
    expect(mark.dataset.claimLabel).toBe("missing");
    expect(mark.textContent).toContain("Missing");
    expect(h.$("button[data-claim-sentence]")).toBeNull();
    cleanup(h);
  });

  it("carries a boundary title describing its boundary reference", () => {
    const h = render(
      <ClaimMark
        label="strongest_supported"
        sentence={sentence}
        boundaryRef="rubric rub-eval@2"
        onApply={() => {}}
      />,
    );
    const mark = h.$("[data-claim-mark]")!;
    expect(mark.getAttribute("title") ?? "").toContain("rubric rub-eval@2");
    expect(mark.getAttribute("title") ?? "").toContain("Boundary declared by");
    cleanup(h);
  });
});
