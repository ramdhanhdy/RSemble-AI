// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, cleanup } from "./models-test-harness";
import { ObservationCard } from "./ObservationCard";

describe("ObservationCard — Fable §5.11 (≤390 stacked-row transform)", () => {
  it("renders the evidence row as a stacked list of labeled rows", () => {
    const h = render(
      <ObservationCard
        observationId="obs-1"
        task="code-transform-03"
        version={2}
        instance="inst-7"
        eligibility="eligible"
        evidenceClass="verified"
        source="benchmark"
      />,
    );
    const list = h.$("[role='list'][data-observation-card]")!;
    expect(list).not.toBeNull();
    const rows = h.$$("[role='listitem'][data-observation-row]");
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const labels = rows.map((r) => r.querySelector("[data-row-label]")!.textContent);
    expect(labels).toEqual(
      expect.arrayContaining(["Task", "Version", "Instance", "Eligibility", "Evidence class"]),
    );
    expect(h.text()).toContain("code-transform-03");
    expect(h.text()).toContain("verified");
    cleanup(h);
  });

  it("links the canonical Task, Version, and Instance", () => {
    const h = render(
      <ObservationCard
        observationId="obs-1"
        task="code-transform-03"
        version={2}
        instance="inst-7"
        eligibility="eligible"
        evidenceClass="verified"
        source="benchmark"
      />,
    );
    const links = h.$$("[data-observation-row] a[data-canonical-link]");
    expect(links.length).toBe(3);
    cleanup(h);
  });

  it("keeps every target ≥44×44 via pressable buttons/links (class hook)", () => {
    const h = render(
      <ObservationCard
        observationId="obs-1"
        task="t-1"
        version={1}
        instance="i-1"
        eligibility="eligible"
        evidenceClass="verified"
        source="benchmark"
      />,
    );
    for (const a of h.$$("[data-canonical-link]")) {
      expect(a.className).toContain("min-h-[44px]");
    }
    cleanup(h);
  });
});
