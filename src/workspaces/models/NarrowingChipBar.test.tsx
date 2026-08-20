// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { render, cleanup } from "./models-test-harness";
import { NarrowingChipBar } from "./NarrowingChipBar";

describe("NarrowingChipBar — Fable §5.10", () => {
  it("renders removable chips for each active narrowing", () => {
    const onRemove = vi.fn();
    const h = render(
      <NarrowingChipBar
        chips={[
          { key: "task", label: "Task: code-transform-03" },
          { key: "class", label: "Class: verified" },
        ]}
        onRemove={onRemove}
        onClearAll={() => {}}
      />,
    );
    const chips = h.$$("[data-narrowing-chip]");
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toContain("Task: code-transform-03");
    const removeBtn = chips[0].querySelector("button[data-remove-narrowing]")!;
    removeBtn.click();
    expect(onRemove).toHaveBeenCalledWith("task");
    cleanup(h);
  });

  it("renders a Clear all control", () => {
    const onClearAll = vi.fn();
    const h = render(
      <NarrowingChipBar
        chips={[{ key: "task", label: "Task: t-1" }]}
        onRemove={() => {}}
        onClearAll={onClearAll}
      />,
    );
    const clear = h.$("button[data-clear-all]")!;
    expect(clear.textContent).toBe("Clear all");
    clear.click();
    expect(onClearAll).toHaveBeenCalled();
    cleanup(h);
  });

  it("renders nothing when there are no chips", () => {
    const h = render(<NarrowingChipBar chips={[]} onRemove={() => {}} onClearAll={() => {}} />);
    expect(h.$("[data-narrowing-chip]")).toBeNull();
    expect(h.$("button[data-clear-all]")).toBeNull();
    cleanup(h);
  });
});
