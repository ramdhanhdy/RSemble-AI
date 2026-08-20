// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, cleanup } from "./models-test-harness";
import { InsufficientState } from "./InsufficientState";

describe("InsufficientState — Fable §5.5", () => {
  it("renders the insufficient-coverage text with units/required/resolver/digest and no ±", () => {
    const h = render(
      <InsufficientState
        kind="insufficient"
        unitCount={4}
        required={5}
        resolverVersion="v1"
        digest="9a2f"
      />,
    );
    const root = h.$("[data-insufficient-state]")!;
    expect(root.textContent).toContain("Insufficient independent coverage for an interval");
    expect(root.textContent).toContain("4 resolved task-cluster units");
    expect(root.textContent).toContain("5 required");
    expect(root.textContent).toContain("resolver v1");
    expect(root.textContent).toContain("9a2f");
    expect(root.textContent).not.toMatch(/±/);
    // No interval digits.
    expect(root.textContent).not.toMatch(/\d+\.\d+/);
    expect(root.querySelector("svg")).not.toBeNull();
    cleanup(h);
  });

  it("renders the non_aggregatable reason sentence (same component)", () => {
    const h = render(
      <InsufficientState
        kind="non_aggregatable"
        reason="Verifier definitions are incompatible; pass rates are not pooled."
      />,
    );
    expect(h.$("[data-insufficient-state]")!.textContent).toContain(
      "Verifier definitions are incompatible; pass rates are not pooled.",
    );
    cleanup(h);
  });

  it("uses a muted text role and is static (no animation class)", () => {
    const h = render(
      <InsufficientState kind="insufficient" unitCount={4} required={5} />,
    );
    const root = h.$("[data-insufficient-state]")!;
    expect(root.className).toContain("text-text-muted");
    expect(root.className).not.toMatch(/animate-/);
    cleanup(h);
  });
});
