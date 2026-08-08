// =============================================================================
// Shared Vitest setup — Plan 006 quality gate (workstream B).
//
// 1. Marks the environment as a React act() environment so every
//    createRoot/render call in the suite can batch updates correctly and the
//    "not configured to support act(...)" warning cannot appear.
// 2. Installs a console.warning/error guard: any React DOM-nesting warning,
//    act() misuse, or other unexpected console noise fails the emitting test.
//    Only narrow, documented third-party patterns are allowed through.
// =============================================================================

import { afterEach, beforeEach } from "vitest";

// React reads this global to decide whether act() batching applies. It must be
// set before any react-dom render happens, so it lives at module scope.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Node >= 22.12 ships an experimental `globalThis.localStorage` whose getter
// returns a non-Web-Storage object (no getItem/setItem/removeItem) and prints
// `Warning: --localstorage-file was provided without a valid path` on access.
// In the happy-dom test environment this built-in shadows happy-dom's
// spec-compliant Storage, so credential-store.ts (which calls
// `globalThis.localStorage?.getItem`) silently swallows the TypeError and
// reports "session" instead of "remembered" — the root cause of the two
// ConnectionsModal.behavior.test.tsx failures. Other suites stub localStorage
// themselves (vi.stubGlobal) and must keep working, so only replace the global
// when the existing one is NOT a spec Web Storage (lacks getItem). Test-harness
// only; no src/ implementation changes.
function installSpecLocalStorageIfMissing(): void {
  const existing = (globalThis as Record<string, unknown>).localStorage as
    { getItem?: unknown } | undefined;
  if (existing && typeof existing.getItem === "function") {
    return; // happy-dom or a real Web Storage is already in place.
  }
  const store = new Map<string, string>();
  const storage = {
    get length(): number {
      return store.size;
    },
    clear(): void {
      store.clear();
    },
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    key(index: number): string | null {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    setItem(key: string, value: string): void {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
}

installSpecLocalStorageIfMissing();

/**
 * Narrow allowlist for known noise that is NOT a defect in first-party code.
 * Every entry must name its source and why it is safe to ignore. Adding a
 * pattern here requires review: hiding a real warning behind this list is a
 * quality-gate regression.
 */
const ALLOWED_CONSOLE_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  {
    // Vitest workers set FORCE_COLOR while a dependency warns about NO_COLOR;
    // this is runner plumbing, emitted by Node itself, not application code.
    pattern: /The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env/,
    reason: "vitest/Node runner color-env noise",
  },
];

interface GuardedConsole {
  messages: string[];
  restore: () => void;
}

function installGuard(kind: "error" | "warn"): GuardedConsole {
  const target = console[kind].bind(console);
  const messages: string[] = [];
  console[kind] = (...args: unknown[]) => {
    const text = args
      .map((a) => (typeof a === "string" ? a : a instanceof Error ? a.message : String(a)))
      .join(" ");
    if (ALLOWED_CONSOLE_PATTERNS.some(({ pattern }) => pattern.test(text))) return;
    messages.push(text);
    // Keep the original output so failures are diagnosable in the log.
    target(...args);
  };
  return {
    messages,
    restore: () => {
      console[kind] = target;
    },
  };
}

let errorGuard: GuardedConsole | null = null;
let warnGuard: GuardedConsole | null = null;

beforeEach(() => {
  errorGuard = installGuard("error");
  warnGuard = installGuard("warn");
});

afterEach((ctx) => {
  const errors = errorGuard?.messages ?? [];
  const warns = warnGuard?.messages ?? [];
  errorGuard?.restore();
  warnGuard?.restore();
  errorGuard = null;
  warnGuard = null;

  const report: string[] = [];
  if (errors.length > 0) {
    report.push(`unexpected console.error output:\n${errors.map((m) => `  - ${m}`).join("\n")}`);
  }
  if (warns.length > 0) {
    report.push(`unexpected console.warn output:\n${warns.map((m) => `  - ${m}`).join("\n")}`);
  }
  if (report.length > 0) {
    throw new Error(
      `Test "${ctx.task.name}" failed the console guard (Plan 006: warnings are defects).\n` +
        report.join("\n") +
        "\nFix the underlying warning; only narrow third-party noise may be allowlisted in test/setup-tests.ts.",
    );
  }
});
