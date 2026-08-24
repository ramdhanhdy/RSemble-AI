// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { render, cleanup, settle } from "./models-test-harness";
import { ComparatorPicker } from "./ComparatorPicker";

const candidates = [
  { id: "mc-a", label: "Model A · gpt-x@2026-05", sharedTaskCount: 4 },
  { id: "mc-b", label: "Model B · gpt-y@2026-05", sharedTaskCount: 12 },
  { id: "mc-c", label: "Model C · gpt-z@2026-05", sharedTaskCount: 8 },
];

// DialogSurface portals into document.body; query the body for portal content.
function bodyText(): string {
  return document.body.textContent ?? "";
}

describe("ComparatorPicker — Fable §5.9 / §7.5 (DialogSurface)", () => {
  it("renders a Select comparator trigger button", () => {
    const h = render(
      <ComparatorPicker
        open={false}
        onOpenChange={() => {}}
        candidates={candidates}
        onSelect={() => {}}
      />,
    );
    const trigger = h.$("button[data-comparator-trigger]")!;
    expect(trigger.textContent).toBe("Select comparator");
    cleanup(h);
  });

  it("orders candidates by shared-task overlap (descending), the only ranking", async () => {
    const onSelect = vi.fn();
    const h = render(
      <ComparatorPicker
        open={true}
        onOpenChange={() => {}}
        candidates={candidates}
        onSelect={onSelect}
      />,
    );
    await settle();
    const rows = [...document.body.querySelectorAll<HTMLElement>("[data-comparator-candidate]")];
    expect(rows.map((r) => r.dataset.candidateId)).toEqual(["mc-b", "mc-c", "mc-a"]);
    // Ranking is labeled as overlap, not quality.
    expect(bodyText()).toContain("Ordered by shared-task overlap, not quality.");
    cleanup(h);
  });

  it("selects a candidate and reports the choice", async () => {
    const onSelect = vi.fn();
    const h = render(
      <ComparatorPicker
        open={true}
        onOpenChange={() => {}}
        candidates={candidates}
        onSelect={onSelect}
      />,
    );
    await settle();
    const first = document.body.querySelector<HTMLElement>("[data-comparator-candidate]")!;
    first.click();
    expect(onSelect).toHaveBeenCalledWith("mc-b");
    cleanup(h);
  });

  it("wraps DialogSurface (the dialog portal renders a popup)", async () => {
    const h = render(
      <ComparatorPicker
        open={true}
        onOpenChange={() => {}}
        candidates={candidates}
        onSelect={() => {}}
      />,
    );
    await settle();
    expect(document.body.querySelector("[data-dialog-backdrop]")).not.toBeNull();
    expect(bodyText()).toContain("Select comparator");
    cleanup(h);
  });
});
