// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, cleanup } from "./models-test-harness";
import { VersionStatusChip } from "./VersionStatusChip";

describe("VersionStatusChip — Fable §5.2", () => {
  it("exact renders the word and no icon, secondary role", () => {
    const h = render(<VersionStatusChip status="exact" />);
    const chip = h.$("[data-version-status]")!;
    expect(chip.textContent).toBe("Exact version");
    expect(chip.querySelector("svg")).toBeNull();
    expect(chip.className).toContain("text-text-secondary");
    cleanup(h);
  });

  it("rolling alias carries its window with a Repeat icon", () => {
    const h = render(<VersionStatusChip status="rolling_alias" window="May–Aug 2026" />);
    const chip = h.$("[data-version-status]")!;
    expect(chip.textContent).toContain("Rolling alias");
    expect(chip.textContent).toContain("May–Aug 2026");
    expect(chip.querySelector("svg")).not.toBeNull();
    expect(chip.className).toContain("text-warning");
    cleanup(h);
  });

  it("partial identity carries the missing dimension with a CircleAlert icon", () => {
    const h = render(
      <VersionStatusChip status="partial_identity" missingDimension="no resolved version" />,
    );
    const chip = h.$("[data-version-status]")!;
    expect(chip.textContent).toContain("Partial identity");
    expect(chip.textContent).toContain("no resolved version");
    expect(chip.querySelector("svg")).not.toBeNull();
    expect(chip.className).toContain("text-warning");
    cleanup(h);
  });

  it("never renders icon-only (every chip has its word)", () => {
    for (const status of ["exact", "rolling_alias", "partial_identity"] as const) {
      const h = render(
        <VersionStatusChip
          status={status}
          window="May–Aug 2026"
          missingDimension="no resolved version"
        />,
      );
      expect(h.$("[data-version-status]")!.textContent!.trim().length).toBeGreaterThan(0);
      cleanup(h);
    }
  });
});
