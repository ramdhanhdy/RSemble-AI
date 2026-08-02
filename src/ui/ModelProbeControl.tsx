// =============================================================================
// ModelProbeControl — per-slot model-route test action + status (spec §8).
//
// Owns one slot's ephemeral probe state and calls probeModelRoute through the
// real streaming adapter. Visible text status, not icon-only. The spinner uses
// the existing linear spinner class. No animation on state entry.
//
// Probe state is ephemeral session state — never persisted or exported.
// A result is invalidated when the slot provider/slug changes or when the
// parent passes a new invalidation token (credential save/clear).
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { getProvider } from "../lib/providers/registry";
import { probeModelRoute, type ModelProbeState } from "../lib/providers/model-probe";
import type { ProviderId } from "../lib/providers/types";

export interface ModelProbeControlProps {
  providerId: ProviderId;
  model: string;
  /** Slot label for the accessible name. */
  slotLabel: string;
  /** Incremented by the parent when a credential is saved/cleared. */
  invalidationToken?: number;
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
  invalidationToken = 0,
  disabled = false,
}: ModelProbeControlProps) {
  const [state, setState] = useState<ModelProbeState>({ kind: "untested" });
  const lastToken = useRef(invalidationToken);
  const lastKey = useRef(`${providerId}:${model}`);

  // Invalidate on provider/slug change or credential token change.
  useEffect(() => {
    const currentKey = `${providerId}:${model}`;
    if (currentKey !== lastKey.current || invalidationToken !== lastToken.current) {
      setState({ kind: "untested" });
      lastKey.current = currentKey;
      lastToken.current = invalidationToken;
    }
  }, [providerId, model, invalidationToken]);

  const handleTest = useCallback(async () => {
    const provider = getProvider(providerId);
    setState({ kind: "testing", startedAt: Date.now() });
    const result = await probeModelRoute({
      provider,
      providerId,
      model,
    });
    setState(result);
  }, [providerId, model]);

  const isTesting = state.kind === "testing";
  const accessibleName = `Test model ${slotLabel}`;
  const statusId = `probe-status-${providerId}-${model}`.replace(/[^a-zA-Z0-9-]/g, "-");

  let statusText = "";
  if (state.kind === "testing") statusText = "Testing…";
  else if (state.kind === "ready") statusText = `Ready · ${state.latencyMs}ms`;
  else if (state.kind === "failed") statusText = `${FAILURE_LABELS[state.category] ?? "Failed"} · ${state.message}`;

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
        {isTesting ? (
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        ) : null}
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
