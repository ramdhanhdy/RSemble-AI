// @vitest-environment happy-dom
// =============================================================================
// ConnectionsModal credential-fallback behavior tests (Phase 2 F3)
//
// Render-based regression coverage for the Plan 002 D1 / Bug-2 fix in
// handleTest: when the API-key input is empty, Test falls back to the stored
// credential (env / session / remembered); a typed draft always wins; with no
// stored value the provider's own "enter key" guard surfaces. Also locks in
// the disabled-button cursor (`disabled:cursor-not-allowed`, never `cursor-wait`).
// These assert observable DOM/contract behavior — not source text — so the old
// bug (Test always sent the empty draft) would fail them.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Dialog } from "@base-ui/react/dialog";
import { ConnectionsModal } from "./ConnectionsModal";
import { ModelProbeProvider } from "./ModelProbeContext";
import { credentialStore, resetCredentialStoreForTests } from "../lib/credentials/credential-store";
import type { LLMProvider, ProviderReadiness } from "../lib/providers/types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// vi.hoisted keeps the mock provider and its testConnection spy accessible to
// both the hoisted vi.mock factory and the test bodies.
const { openrouterProvider, testConnectionMock } = vi.hoisted(() => {
  const testConnectionMock =
    vi.fn<(apiKey: string, signal?: AbortSignal) => Promise<ProviderReadiness>>();
  const openrouterProvider: LLMProvider = {
    id: "openrouter",
    label: "OpenRouter",
    executionDeadlines: false,
    readiness: () => ({ ok: false, reason: "Missing VITE_OPENROUTER_KEY." }),
    testConnection: testConnectionMock,
    chatCompletion: async () => "",
    chatCompletionStream: async function* () {},
    listModels: async () => [],
  };
  return { openrouterProvider, testConnectionMock };
});

vi.mock("../lib/providers/registry", () => ({
  listProviders: () => [openrouterProvider],
  getProvider: () => openrouterProvider,
}));

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

function mount(): { root: { unmount: () => void } } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Harness />);
  });
  activeRoot = root;
  return { root };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function rootEl(): HTMLElement {
  // The Base UI dialog portals to document.body.
  return document.body;
}

function openrouterRow(): HTMLElement {
  const input = rootEl().querySelector<HTMLInputElement>('input[id="key-openrouter"]')!;
  // The provider card is the closest .rounded-md ancestor of the key input.
  return input.closest(".rounded-md") as HTMLElement;
}

function setKeyInput(value: string): void {
  const input = rootEl().querySelector<HTMLInputElement>('input[id="key-openrouter"]')!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function clickTest(): void {
  const button = rootEl().querySelector<HTMLButtonElement>(
    'button[aria-label="Test OpenRouter connection"]',
  )!;
  act(() => {
    button.click();
  });
}

function testStatusText(): string | null {
  const status = rootEl().querySelector<HTMLElement>('p[role="status"]');
  return status?.textContent ?? null;
}

let activeRoot: { unmount: () => void } | null = null;

beforeEach(() => {
  // No real loopback: the modal probes readiness on open.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("bridge offline in test"))),
  );
  // Neutral env so developer .env keys cannot supply a stored credential.
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
  // Mirror the real openrouter guard: an empty candidate yields the
  // provider's own "enter key" readiness reason; any non-empty key verifies.
  testConnectionMock.mockImplementation(async (apiKey: string) => {
    if (!apiKey.trim()) {
      return { ok: false, reason: "Enter an OpenRouter API key first." };
    }
    return { ok: true };
  });
});

afterEach(async () => {
  // Isolate per test: the in-memory localStorage shim persists across tests
  // in a file, so clear it after each test for a clean slate next run.
  globalThis.localStorage?.clear?.();
  if (activeRoot) {
    const root = activeRoot;
    activeRoot = null;
    act(() => {
      root.unmount();
    });
    await settle();
  }
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  testConnectionMock.mockReset();
  resetCredentialStoreForTests();
});

describe("ConnectionsModal — handleTest credential fallback (F3)", () => {
  it("tests the stored credential when the input is empty", async () => {
    credentialStore.set("openrouter", "sk-stored-AAA", "remembered");
    mount();
    await settle();

    clickTest();
    await settle();
    await settle();

    expect(testConnectionMock).toHaveBeenCalledTimes(1);
    expect(testConnectionMock.mock.calls[0][0]).toBe("sk-stored-AAA");
    expect(testStatusText()).toBe("Connection verified.");
  });

  it("lets a typed draft win over the stored credential", async () => {
    credentialStore.set("openrouter", "sk-stored-BBB", "remembered");
    mount();
    await settle();

    setKeyInput("sk-typed-CCC");
    clickTest();
    await settle();
    await settle();

    expect(testConnectionMock).toHaveBeenCalledTimes(1);
    expect(testConnectionMock.mock.calls[0][0]).toBe("sk-typed-CCC");
    expect(testStatusText()).toBe("Connection verified.");
  });

  it("surfaces the provider's own enter-key error when no credential is available", async () => {
    // No stored credential and an empty draft: the candidate is "" and the
    // provider's guard reason must render in the test-result status line.
    mount();
    await settle();

    clickTest();
    await settle();
    await settle();

    expect(testConnectionMock).toHaveBeenCalledTimes(1);
    expect(testConnectionMock.mock.calls[0][0]).toBe("");
    expect(testStatusText()).toBe("Enter an OpenRouter API key first.");
  });

  it("renders disabled:cursor-not-allowed (never cursor-wait) on Test and Save", async () => {
    mount();
    await settle();

    const row = openrouterRow();
    const testButton = row.querySelector<HTMLButtonElement>(
      'button[aria-label="Test OpenRouter connection"]',
    )!;
    const saveButton = [...row.querySelectorAll("button")].find((b) => b.textContent === "Save")!;

    expect(testButton.className).toContain("disabled:cursor-not-allowed");
    expect(testButton.className).not.toContain("cursor-wait");
    expect(saveButton.className).toContain("disabled:cursor-not-allowed");
    expect(saveButton.className).not.toContain("cursor-wait");
  });
});
