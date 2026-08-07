// =============================================================================
// ExperimentRecoveryDialog — shared recovery confirmation (spec §11).
//
// Drives the three terminal recovery actions (spec §11.1):
//   repair-cell — targeted missing-cell repair with exact planner counts;
//   repair-all  — batch repair of every repairable no-score cell;
//   retry-task  — full-roster fallback when targeted repair is unsafe.
//
// The cost preview renders EXACT candidate/Judge call counts from the pure
// planner plan (spec §11.7). It never invents a currency estimate: pricing
// data does not cover every involved model, so no $ amount is shown.
// =============================================================================

import type { ReactElement } from "react";
import { DialogSurface } from "../../ui/DialogSurface";
import type { CompoundRepairPlan } from "../../lib/evaluations/experiment-repair";

export type RecoveryDialogVariant = "repair-cell" | "repair-all" | "retry-task";

/** Aggregate planner counts for the batch "Repair all" action. */
export interface RepairAllSummary {
  taskCount: number;
  candidateCalls: number;
  judgeCalls: number;
  reusedCount: number;
}

export interface ExperimentRecoveryMessage {
  tone: "success" | "error";
  text: string;
}

export interface ExperimentRecoveryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which recovery action this dialog drives (spec §11.1). */
  variant: RecoveryDialogVariant;
  /** Planner plan for a single-cell repair (present when variant is repair-cell). */
  plan: CompoundRepairPlan | null;
  /** Aggregate planner counts for the batch action (present when variant is repair-all). */
  summary: RepairAllSummary | null;
  /** Task label used in the repair-cell / retry-task copy. */
  taskTitle: string;
  /** Model key label used in the repair-cell copy. */
  modelLabel: string;
  /** True while the controller runs the operation. */
  busy: boolean;
  /** Operation result rendered as a live alert inside the dialog. */
  message: ExperimentRecoveryMessage | null;
  onConfirm: () => void;
}

const TITLES: Record<RecoveryDialogVariant, string> = {
  "repair-cell": "Complete missing result",
  "repair-all": "Repair all missing results",
  "retry-task": "Retry incomplete task",
};

const CONFIRM_LABELS: Record<RecoveryDialogVariant, string> = {
  "repair-cell": "Start repair",
  "repair-all": "Start repair",
  "retry-task": "Retry task",
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

const ACTION_CLASSES =
  "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50";

const CONFIRM_CLASSES =
  "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-accent/40 bg-accent/[0.06] px-4 text-sm text-accent transition-colors duration-150 hover:bg-accent/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50";

export function ExperimentRecoveryDialog({
  open,
  onOpenChange,
  variant,
  plan,
  summary,
  taskTitle,
  modelLabel,
  busy,
  message,
  onConfirm,
}: ExperimentRecoveryDialogProps): ReactElement {
  const title = TITLES[variant];
  return (
    <DialogSurface open={open} onOpenChange={onOpenChange} title={title}>
      <div className="flex min-w-0 flex-col gap-4 p-5">
        <h2 className="text-base font-semibold text-text">{title}</h2>
        <div className="flex min-w-0 flex-col gap-2 text-sm text-text-secondary">
          {variant === "repair-cell" && plan ? (
            <>
              <p>
                Repair the missing result for{" "}
                <span className="font-mono text-text">{modelLabel}</span> in {taskTitle}. Accepted
                candidate outputs from the selected run are reused with provenance; only the missing
                model runs fresh.
              </p>
              <p
                data-cost-preview
                className="rounded-md border border-edge bg-panel px-3 py-2 text-text"
              >
                {plural(plan.candidateCalls, "candidate call")} +{" "}
                {plural(plan.judgeCalls, "Judge call")} across 1 task. {plan.reusedModelKeys.length}{" "}
                candidate output
                {plan.reusedModelKeys.length === 1 ? "" : "s"} will be reused.
              </p>
            </>
          ) : null}
          {variant === "repair-all" && summary ? (
            <>
              <p>
                Repair every repairable missing result in one pass. Accepted candidate outputs are
                reused with provenance; only missing model keys run fresh.
              </p>
              <p
                data-cost-preview
                className="rounded-md border border-edge bg-panel px-3 py-2 text-text"
              >
                {plural(summary.candidateCalls, "candidate call")} +{" "}
                {plural(summary.judgeCalls, "Judge call")} across{" "}
                {plural(summary.taskCount, "task")}. {summary.reusedCount} candidate output
                {summary.reusedCount === 1 ? "" : "s"} will be reused.
              </p>
            </>
          ) : null}
          {variant === "retry-task" ? (
            <p>
              Targeted repair is not safe for {taskTitle || "this task"} — retry it with the full
              candidate roster instead. This also retries every other incomplete task in the
              experiment.
            </p>
          ) : null}
          {message ? (
            <p
              role="alert"
              data-recovery-message
              className={`text-xs ${message.tone === "error" ? "text-warning" : "text-success"}`}
            >
              {message.text}
            </p>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className={ACTION_CLASSES}
          >
            Cancel
          </button>
          <button
            type="button"
            data-recovery-confirm
            onClick={onConfirm}
            disabled={busy}
            className={CONFIRM_CLASSES}
          >
            {busy ? "Starting…" : CONFIRM_LABELS[variant]}
          </button>
        </div>
      </div>
    </DialogSurface>
  );
}
