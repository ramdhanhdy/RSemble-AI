// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { RunDetail } from "./RunDetail";
import { LegacyRunDetail } from "./LegacyRunDetail";
import type { RunRecordV2, LegacyRunSummary } from "../../lib/persistence/run-types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
}

function renderWithRouter(node: React.ReactNode): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<MemoryRouter>{node}</MemoryRouter>));
  return {
    container,
    root,
    $: (s) => container.querySelector<HTMLElement>(s),
    $$: (s) => [...container.querySelectorAll<HTMLElement>(s)],
  };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// --- Test fixtures ------------------------------------------------------------

function makeFullRecord(overrides: Partial<RunRecordV2> = {}): RunRecordV2 {
  return {
    schemaVersion: 2,
    id: "run-1",
    revision: 1,
    execution: { ownerId: "tab-1", fence: 1 },
    createdAt: 1716048000000,
    updatedAt: 1716048060000,
    completedAt: 1716048060000,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: {
      title: "Write a Python sort function",
      prompt: "Write a function that sorts integers using bubble sort.",
      systemPrompt: "You are a helpful assistant.",
      temperature: 0.7,
    },
    evaluation: { profile: null, candidateMessages: [] },
    candidates: [
      {
        candidateId: "c1",
        slotId: "s1",
        modelKey: "openrouter:gpt-4o",
        providerId: "openrouter",
        model: "GPT-4o",
        slug: "gpt-4o",
        acceptedAttemptId: "att-1",
        attempts: [
          {
            attemptId: "att-1",
            messages: [{ role: "user", content: "Sort the list" }],
            startedAt: 1716048000000,
            finishedAt: 1716048030000,
            status: "completed" as const,
            output: "def bubble_sort(arr):\n    return sorted(arr)",
            tokensIn: 15,
            tokensOut: 30,
            error: null,
          },
        ],
      },
    ],
    judge: {
      status: "done" as const,
      acceptedAttemptId: "judge-att-1",
      report: {
        labelMap: [{ label: "A", candidateId: "c1" }],
        evaluationsById: {
          c1: {
            candidateId: "c1",
            blindLabel: "A",
            overallScore: 4.5,
            position: "First",
            rationale: "Clean implementation",
            strengths: ["Readability"],
            deductions: [],
            missedRequirements: [],
            criterionScores: [],
          },
        },
        comparisons: [],
      },
      consensus: null,
      attempts: [
        {
          attemptId: "judge-att-1",
          providerId: "openrouter",
          model: "judge-model",
          instruction: "Evaluate candidates by correctness and readability.",
          messages: [{ role: "user", content: "Evaluate" }],
          blindLabelToCandidateId: { A: "c1" },
          candidateAttemptIdsByCandidateId: { c1: "att-1" },
          startedAt: 1716048030000,
          finishedAt: 1716048050000,
          status: "completed" as const,
          error: null,
          report: {
            labelMap: [{ label: "A", candidateId: "c1" }],
            evaluationsById: {
              c1: {
                candidateId: "c1",
                blindLabel: "A",
                overallScore: 4.5,
                position: "First",
                rationale: "Clean implementation",
                strengths: ["Readability"],
                deductions: [],
                missedRequirements: [],
                criterionScores: [],
              },
            },
            comparisons: [],
          },
          consensus: null,
        },
      ],
    },
    fusion: { status: "idle" as const, acceptedAttemptId: null, attempts: [] },
    winnerKeys: ["openrouter:gpt-4o"],
    ...overrides,
  };
}

function makeLegacySummary(overrides: Partial<LegacyRunSummary> = {}): LegacyRunSummary {
  return {
    kind: "legacy",
    schemaVersion: "1-import",
    id: "legacy-1",
    createdAt: 1715961600000,
    taskExcerpt: "Old run before v2 migration",
    modelKeys: ["openrouter:gpt-3.5-turbo"],
    winnerKeys: ["openrouter:gpt-3.5-turbo"],
    scoresByModelKey: { "openrouter:gpt-3.5-turbo": 3.0 },
    detailAvailable: false,
    searchText: "old run before v2 migration",
    ...overrides,
  };
}

// --- Tests --------------------------------------------------------------------

describe("RunDetail", () => {
  it("renders semantic section order: header → outcome → candidates → judge → task-config", () => {
    const record = makeFullRecord();
    const h = renderWithRouter(<RunDetail record={record} />);
    const sections = h.$$("[data-section]");
    const ids = sections.map((s) => s.getAttribute("data-section"));
    expect(ids).toContain("header");
    expect(ids).toContain("outcome");
    expect(ids).toContain("candidates");
    expect(ids).toContain("judge");
    expect(ids).toContain("task-config");
    // Header comes before outcome
    expect(ids.indexOf("header")).toBeLessThan(ids.indexOf("outcome"));
    // Outcome before candidates
    expect(ids.indexOf("outcome")).toBeLessThan(ids.indexOf("candidates"));
    // Candidates before judge
    expect(ids.indexOf("candidates")).toBeLessThan(ids.indexOf("judge"));
    cleanup(h);
  });

  it("renders the status timeline section after header and before outcome", () => {
    const record = makeFullRecord();
    const h = renderWithRouter(<RunDetail record={record} />);
    const timeline = h.$("[data-section='timeline']");
    expect(timeline).toBeTruthy();
    expect(timeline?.textContent).toContain("Status timeline");
    const ids = h.$$("[data-section]").map((s) => s.getAttribute("data-section"));
    expect(ids.indexOf("header")).toBeLessThan(ids.indexOf("timeline"));
    expect(ids.indexOf("timeline")).toBeLessThan(ids.indexOf("outcome"));
    cleanup(h);
  });

  it("aborted run timeline labels the result aborted, never pending", () => {
    const h = renderWithRouter(
      <RunDetail
        record={makeFullRecord({
          status: "aborted",
          winnerKeys: [],
          judge: {
            status: "idle",
            acceptedAttemptId: null,
            report: null,
            consensus: null,
            attempts: [],
          },
          completedAt: 1716048060000,
        })}
      />,
    );
    const text = h.$("[data-section='timeline']")?.textContent ?? "";
    expect(text).toContain("aborted by user");
    expect(text).not.toContain("pending");
    // An idle judge on a terminal run never ran — "not run", not "pending".
    expect(text).toContain("not run");
    cleanup(h);
  });

  it("running run timeline keeps pending labels for the judge and result", () => {
    const h = renderWithRouter(
      <RunDetail
        record={makeFullRecord({
          status: "running",
          winnerKeys: [],
          judge: {
            status: "idle",
            acceptedAttemptId: null,
            report: null,
            consensus: null,
            attempts: [],
          },
        })}
      />,
    );
    const text = h.$("[data-section='timeline']")?.textContent ?? "";
    expect(text).toContain("pending");
    expect(text).not.toContain("not run");
    cleanup(h);
  });

  it("fusion section renders only when present", () => {
    // No fusion attempts → no fusion section
    const h1 = renderWithRouter(<RunDetail record={makeFullRecord()} />);
    expect(h1.$("[data-section='fusion']")).toBeNull();
    cleanup(h1);

    // With fusion attempt → fusion section present
    const h2 = renderWithRouter(
      <RunDetail
        record={makeFullRecord({
          fusion: {
            status: "done",
            acceptedAttemptId: "fusion-att-1",
            attempts: [
              {
                attemptId: "fusion-att-1",
                providerId: "openrouter",
                model: "judge-model",
                messages: [{ role: "user", content: "Merge" }],
                sourceJudgeAttemptId: "judge-att-1",
                candidateAttemptIdsByCandidateId: { c1: "att-1" },
                startedAt: 1716048050000,
                finishedAt: 1716048060000,
                status: "completed",
                error: null,
                result: "Fused answer combining all candidates",
              },
            ],
          },
        })}
      />,
    );
    expect(h2.$("[data-section='fusion']")).toBeTruthy();
    cleanup(h2);
  });

  it("outcome section shows every tied winner", () => {
    const h = renderWithRouter(
      <RunDetail
        record={makeFullRecord({
          winnerKeys: ["openrouter:gpt-4o", "umans:claude-opus"],
        })}
      />,
    );
    const outcome = h.$("[data-section='outcome']");
    expect(outcome).toBeTruthy();
    const text = outcome?.textContent ?? "";
    expect(text).toContain("openrouter:gpt-4o");
    expect(text).toContain("umans:claude-opus");
    cleanup(h);
  });

  it("header shows title, status, exact timestamp, and relative time", () => {
    const h = renderWithRouter(<RunDetail record={makeFullRecord()} />);
    const header = h.$("[data-section='header']");
    expect(header).toBeTruthy();
    const text = header?.textContent ?? "";
    expect(text).toContain("Write a Python sort function");
    expect(text).toContain("Completed");
    // Exact timestamp (locale string includes date/time)
    expect(text).toMatch(/\d{4}/); // has a year
    // Relative time as secondary
    expect(text).toMatch(/ago/);
    cleanup(h);
  });

  it("renders start and completion semantic times, terminal age, duration, and timezone", () => {
    const h = renderWithRouter(<RunDetail record={makeFullRecord()} />);
    const header = h.$("[data-section='header']")!;
    expect(header.querySelector('time[data-time="started"]')).not.toBeNull();
    expect(header.querySelector('time[data-time="completed"]')).not.toBeNull();
    expect(header.textContent).toContain("Duration 1m 00s");
    expect(header.textContent).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
    cleanup(h);
  });

  it("uses Ended for a failed record with a completion timestamp", () => {
    const h = renderWithRouter(<RunDetail record={makeFullRecord({ status: "failed" })} />);
    const header = h.$("[data-section='header']")!;
    expect(header.textContent).toContain("Ended");
    expect(header.querySelector('time[data-time="completed"]')).not.toBeNull();
    cleanup(h);
  });

  it("shows running duration without fabricating completion", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1716048045000);
    const h = renderWithRouter(
      <RunDetail record={makeFullRecord({ status: "running", completedAt: null })} />,
    );
    const header = h.$("[data-section='header']")!;
    expect(header.textContent).toContain("Running for 45s");
    expect(header.querySelector('time[data-time="completed"]')).toBeNull();
    expect(header.textContent).not.toContain("Completed");
    cleanup(h);
  });

  it("renders start-only semantics for older records without completedAt", () => {
    const h = renderWithRouter(
      <RunDetail record={makeFullRecord({ status: "interrupted", completedAt: null })} />,
    );
    const header = h.$("[data-section='header']")!;
    expect(header.querySelector('time[data-time="started"]')).not.toBeNull();
    expect(header.querySelector('time[data-time="completed"]')).toBeNull();
    expect(header.textContent).not.toContain("Duration");
    cleanup(h);
  });

  it("candidate section shows blind label mapping", () => {
    const h = renderWithRouter(<RunDetail record={makeFullRecord()} />);
    const text = h.container.textContent ?? "";
    // Blind label A appears, mapped to the candidate
    expect(text).toContain("A");
    cleanup(h);
  });

  it("reused candidates link to the source run evidence (spec §11.4)", () => {
    const record = makeFullRecord({
      candidates: [
        {
          candidateId: "c1",
          slotId: "s1",
          modelKey: "openrouter:gpt-4o",
          providerId: "openrouter",
          model: "GPT-4o",
          slug: "gpt-4o",
          acceptedAttemptId: "att-1",
          attempts: [
            {
              attemptId: "att-1",
              messages: [{ role: "user", content: "Sort the list" }],
              startedAt: 1716048000000,
              finishedAt: 1716048030000,
              status: "completed" as const,
              output: "def bubble_sort(arr):\n    return sorted(arr)",
              tokensIn: 15,
              tokensOut: 30,
              error: null,
              // Compound-repair provenance: copied from an earlier immutable run.
              reusedFrom: {
                sourceRunId: "run-base-1",
                sourceCandidateId: "cand-orig",
                sourceAttemptId: "att-orig",
              },
            },
          ],
        },
      ],
    });
    const h = renderWithRouter(<RunDetail record={record} />);
    const reused = h.$("[data-reused-from]");
    expect(reused).not.toBeNull();
    expect(reused?.textContent).toContain("Reused from prior attempt");
    const link = reused?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/runs/run-base-1");
    expect(link?.textContent).toContain("View source run");
    cleanup(h);
  });

  it("judge evidence section shows accepted attempt and blind-label mapping", () => {
    const h = renderWithRouter(<RunDetail record={makeFullRecord()} />);
    const judge = h.$("[data-section='judge']");
    expect(judge).toBeTruthy();
    const text = judge?.textContent ?? "";
    // Blind label A → candidate c1 mapping is visible
    expect(text).toContain("A");
    cleanup(h);
  });

  it("selected candidate output is visible by default", () => {
    const h = renderWithRouter(<RunDetail record={makeFullRecord()} />);
    const text = h.container.textContent ?? "";
    expect(text).toContain("def bubble_sort");
    cleanup(h);
  });

  it("task/config section is collapsed by default", () => {
    const h = renderWithRouter(<RunDetail record={makeFullRecord()} />);
    const taskConfig = h.$("[data-section='task-config']");
    expect(taskConfig).toBeTruthy();
    // Collapsed — a disclosure must exist and report aria-expanded=false. A
    // missing disclosure must not silently pass (absence is a regression).
    const disclosure = taskConfig?.querySelector("[aria-expanded]");
    expect(disclosure).toBeTruthy();
    expect(disclosure?.getAttribute("aria-expanded")).toBe("false");
    cleanup(h);
  });

  it("shows stage cost breakdown with source badges and incremental total", () => {
    const record = makeFullRecord({
      candidates: [
        {
          candidateId: "c1",
          slotId: "s1",
          modelKey: "openrouter:gpt-4o",
          providerId: "openrouter",
          model: "GPT-4o",
          slug: "gpt-4o",
          acceptedAttemptId: "att-1",
          attempts: [
            {
              attemptId: "att-1",
              messages: [{ role: "user", content: "Sort the list" }],
              startedAt: 1716048000000,
              finishedAt: 1716048030000,
              status: "completed" as const,
              output: "def bubble_sort(arr):\n    return sorted(arr)",
              tokensIn: 15,
              tokensOut: 30,
              error: null,
              cost: { usd: 0.000123, source: "provider-reported" },
            },
          ],
        },
        {
          candidateId: "c2",
          slotId: "s2",
          modelKey: "umans:claude-opus",
          providerId: "umans",
          model: "Claude Opus",
          slug: "claude-opus",
          acceptedAttemptId: "att-reused",
          attempts: [
            {
              attemptId: "att-reused",
              messages: [{ role: "user", content: "x" }],
              startedAt: 1716048000000,
              finishedAt: 1716048030000,
              status: "completed" as const,
              output: "reused",
              tokensIn: 10,
              tokensOut: 20,
              error: null,
              reusedFrom: {
                sourceRunId: "run-base",
                sourceCandidateId: "cand-x",
                sourceAttemptId: "att-x",
              },
            },
          ],
        },
      ],
      judge: {
        status: "done",
        acceptedAttemptId: "judge-att-1",
        report: {
          labelMap: [{ label: "A", candidateId: "c1" }],
          evaluationsById: {
            c1: {
              candidateId: "c1",
              blindLabel: "A",
              overallScore: 4.5,
              position: "First",
              rationale: "Good",
              strengths: [],
              deductions: [],
              missedRequirements: [],
              criterionScores: [],
            },
          },
          comparisons: [],
        },
        consensus: null,
        attempts: [
          {
            attemptId: "judge-att-1",
            providerId: "openrouter",
            model: "judge-model",
            instruction: "Evaluate",
            messages: [{ role: "user", content: "Evaluate" }],
            blindLabelToCandidateId: { A: "c1" },
            candidateAttemptIdsByCandidateId: { c1: "att-1" },
            startedAt: 1716048030000,
            finishedAt: 1716048050000,
            status: "completed",
            error: null,
            report: null,
            consensus: null,
            cost: { usd: 0.000321, source: "provider-reported" },
          },
        ],
      },
      fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    });
    const h = renderWithRouter(<RunDetail record={record} />);
    const costSection = h.$("[data-section='cost-breakdown']");
    expect(costSection).not.toBeNull();
    expect(costSection?.textContent).toContain("openrouter:gpt-4o");
    expect(costSection?.textContent).toContain("Judge");
    expect(costSection?.textContent).toContain("provider-reported");
    // Reused candidate is NOT charged again.
    expect(costSection?.textContent).not.toContain("claude-opus");
    const total = costSection?.querySelector("[data-cost-total]");
    expect(total?.textContent).toContain("0.000444");
    cleanup(h);
  });

  it("shows provider-default for imported records without reasoning provenance", () => {
    const h = renderWithRouter(<RunDetail record={makeFullRecord()} />);
    const disclosure = h.$("[data-section='task-config'] button")!;
    act(() => disclosure.click());
    const provenance = h.$("[data-reasoning-provenance]");
    expect(provenance?.textContent).toContain("requested provider-default");
    expect(provenance?.textContent).toContain("effective provider-default");
    cleanup(h);
  });

  it("experiment-sourced run shows provenance trail with deep links", () => {
    const h = renderWithRouter(
      <RunDetail
        record={makeFullRecord({
          source: {
            kind: "experiment",
            experimentId: "exp-1",
            suiteId: "suite-1",
            suiteVersion: 3,
            protocolFingerprint: "fp-abc",
            taskId: "task-pricing",
            experimentTaskAttemptId: "attempt-2-xyz",
            trial: 1,
          },
        })}
      />,
    );
    const provenance = h.$("[data-section='provenance']");
    expect(provenance).toBeTruthy();
    const text = provenance?.textContent ?? "";
    // "Evaluation" links to the canonical evaluation results route
    const experimentLinks = [...provenance!.querySelectorAll("a[href='/evaluations/results/exp-1']")];
    expect(experimentLinks.some((a) => a.textContent?.trim() === "Evaluation")).toBe(true);
    // Task Set part links to the task set route with its version
    const suiteLink = provenance!.querySelector("a[href='/evaluations/sets/suite-1']");
    expect(suiteLink).toBeTruthy();
    expect(suiteLink?.textContent).toContain("Task Set v3");
    // Task id is visible
    expect(text).toContain("task-pricing");
    // Attempt id is bounded (first 8 chars) with the full value present (sr-only)
    expect(text).toContain("attempt-");
    expect(text).toContain("attempt-2-xyz");
    // Trailing Back to evaluation link
    expect(experimentLinks.some((a) => a.textContent?.includes("Back to evaluation"))).toBe(true);
    cleanup(h);
  });

  it("ad hoc run renders no provenance section", () => {
    const h = renderWithRouter(<RunDetail record={makeFullRecord()} />);
    expect(h.$("[data-section='provenance']")).toBeNull();
    cleanup(h);
  });

  it("focusCandidateId selects, focuses, and scrolls the linked candidate", () => {
    // happy-dom may lack scrollIntoView; stub it so the component's typeof
    // guard passes, then spy on the prototype method.
    if (typeof Element.prototype.scrollIntoView !== "function") {
      Element.prototype.scrollIntoView = () => {};
    }
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    const record = makeFullRecord();
    record.candidates.push({
      candidateId: "c2",
      slotId: "s2",
      modelKey: "openrouter:claude",
      providerId: "openrouter",
      model: "Claude",
      slug: "anthropic/claude",
      acceptedAttemptId: "att-2",
      attempts: [
        {
          attemptId: "att-2",
          messages: [{ role: "user", content: "Sort the list" }],
          startedAt: 1716048000000,
          finishedAt: 1716048030000,
          status: "completed" as const,
          output: "def quick_sort(arr): ...",
          tokensIn: 15,
          tokensOut: 30,
          error: null,
        },
      ],
    });
    const h = renderWithRouter(<RunDetail record={record} focusCandidateId="c2" />);
    const btn = h.$("[data-candidate-id='c2']");
    expect(btn).toBeTruthy();
    // The linked candidate is selected, overriding the default first candidate
    expect(btn!.getAttribute("aria-pressed")).toBe("true");
    // Focus moved to the candidate row button
    expect(document.activeElement).toBe(btn);
    // Scrolled into view
    expect(scrollSpy).toHaveBeenCalled();
    cleanup(h);
  });

  it("focusJudgeAttemptId matching the accepted attempt labels it Selected attempt", () => {
    const h = renderWithRouter(
      <RunDetail record={makeFullRecord()} focusJudgeAttemptId="judge-att-1" />,
    );
    const judge = h.$("[data-section='judge']");
    expect(judge).toBeTruthy();
    expect(judge!.textContent).toContain("Selected attempt");
    expect(judge!.textContent).not.toContain("Historical attempt");
    const panel = h.$("[data-judge-attempt='judge-att-1']");
    expect(panel).toBeTruthy();
    expect(panel!.getAttribute("class") ?? "").toContain("ring-accent");
    cleanup(h);
  });

  it("focusJudgeAttemptId matching a non-accepted attempt labels it historical without changing accepted summary", () => {
    const record = makeFullRecord();
    record.judge.attempts.push({
      ...record.judge.attempts[0],
      attemptId: "judge-att-2",
      instruction: "Earlier judge pass",
    });
    const h = renderWithRouter(<RunDetail record={record} focusJudgeAttemptId="judge-att-2" />);
    const judge = h.$("[data-section='judge']");
    expect(judge).toBeTruthy();
    expect(judge!.textContent).toContain("Historical attempt — accepted summary unchanged");
    const panel = h.$("[data-judge-attempt='judge-att-2']");
    expect(panel).toBeTruthy();
    expect(panel!.getAttribute("class") ?? "").toContain("ring-accent");
    // Accepted attempt panel remains intact and unhighlighted
    const accepted = h.$("[data-judge-attempt='judge-att-1']");
    expect(accepted).toBeTruthy();
    expect(accepted!.getAttribute("class") ?? "").not.toContain("ring-accent");
    cleanup(h);
  });

  it("invalid focus candidate id shows a non-blocking notice and renders normally", () => {
    const h = renderWithRouter(<RunDetail record={makeFullRecord()} focusCandidateId="nope" />);
    const notice = h.$("[data-focus-notice='candidate']");
    expect(notice).toBeTruthy();
    expect(notice!.textContent).toContain("Linked candidate not found");
    expect(notice!.getAttribute("role")).not.toBe("alert");
    // Normal render continues — sections and default selection intact
    expect(h.$("[data-section='candidates']")).toBeTruthy();
    expect(h.container.textContent).toContain("def bubble_sort");
    cleanup(h);
  });

  it("invalid focus judge attempt id shows a non-blocking notice and renders normally", () => {
    const h = renderWithRouter(<RunDetail record={makeFullRecord()} focusJudgeAttemptId="nope" />);
    const notice = h.$("[data-focus-notice='attempt']");
    expect(notice).toBeTruthy();
    expect(notice!.textContent).toContain("Linked judge attempt not found");
    expect(notice!.getAttribute("role")).not.toBe("alert");
    expect(h.$("[data-section='judge']")).toBeTruthy();
    cleanup(h);
  });

  it("missing ID renders not-found state with list link", () => {
    const h = renderWithRouter(<RunDetail record={null} />);
    const text = h.container.textContent ?? "";
    expect(text).toMatch(/not found|unavailable|not-found/i);
    const link = h.$("a[href='/runs']");
    expect(link).toBeTruthy();
    cleanup(h);
  });

  it("uses 13px minimum body text", () => {
    const h = renderWithRouter(<RunDetail record={makeFullRecord()} />);
    const detail = h.$("[data-run-detail]");
    expect(detail).toBeTruthy();
    const classes = (detail?.getAttribute("class") ?? "").split(/\s+/);
    const hasStdSize = classes.includes("text-sm") || classes.includes("text-base");
    expect(hasStdSize).toBe(true);
    cleanup(h);
  });
});

describe("LegacyRunDetail", () => {
  it("renders only known summary fields with limitation message", () => {
    const summary = makeLegacySummary();
    const h = renderWithRouter(<LegacyRunDetail summary={summary} />);
    const text = h.container.textContent ?? "";
    expect(text).toContain("Old run before v2 migration");
    // Explicit limitation message
    expect(text).toMatch(/not captured|unavailable|older format|legacy/i);
    cleanup(h);
  });

  it("does not fabricate status, mode, or evaluation fields", () => {
    const summary = makeLegacySummary();
    const h = renderWithRouter(<LegacyRunDetail summary={summary} />);
    const text = h.container.textContent ?? "";
    // Legacy summaries have no status — don't render "Completed", "Failed", etc.
    expect(text).not.toMatch(/\bCompleted\b/);
    expect(text).not.toMatch(/\bFailed\b/);
    cleanup(h);
  });

  it("renders a link back to the runs list", () => {
    const summary = makeLegacySummary();
    const h = renderWithRouter(<LegacyRunDetail summary={summary} />);
    const link = h.$("a[href='/runs']");
    expect(link).toBeTruthy();
    cleanup(h);
  });

  it("offers Copy link but never Open in Compare (no frozen config in v1)", () => {
    const h = renderWithRouter(<LegacyRunDetail summary={makeLegacySummary()} />);
    expect(h.$('[data-action="copy-link"]')).toBeTruthy();
    // v1 summaries have no frozen config to preload — the action must not
    // exist, not even as a disabled stub with fabricated data.
    expect(h.$('[data-action="open-in-compare"]')).toBeNull();
    expect(h.container.textContent).not.toContain("Open in Compare");
    cleanup(h);
  });
});

describe("RunDetail accessibility (Plan 006 workstream B)", () => {
  it("candidate row buttons contain no nested interactive elements", () => {
    // A CompactModelLabel with its disclosure button used to sit inside the
    // row <button>, producing invalid DOM nesting. The row must stay a single
    // interactive element.
    const h = renderWithRouter(<RunDetail record={makeFullRecord()} />);
    const rows = h.$$("[data-candidate-id]");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tagName).toBe("BUTTON");
      expect(row.querySelector("button, a, input, select, textarea, [role=button]")).toBeNull();
    }
    cleanup(h);
  });

  it("candidate rows expose the full opaque model identity in accessible text", () => {
    const h = renderWithRouter(<RunDetail record={makeFullRecord()} />);
    const row = h.$("[data-candidate-id]");
    expect(row).toBeTruthy();
    // Full providerId:modelSlug identity survives inside the row even though
    // the interactive disclosure is suppressed there.
    expect(row!.querySelector("[data-full-id]")).toBeTruthy();
    expect(row!.textContent).toContain("openrouter");
    cleanup(h);
  });

  it("candidate rows are keyboard-operable buttons with pressed state", () => {
    const h = renderWithRouter(<RunDetail record={makeFullRecord()} />);
    const row = h.$("[data-candidate-id]");
    expect(row).toBeTruthy();
    expect(row!.getAttribute("type")).toBe("button");
    expect(row!.getAttribute("aria-pressed")).toBeTruthy();
    cleanup(h);
  });
});

describe("RunDetail contextual continuity (Slice 5)", () => {
  it("header shows Open in Compare only when the handler is wired", () => {
    const wired = renderWithRouter(
      <RunDetail record={makeFullRecord()} onOpenInCompare={() => undefined} />,
    );
    expect(wired.$('[data-action="open-in-compare"]')).toBeTruthy();
    cleanup(wired);

    // Route-only renders (tests, non-shell embedding) get the honest
    // degradation: no action button without a handler.
    const plain = renderWithRouter(<RunDetail record={makeFullRecord()} />);
    expect(plain.$('[data-action="open-in-compare"]')).toBeNull();
    cleanup(plain);
  });

  it("Open in Compare passes the record id and its frozen config, never results", () => {
    const onOpenInCompare = vi.fn();
    const record = makeFullRecord();
    const h = renderWithRouter(<RunDetail record={record} onOpenInCompare={onOpenInCompare} />);
    const button = h.$('[data-action="open-in-compare"]')!;
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOpenInCompare).toHaveBeenCalledTimes(1);
    const [runId, config] = onOpenInCompare.mock.calls[0] as [string, { prompt: string }];
    expect(runId).toBe(record.id);
    // Frozen task restored from the record.
    expect(config.prompt).toBe(record.task.prompt);
    // The preload carries command-pane inputs only — never results: no
    // candidate attempts, scores, winner keys, or judge report fields.
    const serialized = JSON.stringify(config);
    expect(serialized).not.toContain("winnerKeys");
    expect(serialized).not.toContain("acceptedAttemptId");
    expect(serialized).not.toContain("rationale");
    cleanup(h);
  });

  it("header always offers Copy link for v2 records", () => {
    const h = renderWithRouter(<RunDetail record={makeFullRecord()} />);
    const header = h.$("[data-section='header']")!;
    const copy = header.querySelector('[data-action="copy-link"]');
    expect(copy).toBeTruthy();
    expect(copy?.textContent).toContain("Copy link");
    cleanup(h);
  });
});
