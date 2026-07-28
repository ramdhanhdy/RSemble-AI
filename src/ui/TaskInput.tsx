// =============================================================================
// TaskInput — the task prompt textarea. Bound to state.prompt.
// Per UI.md §3.1. Multi-line, fixed 4 rows, autosize deferred.
//
// Includes a one-click "Try an example" control that loads a curated,
// comparison-ready test case from lib/test-cases.ts without spending a provider
// call. Behaviour:
//   - Empty task           → single click fills the first example.
//   - Unedited example      → single click rotates to the next example (no
//     immediate repeat), so the user can browse the catalog with repeated clicks.
//   - User-typed text       → first click arms a "Replace" confirmation (mirrors
//     the ResetButton affordance); a second click within the timeout window
//     replaces the text. This never silently destroys meaningful input.
//
// A11y: explicit <label htmlFor> + id linkage; eyebrow uses text-xs (reserved
// strictly for uppercase metadata labels, DESIGN.md). The example control is a
// real <button> with an aria-label so keyboard/AT users can reach and activate
// it. Its armed state is announced via aria-label and title.
// =============================================================================

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import type { Action } from "../studio-engine";
import { estimateTokens } from "../lib/cost";
import { EXAMPLE_TASKS } from "../lib/test-cases";

export function TaskInput({
  prompt,
  exampleIndex,
  dispatch,
}: {
  prompt: string;
  exampleIndex: number;
  dispatch: React.Dispatch<Action>;
}) {
  const hasText = prompt.trim().length > 0;
  // True when the prompt is still exactly the last-loaded curated example — the
  // user has not edited it, so repeated clicks should rotate, not arm.
  const isUneditedExample =
    exampleIndex >= 0 && EXAMPLE_TASKS[exampleIndex]?.prompt === prompt;
  const [armed, setArmed] = useState(false);

  // Disarm whenever the prompt leaves the "user text that needs confirmation"
  // state — i.e. it became empty, or it became an unedited example again.
  useEffect(() => {
    if (!hasText || isUneditedExample) setArmed(false);
  }, [hasText, isUneditedExample]);

  // Auto-dismiss the armed confirmation after a short window, like ResetButton.
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(id);
  }, [armed]);

  const onClick = () => {
    // Empty task or unedited example: load/rotate immediately, no confirmation.
    if (!hasText || isUneditedExample) {
      setArmed(false);
      dispatch({ type: "LOAD_EXAMPLE" });
      return;
    }
    // User-typed text: require a second click to confirm replacement.
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    dispatch({ type: "LOAD_EXAMPLE", force: true });
  };

  // Static (SSR + initial) affordance text. When the task already holds
  // user-typed text, surface "replace" up front so the user knows clicking arms
  // a confirmation rather than silently overwriting.
  const label = armed ? "Replace current task with an example" : "Try an example";
  const title = armed
    ? "Click again to replace your task with a curated example"
    : hasText && !isUneditedExample
      ? "Replace your task with a curated example (click to confirm)"
      : "Try an example — fill the task with a ready-made comparison case";

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor="prompt"
          className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted"
        >
          Task
        </label>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          title={title}
          className={`flex min-h-[44px] items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
            armed
              ? "border-warning/60 bg-warning/10 text-warning"
              : "border-edge text-text-secondary hover:border-edge-bright hover:text-text"
          }`}
        >
          <Sparkles size={12} aria-hidden="true" />
          {armed ? "Replace" : "Try an example"}
        </button>
      </div>
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
