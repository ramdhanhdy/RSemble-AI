// =============================================================================
// ModelProbeControl — per-slot model-route test action + status (spec §8).
//
// Reads and writes through the shared ModelProbeContext so that the "Test
// selected models" batch runner and credential-save invalidation work
// correctly. Visible text status, not icon-only. The spinner uses the existing
// linear spinner class. No animation on state entry.
// =============================================================================

import { useCallback } from "react";
import { Loader2 } from "lucide-react";
import { useModelProbe, useProbeState, useProviderToken } from "./ModelProbeContext";
import type { ProviderId } from "../lib/providers/types";

export interface ModelProbeControlProps {
  providerId: ProviderId;
  model: string;
  /** Slot label for the accessible name. */
  slotLabel: string;
  /** Disabled when the provider has no key or the slot is not ready. */
  disabled?: boolean;
}

const FAILURE_LABELS: Record<string, string> = {
  unauthorized: "Unauthorized",
  unavailable: "Unavailable",
  "rate-limited": "Rate limited",
  timeout: "Timed out",
  "empty-stream": "Empty stream",
  "protocol-incompatible": "Protocol incompatible",
  network: "Network error",
  unknown: "Failed",
};

export function ModelProbeControl({
  providerId,
  model,
  slotLabel,
  disabled = false,
}: ModelProbeControlProps) {
  const { testOne } = useModelProbe();
  const state = useProbeState(providerId, model);
  // Read the token so React re-renders when the provider's credentials change.
  // The context already resets states on invalidation; this just ensures
  // the component observes the change.
  useProviderToken(providerId);

  const handleTest = useCallback(async () => {
    await testOne(providerId, model);
  }, [testOne, providerId, model]);

  const isTesting = state.kind === "testing";
  const accessibleName = `Test model ${slotLabel}`;
  const statusId = `probe-status-${providerId}-${model}`.replace(/[^a-zA-Z0-9-]/g, "-");

  let statusText = "";
  if (state.kind === "testing") statusText = "Testing…";
  else if (state.kind === "ready") statusText = `Ready · ${state.latencyMs}ms`;
  else if (state.kind === "failed")
    statusText = `${FAILURE_LABELS[state.category] ?? "Failed"} · ${state.message}`;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleTest}
        disabled={disabled || isTesting}
        aria-label={accessibleName}
        aria-describedby={statusId}
        className="inline-flex min-h-[44px] items-center rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
      >
        {isTesting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
        <span>Test model</span>
      </button>
      {state.kind !== "untested" && (
        <span
          id={statusId}
          role={state.kind === "failed" ? "alert" : "status"}
          className="text-xs text-text-muted"
        >
          {statusText}
        </span>
      )}
    </div>
  );
}
