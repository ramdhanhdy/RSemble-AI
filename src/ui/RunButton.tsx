// =============================================================================
// RunButton — the primary action. Cyan, disabled until ≥1 model enabled and the
// prompt is non-empty. Executes fanout → Judge (+ fusion if Fuse). Per UI.md §3.4.
// =============================================================================

import { Play, Square } from "lucide-react";
import { estimateAttachmentTokens, estimateRunCost, estimateRunTime } from "../lib/cost";
import type { ProviderId } from "../lib/providers/types";
import type { Attachment } from "../lib/attachments/types";
import type { Mode } from "../studio-data";

export function RunButton({
  running,
  canRun,
  hasPrompt,
  enabledCount,
  enabledSlugs,
  prompt,
  onClick,
  onAbort,
  blockReason,
  attachments,
  mode = "rank",
  judge,
  providerIdsBySlug = {},
}: {
  running: boolean;
  canRun: boolean;
  hasPrompt: boolean;
  enabledCount: number;
  enabledSlugs: string[];
  prompt: string;
  onClick: () => void;
  onAbort: () => void;
  /** Why Run is disabled beyond the base gates (attachments not ready / blocked). */
  blockReason?: string | null;
  attachments?: Attachment[];
  mode?: Mode;
  /** Judge ref for forecast pricing. */
  judge?: { providerId: ProviderId; model: string };
  /** Slug → providerId for exact catalog pricing. */
  providerIdsBySlug?: Record<string, ProviderId>;
}) {
  const attachmentTokens = attachments ? estimateAttachmentTokens(attachments) : 0;
  const cost =
    hasPrompt && enabledCount > 0
      ? estimateRunCost(prompt, enabledSlugs, attachmentTokens, {
          providerIds: providerIdsBySlug,
          mode,
          judgeProvider: judge?.providerId,
          judgeModel: judge?.model,
        })
      : null;
  const time = enabledCount > 0 ? estimateRunTime(enabledSlugs) : 0;

  const costStr = cost?.totalCostUsd != null ? `~$${cost.totalCostUsd.toFixed(2)}` : null;
  const partialCost = cost?.partial === true;
  const timeStr = time > 0 ? `~${time}s` : null;
  const forecast = costStr && timeStr ? `${costStr} · ${timeStr}` : costStr ?? timeStr;

  const caption = running
    ? "Click to stop"
    : !hasPrompt
      ? "Enter a task to run"
      : enabledCount === 0
        ? "Enable at least one model"
        : blockReason
          ? blockReason
          : canRun
            ? `${enabledCount} model${enabledCount === 1 ? "" : "s"} · 1 judge${mode === "fuse" ? " + fusion" : ""}${
                forecast ? ` · ${forecast}${partialCost ? " (partial)" : ""}` : ""
              }`
            : "Waiting for provider connections";

  const look = running
    ? "bg-error/15 text-error"
    : canRun
      ? "bg-accent text-on-accent hover-lift"
      : "cursor-not-allowed border border-edge bg-card text-text-secondary opacity-70";

  return (
    <button
      data-geometry="run-action"
      type="button"
      onClick={running ? onAbort : onClick}
      disabled={!canRun && !running}
      title={!running && blockReason ? blockReason : undefined}
      className={`pressable mt-auto grid min-h-[64px] w-full grid-cols-[1rem_minmax(0,1fr)_53px] items-center gap-3 rounded-md px-4 text-left ${look}`}
    >
      {running ? (
        <Square size={16} className="shrink-0" />
      ) : (
        <Play size={16} className="shrink-0" />
      )}
      <span data-geometry="run-label" className="min-w-0">
        <span className="block text-sm font-semibold">{running ? "Stop run" : "Run pipeline"}</span>
        <span className={`mt-0.5 block truncate text-xs tabular-nums ${canRun || running ? "text-on-accent/80" : ""}`}>
          {caption}
        </span>
      </span>
      <span data-geometry="run-shortcut" className="flex h-[22px] w-[53px] shrink-0 items-center">
        {canRun && !running && (
          <kbd className="flex w-full items-center gap-1 rounded-sm bg-black/25 px-1.5 py-0.5 font-mono text-xs text-white/90">
            ⌘ Enter
          </kbd>
        )}
      </span>
    </button>
  );
}
