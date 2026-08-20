// =============================================================================
// Models workspace — shared happy-dom test harness.
//
// Copies the Lab workspace harness pattern (createRoot + act + IS_REACT_ACT
// environment) so every primitive test mounts a real React tree and asserts
// against DOM structure/class names rather than rendered strings alone.
// =============================================================================

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

export interface Harness {
  container: HTMLDivElement;
  root: { render: (n: ReactNode) => void; unmount: () => void };
  $: (selector: string) => HTMLElement | null;
  $$: (selector: string) => HTMLElement[];
  text: () => string;
}

export function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await flush();
    });
  }
}

export function render(node: ReactNode): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    container,
    root,
    $: (selector) => container.querySelector<HTMLElement>(selector),
    $$: (selector) => [...container.querySelectorAll<HTMLElement>(selector)],
    text: () => container.textContent ?? "",
  };
}

export function cleanup(h: Harness): void {
  act(() => h.root.unmount());
  h.container.remove();
}
