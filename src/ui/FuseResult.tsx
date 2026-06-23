// =============================================================================
// FuseResult — the FUSE output surface.
//
// This is the deliverable: one merged answer. Three regions, per UI.md §5:
//   5.1  Output header — "Fused answer · markdown" label + copy action.
//   5.2  Merged document — fusedText rendered as Markdown, prose-invert,
//        comfortable reading width. Typography is the priority here.
//   5.3  Per-candidate scores — collapsed <details>, so the user can see what
//        fed the fusion without it dominating the reading surface.
//
// No "Frankenstein" manual snippet picker — that interaction is OUT (PRODUCT.md
// §5). Fusion honors the rubric and the synthesizer's judgment only.
// =============================================================================

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { StudioState } from "../studio-engine";
import type { Candidate } from "../studio-data";
import { Markdown } from "./Markdown";
import { FailedCandidates } from "./FailedCandidates";
import { CandidateAnswer } from "./CandidateAnswer";

export function FuseResult({ state }: { state: StudioState }) {
  const [copied, setCopied] = useState(false);
  const text = state.fusedText;

  const copy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — non-fatal */
    }
  };

  if (!text) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-800 py-10 text-center text-sm text-zinc-500">
        {state.fusionStatus === "error"
          ? `Fusion failed — ${state.fusionError ?? "unknown error"}`
          : "Fusion has not run for this run yet."}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      {/* 5.1 Output header */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-wider text-zinc-500">
          Fused answer · markdown
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy fused answer"}
          className="flex min-h-[28px] items-center gap-1 font-mono text-sm text-zinc-500 transition-colors hover:text-zinc-200"
        >
          {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
          {copied ? "copied" : "copy"}
        </button>
      </div>

      {/* 5.2 Merged document */}
      <article className="flex-1 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4 scroll-thin">
        <Markdown text={text} />
      </article>

      {/* 5.3 Source answers — each candidate's full text, expandable */}
      <SourceAnswers candidates={state.candidates} />

      {/* 5.4 Failed candidates — kept visible so a partial run is honest */}
      <FailedCandidates candidates={state.candidates} />
    </div>
  );
}

function SourceAnswers({ candidates }: { candidates: Candidate[] }) {
  const done = candidates
    .filter((c) => c.status === "done")
    .sort((a, b) => b.weightedScore - a.weightedScore);
  if (done.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="font-mono text-xs uppercase tracking-wider text-zinc-500">
        What fed this fusion · {done.length} candidates · click to read
      </div>
      {done.map((c) => (
        <CandidateAnswer key={c.id} candidate={c} />
      ))}
    </div>
  );
}
