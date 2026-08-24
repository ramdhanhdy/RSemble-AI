import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

export function AttentionOwnerHandoff({ recoveryAvailable }: { recoveryAvailable: boolean }) {
  const { hash } = useLocation();
  const focusRef = useRef<HTMLDivElement>(null);
  const active = hash === "#attention";

  useEffect(() => {
    if (active && recoveryAvailable) {
      focusRef.current?.focus();
    }
  }, [active, recoveryAvailable]);

  if (!active) return null;
  if (!recoveryAvailable) {
    return (
      <p data-attention-stale className="text-sm text-text-secondary">
        This item no longer needs attention.
      </p>
    );
  }
  return (
    <div
      ref={focusRef}
      tabIndex={-1}
      data-attention-focus
      aria-label="Recovery actions"
      className="outline-none"
    />
  );
}
