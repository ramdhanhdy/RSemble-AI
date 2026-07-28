// =============================================================================
// FuseResult — the FUSE output surface.
//
// This is the deliverable: one merged answer. Per UI.md §5:
//   5.1  Sticky action bar — Copy · Export .md · word count · Re-fuse.
//   5.2  Merged document — fusedText rendered as Markdown, prose-invert,
//        reading-optimized measure (max-w-[72ch]) with a provenance gutter:
//        a 4px colored tick beside each paragraph indicating which candidate
//        it drew from. Provenance is heuristic (no synthesizer metadata yet) —
//        each block is matched against candidate segments by word overlap, and
//        the best-matching candidate's accent color paints the tick. Hover
//        reveals the source model. No match → neutral gray tick.
//   5.3  Source answers — each candidate's full text, expandable.
//   5.4  Failed candidates — kept visible so a partial run is honest.
//
// No "Frankenstein" manual snippet picker — that interaction is OUT (PRODUCT.md
// §5). Fusion honors the rubric and the synthesizer's judgment only.
// =============================================================================

import { useMemo, useState, type JSX } from "react";
import { Check, Copy, FileDown, Hash, Loader2, RefreshCw } from "lucide-react";
import type { StudioState } from "../studio-engine";
import type { Candidate } from "../studio-data";
import { isUsableCandidate } from "../lib/pipeline";
import { Markdown } from "./Markdown";
import { FailedCandidates } from "./FailedCandidates";
import { CandidateAnswer } from "./CandidateAnswer";
import { BrandAvatar } from "./brand-icons";

export interface FuseResultProps {
  state: StudioState;
  onRefuse?: () => void;
}

export function FuseResult({ state, onRefuse }: FuseResultProps) {
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState(false);
  const text = state.fusedText;

  const doneCandidates = useMemo(
    () => state.candidates.filter(isUsableCandidate),
    [state.candidates],
  );

  const provenanceIndex = useMemo(
    () =>
      doneCandidates.map((c) => ({
        candidate: c,
        segmentTokens: c.segments.map((s) => tokenize(s.text)),
      })),
    [doneCandidates],
  );

  const decorate = (block: JSX.Element, plainText: string, index: number): JSX.Element => {
    const match = matchProvenance(plainText, provenanceIndex);
    const color = match ? (ACCENT_HEX[match.accent] ?? NEUTRAL_TICK) : NEUTRAL_TICK;
    return (
      <div key={index} className="relative flex gap-3">
        <ProvenanceTick color={color} candidate={match} />
        <div className="min-w-0 flex-1">{block}</div>
      </div>
    );
  };

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

  const exportMarkdown = () => {
    if (!text) return;
    const blob = new Blob([text], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rsemble-fused-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setExported(true);
    window.setTimeout(() => setExported(false), 1500);
  };

  if (!text) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-edge py-10 text-center text-sm text-text-muted">
        {state.fusionStatus === "error"
          ? `Fusion failed — ${state.fusionError ?? "unknown error"}`
          : "Fusion has not run for this run yet."}
      </div>
    );
  }

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const refusing = state.fusionStatus === "running";

  return (
    <div className="flex flex-1 flex-col gap-3">
      {/* 5.1–5.2 Merged document with a sticky action bar + provenance gutter */}
      <article className="flex flex-1 flex-col overflow-hidden rounded-lg border border-edge bg-card scroll-thin">
        <div className="flex flex-wrap items-center gap-1 border-b border-edge bg-card px-3 py-2">
          <span className="px-1 font-mono text-xs uppercase tracking-wider text-text-muted">
            Fused answer · markdown
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={copy}
              aria-label={copied ? "Copied" : "Copy fused answer"}
              className="flex min-h-[44px] items-center gap-1.5 rounded-sm px-2 font-mono text-sm text-text-secondary transition-colors hover:text-text"
            >
              {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
              {copied ? "copied" : "copy"}
            </button>
            <button
              type="button"
              onClick={exportMarkdown}
              aria-label="Export fused answer as markdown"
              className="flex min-h-[44px] items-center gap-1.5 rounded-sm px-2 font-mono text-sm text-text-secondary transition-colors hover:text-text"
            >
              {exported ? <Check size={14} className="text-success" /> : <FileDown size={14} />}
              {exported ? "saved" : "export .md"}
            </button>
            <span className="flex min-h-[44px] items-center gap-1 px-2 font-mono text-xs tabular-nums text-text-muted">
              <Hash size={13} />
              {wordCount} {wordCount === 1 ? "word" : "words"}
            </span>
            <button
              type="button"
              onClick={onRefuse}
              disabled={!onRefuse || refusing}
              aria-label="Re-run fusion"
              className="flex min-h-[44px] items-center gap-1.5 rounded-sm px-2 font-mono text-sm text-text-secondary transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
            >
              {refusing ? <Loader2 size={14} className="animate-spin-ease text-accent" /> : <RefreshCw size={14} />}
              re-fuse
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin">
          <div className="mx-auto max-w-[72ch] px-5 py-4">
            <Markdown text={text} blockDecorator={decorate} />
          </div>
        </div>
      </article>

      {/* 5.3 Source answers — each candidate's full text, expandable */}
      <SourceAnswers candidates={state.candidates} />

      {/* 5.4 Failed candidates — kept visible so a partial run is honest */}
      <FailedCandidates candidates={state.candidates} />
    </div>
  );
}


const ACCENT_HEX: Record<string, string> = {
  indigo: "#818cf8",
  emerald: "#34d399",
  violet: "#a78bfa",
  amber: "#fbbf24",
  sky: "#38bdf8",
  rose: "#fb7185",
  teal: "#2dd4bf",
};

const NEUTRAL_TICK = "#3a4f78";

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
}

interface ProvenanceIndex {
  candidate: Candidate;
  segmentTokens: Set<string>[];
}

function matchProvenance(blockText: string, index: ProvenanceIndex[]): Candidate | null {
  const blockWords = tokenize(blockText);
  if (blockWords.size === 0) return null;
  let best: Candidate | null = null;
  let bestScore = 0;
  for (const { candidate, segmentTokens } of index) {
    let candBest = 0;
    for (const segWords of segmentTokens) {
      if (segWords.size === 0) continue;
      let inter = 0;
      for (const w of blockWords) if (segWords.has(w)) inter++;
      const score = inter / blockWords.size;
      if (score > candBest) candBest = score;
    }
    if (candBest > bestScore) {
      bestScore = candBest;
      best = candidate;
    }
  }
  return bestScore >= 0.3 ? best : null;
}

function ProvenanceTick({ color, candidate }: { color: string; candidate: Candidate | null }) {
  return (
    <div className="group/tick relative flex shrink-0">
      <div
        className="w-1 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      {candidate && (
        <div className="pointer-events-none absolute left-2 top-0 z-30 hidden group-hover/tick:flex">
          <div className="flex items-center gap-1.5 rounded-md border border-edge-bright bg-raised px-2 py-1.5 shadow-popover">
            <BrandAvatar slug={candidate.slug} size={18} />
            <span className="whitespace-nowrap font-mono text-xs text-text">{candidate.model}</span>
          </div>
        </div>
      )}
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
      <div className="font-mono text-xs uppercase tracking-wider text-text-muted">
        What fed this fusion · {done.length} candidates · click to read
      </div>
      {done.map((c) => (
        <CandidateAnswer key={c.id} candidate={c} />
      ))}
    </div>
  );
}
