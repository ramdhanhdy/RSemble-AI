// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, cleanup } from "./models-test-harness";
import { PairedGlyphStrip } from "./PairedGlyphStrip";
import type { PairedOutcome } from "../../lib/model-profiles/paired-comparison";

describe("PairedGlyphStrip — Fable §5.7", () => {
  it("renders one lettered glyph per outcome in canonical task order", () => {
    const h = render(
      <PairedGlyphStrip
        outcomes={[
          { taskId: "code-transform-03", outcome: "win" },
          { taskId: "code-transform-01", outcome: "loss" },
          { taskId: "code-transform-02", outcome: "tie" },
        ]}
      />,
    );
    const list = h.$("[role='list'][data-paired-glyph-strip]")!;
    expect(list).not.toBeNull();
    const items = h.$$("[role='listitem'][data-glyph]");
    expect(items).toHaveLength(3);
    // Canonical task id order: 01, 02, 03.
    expect(items.map((i) => i.dataset.taskId)).toEqual([
      "code-transform-01",
      "code-transform-02",
      "code-transform-03",
    ]);
    expect(items.map((i) => i.textContent!.trim())).toEqual(["L", "T", "W"]);
    cleanup(h);
  });

  it("uses the letter as the signal with color supplementary (win success, loss error, tie secondary)", () => {
    const h = render(
      <PairedGlyphStrip
        outcomes={[
          { taskId: "t-1", outcome: "win" as PairedOutcome },
          { taskId: "t-2", outcome: "tie" as PairedOutcome },
          { taskId: "t-3", outcome: "loss" as PairedOutcome },
        ]}
      />,
    );
    const items = h.$$("[role='listitem'][data-glyph]");
    expect(items[0].className).toContain("text-success");
    expect(items[1].className).toContain("text-text-secondary");
    expect(items[2].className).toContain("text-error");
    cleanup(h);
  });

  it("gives each glyph a full-sentence accessible name", () => {
    const h = render(
      <PairedGlyphStrip
        outcomes={[
          { taskId: "code-transform-03", outcome: "win" },
          { taskId: "code-transform-01", outcome: "loss" },
          { taskId: "code-transform-02", outcome: "tie" },
        ]}
      />,
    );
    const items = h.$$("[role='listitem'][data-glyph]");
    expect(items[0].getAttribute("aria-label")).toBe("Lost on task code-transform-01");
    expect(items[1].getAttribute("aria-label")).toBe("Tied on task code-transform-02");
    expect(items[2].getAttribute("aria-label")).toBe("Won on task code-transform-03");
    cleanup(h);
  });

  it("renders the legend line verbatim", () => {
    const h = render(<PairedGlyphStrip outcomes={[{ taskId: "t-1", outcome: "win" }]} />);
    expect(h.$("[data-paired-legend]")!.textContent).toBe(
      "W won · T tied · L lost — per shared task, task order fixed",
    );
    cleanup(h);
  });
});
