// =============================================================================
// Action shortcuts — extracted keyboard shortcut effect from rsemble.tsx.
//
// REV-5 (Child 06 T12, spec §15.12): Compare pipeline shortcuts fire ONLY on
// routes that own live Compare execution. `deriveWorkspace` is the explicit
// routing/ownership rule — an opt-in whitelist, not a "compare" default with a
// "lab" arm bolted on. Every route that does not own live Compare execution
// (/runs, /evaluations, /experiments, /lab, /tasks, /compare/results/*, and
// unknown routes) maps to a non-compare workspace so the listener below and
// the command palette suppress Compare-only actions there.
// =============================================================================

import { useEffect } from "react";
import type { StudioState, Action } from "../studio-engine";

/** Workspaces routed by the app shell. Compare is the only workspace whose
 *  pipeline shortcuts (⌘Enter, ⌘/, ⌘1–9, ⌘F, ⌘C) may fire. `"other"` covers
 *  every route that owns no named workspace and must not inherit Compare
 *  shortcuts — /lab, /tasks, /compare/results/*, and unknown routes. */
export type WorkspaceKind = "compare" | "runs" | "evaluations" | "experiments" | "other";

/**
 * Explicit routing/ownership rule (REV-5, spec §15.12). Compare pipeline
 * shortcuts are enabled only on routes that own live Compare execution —
 * Compare home (`/compare`, and `/` which redirects there). The named
 * non-compare workspaces are matched by their route prefix; every other route
 * (including `/lab`, `/tasks`, `/compare/results/*`, and unknown paths) maps
 * to `"other"` so Compare actions are suppressed there.
 *
 * This is a pure function so route-classifier tests can probe it directly
 * without mounting the listener.
 */
export function deriveWorkspace(pathname: string): WorkspaceKind {
  // Compare home owns live execution. `/` redirects to `/compare` (app-router)
  // so it is treated as Compare home too. `/compare/results/*` is a historical
  // result viewer — it does NOT own live execution and must fall through to
  // "other".
  if (pathname === "/compare" || pathname === "/" || pathname === "/compare/") {
    return "compare";
  }
  if (pathname.startsWith("/runs")) return "runs";
  if (pathname.startsWith("/evaluations")) return "evaluations";
  if (pathname.startsWith("/experiments")) return "experiments";
  // Every remaining route owns no live Compare execution: /lab, /tasks,
  // /compare/results/*, and unknown paths. Shortcuts and the command palette
  // suppress Compare-only actions here.
  return "other";
}

interface ShortcutDeps {
  stateRef: React.MutableRefObject<StudioState>;
  /** Live workspace ref — read per keystroke so route changes gate shortcuts
   *  without remounting the listener (spec §15.12). */
  workspaceRef: { current: WorkspaceKind };
  dispatch: React.Dispatch<Action>;
  requestRun: () => void;
  abortRun: () => void;
  handleModeChange: (mode: "rank" | "fuse") => void;
}

export function useActionShortcuts({
  stateRef,
  workspaceRef,
  dispatch,
  requestRun,
  abortRun,
  handleModeChange,
}: ShortcutDeps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Every binding below drives the Compare pipeline, so outside Compare
      // none of them may fire (spec §15.12 — workspace-aware shortcuts).
      if (workspaceRef.current !== "compare") return;

      const mod = e.metaKey || e.ctrlKey;
      const s = stateRef.current;

      // ⌘Enter — run / abort pipeline.
      if (mod && e.key === "Enter") {
        e.preventDefault();
        if (s.running) abortRun();
        else requestRun();
        return;
      }

      // ⌘/ — toggle Rank ↔ Fuse.
      if (mod && e.key === "/") {
        e.preventDefault();
        handleModeChange(s.mode === "rank" ? "fuse" : "rank");
        return;
      }

      // ⌘1 … ⌘9 — toggle model slot n (1-indexed).
      if (mod && e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key, 10) - 1;
        const slot = s.slots[idx];
        if (slot) {
          e.preventDefault();
          dispatch({ type: "TOGGLE_SLOT", id: slot.id });
        }
        return;
      }

      // ⌘F — focus the task input.
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        const textareas = document.querySelectorAll<HTMLTextAreaElement>("#prompt");
        for (const ta of textareas) {
          if (ta.offsetParent !== null) {
            ta.focus();
            break;
          }
        }
        return;
      }

      // ⌘C — copy the winner (rank) or fused answer (fuse) to clipboard.
      if (mod && e.key.toLowerCase() === "c") {
        const t = e.target as HTMLElement | null;
        const tag = t?.tagName;
        const typing = tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable;
        const hasSelection = !typing && (window.getSelection()?.toString() ?? "").length > 0;
        if (typing || hasSelection) return;
        const text =
          s.mode === "fuse" && s.fusedText
            ? s.fusedText
            : [...s.candidates]
                .filter((c) => c.status === "done")
                .sort((a, b) => b.weightedScore - a.weightedScore)[0]
                ?.segments?.map((seg) => seg.text)
                .join("\n\n");
        if (text) {
          e.preventDefault();
          void navigator.clipboard.writeText(text);
        }
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [stateRef, workspaceRef, dispatch, requestRun, abortRun, handleModeChange]);
}
