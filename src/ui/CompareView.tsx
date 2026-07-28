import { useRef, useState, useCallback } from "react";
import { Lock, Unlock, X, Columns2 } from "lucide-react";
import type { Candidate, RubricCriterion } from "../studio-data";
import { isUsableCandidate } from "../lib/pipeline";
import { Markdown } from "./Markdown";
import { BrandAvatar } from "./brand-icons";

function tierColor(score: number): string {
  if (score >= 4.0) return "text-success";
  if (score >= 3.0) return "text-accent";
  return "text-warning";
}

export function CompareView({
  candidates,
  rubric,
  onClose,
}: {
  candidates: Candidate[];
  rubric: RubricCriterion[];
  onClose: () => void;
}) {
  const done = candidates.filter(isUsableCandidate);
  const [synced, setSynced] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const scrollRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const visible = done.filter((c) => !hidden.has(c.id));

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (!synced) return;
      const source = e.currentTarget;
      const sourceMax = source.scrollHeight - source.clientHeight;
      if (sourceMax <= 0) return;
      const progress = source.scrollTop / sourceMax;
      for (const el of scrollRefs.current.values()) {
        if (el && el !== source) {
          const targetMax = el.scrollHeight - el.clientHeight;
          if (targetMax <= 0) continue;
          const targetTop = progress * targetMax;
          // Prevent feedback loop: only write when the difference is meaningful.
          if (Math.abs(el.scrollTop - targetTop) > 1) {
            el.scrollTop = targetTop;
          }
        }
      }
    },
    [synced],
  );

  const toggleHide = (id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (done.length < 2) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-text-secondary">
          Need at least 2 completed candidates to compare.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-[44px] items-center gap-2 rounded-md border border-edge px-4 text-sm text-text-secondary transition-colors hover:bg-card-hover"
        >
          <X size={14} />
          Back to leaderboard
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[44px] items-center gap-2 rounded-md border border-edge px-3 text-sm text-text-secondary transition-colors hover:bg-card-hover"
          >
            <X size={14} />
            Leaderboard
          </button>
          <span className="font-mono text-xs uppercase tracking-wider text-text-muted">
            Compare
          </span>
        </div>
        <button
          type="button"
          onClick={() => setSynced((s) => !s)}
          aria-pressed={synced}
          className="flex min-h-[44px] items-center gap-2 rounded-md border border-edge px-3 text-sm text-text-secondary transition-colors hover:bg-card-hover"
        >
          {synced ? <Lock size={14} /> : <Unlock size={14} />}
          {synced ? "Synced scroll" : "Independent scroll"}
        </button>
      </div>

      {hidden.size > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {done
            .filter((c) => hidden.has(c.id))
            .map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleHide(c.id)}
                className="flex min-h-[36px] items-center gap-1.5 rounded-md border border-edge px-2 text-xs text-text-secondary transition-colors hover:bg-card-hover"
              >
                <BrandAvatar slug={c.slug} size={16} className="rounded-sm" />
                {c.model}
                <Columns2 size={12} />
              </button>
            ))}
        </div>
      )}

      <div
        className="grid flex-1 gap-3 overflow-hidden"
        style={{
          gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))`,
        }}
      >
        {visible.map((c) => {
          const latencyMs =
            c.startedAt && c.finishedAt ? c.finishedAt - c.startedAt : null;
          const text = c.segments.map((s) => s.text).join("\n\n");
          return (
            <div
              key={c.id}
              className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-edge bg-panel"
            >
              <div className="sticky top-0 z-10 border-b border-edge bg-card px-3 py-2">
                <div className="flex items-center gap-2">
                  <BrandAvatar slug={c.slug} size={24} className="rounded-md" />
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-sm text-text"
                    title={c.model}
                  >
                    {c.model}
                  </span>
                  <span
                    className={`font-mono text-sm ${tierColor(c.weightedScore)}`}
                  >
                    {c.weightedScore.toFixed(1)}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleHide(c.id)}
                    aria-label={`Hide ${c.model}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-card-hover"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-text-muted">
                  {latencyMs != null && (
                    <span>{(latencyMs / 1000).toFixed(1)}s</span>
                  )}
                  {c.tokensOut != null && (
                    <>
                      <span aria-hidden>·</span>
                      <span>{c.tokensOut} tok</span>
                    </>
                  )}
                </div>
                {rubric.length > 0 && Object.keys(c.scores ?? {}).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {rubric.map((r) => {
                      const s = c.scores?.[r.label];
                      if (typeof s !== "number") return null;
                      return (
                        <span
                          key={r.id}
                          className={`rounded-sm border border-edge px-1 font-mono text-[11px] tabular-nums ${tierColor(s)}`}
                          title={`${r.label}: ${s.toFixed(1)}`}
                        >
                          {r.label.slice(0, 3)} {s.toFixed(1)}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
              <div
                ref={(el) => {
                  if (el) scrollRefs.current.set(c.id, el);
                  else scrollRefs.current.delete(c.id);
                }}
                onScroll={handleScroll}
                className="min-h-0 flex-1 overflow-y-auto scroll-thin px-3 py-3"
              >
                <Markdown text={text} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
