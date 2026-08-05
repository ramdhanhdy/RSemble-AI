// =============================================================================
// ExperimentAddModelDialog — extend a terminal experiment with one model
// (roster-extension spec §9 / plan Workstream F2).
//
// Presentational by design: all orchestration (planning, suite sync, controller
// handoff) lives in ExperimentResults. Props are data + callbacks only, so the
// component tests exercise interaction without a repository or controller.
//
// The picker reuses AddModelCombobox unchanged: provider tabs, live catalog
// entries, and raw-slug entry (which keeps the flow usable even when the
// catalog for a ready provider is empty). One committed catalog entry or raw
// slug becomes the single selected ModelSlot; "Change model" returns to the
// picker without generating a second slot.
// =============================================================================

import type { ReactElement } from "react";
import { DialogSurface } from "../../ui/DialogSurface";
import { AddModelCombobox } from "../../ui/ModelList";
import { CompactModelLabel } from "../../ui/CompactModelLabel";
import type { CatalogModel, ProviderId } from "../../lib/providers/types";
import type { ModelSlot } from "../../studio-data";
import type { RosterExtensionPlan } from "../../lib/evaluations/experiment-roster-extension";

export interface AddModelDialogMessage {
  tone: "error" | "warning";
  text: string;
}

export interface ExperimentAddModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Merged catalog entries from all providers (may be empty). */
  models: CatalogModel[];
  /** Providers currently ready, registry order. The first one seeds the
   *  picker so raw-slug entry works even with an empty catalog. */
  availableProviderIds: ProviderId[];
  /** Snapshot roster + extension history keys — excluded from the picker. */
  takenKeys: Set<string>;
  /** Suite display name for the sync checkbox (falls back to suite id). */
  suiteName: string;
  selectedSlot: ModelSlot | null;
  /** Commit a slot from the picker; pass null to return to the picker. */
  onSelectSlot: (slot: ModelSlot | null) => void;
  /** Exact planner preview for the selected slot (null while none/invalid). */
  plan: RosterExtensionPlan | null;
  /** Planner rejection for the selected slot, when planning fails. */
  planError: string | null;
  syncToSuite: boolean;
  onSyncToSuiteChange: (checked: boolean) => void;
  busy: boolean;
  message: AddModelDialogMessage | null;
  onConfirm: () => void;
  onCancel: () => void;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

const ACTION_CLASSES =
  "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50";

const CONFIRM_CLASSES =
  "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-accent/40 bg-accent/[0.06] px-4 text-sm text-accent transition-colors duration-150 hover:bg-accent/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50";

export function ExperimentAddModelDialog({
  open,
  onOpenChange,
  models,
  availableProviderIds,
  takenKeys,
  suiteName,
  selectedSlot,
  onSelectSlot,
  plan,
  planError,
  syncToSuite,
  onSyncToSuiteChange,
  busy,
  message,
  onConfirm,
  onCancel,
}: ExperimentAddModelDialogProps): ReactElement {
  const initialProvider = availableProviderIds[0] ?? "openrouter";
  const confirmDisabled = busy || selectedSlot === null || plan === null;

  return (
    <DialogSurface
      open={open}
      // Escape / backdrop clicks surface here; suppress close while the
      // operation is in flight so a half-started run is never abandoned.
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
      title="Add model to results"
    >
      <div className="flex min-w-0 flex-col gap-4 p-5">
        <h2 className="text-base font-semibold text-text">Add model to results</h2>

        {/* Model picker / committed selection */}
        {selectedSlot === null ? (
          <div className="min-w-0">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">
              Model
            </p>
            <AddModelCombobox
              models={models}
              takenKeys={takenKeys}
              initialProvider={initialProvider}
              commitLabel="Select"
              onCancel={onCancel}
              onAdd={onSelectSlot}
            />
          </div>
        ) : (
          <div className="flex min-h-[44px] min-w-0 flex-wrap items-center gap-2 rounded-md border border-edge bg-panel px-3 py-2">
            <CompactModelLabel providerId={selectedSlot.providerId} slug={selectedSlot.slug} />
            <button
              type="button"
              onClick={() => {
                if (!busy) onSelectSlot(null);
              }}
              disabled={busy}
              className="ml-auto inline-flex min-h-[44px] items-center rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              Change model
            </button>
          </div>
        )}

        {/* Suite sync — checked by default, names the suite explicitly. */}
        <label className="flex min-h-[44px] min-w-0 cursor-pointer items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={syncToSuite}
            disabled={busy}
            onChange={(e) => onSyncToSuiteChange(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent,#c2410c)]"
          />
          Also add to suite <span className="font-medium text-text">{suiteName}</span>
        </label>

        {/* Exact planner preview — counts only, never currency. */}
        {plan ? (
          <div
            data-cost-preview
            className="flex min-w-0 flex-col gap-1 rounded-md border border-edge bg-panel px-3 py-2 text-sm text-text"
          >
            <p>
              {plural(plan.candidateCalls, "candidate call")} +{" "}
              {plural(plan.judgeCalls, "Judge call")} across {plural(plan.taskCount, "task")}.{" "}
              {plural(plan.reusedOutputCount, "accepted candidate output")} will be reused.
            </p>
            {plan.fullRosterFallbackCount > 0 ? (
              <p className="text-text-secondary">
                {plan.fullRosterFallbackCount}{" "}
                {plan.fullRosterFallbackCount === 1 ? "task lacks" : "tasks lack"} reusable
                evidence and will run the full roster (
                {plural(plan.fullRosterCandidateCount, "candidate")} each).
              </p>
            ) : null}
          </div>
        ) : null}
        {planError ? <p className="text-sm text-warning">{planError}</p> : null}

        {/* Single live message region (controller/suite-sync failures). */}
        <div role="alert" aria-live="assertive">
          {message ? (
            <p className={`text-sm ${message.tone === "error" ? "text-warning" : "text-text-secondary"}`}>
              {message.text}
            </p>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className={ACTION_CLASSES}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={CONFIRM_CLASSES}
          >
            {busy ? "Starting…" : "Add and run"}
          </button>
        </div>
      </div>
    </DialogSurface>
  );
}
