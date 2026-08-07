// =============================================================================
// RSemble AI — Execution owner React context (spec §5.4)
//
// Provides a tab-wide ExecutionOwnerRegistry to React components so the UI can
// gate Compare start while an experiment is active (and vice versa). The
// registry itself is imperative; this module adds a reactive hook that
// re-renders on ownership changes.
// =============================================================================

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ExecutionOwnerRegistry, type ExecutionOwner } from "./execution-owner";

export interface ExecutionOwnerContextValue {
  registry: ExecutionOwnerRegistry;
  owner: ExecutionOwner | null;
}

const ExecutionOwnerContext = createContext<ExecutionOwnerContextValue | null>(null);

export function ExecutionOwnerProvider({ children }: { children: ReactNode }) {
  const registry = useMemo(() => new ExecutionOwnerRegistry(), []);
  const [owner, setOwner] = useState<ExecutionOwner | null>(registry.get());

  useEffect(() => registry.subscribe(setOwner), [registry]);

  const value = useMemo<ExecutionOwnerContextValue>(() => ({ registry, owner }), [registry, owner]);

  return <ExecutionOwnerContext.Provider value={value}>{children}</ExecutionOwnerContext.Provider>;
}

export function useExecutionOwner(): ExecutionOwnerContextValue {
  const ctx = useContext(ExecutionOwnerContext);
  if (ctx === null) {
    throw new Error("useExecutionOwner must be used within an ExecutionOwnerProvider");
  }
  return ctx;
}
