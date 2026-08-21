import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";

interface DialogSurfaceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  handle?: Dialog.Handle<unknown>;
  className?: string;
  viewportClassName?: string;
}

export function DialogSurface({
  open,
  onOpenChange,
  title,
  children,
  handle,
  className = "",
  viewportClassName = "",
}: DialogSurfaceProps) {
  return (
    <Dialog.Root handle={handle} open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop data-dialog-backdrop className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Viewport
          className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${viewportClassName}`}
        >
          <Dialog.Popup
            className={`motion-state origin-center max-h-[calc(100dvh-2rem)] w-full overflow-hidden rounded-lg border border-edge-bright bg-raised shadow-popover ${className}`}
          >
            <Dialog.Title className="sr-only">{title}</Dialog.Title>
            {children}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Right-anchored drawer variant of the dialog authority (Child 08 §H.1).
 * Focus trap, inert background, Escape dismissal, and focus restore are
 * inherited from the same Base UI primitive as DialogSurface — never
 * reimplemented. Enter/exit motion rides `.drawer-panel` (§G.3).
 *
 * `finalFocus` forwards the primitive's own return-focus target — used by
 * the Records drawer to hand focus back to the header trigger, which sits
 * outside this portal and is not a Dialog.Trigger.
 */
export function DrawerSurface({
  open,
  onOpenChange,
  title,
  children,
  finalFocus,
}: Omit<DialogSurfaceProps, "handle" | "className" | "viewportClassName"> & {
  finalFocus?: React.RefObject<HTMLElement | null>;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop data-dialog-backdrop className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Viewport className="fixed inset-0 z-50 justify-end">
          <Dialog.Popup
            aria-label={title}
            finalFocus={finalFocus}
            className="drawer-panel flex h-full w-[400px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden border-l border-edge-bright bg-raised shadow-popover"
          >
            <Dialog.Title className="sr-only">{title}</Dialog.Title>
            {children}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
