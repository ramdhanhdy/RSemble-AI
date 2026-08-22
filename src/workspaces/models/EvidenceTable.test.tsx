// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, cleanup } from "./models-test-harness";
import { EvidenceTable, type EvidenceTableRow } from "./EvidenceTable";

function makeRows(count: number): EvidenceTableRow[] {
  return Array.from({ length: count }, (_, i) => ({
    observationId: `obs-${i + 1}`,
    taskId: `task-${(i % 5) + 1}`,
    taskName: `Task ${(i % 5) + 1}`,
    version: 2,
    instanceId: `i-${i + 1}`,
    familyId: "code",
    familyName: "Code Transformation",
    outcome: i % 3 === 0 ? "pass" : "fail",
    evidenceClass: i % 4 === 0 ? "verified" : "comparable",
    eligibility: "eligible",
    observedDate: "2026-08-15",
    sourceKind: "comparison",
    supporting: i % 3 === 0,
    contradicting: i % 3 === 1,
  }));
}

describe("EvidenceTable — Fable §7.6", () => {
  it("renders the section heading always", () => {
    const h = render(<EvidenceTable rows={[]} />);
    expect(h.text()).toContain("Observations");
    cleanup(h);
  });

  it("renders quick-tabs All · Supporting · Contradicting · Recent (D8)", () => {
    const h = render(<EvidenceTable rows={makeRows(3)} />);
    expect(h.$("[data-quick-tab=all]")).not.toBeNull();
    expect(h.$("[data-quick-tab=supporting]")).not.toBeNull();
    expect(h.$("[data-quick-tab=contradicting]")).not.toBeNull();
    expect(h.$("[data-quick-tab=recent]")).not.toBeNull();
    cleanup(h);
  });

  it("quick-tabs use aria-pressed", () => {
    const h = render(<EvidenceTable rows={makeRows(3)} />);
    const allTab = h.$("[data-quick-tab=all]")!;
    expect(allTab.getAttribute("aria-pressed")).toBe("true");
    const supTab = h.$("[data-quick-tab=supporting]")!;
    expect(supTab.getAttribute("aria-pressed")).toBe("false");
    cleanup(h);
  });

  it("renders rows in the desktop table", () => {
    const h = render(<EvidenceTable rows={makeRows(3)} />);
    const rows = h.$$("[data-evidence-row]");
    expect(rows.length).toBe(3);
    cleanup(h);
  });

  it("renders observation IDs as clickable links", () => {
    const h = render(<EvidenceTable rows={makeRows(1)} />);
    expect(h.text()).toContain("obs-1");
    cleanup(h);
  });

  it("renders NarrowingChipBar when narrowings are present", () => {
    const h = render(
      <EvidenceTable
        rows={makeRows(3)}
        narrowings={[{ key: "family:code", label: "Family: Code" }]}
        onRemoveNarrowing={() => {}}
        onClearAllNarrowings={() => {}}
      />,
    );
    expect(h.$("[data-narrowing-chip-bar]")).not.toBeNull();
    cleanup(h);
  });

  it("does not render NarrowingChipBar when no narrowings", () => {
    const h = render(<EvidenceTable rows={makeRows(3)} />);
    expect(h.$("[data-narrowing-chip-bar]")).toBeNull();
    cleanup(h);
  });

  it("renders pagination when more than 50 rows", () => {
    const h = render(<EvidenceTable rows={makeRows(60)} />);
    expect(h.text()).toContain("of 60");
    cleanup(h);
  });

  it("does not render pagination for ≤50 rows", () => {
    const h = render(<EvidenceTable rows={makeRows(10)} />);
    expect(h.$("nav[aria-label=Pagination]")).toBeNull();
    cleanup(h);
  });
});
