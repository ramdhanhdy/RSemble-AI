// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, cleanup, settle } from "./models-test-harness";
import { ObservationDrilldown, type ObservationDrilldownData } from "./ObservationDrilldown";
import { ModelsWorkspace } from "./ModelsWorkspace";

export function makeDrilldownData(
  overrides: Partial<ObservationDrilldownData> = {},
): ObservationDrilldownData {
  return {
    observationId: "obs-9f3a",
    observedAt: 1_724_070_400_000,
    evidenceClass: "verified",
    eligibility: "eligible",
    eligibilityReasons: ["canonical_task_resolved", "verifier_passed"],
    taskId: "code-transform-03",
    taskVersion: 2,
    taskInstanceId: "i-3",
    familyId: "code-transformation",
    familyName: "Code transformation",
    outcome: {
      kind: "verifier",
      passed: true,
      verifierRef: "ver-code@4",
      verifierDigest: "d1g3st",
    },
    replicateLabel: "replicate 2 of 3 within instance i-3",
    evaluator: {
      kind: "model_judge",
      model: "gpt-4o",
      instructionDigest: "inst-aa11",
    },
    assessmentLineage: "active",
    sourceKind: "comparison",
    sourceResultId: "cmp-77",
    sourceHref: "/compare/results/cmp-77",
    confidenceLabel: "high",
    recordHref: "/records/observation/obs-9f3a",
    configurationId: "mc-subject",
    configurationLabel: "openai · gpt-4o",
    ...overrides,
  };
}

function renderDrilldown(
  data?: ObservationDrilldownData | null,
  opts: { notFound?: boolean; path?: string } = {},
) {
  const path = opts.path ?? "/models/mc-subject/evidence/obs-9f3a";
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/models/:modelConfigurationId/evidence/:observationId"
          element={<ObservationDrilldown data={data} notFound={opts.notFound} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ObservationDrilldown — Fable §8 focused page", () => {
  it("is a focused page, not a dialog", () => {
    const h = renderDrilldown(makeDrilldownData());
    expect(h.$("[data-observation-drilldown]")).not.toBeNull();
    expect(h.$("[role=dialog]")).toBeNull();
    expect(document.body.querySelector("[data-dialog-backdrop]")).toBeNull();
    cleanup(h);
  });

  it("renders the breadcrumb Models / {configuration} / Observation", () => {
    const h = renderDrilldown(makeDrilldownData());
    const crumb = h.$("[data-breadcrumb]")!;
    expect(crumb.textContent).toMatch(/Models/);
    expect(crumb.textContent).toMatch(/openai · gpt-4o/);
    expect(crumb.textContent).toMatch(/Observation/);
    const modelsLink = crumb.querySelector("a[href]") as HTMLAnchorElement;
    expect(modelsLink.getAttribute("href")).toContain("/models");
    cleanup(h);
  });

  it("renders identity: eyebrow, mono id, timestamp, class chip, eligibility mark", () => {
    const h = renderDrilldown(makeDrilldownData());
    expect(h.text()).toContain("OBSERVATION");
    expect(h.text()).toContain("obs-9f3a");
    expect(h.$("[data-evidence-class]")!.textContent?.toLowerCase()).toContain("verified");
    expect(h.$("[data-eligibility]")!.textContent?.toLowerCase()).toContain("eligible");
    expect(h.text()).toContain("canonical_task_resolved");
    expect(h.text()).toContain("verifier_passed");
    const heading = h.$("#drilldown-heading")!;
    expect(heading.getAttribute("tabindex")).toBe("-1");
    cleanup(h);
  });

  it("renders canonical Task / Version / Instance links plus family", () => {
    const h = renderDrilldown(makeDrilldownData());
    const links = h.$$("[data-canonical-link]");
    const hrefs = links.map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((href) => href.includes("/tasks/code-transform-03"))).toBe(true);
    expect(hrefs.some((href) => href.includes("/versions/2"))).toBe(true);
    expect(h.text()).toContain("i-3");
    expect(h.text()).toContain("Code transformation");
    cleanup(h);
  });

  it("renders verifier outcome with ref + digest and the replicate label", () => {
    const h = renderDrilldown(makeDrilldownData());
    expect(h.$("[data-section=outcome]")!.textContent).toMatch(/pass/i);
    expect(h.text()).toContain("ver-code@4");
    expect(h.text()).toContain("d1g3st");
    expect(h.text()).toContain("replicate 2 of 3 within instance i-3");
    cleanup(h);
  });

  it("renders judged-score outcome when that is the emitted kind", () => {
    const h = renderDrilldown(
      makeDrilldownData({
        outcome: {
          kind: "judged",
          score: 71.2,
          rubricRef: "rub-eval@2",
          cohortId: "rub-eval@2",
        },
        replicateLabel: "undeclared repeat — not a replicate",
      }),
    );
    expect(h.$("[data-section=outcome]")!.textContent).toContain("71.2");
    expect(h.text()).toContain("rub-eval@2");
    expect(h.text()).toContain("undeclared repeat — not a replicate");
    expect(h.text()).not.toMatch(/replicate \d of \d/);
    cleanup(h);
  });

  it("renders assessment, provenance, source backlink with confidence, and the Records deep link", () => {
    const h = renderDrilldown(makeDrilldownData());
    expect(h.$("[data-section=assessment]")!.textContent).toContain("model_judge");
    expect(h.text()).toContain("inst-aa11");
    expect(h.text()).toContain("active");
    const source = h.$("[data-source-backlink]") as HTMLAnchorElement;
    expect(source.getAttribute("href")).toContain("/compare/results/cmp-77");
    expect(h.$("[data-confidence-chip]")!.textContent).toContain("high");
    const record = h.$("[data-records-link]") as HTMLAnchorElement;
    expect(record.getAttribute("href")).toContain("/records/observation/obs-9f3a");
    expect(h.text()).toContain("Copy link — this device");
    expect(h.text()).toContain("Raw output lives on the exact Record; it is not duplicated here.");
    cleanup(h);
  });

  it("never embeds raw candidate output", () => {
    const h = renderDrilldown(makeDrilldownData());
    expect(h.text()).not.toMatch(/candidate output|raw output lives here|completion text/i);
    expect(h.$("pre")).toBeNull();
    cleanup(h);
  });

  it("renders the typed not-found for an unknown observation id", () => {
    const h = renderDrilldown(null, {
      notFound: true,
      path: "/models/mc-subject/evidence/obs-missing",
    });
    expect(h.$("[data-drilldown-state=not-found]")).not.toBeNull();
    expect(h.text()).toContain("obs-missing");
    expect(h.$("[data-action=open-models]")).not.toBeNull();
    expect(h.$("[data-action=open-records]")).not.toBeNull();
    cleanup(h);
  });

  it("renders an excluded observation fully with exclusion reasons in section 1", () => {
    const h = renderDrilldown(
      makeDrilldownData({
        eligibility: "excluded",
        eligibilityReasons: ["candidate_missing_or_failed", "protocol_incomplete"],
      }),
    );
    expect(h.$("[data-observation-drilldown]")).not.toBeNull();
    expect(h.$("[data-eligibility]")!.textContent?.toLowerCase()).toContain("excluded");
    expect(h.text()).toContain("candidate_missing_or_failed");
    expect(h.text()).toContain("protocol_incomplete");
    expect(h.$("[data-section=canonical]")).not.toBeNull();
    expect(h.$("[data-section=record]")).not.toBeNull();
    cleanup(h);
  });
});

describe("ObservationDrilldown — ModelsWorkspace route (C4)", () => {
  it("direct-loads /:modelConfigurationId/evidence/:observationId", async () => {
    const h = render(
      <MemoryRouter initialEntries={["/models/mc-subject/evidence/obs-unknown"]}>
        <Routes>
          <Route path="/models/*" element={<ModelsWorkspace evidenceRepo={null} />} />
        </Routes>
      </MemoryRouter>,
    );
    await settle();
    expect(h.$("[data-observation-drilldown], [data-drilldown-state=not-found]")).not.toBeNull();
    expect(h.text()).toMatch(/obs-unknown|Observation/);
    cleanup(h);
  });
});
