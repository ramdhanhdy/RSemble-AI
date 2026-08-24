// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, cleanup } from "./models-test-harness";
import { HonestValue } from "./HonestValue";
import type { HonestQuantity } from "../../lib/model-profiles/coverage-summary";

describe("HonestValue — Fable §5.1", () => {
  it("available renders the value in mono tabular text and no marker", () => {
    const q: HonestQuantity = { state: "available", value: 312 };
    const h = render(<HonestValue quantity={q} label="Accepted responses" />);
    const value = h.$("[data-honest-value]")!;
    expect(value.className).toContain("font-mono");
    expect(value.className).toContain("tabular-nums");
    expect(value.textContent).toBe("312");
    expect(h.text()).not.toMatch(/limited/i);
    expect(h.text()).not.toMatch(/unavailable/i);
    cleanup(h);
  });

  it("limited renders value + unresolved count + dashed warning limited marker (D9)", () => {
    const q: HonestQuantity = {
      state: "limited",
      value: 312,
      unresolved: 14,
      reason: "Provider version was not reported for 14 observations.",
    };
    const h = render(<HonestValue quantity={q} label="Accepted responses" />);
    expect(h.text()).toContain("312");
    expect(h.text()).toContain("(14 unresolved)");
    const marker = h.$("[data-limited-marker]")!;
    expect(marker.textContent).toBe("limited");
    expect(marker.className).toContain("text-warning");
    expect(marker.className).toContain("border-dashed");
    // Reason is disclosed (title + sr-only), never tooltip-only.
    expect(marker.getAttribute("title")).toContain("Provider version");
    expect(h.$("[data-limited-reason]")).not.toBeNull();
    cleanup(h);
  });

  it("unavailable renders the word Unavailable + reason in an honesty-note line and no numeral", () => {
    const q: HonestQuantity = {
      state: "unavailable",
      reason: "No accepted candidate responses exist for this selection.",
    };
    const h = render(<HonestValue quantity={q} label="Accepted responses" />);
    expect(h.text()).toContain("Unavailable");
    expect(h.text()).toContain("No accepted candidate responses exist for this selection.");
    const note = h.$(".honesty-note")!;
    expect(note.textContent).toContain("No accepted candidate responses exist");
    // No numeral renders for unavailable.
    expect(h.$("[data-honest-value]")).not.toBeNull();
    expect(h.$("[data-honest-value]")!.textContent).toBe("Unavailable");
    cleanup(h);
  });

  it("the three states never share a rendering (distinct root class hooks)", () => {
    const a = render(<HonestValue quantity={{ state: "available", value: 1 }} />);
    const l = render(
      <HonestValue quantity={{ state: "limited", value: 1, unresolved: 2, reason: "r" }} />,
    );
    const u = render(<HonestValue quantity={{ state: "unavailable", reason: "r" }} />);
    expect(a.$("[data-honest-state]")!.dataset.honestState).toBe("available");
    expect(l.$("[data-honest-state]")!.dataset.honestState).toBe("limited");
    expect(u.$("[data-honest-state]")!.dataset.honestState).toBe("unavailable");
    cleanup(a);
    cleanup(l);
    cleanup(u);
  });
});
