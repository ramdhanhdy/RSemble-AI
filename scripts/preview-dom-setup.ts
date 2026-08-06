// Side-effect module: installs happy-dom globals BEFORE any React imports.
// Imported first by render-results-preview.tsx so React DOM sees a document
// at import time. Test-harness boundary — the only place this ordering trick
// is needed.
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/" });
const target = globalThis as Record<string, unknown>;
const source = window as unknown as Record<string, unknown>;
const keys = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLSelectElement",
  "HTMLButtonElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "MutationObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "DocumentFragment",
  "SVGElement",
  "DOMParser",
  "XMLSerializer",
  "CSS",
  "FileReader",
  "Blob",
];
for (const key of keys) {
  if (source[key] === undefined) continue;
  try {
    target[key] = source[key];
  } catch {
    // Some globals (navigator) are getter-only in modern Node — redefine.
    Object.defineProperty(target, key, { value: source[key], configurable: true });
  }
}

function matchMedia(query: string) {
  return {
    matches: query.includes("min-width: 768"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}
target.matchMedia = matchMedia;
target.IS_REACT_ACT_ENVIRONMENT = true;
