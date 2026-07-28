// =============================================================================

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface ShortcutCheatsheetProps {
  open: boolean;
  onClose: () => void;
}

interface Shortcut {
  keys: string[];
  action: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: ["⌘", "K"], action: "Command palette" },
  { keys: ["⌘", "↵"], action: "Run / re-run pipeline" },
  { keys: ["Esc"], action: "Abort run · close dialog" },
  { keys: ["⌘", "\\"], action: "Toggle focus mode" },
  { keys: ["⌘", "/"], action: "Toggle Rank ↔ Fuse" },
  { keys: ["⌘", "1…9"], action: "Toggle model n" },
  { keys: ["⌘", "F"], action: "Focus task input" },
  { keys: ["⌘", "C"], action: "Copy winner / fused answer" },
  { keys: ["?"], action: "This cheatsheet" },
];

export function ShortcutCheatsheet({ open, onClose }: ShortcutCheatsheetProps) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement;
      const id = requestAnimationFrame(() => closeBtnRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      triggerRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    if (!node) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusable = node.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    node.addEventListener("keydown", handler);
    return () => node.removeEventListener("keydown", handler);
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-edge-bright bg-raised shadow-popover motion-safe:animate-cmd-pop"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center justify-between border-b border-edge px-5 py-3.5">
          <h2 className="font-mono text-base font-semibold text-text">Keyboard Shortcuts</h2>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts"
            className="flex h-11 w-11 items-center justify-center rounded-md text-text-secondary hover:bg-card-hover hover:text-text"
          >
            <X size={15} />
          </button>
        </div>

        <div className="overflow-y-auto p-2 scroll-thin">
          <table className="w-full">
            <tbody>
              {SHORTCUTS.map((s) => (
                <tr
                  key={s.action}
                  className="border-b border-edge/50 last:border-b-0"
                >
                  <td className="min-h-[44px] py-2.5 pl-3 pr-2">
                    <span className="flex items-center gap-1">
                      {s.keys.map((k) => (
                        <kbd
                          key={k}
                          className="rounded-sm border border-edge bg-card px-1.5 py-0.5 font-mono text-xs text-text-secondary"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </td>
                  <td className="py-2.5 pl-2 pr-3 text-sm text-text">{s.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
