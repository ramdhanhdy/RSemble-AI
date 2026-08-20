// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, cleanup } from "./models-test-harness";
import { CoverageGrid } from "./CoverageGrid";
import type { ProfileCoverageSummary } from "../../lib/model-profiles/coverage-summary";

function makeCoverage(): ProfileCoverageSummary {
  return {
    uniqueTasks: { state: "available", value: 38 },
    taskVersions: { state: "available", value: 52 },
    taskInstances: { state: "available", value: 94 },
    activeObservations: { state: "available", value: 112 },
    acceptedCandidateResponses: { state: "available", value: 98 },
    attempts: { state: "available", value: 156 },
    plannedReplicates: { state: "limited", value: 20, unresolved: 6, reason: "Some replicates not declared." },
    resolvedIndependentUncertaintyUnits: { state: "unavailable", reason: "Not assigned in Milestone A." },
    uncertaintyUnitKind: { state: "unavailable", reason: "Not assigned." },
    uncertaintyAssumption: { state: "unavailable", reason: "Not assigned." },
    comparabilityCohorts: { state: "available", value: 2 },
    rubricVersions: { state: "available", value: 3 },
    evaluatorConfigurations: { state: "available", value: 2 },
    earliestObservation: { state: "available", value: 1714867200000 },
    latestObservation: { state: "available", value: 1722470400000 },
    missingCells: { state: "available", value: 4 },
    inMetricsEvidenceClassSplit: {
      exploratory: 12,
      comparable: 8,
      verified: 5,
      benchmark_anchor: 2,
    },
    consideredEvidenceClassSplit: {
      exploratory: 12,
      comparable: 8,
      verified: 5,
      benchmark_anchor: 2,
    },
    inMetricsEligibilityStatusSplit: {
      eligible: 14,
      provisional: 3,
      excluded: 6,
    },
    consideredEligibilityStatusSplit: {
      eligible: 14,
      provisional: 3,
      excluded: 6,
    },
    sourceKindSplit: {
      comparison: 61,
      evaluation: 51,
    },
    identityCompleteness: "exact",
    limitationReasons: {},
  };
}

describe("CoverageGrid — Fable §7.2", () => {
  it("renders the section heading", () => {
    const h = render(<CoverageGrid coverage={makeCoverage()} />);
    expect(h.text()).toContain("Coverage");
    expect(h.text()).toContain("evidence quality");
    cleanup(h);
  });

  it("renders HonestQuantity cells in the grid", () => {
    const h = render(<CoverageGrid coverage={makeCoverage()} />);
    const cells = h.$$("[data-coverage-cell]");
    expect(cells.length).toBeGreaterThanOrEqual(14);
    cleanup(h);
  });

  it("renders available values in mono", () => {
    const h = render(<CoverageGrid coverage={makeCoverage()} />);
    expect(h.text()).toContain("38");
    expect(h.text()).toContain("112");
    cleanup(h);
  });

  it("renders limited values with the limited marker", () => {
    const h = render(<CoverageGrid coverage={makeCoverage()} />);
    expect(h.text()).toContain("20");
    expect(h.text()).toContain("(6 unresolved)");
    expect(h.$("[data-limited-marker]")).not.toBeNull();
    cleanup(h);
  });

  it("renders unavailable values as Unavailable", () => {
    const h = render(<CoverageGrid coverage={makeCoverage()} />);
    expect(h.text()).toContain("Unavailable");
    cleanup(h);
  });

  it("renders the attempts cell with provenance-only honesty note", () => {
    const h = render(<CoverageGrid coverage={makeCoverage()} />);
    expect(h.text()).toContain("provenance only");
    expect(h.text()).toContain("not a sample size");
    cleanup(h);
  });

  it("renders EvidenceMixChips", () => {
    const h = render(<CoverageGrid coverage={makeCoverage()} />);
    expect(h.$("[data-evidence-mix]")).not.toBeNull();
    cleanup(h);
  });

  it("renders eligibility split as a narrowing button", () => {
    const h = render(<CoverageGrid coverage={makeCoverage()} />);
    const btn = h.$("[data-narrowing=eligibility]");
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain("eligible");
    cleanup(h);
  });

  it("renders source split as a narrowing button", () => {
    const h = render(<CoverageGrid coverage={makeCoverage()} />);
    const btn = h.$("[data-narrowing=source]");
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain("comparison");
    cleanup(h);
  });
});
