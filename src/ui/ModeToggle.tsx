// =============================================================================
// ModeToggle — the sole switch in the product.
//
// A real radiogroup (arrow-key navigable, aria-checked), per DESIGN.md a11y.
// Active side takes the cyan accent. Flipping it never re-runs the pipeline;
// it only re-targets the Output pane's render. See UI.md §6 for the behavior
// matrix (Rank re-renders from existing Judge results; Fuse may trigger one
// synthesizer pass on first switch).
// =============================================================================

import { useRef } from "react";
import type { Mode } from "../studio-data";

const OPTIONS: { value: Mode; label: string }[] = [
  { value: "rank", label: "Rank" },
  { value: "fuse", label: "Fuse" },
];

export function ModeToggle({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
}) {
  const radiosRef = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = OPTIONS[(index + 1) % OPTIONS.length];
      onChange(next.value);
      radiosRef.current[(index + 1) % OPTIONS.length]?.focus();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const prev = OPTIONS[(index - 1 + OPTIONS.length) % OPTIONS.length];
      onChange(prev.value);
      radiosRef.current[(index - 1 + OPTIONS.length) % OPTIONS.length]?.focus();
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Finish mode"
      className="flex items-center rounded-md border border-zinc-800 bg-zinc-900 p-0.5 font-mono text-sm"
    >
      {OPTIONS.map((opt, i) => {
        const active = mode === opt.value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              radiosRef.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`min-h-[36px] rounded px-3 py-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${
              active
                ? "bg-cyan-500 font-semibold text-zinc-950"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
