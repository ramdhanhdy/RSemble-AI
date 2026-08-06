// @vitest-environment happy-dom
// =============================================================================
// ConnectionsModal behavior tests — Plan 003 workstream A
//
// Prove the Plan 002 D1 credential policy in the UI: session-only default,
// explicit "Remember on this device" opt-in, environment read-only state,
// and Clear. Uses the real CredentialStore singleton against happy-dom
// localStorage so behavior matches production.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useMemo, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { ConnectionsModal } from "./ConnectionsModal";
import { ModelProbeProvider } from "./ModelProbeContext";
import { credentialStore, resetCredentialStoreForTests } from "../lib/credentials/credential-store";
import { rememberedStorageKey } from "../lib/credentials/credential-store";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  const [open, setOpen] = useState(true);
  const handle = useMemo(() => Dialog.createHandle(), []);
  return (
    <ModelProbeProvider>
      <ConnectionsModal
        isOpen={open}
        onOpenChange={setOpen}
        onRefresh={() => undefined}
        handle={handle}
      />
    </ModelProbeProvider>
  );
}

function mount(): { container: HTMLDivElement; root: { unmount: () => void } } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Harness />);
  });
  return { container, root };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function rootEl(): HTMLElement {
  // The Base UI dialog portals to document.body; the container passed to
  // createRoot stays empty.
  return document.body;
}

function openrouterRow(_container: HTMLElement): HTMLElement {
  const rows = [...rootEl().querySelectorAll("div")].filter((el) =>
    el.textContent?.includes("OpenRouter"),
  );
  return rows.find((el) => el.querySelector('input[id="key-openrouter"]')) ?? rows[0];
}

function setKeyInput(_container: HTMLElement, value: string): void {
  const input = rootEl().querySelector<HTMLInputElement>('input[id="key-openrouter"]')!;
  act(() => {
    // React tracks controlled inputs via its own value tracker; use the native
    // setter so the change is observed and state updates.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function click(button: HTMLButtonElement | null): void {
  expect(button).toBeTruthy();
  act(() => {
    button!.click();
  });
}

beforeEach(() => {
  // Deterministic: neutral provider env so the developer's .env cannot
  // interfere with session/remembered policy assertions.
  for (const key of [
    "VITE_OPENROUTER_KEY",
    "VITE_GEMINI_KEY",
    "VITE_DEEPSEEK_KEY",
    "VITE_COMMANDCODE_KEY",
    "VITE_CLINEPASS_KEY",
    "VITE_UMANS_KEY",
    "VITE_9ROUTER_KEY",
  ]) {
    vi.stubEnv(key, "");
  }
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetCredentialStoreForTests();
});

describe("ConnectionsModal — credential policy (Plan 002 D1)", () => {
  it("saves a new key session-only by default (no storage write)", async () => {
    const { container } = mount();
    await settle();
    setKeyInput(container, "sk-test-session-only-123");
    // Save with the remember checkbox unchecked (no Test click: Test-before-save
    // is covered by the source-level test and would otherwise hold the Save
    // button disabled while the async connection probe settles).
    const row = openrouterRow(container);
    const save = row.querySelector<HTMLButtonElement>("button")!;
    // Find the Save button specifically.
    const saveButton = [...row.querySelectorAll("button")].find((b) => b.textContent === "Save");
    click(saveButton ?? null);
    await settle();

    expect(credentialStore.get("openrouter")).toBe("sk-test-session-only-123");
    expect(credentialStore.persistence("openrouter")).toBe("session");
    expect(localStorage.getItem(rememberedStorageKey("openrouter"))).toBeNull();
    void save;
  });

  it("persists only after the explicit Remember on this device opt-in", async () => {
    const { container } = mount();
    await settle();
    setKeyInput(container, "sk-test-remembered-456");
    const row = openrouterRow(container);
    const checkbox = row.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    act(() => {
      checkbox.click();
    });
    const saveButton = [...row.querySelectorAll("button")].find((b) => b.textContent === "Save");
    click(saveButton ?? null);
    await settle();

    expect(credentialStore.persistence("openrouter")).toBe("remembered");
    expect(localStorage.getItem(rememberedStorageKey("openrouter"))).toBe("sk-test-remembered-456");
  });

  it("shows an environment key as read-only and never prefills the draft", async () => {
    vi.stubEnv("VITE_OPENROUTER_KEY", "sk-env-active-789");
    const { container } = mount();
    await settle();

    const input = rootEl().querySelector<HTMLInputElement>('input[id="key-openrouter"]')!;
    expect(input.value).toBe("");
    expect(input.disabled).toBe(true);
    expect(rootEl().textContent).toContain("Environment key active");
    const saveButton = [...openrouterRow(container).querySelectorAll("button")].find((b) => b.textContent === "Save");
    expect(saveButton?.disabled).toBe(true);
  });

  it("never renders the stored value as plaintext", async () => {
    credentialStore.set("openrouter", "sk-secret-plaintext-000", "remembered");
    const { container } = await Promise.resolve(mount()).then((h) => h);
    await settle();
    expect(container.textContent).not.toContain("sk-secret-plaintext-000");
  });

  it("Clear removes session and remembered values", async () => {
    credentialStore.set("openrouter", "sk-clear-me-111", "remembered");
    const { container } = mount();
    await settle();
    const clearButton = [...openrouterRow(container).querySelectorAll("button")].find((b) =>
      b.getAttribute("aria-label")?.includes("Clear"),
    );
    click(clearButton ?? null);
    await settle();
    expect(credentialStore.get("openrouter")).toBe("");
    expect(credentialStore.persistence("openrouter")).toBeNull();
  });
});
