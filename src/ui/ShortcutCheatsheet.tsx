import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { DialogSurface } from "./DialogSurface";

interface ShortcutCheatsheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  handle?: Dialog.Handle<unknown>;
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

export function ShortcutCheatsheet({ open, onOpenChange, handle }: ShortcutCheatsheetProps) {
  return (
    <DialogSurface
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      handle={handle}
      className="max-w-lg"
    >
      <div className="flex items-center justify-between border-b border-edge px-5 py-3.5">
        <h2 className="font-mono text-base font-semibold text-text">Keyboard Shortcuts</h2>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Close shortcuts"
          className="flex h-11 w-11 items-center justify-center rounded-md text-text-secondary hover:bg-card-hover hover:text-text"
        >
          <X size={15} />
        </button>
      </div>

      <div className="overflow-y-auto p-2 scroll-thin">
        <table className="w-full">
          <tbody>
            {SHORTCUTS.map((shortcut) => (
              <tr
                key={shortcut.action}
                className="border-b border-edge/50 last:border-b-0"
              >
                <td className="min-h-[44px] py-2.5 pl-3 pr-2">
                  <span className="flex items-center gap-1">
                    {shortcut.keys.map((key) => (
                      <kbd
                        key={key}
                        className="rounded-sm border border-edge bg-card px-1.5 py-0.5 font-mono text-xs text-text-secondary"
                      >
                        {key}
                      </kbd>
                    ))}
                  </span>
                </td>
                <td className="py-2.5 pl-2 pr-3 text-sm text-text">{shortcut.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DialogSurface>
  );
}
