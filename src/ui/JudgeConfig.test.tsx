import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JudgeConfig } from "./JudgeConfig";
import type { Action } from "../studio-engine";
import type { CatalogModel } from "../lib/providers/types";

const noop: React.Dispatch<Action> = () => undefined;
const NO_MODELS: CatalogModel[] = [];

const baseProps = {
  critic: { providerId: "openrouter" as const, model: "z-ai/glm-5.2" },
  models: NO_MODELS,
  dispatch: noop,
};

describe("JudgeConfig — judge custom instruction input", () => {
  it("renders a clearly labelled optional judge-instruction input", () => {
    const html = renderToStaticMarkup(
      <JudgeConfig {...baseProps} judgeInstruction="" />,
    );
    // A visible label identifying it as the judge instruction.
    expect(html.toLowerCase()).toMatch(/judge instruction/);
  });

  it("renders concise helper text explaining the instruction is optional", () => {
    const html = renderToStaticMarkup(
      <JudgeConfig {...baseProps} judgeInstruction="" />,
    );
    // Helper text must mention "optional" (or equivalent) so the user knows it
    // is not required and is judge-scoped.
    expect(html.toLowerCase()).toMatch(/optional/);
  });

  it("the instruction textarea is accessible via an associated label", () => {
    const html = renderToStaticMarkup(
      <JudgeConfig {...baseProps} judgeInstruction="" />,
    );
    // There must be a label[for] pointing at the input's id, or an
    // aria-label on the input itself, so AT users can reach it.
    expect(html).toMatch(/id="judge-instruction"/);
    expect(html).toMatch(/for="judge-instruction"/);
  });

  it("shows the current judgeInstruction value in the input", () => {
    const html = renderToStaticMarkup(
      <JudgeConfig {...baseProps} judgeInstruction="Prefer brevity." />,
    );
    expect(html).toContain("Prefer brevity.");
  });

  it("the input meets the 44px touch-target minimum (WCAG 2.5.5)", () => {
    const html = renderToStaticMarkup(
      <JudgeConfig {...baseProps} judgeInstruction="" />,
    );
    const match = html.match(/<(textarea)[^>]*id="judge-instruction"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).toMatch(/min-h-\[44px\]|h-11/);
  });
});
