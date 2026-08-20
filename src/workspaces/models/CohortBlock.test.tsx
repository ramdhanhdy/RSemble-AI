// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, cleanup } from "./models-test-harness";
import { CohortBlock } from "./CohortBlock";
import type { AggregatedValue } from "../../lib/model-profiles/family-aggregation";

const available: AggregatedValue = { state: "available", value: 71.2, unitCount: 6 };

describe("CohortBlock — Fable §5.4", () => {
  it("renders cohort ref, value, interval, and coverage line in anatomy order", () => {
    const h = render(
      <CohortBlock
        cohortRef="Rubric v3 · rub-eval@2"
        value={available}
        interval={{
          state: "available",
          level: 95,
          lower: 64.1,
          upper: 77.8,
          unitCount: 6,
          unitKind: "task-cluster",
        }}
        coverageLine="8 of 10 tasks · 14 instances · 23 observations"
      />,
    );
    expect(h.$("[data-cohort-ref]")!.textContent).toBe("Rubric v3 · rub-eval@2");
    expect(h.$("[data-cohort-value]")!.textContent).toBe("71.2");
    expect(h.$("[data-cohort-interval]")!.textContent).toContain("64.1–77.8");
    expect(h.$("[data-cohort-interval]")!.textContent).toContain("95%");
    expect(h.$("[data-cohort-interval]")!.textContent).toContain("6 task-cluster units");
    expect(h.$("[data-cohort-coverage]")!.textContent).toBe(
      "8 of 10 tasks · 14 instances · 23 observations",
    );
    cleanup(h);
  });

  it("renders the insufficient-coverage state in the interval slot when unitCount < 5", () => {
    const h = render(
      <CohortBlock
        cohortRef="verifier cohort X · ver-code@4"
        value={available}
        interval={{
          state: "insufficient",
          unitCount: 4,
          unitKind: "task-cluster",
          reason: "Only four usable metric units are available.",
        }}
        coverageLine="4 of 10 tasks · 5 instances · 7 observations"
      />,
    );
    const slot = h.$("[data-cohort-interval]")!;
    expect(slot.textContent).toContain("Insufficient independent coverage for an interval");
    // No ± and no interval digits in the insufficient slot.
    expect(slot.textContent).not.toMatch(/±/);
    expect(slot.textContent).not.toMatch(/64\.1/);
    cleanup(h);
  });

  it("renders the non-aggregatable value state with its reason sentence", () => {
    const h = render(
      <CohortBlock
        cohortRef="verifier cohort X · ver-code@4"
        value={{
          state: "non_aggregatable",
          reason: "incompatible_verifier_definitions",
          detail: "Verifier definitions are incompatible; pass rates are not pooled.",
        }}
        coverageLine="8 of 10 tasks · 14 instances · 23 observations"
      />,
    );
    expect(h.text()).toContain("Verifier definitions are incompatible; pass rates are not pooled.");
    cleanup(h);
  });
});
