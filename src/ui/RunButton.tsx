// =============================================================================
// RunButton — the primary action. Cyan, disabled until ≥1 model enabled and the
// prompt is non-empty. Executes fanout → Judge (+ fusion if Fuse). Per UI.md §3.4.
// =============================================================================

import { Loader2 } from "lucide-react";

export function RunButton({
  running,
  canRun,
  enabledCount,
  onClick,
}: {
  running: boolean;
  canRun: boolean;
  enabledCount: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!canRun}
      // min-h-[44px] guarantees the DESIGN.md touch target even with short labels.
      className="mt-auto inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition-all ease-out duration-200 hover:scale-[1.02] hover:bg-cyan-400 hover:shadow-lg hover:shadow-cyan-500/20 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 disabled:cursor-not-allowed disabled:bg-cyan-500/20 disabled:text-cyan-300/60 disabled:shadow-none disabled:ring-1 disabled:ring-cyan-500/20"
    >
      {running && <Loader2 size={15} className="animate-spin-ease" />}
      {running ? "Running…" : "Run pipeline"}
      {!running && enabledCount > 0 && (
        <span className="font-mono text-sm text-zinc-900/60">{enabledCount} models</span>
      )}
    </button>
  );
}
