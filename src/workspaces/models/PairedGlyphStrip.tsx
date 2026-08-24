// =============================================================================
// PairedGlyphStrip — Fable §5.7.
//
// Wins/ties/losses as a lettered strip: one size-6 rounded-sm border glyph per
// comparable shared task, containing W / T / L (font-mono text-xs), ordered by
// canonical task id. Color is supplementary (§4.2); the letter is the signal.
// The strip is a role="list" of role="listitem" glyphs whose accessible names
// are full sentences ("Won on task code-transform-03").
// =============================================================================

import type { ReactNode } from "react";
import type { PairedOutcome } from "../../lib/model-profiles/paired-comparison";
import { COPY } from "./copy";

export interface PairedGlyph {
  taskId: string;
  outcome: PairedOutcome;
}

interface PairedGlyphStripProps {
  outcomes: readonly PairedGlyph[];
}

const OUTCOME_VISUALS: Record<PairedOutcome, { letter: string; roleClass: string }> = {
  win: { letter: "W", roleClass: "text-success" },
  tie: { letter: "T", roleClass: "text-text-secondary" },
  loss: { letter: "L", roleClass: "text-error" },
};

export function PairedGlyphStrip({ outcomes }: PairedGlyphStripProps): ReactNode {
  const ordered = [...outcomes].sort((a, b) =>
    a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0,
  );
  return (
    <div data-paired-glyph-strip-wrapper>
      <ol role="list" data-paired-glyph-strip className="flex flex-wrap gap-1">
        {ordered.map(({ taskId, outcome }) => {
          const visual = OUTCOME_VISUALS[outcome];
          return (
            <li
              key={taskId}
              role="listitem"
              data-glyph={outcome}
              data-task-id={taskId}
              aria-label={COPY.pairedGlyphStrip.accessibleName(outcome, taskId)}
              className={`size-6 rounded-sm border border-edge flex items-center justify-center font-mono text-xs ${visual.roleClass}`}
            >
              {visual.letter}
            </li>
          );
        })}
      </ol>
      <p data-paired-legend className="text-xs text-text-secondary">
        {COPY.pairedGlyphStrip.legend}
      </p>
    </div>
  );
}
