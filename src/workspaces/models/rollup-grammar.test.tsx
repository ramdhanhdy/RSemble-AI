// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, cleanup } from "./models-test-harness";
import { RollupBanner } from "./RollupBanner";
import { HeterogeneityTable } from "./HeterogeneityTable";
import { MemberShelf } from "./MemberShelf";
import { KindEyebrow } from "../../ui/KindEyebrow";

describe("Rollup grammar — Fable §9 forward contract", () => {
  it("banner precedes member content in DOM order", () => {
    const h = render(
      <div>
        <RollupBanner
          name="Coding rollup"
          version={2}
          memberCount={4}
          pinnedDate="Aug 12 2026"
          manifestDigest="4c9d"
        />
        <MemberShelf member={{ id: "mc-1", present: true }}>
          <div data-member-content>member body</div>
        </MemberShelf>
      </div>,
    );
    const banner = h.$("[data-rollup-banner]")!;
    const member = h.$("[data-member-shelf]")!;
    expect(banner.compareDocumentPosition(member) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup(h);
  });

  it("banner renders eyebrow, name + version (mono), and the policy block verbatim", () => {
    const h = render(
      <RollupBanner
        name="Coding rollup"
        version={2}
        memberCount={4}
        pinnedDate="Aug 12 2026"
        manifestDigest="4c9d"
      />,
    );
    expect(h.$("[data-rollup-eyebrow]")!.textContent).toBe("SAVED ROLLUP");
    expect(h.$("[data-rollup-name]")!.textContent).toContain("Coding rollup");
    const version = h.$("[data-rollup-version]")!;
    expect(version.textContent).toBe("v2");
    expect(version.className).toContain("font-mono");
    expect(h.text()).toContain("Stratified only.");
    expect(h.text()).toContain("Members: 4 exact configurations");
    expect(h.text()).toContain("version pinned Aug 12 2026");
    expect(h.text()).toContain("member manifest digest 4c9d");
    cleanup(h);
  });

  it("heterogeneity table marks differing cells with warning border + differs word", () => {
    const h = render(
      <HeterogeneityTable
        dimensions={["provider", "resolved version"]}
        members={[
          { id: "mc-1", values: { provider: "Acme", "resolved version": "2026-05" } },
          { id: "mc-2", values: { provider: "Acme", "resolved version": "2026-08" } },
        ]}
      />,
    );
    const differs = h.$$("[data-differs]");
    expect(differs.length).toBeGreaterThan(0);
    for (const cell of differs) {
      expect(cell.className).toContain("border-warning");
      expect(cell.textContent).toContain("differs");
    }
    // Identical cells are not marked.
    const providerCells = h.$$("[data-dimension='provider']");
    expect(providerCells.every((c) => !c.hasAttribute("data-differs"))).toBe(true);
    cleanup(h);
  });

  it("string sweep finds no pooled aggregate (no Σ / total / average outside policy)", () => {
    const h = render(
      <RollupBanner
        name="Coding rollup"
        version={2}
        memberCount={4}
        pinnedDate="Aug 12 2026"
        manifestDigest="4c9d"
      />,
    );
    const text = h.text();
    expect(text).not.toMatch(/Σ/);
    // "total" / "average" must not appear in rollup banner output.
    expect(text.toLowerCase()).not.toMatch(/\btotal\b/);
    expect(text.toLowerCase()).not.toMatch(/\baverage\b/);
    cleanup(h);
  });

  it("tombstone member shelf renders the absence, never silently dropped", () => {
    const h = render(<MemberShelf member={{ id: "mc-4f", present: false }} />);
    expect(h.text()).toContain("Member mc-4f is not present in this database");
    expect(h.$("[data-member-tombstone]")).not.toBeNull();
    cleanup(h);
  });

  it("KindEyebrow exposes the rollup, model-configuration, and observation kinds", () => {
    // textContent is the raw stored word; the CSS `uppercase` class renders it
    // visually uppercase. Assert the raw word is present for each new kind.
    const r = render(<KindEyebrow kind="rollup" />);
    expect(r.text()).toContain("Rollup");
    cleanup(r);
    const m = render(<KindEyebrow kind="model-configuration" />);
    expect(m.text()).toContain("Model Configuration");
    cleanup(m);
    const o = render(<KindEyebrow kind="observation" />);
    expect(o.text()).toContain("Observation");
    cleanup(o);
  });
});
