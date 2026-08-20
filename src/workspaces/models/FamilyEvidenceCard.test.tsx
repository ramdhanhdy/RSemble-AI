// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, cleanup } from "./models-test-harness";
import { FamilyEvidenceCard } from "./FamilyEvidenceCard";
import type { FamilyAggregate } from "../../lib/model-profiles/family-aggregation";

function makeFamily(): FamilyAggregate {
  return {
    familyId: "code-transformation",
    judgedScores: [
      {
        cohortId: "rub-eval@2",
        value: { state: "available", value: 71.2, unitCount: 6 },
      },
    ],
    passRates: [
      {
        cohortId: "ver-x@4",
        value: { state: "available", value: 0.8, unitCount: 8 },
      },
    ],
    taskCount: 10,
    tasks: [
      {
        taskId: "task-1",
        familyId: "code-transformation",
        versions: [],
        judgedScores: [],
        passRates: [],
        rolledUp: false,
      },
      {
        taskId: "task-2",
        familyId: "code-transformation",
        versions: [],
        judgedScores: [],
        passRates: [],
        rolledUp: false,
      },
    ],
  };
}

describe("FamilyEvidenceCard — Fable §7.3", () => {
  it("renders the family name and task count", () => {
    const h = render(<FamilyEvidenceCard family={makeFamily()} familyName="Code Transformation" />);
    expect(h.text()).toContain("Code Transformation");
    expect(h.text()).toContain("10 tasks");
    cleanup(h);
  });

  it("renders the header as a narrowing button", () => {
    const h = render(<FamilyEvidenceCard family={makeFamily()} />);
    const btn = h.$("[data-family-header]");
    expect(btn).not.toBeNull();
    expect(btn!.tagName).toBe("BUTTON");
    cleanup(h);
  });

  it("renders CohortBlocks for judged-score metrics", () => {
    const h = render(<FamilyEvidenceCard family={makeFamily()} />);
    expect(h.$("[data-cohort-block]")).not.toBeNull();
    cleanup(h);
  });

  it("renders the non-pooling divider for heterogeneous rubrics", () => {
    const family: FamilyAggregate = {
      familyId: "multi-rubric",
      judgedScores: [
        { cohortId: "rub-a@1", value: { state: "available", value: 70, unitCount: 5 } },
        { cohortId: "rub-b@1", value: { state: "available", value: 80, unitCount: 5 } },
      ],
      passRates: [],
      taskCount: 10,
      tasks: [],
    };
    const h = render(<FamilyEvidenceCard family={family} />);
    expect(h.text()).toContain("not commensurate");
    cleanup(h);
  });

  it("renders task-level drilldown buttons in footer", () => {
    const h = render(<FamilyEvidenceCard family={makeFamily()} />);
    const btns = h.$$("[data-narrowing=task]");
    expect(btns.length).toBe(2);
    cleanup(h);
  });

  it("renders pass-rate cohorts", () => {
    const h = render(<FamilyEvidenceCard family={makeFamily()} />);
    expect(h.text()).toContain("Pass rates");
    cleanup(h);
  });
});
