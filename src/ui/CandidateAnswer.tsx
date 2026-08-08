// =============================================================================
// CandidateAnswer — collapsible full-answer view for a single candidate.
//
// Used in BOTH modes so a candidate's full generated answer can be read and
// rendered (Markdown, identical to the merged result) — not just its score.
// Shared component keeps Rank and Fuse consistent.
//
// Header: rank badge · model · score · accent dot · chevron · copy (when open).
// Body:   the candidate's full text via <Markdown />.
// =============================================================================

import { useState } from "react";
import { Check, ChevronRight, Copy } from "lucide-react";
import type { Candidate } from "../studio-data";
import { Markdown } from "./Markdown";
import { formatCandidateScoreDisplay } from "../lib/evaluations/evaluation-profile";

function tierColor(score: number): string {
  if (score >= 4.0) return "text-success";
  if (score >= 3.0) return "text-accent";
  return "text-warning";
}

const ACCENT_DOT: Record<string, string> = {
  indigo: "bg-indigo-400",
  emerald: "bg-success",
  violet: "bg-violet-400",
  amber: "bg-warning",
  sky: "bg-sky-400",
  rose: "bg-error",
  teal: "bg-teal-400",
};

export function CandidateAnswer({
  candidate,
  rank,
  defaultOpen = false,
}: {
  candidate: Candidate;
  /** 1-based rank, or undefined when order isn't a ranking (Fuse source list). */
  rank?: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const text = candidate.segments.map((s) => s.text).join("\n\n");

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div
      className={`rounded-lg border bg-card ${rank === 1 ? "border-success/30" : "border-edge"}`}
    >
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex flex-1 min-h-[44px] items-center gap-3 px-3 py-3 text-left hover:bg-card-hover/50"
        >
          <ChevronRight
            size={14}
            className={`shrink-0 text-text-muted transition-transform ${open ? "rotate-90" : ""}`}
          />
          {rank != null && (
            <span
              className={`grid size-5 shrink-0 place-items-center rounded font-mono text-xs ${
                rank === 1 ? "bg-success/20 text-success" : "bg-card-hover text-text-secondary"
              }`}
            >
              {rank}
            </span>
          )}
          <span
            className={`size-2 shrink-0 rounded-full ${ACCENT_DOT[candidate.accent] ?? "bg-text-muted"}`}
          />
          <span className="flex-1 truncate font-mono text-sm text-text" title={candidate.provider}>
            {candidate.model}
          </span>
          {candidate.weightedScore != null && (
            <span className={`shrink-0 font-mono text-sm ${tierColor(candidate.weightedScore)}`}>
              {formatCandidateScoreDisplay(candidate.weightedScore, candidate.scoreDomain)}
            </span>
          )}
        </button>
        {open && (
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? "Copied" : `Copy ${candidate.model} answer`}
            className="flex shrink-0 items-center gap-1 rounded-sm px-3 py-2 font-mono text-sm text-text-secondary hover:text-text"
          >
            {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
            {copied ? "copied" : "copy"}
          </button>
        )}
      </div>

      {open && (
        <div className="border-t border-edge px-3 py-3">
          {text.length > 0 ? (
            <Markdown text={text} />
          ) : (
            <p className="font-mono text-sm text-text-muted">(empty response)</p>
          )}
        </div>
      )}
    </div>
  );
}
