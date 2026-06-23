// =============================================================================
// CandidateAnswer — collapsible full-answer view for a single candidate.
//
// Used in BOTH modes so a candidate's full generated answer can be read and
// rendered (Markdown, identical to the merged result) — not just its score.
// Shared component keeps Rank and Fuse consistent.
//
// Header: rank badge · model · score · accent dot · chevron.
// Body:   the candidate's full text via <Markdown />, with a copy affordance.
// =============================================================================

import { useState } from "react";
import { Check, ChevronRight, Copy } from "lucide-react";
import type { Candidate } from "../studio-data";
import { Markdown } from "./Markdown";

function tierColor(score: number): string {
  if (score >= 4.0) return "text-emerald-400";
  if (score >= 3.0) return "text-cyan-400";
  return "text-amber-400";
}

const ACCENT_DOT: Record<string, string> = {
  indigo: "bg-indigo-400",
  emerald: "bg-emerald-400",
  violet: "bg-violet-400",
  amber: "bg-amber-400",
  sky: "bg-sky-400",
  rose: "bg-rose-400",
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
      className={`rounded-lg border bg-zinc-900 ${
        rank === 1 ? "border-emerald-500/30" : "border-zinc-800"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full min-h-[44px] items-center gap-3 px-3 py-3 text-left hover:bg-zinc-800/50"
      >
        <ChevronRight
          size={14}
          className={`shrink-0 text-zinc-500 transition-transform ${open ? "rotate-90" : ""}`}
        />
        {rank != null && (
          <span
            className={`grid size-5 shrink-0 place-items-center rounded font-mono text-xs ${
              rank === 1 ? "bg-emerald-500/20 text-emerald-300" : "bg-zinc-800 text-zinc-400"
            }`}
          >
            {rank}
          </span>
        )}
        <span className={`size-2 shrink-0 rounded-full ${ACCENT_DOT[candidate.accent] ?? "bg-zinc-500"}`} />
        <span className="flex-1 truncate font-mono text-sm text-zinc-100" title={candidate.provider}>
          {candidate.model}
        </span>
        {candidate.weightedScore > 0 && (
          <span className={`shrink-0 font-mono text-sm ${tierColor(candidate.weightedScore)}`}>
            {candidate.weightedScore.toFixed(1)}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-zinc-800 px-3 py-3">
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={copy}
              aria-label={copied ? "Copied" : `Copy ${candidate.model} answer`}
              className="flex min-h-[28px] items-center gap-1 font-mono text-sm text-zinc-500 hover:text-zinc-200"
            >
              {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              {copied ? "copied" : "copy"}
            </button>
          </div>
          {text.length > 0 ? (
            <Markdown text={text} />
          ) : (
            <p className="font-mono text-sm text-zinc-600">(empty response)</p>
          )}
        </div>
      )}
    </div>
  );
}
