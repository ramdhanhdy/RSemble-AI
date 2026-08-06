// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ModelProbeControl } from "./ModelProbeControl";
import { ModelProbeProvider, useModelProbe } from "./ModelProbeContext";
import type { LLMProvider } from "../lib/providers/types";
import { ProviderError } from "../lib/providers/types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
}

function render(node: React.ReactNode): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<ModelProbeProvider>{node}</ModelProbeProvider>));
  return {
    container,
    root,
    $: (s) => container.querySelector<HTMLElement>(s),
    $$: (s) => [...container.querySelectorAll<HTMLElement>(s)],
  };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function settle() {
  await act(async () => {
    await flush();
  });
}

let mockProvider: LLMProvider;

vi.mock("../lib/providers/registry", () => ({
  getProvider: () => mockProvider,
}));

function makeProvider(overrides: Partial<LLMProvider> = {}): LLMProvider {
  return {
    id: "9router",
    label: "9Router",
    readiness: () => ({ ok: true }),
    chatCompletion: vi.fn(async () => "OK"),
    chatCompletionStream: vi.fn(async function* (): AsyncGenerator<string, void, unknown> {
      yield "OK";
    }),
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mockProvider = makeProvider();
});

mockProvider = makeProvider();

describe("ModelProbeControl", () => {
  it("renders a Test model button with an accessible name including provider and slug", () => {
    const h = render(
      <ModelProbeControl providerId="9router" model="cmc/model" slotLabel="9Router · cmc/model" />,
    );
    const btn = h.$("button");
    expect(btn).toBeTruthy();
    expect(btn?.getAttribute("aria-label")).toContain("Test model");
    expect(btn?.getAttribute("aria-label")).toContain("9Router");
    expect(btn?.getAttribute("aria-label")).toContain("cmc/model");
    cleanup(h);
  });

  it("shows Ready with latency after a successful test", async () => {
    mockProvider = makeProvider();
    const h = render(
      <ModelProbeControl providerId="9router" model="cmc/model" slotLabel="9Router · cmc/model" />,
    );
    const btn = h.$("button")!;
    act(() => btn.click());
    await settle();

    const text = h.container.textContent ?? "";
    expect(text).toContain("Ready");
    expect(text).toMatch(/\d+ms/);
    cleanup(h);
  });

  it("shows a failure category after a failed test", async () => {
    mockProvider = makeProvider({
      chatCompletionStream: vi.fn(async function* (): AsyncGenerator<string, void, unknown> {
        throw new ProviderError("invalid api key", "9router", 401);
      }),
    });
    const h = render(
      <ModelProbeControl providerId="9router" model="cmc/model" slotLabel="9Router · cmc/model" />,
    );
    const btn = h.$("button")!;
    act(() => btn.click());
    await settle();

    const text = h.container.textContent ?? "";
    expect(text).toContain("Unauthorized");
    cleanup(h);
  });

  it("disables the button while testing", async () => {
    mockProvider = makeProvider();
    const h = render(
      <ModelProbeControl providerId="9router" model="cmc/model" slotLabel="9Router · cmc/model" />,
    );
    const btn = h.$("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    act(() => btn.click());
    expect(btn.disabled).toBe(true);
    await settle();
    expect(btn.disabled).toBe(false);
    cleanup(h);
  });

  it("does not dispatch a slot change or save a credential", async () => {
    mockProvider = makeProvider();
    const h = render(
      <ModelProbeControl providerId="9router" model="cmc/model" slotLabel="9Router · cmc/model" />,
    );
    const btn = h.$("button")!;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    act(() => btn.click());
    await settle();
    expect(setItemSpy).not.toHaveBeenCalled();
    cleanup(h);
  });
});

describe("ModelProbeContext — batch testing and invalidation", () => {
  it("batch tests multiple models and keeps per-row results independent", async () => {
    mockProvider = makeProvider();
    const calls: string[] = [];
    mockProvider = makeProvider({
      chatCompletionStream: vi.fn(async function* (opts: { model: string }) {
        calls.push(opts.model);
        yield "OK";
      }),
    });
    // Render two controls sharing one provider.
    const h = render(
      <div>
        <ModelProbeControl providerId="9router" model="a/model" slotLabel="a" />
        <ModelProbeControl providerId="9router" model="b/model" slotLabel="b" />
      </div>,
    );
    // Click both quickly — each only disables itself.
    const buttons = h.$$("button");
    act(() => buttons[0].click());
    act(() => buttons[1].click());
    expect(calls.length).toBeGreaterThanOrEqual(1);
    await settle();
    // Both resolve independently.
    const text = h.container.textContent ?? "";
    expect((text.match(/Ready/g) ?? []).length).toBe(2);
    cleanup(h);
  });

  it("credential invalidation resets probe results to Untested", async () => {
    mockProvider = makeProvider();
    let invalidate!: () => void;
    function ProbeHarness() {
      const { invalidateProvider } = useModelProbe();
      invalidate = () => invalidateProvider("9router");
      return (
        <ModelProbeControl providerId="9router" model="cmc/model" slotLabel="9Router · cmc/model" />
      );
    }
    const h = render(<ProbeHarness />);
    const btn = h.$("button")!;
    act(() => btn.click());
    await settle();
    expect(h.container.textContent).toContain("Ready");
    act(() => invalidate());
    await settle();
    expect(h.container.textContent).not.toContain("Ready");
    cleanup(h);
  });
});
