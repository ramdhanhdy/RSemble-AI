import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveCandidateCard, scrollLiveTranscriptToEnd } from "./OutputPane";
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
