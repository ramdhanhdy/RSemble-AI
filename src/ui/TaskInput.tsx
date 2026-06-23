// =============================================================================
// TaskInput — the task prompt textarea. Bound to state.prompt.
// Per UI.md §3.1. Multi-line, fixed 4 rows, autosize deferred.
//
// A11y: explicit <label htmlFor> + id linkage; eyebrow uses text-xs (reserved
// strictly for uppercase metadata labels, DESIGN.md).
// =============================================================================

import type { Action } from "../studio-engine";

export function TaskInput({
  prompt,
  dispatch,
}: {
  prompt: string;
  dispatch: React.Dispatch<Action>;
}) {
  return (
    <div>
      <label htmlFor="prompt" className="font-mono text-xs uppercase tracking-wider text-zinc-500">
        Task
      </label>
      <textarea
        id="prompt"
        rows={4}
        value={prompt}
        onChange={(e) => dispatch({ type: "SET_PROMPT", value: e.target.value })}
        placeholder="Describe the task — e.g. write a 600-word article on…"
        className="mt-2 w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-3 text-sm text-zinc-100 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
      />
    </div>
  );
}
