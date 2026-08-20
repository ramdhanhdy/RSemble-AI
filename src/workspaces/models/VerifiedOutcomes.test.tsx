// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, cleanup } from "./models-test-harness";
import { VerifiedOutcomes, type VerifiedOutcome } from "./VerifiedOutcomes";

function makeOutcomes(): VerifiedOutcome[] {
  return [
    {
      cohortRef: "Verifier cohort X · ver-code@4",
      verifiedTasks: "8 of 10",
      passRate: { state: "available", value: 0.8, unitCount: 8 },
      interval: {
        level: 95,
        lower: 0.62,
        upper: 0.94,
        unitCount: 8,
        unitKind: "task-cluster",
      },
      failureCount: 2,
    },
  ];
}

describe("VerifiedOutcomes — Fable §7.4", () => {
  it("renders nothing when outcomes is empty", () => {
    const h = render(<VerifiedOutcomes outcomes={[]} />);
    expect(h.$("[data-section=verified-outcomes]")).toBeNull();
    cleanup(h);
  });

  it("renders the section heading and table when outcomes exist", () => {
    const h = render(<VerifiedOutcomes outcomes={makeOutcomes()} />);
    expect(h.text()).toContain("Verified outcomes");
    expect(h.$("[data-verified-table]")).not.toBeNull();
    cleanup(h);
  });

  it("renders cohort ref, verified tasks, and pass rate", () => {
    const h = render(<VerifiedOutcomes outcomes={makeOutcomes()} />);
    expect(h.text()).toContain("Verifier cohort X");
    expect(h.text()).toContain("8 of 10");
    expect(h.text()).toContain("0.8");
    cleanup(h);
  });

  it("renders the interval line", () => {
    const h = render(<VerifiedOutcomes outcomes={makeOutcomes()} />);
    expect(h.text()).toContain("95%");
    expect(h.text()).toContain("0.62");
    expect(h.text()).toContain("0.94");
    cleanup(h);
  });

  it("renders failure count as a narrowing button", () => {
    const h = render(<VerifiedOutcomes outcomes={makeOutcomes()} />);
    const btn = h.$("[data-narrowing=failures]");
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain("2 failures");
    cleanup(h);
  });

  it("renders InsufficientState when unitCount < 5", () => {
    const outcomes: VerifiedOutcome[] = [
      {
        cohortRef: "Small cohort",
        verifiedTasks: "3 of 10",
        passRate: { state: "available", value: 0.6, unitCount: 3 },
        interval: {
          level: 95,
          lower: 0.3,
          upper: 0.9,
          unitCount: 3,
          unitKind: "task-cluster",
        },
        failureCount: 1,
      },
    ];
    const h = render(<VerifiedOutcomes outcomes={outcomes} />);
    expect(h.$("[data-insufficient-state]")).not.toBeNull();
    cleanup(h);
  });

  it("renders non_aggregatable state for missing verifier outcomes", () => {
    const outcomes: VerifiedOutcome[] = [
      {
        cohortRef: "Bad cohort",
        verifiedTasks: "0 of 10",
        passRate: {
          state: "non_aggregatable",
          reason: "incompatible_verifier_definitions",
          detail: "Verifier definitions are incompatible; pass rates are not pooled.",
        },
        failureCount: 0,
      },
    ];
    const h = render(<VerifiedOutcomes outcomes={outcomes} />);
    expect(h.text()).toContain("not pooled");
    cleanup(h);
  });
});
