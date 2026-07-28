// =============================================================================
// Action shortcuts — extracted keyboard shortcut effect from rsemble.tsx.
// =============================================================================

import { useEffect } from "react";
import type { StudioState, Action } from "../studio-engine";

interface ShortcutDeps {
  stateRef: React.MutableRefObject<StudioState>;
  dispatch: React.Dispatch<Action>;
  requestRun: () => void;
  abortRun: () => void;
  handleModeChange: (mode: "rank" | "fuse") => void;
}

export function useActionShortcuts({
  stateRef,
  dispatch,
  requestRun,
  abortRun,
  handleModeChange,
}: ShortcutDeps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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
        const hasSelection = !typing && ((window.getSelection()?.toString() ?? "").length > 0);
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
  }, [stateRef, dispatch, requestRun, abortRun, handleModeChange]);
}
