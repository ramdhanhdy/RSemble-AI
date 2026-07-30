// =============================================================================
// RSemble AI — Global execution owner (spec §5.4)
//
// In-app single-execution ownership: exactly one of these may be active:
//   - an ad hoc Compare run;
//   - one evaluation experiment task.
//
// This is the IN-TAB counterpart of the cross-tab ExecutionLease. The registry
// gates new executions and drives truthful disabled states in the UI. A paused
// experiment with remaining queued work retains ownership until resumed,
// completed, or aborted.
// =============================================================================

export type ExecutionOwnerKind = "compare" | "experiment";

export interface ExecutionOwner {
  kind: ExecutionOwnerKind;
  /** Run ID or experiment ID. */
  id: string;
}

export class ExecutionOwnerRegistry {
  private current: ExecutionOwner | null = null;
  private readonly listeners = new Set<(owner: ExecutionOwner | null) => void>();

  /** Acquire ownership. Returns false when another execution is active. */
  tryAcquire(owner: ExecutionOwner): boolean {
    if (this.current !== null) return false;
    this.current = owner;
    this.emit();
    return true;
  }

  /** Release ownership. Only the current owner's ID can release. */
  release(id: string): void {
    if (this.current?.id !== id) return;
    this.current = null;
    this.emit();
  }

  get(): ExecutionOwner | null {
    return this.current;
  }

  subscribe(listener: (owner: ExecutionOwner | null) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.current);
      } catch {
        // Listener errors must not break ownership transitions.
      }
    }
  }
}
