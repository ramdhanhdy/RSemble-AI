// =============================================================================
// HonestValue — the Models workspace's atom (Fable §5.1).
//
// Renders one HonestQuantity in exactly one of three renderings. The three
// states never share a rendering: available is a mono numeral, limited is the
// numeral + unresolved count + dashed warning "limited" marker (D9), and
// unavailable is the word "Unavailable" + an honesty-note reason line — never a
// numeral and never a tooltip-only disclosure.
// =============================================================================

import type { ReactNode } from "react";
import type { HonestQuantity } from "../../lib/model-profiles/coverage-summary";
import { COPY } from "./copy";

interface HonestValueProps {
  quantity: HonestQuantity;
  /** Static text label rendered above the value (text-xs text-text-secondary). */
  label?: string;
}

export function HonestValue({ quantity, label }: HonestValueProps): ReactNode {
  const labelNode = label ? (
    <div className="text-xs text-text-secondary">{label}</div>
  ) : null;

  if (quantity.state === "available") {
    return (
      <div data-honest-state="available">
        {labelNode}
        <div data-honest-value className="font-mono tabular-nums text-text">
          {String(quantity.value)}
        </div>
      </div>
    );
  }

  if (quantity.state === "limited") {
    const reasonId = "honest-value-limited-reason";
    return (
      <div data-honest-state="limited">
        {labelNode}
        <div className="flex flex-wrap items-baseline gap-1">
          <span data-honest-value className="font-mono tabular-nums text-text">
            {String(quantity.value)}
          </span>
          <span className="font-mono tabular-nums text-text-secondary">
            {" "}
            {COPY.honestValue.unresolved(quantity.unresolved)}
          </span>
          <span
            data-limited-marker
            className="text-[10px] font-mono uppercase text-warning border border-dashed border-warning/40 rounded-sm px-1"
            title={quantity.reason}
            aria-describedby={reasonId}
          >
            {COPY.honestValue.limitedMarker}
          </span>
        </div>
        <span data-limited-reason id={reasonId} className="sr-only">
          {quantity.reason}
        </span>
      </div>
    );
  }

  // unavailable
  return (
    <div data-honest-state="unavailable">
      {labelNode}
      <div data-honest-value className="text-text-muted">
        {COPY.honestValue.unavailableWord}
      </div>
      <div className="honesty-note text-xs text-text-muted">{quantity.reason}</div>
    </div>
  );
}
