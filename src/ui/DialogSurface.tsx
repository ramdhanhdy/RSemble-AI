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
