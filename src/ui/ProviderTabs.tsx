// =============================================================================
// ProviderTabs — the shared responsive provider chooser for both model
// selectors (candidate roster + Judge model).
//
// One source of provider order + display labels, derived from the registry, so
// registering a future provider needs no UI copy in either selector. Renders a
// wrapping grid (not the old single non-wrapping flex row) so every provider —
// including 9Router — stays inside the panel at 390px and at the command pane's
// minimum width. Per UI.md §3.2.1.
// =============================================================================

import { listProviders } from "../lib/providers/registry";
import type { ProviderId } from "../lib/providers/types";

export interface ProviderTabEntry {
  id: ProviderId;
  label: string;
}

/** Single source of provider order + display labels for both model selectors.
 *  Derived from the registry so a newly registered provider appears with no UI
 *  copy. `as const`-stable at module load. */
export const MODEL_PICKER_PROVIDERS: readonly ProviderTabEntry[] = listProviders().map((p) => ({
  id: p.id,
  label: p.label,
}));

/** Display-label lookup for badges/rows, sourced from the same list so the two
 *  selectors never carry divergent label maps. */
export const PROVIDER_LABELS: Record<ProviderId, string> = Object.fromEntries(
  MODEL_PICKER_PROVIDERS.map((p) => [p.id, p.label]),
) as Record<ProviderId, string>;

/**
 * A labelled group of toggle buttons — NOT a `tablist`/`tab`, because the full
 * roving-tabindex arrow-key contract is not implemented. `aria-pressed` exposes
 * the active provider programmatically without claiming tab semantics the
 * keyboard behavior does not satisfy (run-recovery spec §7).
 */
export function ProviderTabs({
  value,
  onChange,
  ariaLabel,
}: {
  value: ProviderId;
  onChange: (providerId: ProviderId) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="mb-2 grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-1 rounded-sm bg-panel p-1 font-mono text-xs"
    >
      {MODEL_PICKER_PROVIDERS.map((p) => {
        const active = value === p.id;
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={active}
            aria-label={`${p.label} provider`}
            onClick={() => onChange(p.id)}
            className={`min-h-[44px] rounded-sm px-1 text-center text-[11px] uppercase tracking-wide transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              active
                ? "bg-accent/15 font-semibold text-accent"
                : "text-text-secondary hover:text-text"
            }`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
