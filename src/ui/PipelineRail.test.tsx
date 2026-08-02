import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { PipelineRail } from "./PipelineRail";
import { GlobalExecutionStrip, type StripViewModel } from "./GlobalExecutionStrip";
import { StatusMark } from "./StatusMark";

const runningView: StripViewModel = {
  kind: "experiment",
  caption: "Evaluation · Task 2/3 · Write a haiku",
  elapsedMs: 5_000,
  href: "/experiments/exp-1",
  status: "running",
  alert: null,
};

describe("pipeline continuity", () => {
  it("animates only the connector feeding the active stage", () => {
    const html = renderToStaticMarkup(
      <PipelineRail
        mode="rank"
        stages={[
          { status: "done" },
          { status: "active", caption: "2 of 3 done" },
          { status: "pending" },
          { status: "pending" },
        ]}
      />,
    );
    expect((html.match(/animate-dash-march/g) ?? [])).toHaveLength(1);
    expect(html).toContain("motion-state");
  });

  it("keeps off-route running status static with visible text", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <GlobalExecutionStrip view={runningView} />
      </MemoryRouter>,
    );
    expect(html).not.toContain("animate-pulse");
    expect(html).not.toContain("animate-spin-ease");
    expect(html).toContain("Running");
  });

  it("uses a fixed icon box and visible label for status geometry", () => {
    const html = renderToStaticMarkup(<StatusMark status="running" />);
    expect(html).toContain("data-status-icon");
    expect(html).toContain("size-4 shrink-0");
    expect(html).toContain("Running");
  });
});
