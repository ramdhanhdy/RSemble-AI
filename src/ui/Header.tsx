// =============================================================================
// Header — identity · run status · (children: the ModeToggle) · mobile drawer
// toggle. See UI.md §2. The Rank/Fuse toggle is passed as children so it sits
// inline here, always visible — it is the sole switch in the product.
//
// Responsive (DESIGN.md): on <768px the command pane collapses into a header
// drawer; `onOpenCommand` renders a hamburger button shown only on mobile.
// =============================================================================

import { Menu } from "lucide-react";
import type { ReactNode } from "react";
import type { StudioState } from "../studio-engine";

function statusText(state: StudioState): { label: string; tone: "idle" | "run" | "done" | "error" } {
  if (state.running) {
    const done = state.candidates.filter((c) => c.status === "done").length;
    return { label: `running · ${done}/${state.candidates.length} models`, tone: "run" };
  }
  if (state.judgeStatus === "error" || state.fusionStatus === "error") {
    return { label: "error", tone: "error" };
  }
  if (state.mode === "fuse" && state.fusionStatus === "done") {
    return { label: "fused", tone: "done" };
  }
  if (state.judgeStatus === "done") {
    return { label: "ranked", tone: "done" };
  }
  return { label: "idle", tone: "idle" };
}

const toneDot: Record<string, string> = {
  idle: "bg-zinc-600",
  run: "bg-cyan-400",
  done: "bg-emerald-400",
  error: "bg-rose-400",
};
const toneText: Record<string, string> = {
  idle: "text-zinc-500",
  run: "text-cyan-400",
  done: "text-emerald-400",
  error: "text-rose-400",
};

export function Header({
  state,
  children,
  onOpenCommand,
}: {
  state: StudioState;
  children: ReactNode;
  /** Mobile-only: opens the command drawer (<768px). Undefined hides the button. */
  onOpenCommand?: () => void;
}) {
  const status = statusText(state);
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4">
      <div className="flex items-center gap-2">
        {/* Mobile drawer toggle — visible only <768px (DESIGN.md responsive). */}
        {onOpenCommand && (
          <button
            type="button"
            onClick={onOpenCommand}
            aria-label="Open command pane"
            className="-ml-1 flex h-9 w-9 items-center justify-center rounded text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 md:hidden"
          >
            <Menu size={18} />
          </button>
        )}
        <span className="size-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px] shadow-cyan-400/60" />
        <span className="font-mono text-sm">RSemble AI</span>
      </div>

      <div className="flex items-center gap-4">
        <span
          className={`hidden items-center gap-1.5 font-mono text-sm sm:flex ${toneText[status.tone]}`}
          aria-live="polite"
        >
          <span className={`size-1.5 rounded-full ${toneDot[status.tone]}`} />
          {status.label}
        </span>
        {children}
      </div>
    </header>
  );
}
