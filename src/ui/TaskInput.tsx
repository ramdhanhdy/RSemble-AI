// =============================================================================
// TaskInput — the task prompt textarea. Bound to state.prompt.
// Per UI.md §3.1. Multi-line, fixed 4 rows, autosize deferred.
//
// A11y: explicit <label htmlFor> + id linkage; eyebrow uses text-xs (reserved
// strictly for uppercase metadata labels, DESIGN.md).
// =============================================================================

import type { Action } from "../studio-engine";
import { estimateTokens } from "../lib/cost";

export function TaskInput({
  prompt,
  dispatch,
}: {
  prompt: string;
  dispatch: React.Dispatch<Action>;
}) {
  return (
    <div>
      <label htmlFor="prompt" className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
        Task
      </label>
      <div className="relative mt-2">
        <textarea
          id="prompt"
          aria-label="Task"
          rows={4}
          value={prompt}
          onChange={(e) => dispatch({ type: "SET_PROMPT", value: e.target.value })}
          placeholder="Describe the task — e.g. write a 600-word article on…"
          className="w-full resize-y rounded-md border border-edge bg-card px-3 py-3 pb-7 text-sm text-text placeholder-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <Counter value={prompt} />
      </div>
    </div>
  );
}

function Counter({ value }: { value: string }) {
  const tokens = estimateTokens(value);
  return (
    <span className="pointer-events-none absolute bottom-2.5 right-3 font-mono text-xs tabular-nums text-text-muted">
      ~{tokens} tokens
    </span>
  );
}
