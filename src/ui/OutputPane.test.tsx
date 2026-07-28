import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveCandidateCard, scrollLiveTranscriptToEnd, InsufficientState } from "./OutputPane";
import type { Candidate } from "../studio-data";

const candidate: Candidate = {
  id: "live-1",
  model: "Test model",
  provider: "Test provider",
  providerId: "openrouter",
  slug: "test/model",
  accent: "sky",
  strategy: "",
  summary: "",
  scores: {},
  weightedScore: 0,
  segments: [],
  status: "pending",
  streamingText: "Line one\nLine two\nLine three\nLine four\nLine five\nLine six",
  startedAt: 1,
};

describe("LiveCandidateCard streaming transcript", () => {
  it("shows live text without a fade mask or three-line clamp", () => {
    const html = renderToStaticMarkup(<LiveCandidateCard candidate={candidate} now={2_000} />);

    expect(html).toContain("Line six");
    expect(html).not.toContain("fade-mask-bottom");
    expect(html).not.toContain("line-clamp-3");
    expect(html).toContain("overflow-y-auto");
  });

  it("follows the newest generated content", () => {
    const transcript = { scrollTop: 12, scrollHeight: 900 };
    scrollLiveTranscriptToEnd(transcript);
    expect(transcript.scrollTop).toBe(900);
  });
});

// ---------------------------------------------------------------------------
// InsufficientState — terminal 2→1 state must show WHICH model failed and WHY,
// not just an aggregate count. Each failed candidate's model name and error
// message must be visible, and a per-candidate retry must be available.
// ---------------------------------------------------------------------------

function makeFailedCandidate(id: string, model: string, error: string): Candidate {
  return {
    id,
    model,
    provider: "Test",
    providerId: "openrouter",
    slug: `slug-${id}`,
    accent: "rose",
    strategy: "Parallel model",
    summary: "",
    scores: {},
    weightedScore: 0,
    segments: [],
    status: "error",
    errorMessage: error,
    startedAt: 100,
    finishedAt: 200,
  };
}

function makeDoneCandidate(id: string, model: string): Candidate {
  return {
    id,
    model,
    provider: "Test",
    providerId: "openrouter",
    slug: `slug-${id}`,
    accent: "emerald",
    strategy: "Parallel model",
    summary: "good answer",
    scores: {},
    weightedScore: 0,
    segments: [{ id: `${id}-s0`, text: "real answer content" }],
    status: "done",
    startedAt: 100,
    finishedAt: 200,
  };
}

describe("InsufficientState — failed candidate visibility", () => {
  it("shows the failed model name and error message (not just an aggregate count)", () => {
    const failed = makeFailedCandidate("c1", "GPT-5", "rate limit exceeded");
    const html = renderToStaticMarkup(
      <InsufficientState done={1} failed={1} mode="fuse" candidates={[makeDoneCandidate("c2", "Claude"), failed]} />,
    );
    expect(html).toContain("GPT-5");
    expect(html).toContain("rate limit exceeded");
  });

  it("shows multiple failed candidates with their respective model names and errors", () => {
    const failed1 = makeFailedCandidate("c1", "GPT-5", "rate limit exceeded");
    const failed2 = makeFailedCandidate("c2", "Claude", "server error");
    const html = renderToStaticMarkup(
      <InsufficientState done={0} failed={2} mode="rank" candidates={[failed1, failed2]} />,
    );
    expect(html).toContain("GPT-5");
    expect(html).toContain("rate limit exceeded");
    expect(html).toContain("Claude");
    expect(html).toContain("server error");
  });

  it("renders a retry button for each failed candidate when onRetryCandidate is provided", () => {
    const failed = makeFailedCandidate("c1", "GPT-5", "rate limit exceeded");
    const html = renderToStaticMarkup(
      <InsufficientState
        done={1}
        failed={1}
        mode="fuse"
        candidates={[makeDoneCandidate("c2", "Claude"), failed]}
        onRetryCandidate={() => {}}
      />,
    );
    // Retry button must be present and reference the failed model.
    expect(html).toContain("Retry");
    expect(html).toContain("GPT-5");
  });

  it("does not render a retry button when no onRetryCandidate callback is provided", () => {
    const failed = makeFailedCandidate("c1", "GPT-5", "rate limit exceeded");
    const html = renderToStaticMarkup(
      <InsufficientState done={1} failed={1} mode="fuse" candidates={[makeDoneCandidate("c2", "Claude"), failed]} />,
    );
    expect(html).not.toContain("Retry");
  });
});

// ---------------------------------------------------------------------------
// Empty/unusable candidate visibility — a done candidate with empty content
// must be visibly unusable, not silently treated as a successful completion.
// ---------------------------------------------------------------------------

describe("LiveCandidateCard — empty done candidate is visibly unusable", () => {
  it("shows an 'unusable' indicator for a done candidate with empty content", () => {
    const emptyDone: Candidate = {
      ...makeDoneCandidate("c1", "GPT-5"),
      segments: [],
      summary: "",
    };
    const html = renderToStaticMarkup(<LiveCandidateCard candidate={emptyDone} now={200} />);
    // The card must NOT show a success indicator for an empty done candidate.
    // It must show an unusable/empty indicator instead.
    expect(html).toContain("unusable");
  });
});
