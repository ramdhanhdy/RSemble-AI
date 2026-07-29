// =============================================================================
// Header — identity · run status · (children: the ModeToggle) · mobile drawer
// toggle. See UI.md §2. The Rank/Fuse toggle is passed as children so it sits
// inline here, always visible — it is the sole switch in the product.
//
// Responsive (DESIGN.md): on <768px the command pane collapses into a header
// drawer; `onOpenCommand` renders a hamburger button shown only on mobile.
// =============================================================================

import { useEffect, useState } from "react";
import { HelpCircle, Menu } from "lucide-react";
import type { ReactNode } from "react";
import type { StudioState } from "../studio-engine";
import { HexCubeLogo } from "./brand-icons";

export type ConnectionState = "ready" | "running" | "degraded" | "offline";

function livePill(state: StudioState, conn: ConnectionState): { label: string; dot: string; text: string } {
  if (state.running) {
    return { label: "Running", dot: "bg-accent animate-pulse-ease", text: "text-accent" };
  }
  if (conn === "offline") {
    return { label: "No key", dot: "bg-error", text: "text-error" };
  }
  if (conn === "degraded") {
    return { label: "Degraded", dot: "bg-warning", text: "text-warning" };
  }
  return { label: "Live", dot: "bg-success", text: "text-success" };
}

function useRunElapsed(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) {
      setSeconds(0);
      return;
    }
    setSeconds(0);
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  return seconds;
}

export function Header({
  state,
  children,
  onOpenCommand,
  onOpenConnections,
  onOpenPalette,
  onOpenHelp,
  connectionState = "ready",
}: {
  state: StudioState;
  children: ReactNode;
  onOpenCommand?: () => void;
  onOpenConnections?: () => void;
  onOpenPalette?: () => void;
  onOpenHelp?: () => void;
  connectionState?: ConnectionState;
}) {
  const pill = livePill(state, connectionState);
  const elapsed = useRunElapsed(state.running);
  const pillLabel = state.running ? `Running · ${elapsed}s` : pill.label;

  return (
    <header className="relative flex h-14 shrink-0 items-center justify-between gap-2 border-b border-edge bg-shell px-2 sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        {onOpenCommand && (
          <button
            type="button"
            onClick={onOpenCommand}
            aria-label="Open command pane"
            className="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-panel hover:text-text md:hidden"
          >
            <Menu size={18} />
          </button>
        )}
        <HexCubeLogo size={22} className="shrink-0 text-accent" />
        {/* App name is redundant chrome on tight viewports — the logo carries
            identity. Keep it from sm up so the header never clips at 390px. */}
        <span className="hidden text-base font-semibold tracking-tight sm:inline">RSemble AI</span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {onOpenConnections && (
          <button
            type="button"
            onClick={onOpenConnections}
            aria-label={`Connection status: ${pillLabel}. Manage connections.`}
            title="Provider connections"
            className="flex min-h-[44px] items-center gap-2 rounded-full border border-edge bg-panel px-3.5 font-mono text-xs hover:border-edge-bright"
          >
            <span className={`size-2 rounded-full ${pill.dot}`} aria-hidden="true" />
            {/* Label text is hidden on xs — the colored dot carries the status
                and the full label stays in the aria-label. */}
            <span className={`hidden sm:inline ${pill.text}`} aria-live="polite">
              {pillLabel}
            </span>
          </button>
        )}
        <button
          type="button"
          aria-disabled={onOpenPalette ? undefined : true}
          onClick={onOpenPalette}
          aria-label="Command palette"
          title="Command palette (⌘K)"
          className={`hidden min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-3 font-mono text-xs sm:flex ${
            onOpenPalette
              ? "text-text-secondary hover:border-edge-bright"
              : "cursor-not-allowed text-text-secondary opacity-60"
          }`}
        >
          <kbd className="rounded-sm border border-edge bg-card px-1.5 py-0.5">⌘</kbd>
          <kbd className="rounded-sm border border-edge bg-card px-1.5 py-0.5">K</kbd>
        </button>
        <button
          type="button"
          aria-disabled={onOpenHelp ? undefined : true}
          onClick={onOpenHelp}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          className={`hidden h-11 w-11 items-center justify-center rounded-md border border-edge bg-panel sm:flex ${
            onOpenHelp
              ? "text-text-secondary hover:border-edge-bright"
              : "cursor-not-allowed text-text-secondary opacity-60"
          }`}
        >
          <HelpCircle size={16} />
        </button>
        {children}
      </div>

      {state.running && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden">
          <div className="h-full w-1/3 animate-[bg-march_1s_linear_infinite] bg-gradient-to-r from-transparent via-accent to-transparent" style={{ animation: "bg-march 1s linear infinite", backgroundImage: "linear-gradient(90deg, transparent, #22d3ee, transparent)", backgroundSize: "200% 100%" }} />
        </div>
      )}
    </header>
  );
}
