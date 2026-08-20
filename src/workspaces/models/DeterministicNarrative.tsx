// =============================================================================
// DeterministicNarrative — Fable §5.8.
//
// A bordered-left block (border-l-2 border-edge pl-3), ≤5 sentences (cap §12.4),
// each a button: sentence text + trailing source chip (font-mono text-[10px]
// text-text-muted, the sourceMetricKey). Clicking narrows the evidence table
// exactly as a ClaimMark does. The block header reads "OVERVIEW —
// TEMPLATE-GENERATED"; its footer is an honesty-note.
// =============================================================================

import type { ReactNode } from "react";
import type { ClaimSentence } from "../../lib/model-profiles/profile-claims";
import { COPY } from "./copy";

interface DeterministicNarrativeProps {
  sentences: readonly ClaimSentence[];
  onApplySource?: (sourceMetricKey: string) => void;
}

const MAX_NARRATIVE_SENTENCES = 5;

export function DeterministicNarrative({
  sentences,
  onApplySource,
}: DeterministicNarrativeProps): ReactNode {
  const capped = sentences.slice(0, MAX_NARRATIVE_SENTENCES);
  return (
    <section data-deterministic-narrative className="border-l-2 border-edge pl-3">
      <h3
        data-narrative-header
        className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted"
      >
        {COPY.deterministicNarrative.header}
      </h3>
      <ul className="mt-2 space-y-2">
        {capped.map((sentence, i) => (
          <li key={`${sentence.sourceMetricKey}-${i}`}>
            <button
              type="button"
              data-narrative-sentence
              className="pressable text-left text-sm text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
              onClick={() => onApplySource?.(sentence.sourceMetricKey)}
            >
              <span>{sentence.text}</span>
              <span data-source-chip className="ml-1 font-mono text-[10px] text-text-muted">
                {sentence.sourceMetricKey}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p data-narrative-footer className="honesty-note mt-2 text-xs text-text-muted">
        {COPY.deterministicNarrative.footer}
      </p>
    </section>
  );
}
