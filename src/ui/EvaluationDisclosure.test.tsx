// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EvaluationDisclosure } from "./EvaluationDisclosure";
import { HOLISTIC_EVALUATION } from "../lib/evaluations/evaluation-profile-adhoc";
import type { AdHocEvaluationConfig } from "../lib/evaluations/evaluation-profile-adhoc";
import type { EvaluationProfile } from "../lib/evaluations/evaluation-types";
import type { Action } from "../studio-engine";

function makeProfile(name: string, criteriaCount = 1): EvaluationProfile {
  return {
    id: "p1",
    version: 1,
    name,
    description: "test profile",
    judgeInstruction: "",
    criteria: Array.from({ length: criteriaCount }, (_, i) => ({
      id: `c${i + 1}`,
      name: `Criterion ${i + 1}`,
      description: `Description ${i + 1}`,
      weight: 1,
      anchors: { one: "Poor", three: "OK", five: "Great" },
    })),
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function makeCustomConfig(profile: EvaluationProfile): AdHocEvaluationConfig {
  return { kind: "custom", profile };
}

function makeProfileConfig(profile: EvaluationProfile): AdHocEvaluationConfig {
  return { kind: "profile", ref: { id: profile.id, version: profile.version }, profile };
}

const noopDispatch = vi.fn() as unknown as React.Dispatch<Action>;

describe("EvaluationDisclosure — summary", () => {
  it("reports holistic judgment by default", () => {
    const html = renderToStaticMarkup(
      <EvaluationDisclosure evaluation={HOLISTIC_EVALUATION} dispatch={noopDispatch} />,
    );
    expect(html).toContain("Holistic judgment");
  });

  it("reports saved profile name and version when a profile is selected", () => {
    const profile = makeProfile("Writing Quality");
    const html = renderToStaticMarkup(
      <EvaluationDisclosure evaluation={makeProfileConfig(profile)} dispatch={noopDispatch} />,
    );
    expect(html).toContain("Writing Quality");
    expect(html).toContain("v1");
  });

  it("reports custom criterion count", () => {
    const profile = makeProfile("Custom", 3);
    const html = renderToStaticMarkup(
      <EvaluationDisclosure evaluation={makeCustomConfig(profile)} dispatch={noopDispatch} />,
    );
    expect(html).toContain("3");
    expect(html).toContain("Custom");
  });
});

describe("EvaluationDisclosure — no preset chips", () => {
  it("does not render goal, metric, gap, Accuracy, Depth, or Clarity chips", () => {
    const html = renderToStaticMarkup(
      <EvaluationDisclosure evaluation={HOLISTIC_EVALUATION} dispatch={noopDispatch} />,
    );
    // Strip SVG content to avoid false positives from path data
    const text = html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/class="[^"]*"/g, "");
    expect(text).not.toContain("Accuracy");
    expect(text).not.toContain("Depth");
    expect(text).not.toContain("Clarity");
    expect(text).not.toMatch(/\bgoal\b/i);
    expect(text).not.toMatch(/\bmetric\b/i);
    expect(text).not.toMatch(/\bgap\b/i);
  });
});

describe("EvaluationDisclosure — accessible", () => {
  it("has a labelled disclosure trigger with aria-expanded", () => {
    const html = renderToStaticMarkup(
      <EvaluationDisclosure evaluation={HOLISTIC_EVALUATION} dispatch={noopDispatch} />,
    );
    expect(html).toContain("aria-expanded");
    expect(html).toContain("aria-controls");
  });
});
