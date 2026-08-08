// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EvaluationProfileEditor } from "./EvaluationProfileEditor";
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
