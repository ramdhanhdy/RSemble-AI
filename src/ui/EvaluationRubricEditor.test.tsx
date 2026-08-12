// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EvaluationProfileEditor } from "./EvaluationProfileEditor";
import { validateProfile } from "../lib/evaluations/evaluation-rubric";
import type { EvaluationProfile, EvaluationCriterion } from "../lib/evaluations/evaluation-types";

function makeCriterion(
  id: string,
  overrides: Partial<EvaluationCriterion> = {},
): EvaluationCriterion {
  return {
    id,
    name: `Criterion ${id}`,
    description: `Description ${id}`,
    weight: 1,
    anchors: { one: "Poor", three: "OK", five: "Great" },
    kind: undefined,
    ...overrides,
  } as EvaluationCriterion;
}

function makeProfile(criteria: EvaluationCriterion[] = []): EvaluationProfile {
  return {
    id: "p1",
    version: 1,
    name: "Test Profile",
    description: "test",
    judgeInstruction: "",
    criteria,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

describe("EvaluationProfileEditor — structure", () => {
  it("shows total weight summary", () => {
    const profile = makeProfile([
      makeCriterion("c1", { weight: 1 }),
      makeCriterion("c2", { weight: 2 }),
    ]);
    const html = renderToStaticMarkup(
      <EvaluationProfileEditor profile={profile} onChange={() => {}} />,
    );
    expect(html).toContain("Total weight");
    expect(html).toContain("3.00");
  });

  it("shows zero total weight warning", () => {
    const profile = makeProfile([makeCriterion("c1", { weight: 0 })]);
    const html = renderToStaticMarkup(
      <EvaluationProfileEditor profile={profile} onChange={() => {}} />,
    );
    expect(html).toContain("needs positive weight");
  });

  it("renders criterion name, weight, and normalized share in collapsed header", () => {
    const profile = makeProfile([makeCriterion("c1", { weight: 2 })]);
    const html = renderToStaticMarkup(
      <EvaluationProfileEditor profile={profile} onChange={() => {}} />,
    );
    expect(html).toContain("Criterion c1");
    expect(html).toContain("Weight 2.0");
    // 100% since it's the only criterion
    expect(html).toContain("100%");
  });

  it("renders anchor fields for 1, 3, and 5", () => {
    const profile = makeProfile([makeCriterion("c1")]);
    const html = renderToStaticMarkup(
      <EvaluationProfileEditor profile={profile} onChange={() => {}} />,
    );
    // The accordion is open by default for the first criterion
    expect(html).toContain("Score 1 anchor");
    expect(html).toContain("Score 3 anchor");
    expect(html).toContain("Score 5 anchor");
  });

  it("renders Add criterion button", () => {
    const html = renderToStaticMarkup(
      <EvaluationProfileEditor profile={makeProfile()} onChange={() => {}} />,
    );
    expect(html).toContain("Add graded");
    expect(html).toContain("Add binary");
  });

  it("renders Move up/down buttons", () => {
    const profile = makeProfile([makeCriterion("c1"), makeCriterion("c2")]);
    const html = renderToStaticMarkup(
      <EvaluationProfileEditor profile={profile} onChange={() => {}} />,
    );
    expect(html).toContain("Move criterion up");
    expect(html).toContain("Move criterion down");
  });
});

describe("EvaluationProfileEditor — no presets", () => {
  it("does not render goal, metric, gap, Accuracy, Depth, or Clarity", () => {
    const html = renderToStaticMarkup(
      <EvaluationProfileEditor profile={makeProfile()} onChange={() => {}} />,
    );
    expect(html).not.toContain("Accuracy");
    expect(html).not.toContain("Depth");
    expect(html).not.toContain("Clarity");
    expect(html).not.toMatch(/>goal</i);
    expect(html).not.toMatch(/>metric</i);
    expect(html).not.toMatch(/>gap</i);
  });
});

describe("EvaluationProfileEditor — accessibility", () => {
  it("every field has an associated label", () => {
    const profile = makeProfile([makeCriterion("c1")]);
    const html = renderToStaticMarkup(
      <EvaluationProfileEditor profile={profile} onChange={() => {}} />,
    );
    expect(html).toContain("Criterion name");
    expect(html).toContain("Description");
    expect(html).toContain("Weight");
  });

  it("accordion header has aria-expanded", () => {
    const profile = makeProfile([makeCriterion("c1")]);
    const html = renderToStaticMarkup(
      <EvaluationProfileEditor profile={profile} onChange={() => {}} />,
    );
    expect(html).toContain("aria-expanded");
  });
});

describe("EvaluationProfileEditor — Requirement Group weight authoring (spec §11.4)", () => {
  function hybridProfile(): EvaluationProfile {
    return {
      id: "p1",
      version: 1,
      name: "Hybrid",
      description: "test",
      judgeInstruction: "",
      criteria: [
        {
          id: "g-c1",
          kind: "graded",
          name: "G",
          description: "d",
          weight: 1,
          anchors: { one: "1", two: "2", three: "3", four: "4", five: "5" },
        },
        {
          id: "b1",
          kind: "binary",
          name: "Check b1",
          description: "d",
          trueWhen: "true",
          falseWhen: "false",
        },
        {
          id: "b2",
          kind: "binary",
          name: "Check b2",
          description: "d",
          trueWhen: "true",
          falseWhen: "false",
        },
      ],
      requirementGroups: [
        { id: "gA", name: "Group A", checkIds: ["b1"], weight: 1, mode: "ALL" },
        { id: "gB", name: "Group B", checkIds: ["b2"], weight: 3, mode: "ALL" },
      ],
      complianceInfluence: 1.0,
      createdAt: 1000,
      updatedAt: 1000,
    };
  }

  it("renders each group's editable weight input and ALL mode (no MEAN, no member weight)", () => {
    const html = renderToStaticMarkup(
      <EvaluationProfileEditor profile={hybridProfile()} onChange={() => {}} />,
    );
    expect(html).toContain('aria-label="Group A group weight"');
    expect(html).toContain('aria-label="Group B group weight"');
    expect(html).toContain('value="3"'); // gB weight 3
    expect(html).toContain("1 check · ALL");
    expect(html).not.toContain("MEAN");
    expect(html).not.toContain("member weight");
  });

  it("discloses per-group fail cost = lambda * v_g / sum(v)", () => {
    const html = renderToStaticMarkup(
      <EvaluationProfileEditor profile={hybridProfile()} onChange={() => {}} />,
    );
    // groups weights 1 + 3 = 4; lambda 1.0.
    // gA fail cost = 1*1/4 = 0.25; gB = 1*3/4 = 0.75.
    expect(html).toContain("fail cost 0.25 pts");
    expect(html).toContain("fail cost 0.75 pts");
  });

  it("changing a group weight changes the fail-cost disclosure", () => {
    const captures: EvaluationProfile[] = [];
    // Simulate a weight edit on Group B (3 -> 5) via the onChange-driven pattern:
    // the editor calls updateGroupWeight only on a valid finite positive value.
    const profile = hybridProfile();
    const edited = {
      ...profile,
      requirementGroups: profile.requirementGroups!.map((g) =>
        g.id === "gB" ? { ...g, weight: 5 } : g,
      ),
    };
    captures.push(edited);
    const html = renderToStaticMarkup(
      <EvaluationProfileEditor profile={edited} onChange={(p) => captures.push(p)} />,
    );
    // weights now 1 + 5 = 6; gA fail cost = 1/6 ≈ 0.17, gB = 5/6 ≈ 0.83.
    expect(html).toContain("fail cost 0.17 pts");
    expect(html).toContain("fail cost 0.83 pts");
  });

  it("invalid/non-positive group weight values never become authoritative", () => {
    // The editor's updateGroupWeight guard rejects <= 0 and non-finite.
    // Exercise via a direct call path by rendering the component and firing the
    // input is not feasible in static render, so we assert the guard contract:
    // a zero-weight group must not survive a profile save (validateProfile).

    const zeroGroup = {
      ...hybridProfile(),
      requirementGroups: [
        { id: "gA", name: "A", checkIds: ["b1"], weight: 0, mode: "ALL" as const },
      ],
    };
    const errors = validateProfile(zeroGroup);
    expect(errors.some((e: string) => e.includes("weight must be positive"))).toBe(true);
  });

  it("shows the ALL-fragility warning at N >= 4 subchecks", () => {
    const profile = hybridProfile();
    profile.requirementGroups = [
      {
        id: "gA",
        name: "Group A",
        checkIds: ["b1", "b2", "b3", "b4", "b5"],
        weight: 1,
        mode: "ALL",
      },
    ];
    profile.criteria = [
      ...profile.criteria,
      ...["b3", "b4", "b5"].map((id) => ({
        id,
        kind: "binary" as const,
        name: `Check ${id}`,
        description: "d",
        trueWhen: "t",
        falseWhen: "f",
      })),
    ];
    const html = renderToStaticMarkup(
      <EvaluationProfileEditor profile={profile} onChange={() => {}} />,
    );
    expect(html).toContain("any single false verdict fails the group");
  });
});
