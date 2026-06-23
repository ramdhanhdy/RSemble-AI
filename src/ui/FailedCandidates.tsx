// =============================================================================
// FailedCandidates — a compact disclosure of candidates that errored during a
// run that otherwise succeeded (≥2 done). Errors are visible during the live
// stream but disappeared once the run completed; this keeps them surfaced in the
// final result so the outcome is honest.
// =============================================================================

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Candidate } from "../studio-data";

export function FailedCandidates({ candidates }: { candidates: Candidate[] }) {
  const failed = candidates.filter((c) => c.status === "error");
  if (failed.length === 0) return null;

  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.03]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full min-h-[40px] items-center gap-2 px-3 py-2 text-left hover:bg-rose-500/[0.05]"
      >
        <ChevronRight
          size={13}
          className={`text-rose-400/70 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="font-mono text-xs uppercase tracking-wider text-rose-400">
          {failed.length} candidate{failed.length === 1 ? "" : "s"} failed
        </span>
        <span className="ml-auto font-mono text-sm text-zinc-500">not included in result</span>
      </button>
      {open && (
        <ul className="border-t border-rose-500/20 px-3 py-2">
          {failed.map((c) => (
            <li key={c.id} className="py-1">
              <div className="flex items-center gap-2 font-mono text-sm">
                <span className="size-2 shrink-0 rounded-full bg-rose-400" />
                <span className="text-zinc-300">{c.model}</span>
              </div>
              {c.errorMessage && (
                <p className="mt-1 pl-4 text-sm leading-relaxed text-rose-400/70">
                  {c.errorMessage}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
