// =============================================================================
// RunButton — the primary action. Cyan, disabled until ≥1 model enabled and the
// prompt is non-empty. Executes fanout → Judge (+ fusion if Fuse). Per UI.md §3.4.
// =============================================================================

import { Play, Square } from "lucide-react";
import { estimateRunCost, estimateRunTime } from "../lib/cost";

export function RunButton({
  running,
  canRun,
  hasPrompt,
  enabledCount,
  enabledSlugs,
  prompt,
  onClick,
  onAbort,
}: {
  running: boolean;
  canRun: boolean;
  hasPrompt: boolean;
  enabledCount: number;
  enabledSlugs: string[];
  prompt: string;
  onClick: () => void;
  onAbort: () => void;
}) {
  const cost = hasPrompt && enabledCount > 0 ? estimateRunCost(prompt, enabledSlugs) : null;
  const time = enabledCount > 0 ? estimateRunTime(enabledSlugs) : 0;

  const costStr = cost?.totalCostUsd != null ? `~$${cost.totalCostUsd.toFixed(2)}` : null;
  const timeStr = time > 0 ? `~${time}s` : null;
  const forecast = costStr && timeStr ? `${costStr} · ${timeStr}` : costStr ?? timeStr;

  const caption = running
    ? "Click to stop"
    : !hasPrompt
      ? "Enter a task to run"
      : enabledCount === 0
        ? "Enable at least one model"
        : canRun
          ? `${enabledCount} model${enabledCount === 1 ? "" : "s"} · 1 judge${forecast ? ` · ${forecast}` : ""}`
          : "Waiting for provider connections";

  const look = running
    ? "bg-gradient-to-br from-accent to-[#14b8a6] text-on-accent saturate-50"
    : canRun
      ? "bg-gradient-to-br from-accent to-[#14b8a6] text-on-accent hover:-translate-y-0.5 hover:shadow-cta active:translate-y-0"
      : "border border-edge bg-card text-text-secondary opacity-70 cursor-not-allowed";

  return (
    <button
      type="button"
      onClick={running ? onAbort : onClick}
      disabled={!canRun && !running}
      className={`mt-auto flex min-h-[64px] w-full items-center gap-3 rounded-md px-4 text-left transition-[transform,box-shadow,background-color] ease-out duration-150 ${look}`}
    >
      {running ? (
        <Square size={16} className="shrink-0" />
      ) : (
        <Play size={16} className="shrink-0" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{running ? "Stop run" : "Run pipeline"}</span>
        <span className={`mt-0.5 block truncate text-xs tabular-nums ${canRun || running ? "text-on-accent/80" : ""}`}>
          {caption}
        </span>
      </span>
      {canRun && !running && (
        <kbd className="flex shrink-0 items-center gap-1 rounded-sm bg-black/25 px-1.5 py-0.5 font-mono text-xs text-white/90">
          ⌘ Enter
        </kbd>
      )}
    </button>
  );
}
