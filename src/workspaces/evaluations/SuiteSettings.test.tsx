// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelProbeProvider } from "../../ui/ModelProbeContext";
import { SuiteSettings } from "./SuiteSettings";
import type { EvaluationSuite } from "../../lib/evaluations/evaluation-types";
import type { ModelSlot } from "../../studio-data";

const slots: ModelSlot[] = [
  { id: "s1", providerId: "gemini", provider: "Gemini", model: "Gemini Flash", slug: "gemini-3.6-flash", enabled: true },
  { id: "s2", providerId: "gemini", provider: "Gemini", model: "Gemini Pro", slug: "gemini-3.1-pro-preview", enabled: true },
];

const suite: EvaluationSuite = {
  id: "suite-1",
  revision: 1,
  version: 1,
  name: "Reasoning suite",
  description: "",
  tasks: [],
  modelSlots: slots,
  defaultJudge: { providerId: "gemini", model: "gemini-3.6-flash" },
  defaultEvaluation: { kind: "holistic" },
  reasoningPolicy: { candidates: "provider-default", judge: "provider-default" },
  createdAt: 0,
  updatedAt: 0,
  archivedAt: null,
};

describe("SuiteSettings reasoning controls", () => {
  it("renders labelled candidate and Judge effort controls", () => {
    const html = renderToStaticMarkup(
      <ModelProbeProvider>
        <SuiteSettings
          suite={suite}
          onChange={() => undefined}
          models={[]}
          profileRecords={[]}
          resolveProfileLabel={() => ""}
        />
      </ModelProbeProvider>,
    );
    expect(html).toContain('aria-label="Candidate effort"');
    expect(html).toContain('aria-label="Judge effort"');
    expect(html).toContain("Provider default");
    expect(html).toContain("Named effort is a controlled request");
  });
});
