// =============================================================================
// useDialogA11y — shared dialog behavior for the app's modal surfaces
// (ConnectionsModal, mobile command drawer). The command palette and shortcut
// cheatsheet already carry their own copies; this hook is the single
// implementation for newer dialogs.
//
// Behavior (WAI-ARIA dialog pattern):
// - On open: remembers the triggering element and moves focus into the dialog.
// - Tab / Shift+Tab: traps focus within the dialog.
// - Escape: closes (via onClose).
// - On close: restores focus to the triggering element.
// =============================================================================

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogA11y(
  open: boolean,
  onClose: () => void,
  dialogRef: RefObject<HTMLElement | null>
): void {
  const triggerRef = useRef<HTMLElement | null>(null);

  // Capture the trigger + move initial focus into the dialog on open.
  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    if (!node) return;
    const id = requestAnimationFrame(() => {
      const first = node.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? node).focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open, dialogRef]);

  // Restore focus to the trigger on close.
  useEffect(() => {
    if (open) return;
    triggerRef.current?.focus?.();
  }, [open]);

  // Escape to close + Tab focus trap. Bound on window so focus can never leak
  // out of the dialog no matter where it currently sits.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const node = dialogRef.current;
      if (!node) return;
      const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !node.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !node.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose, dialogRef]);
}
