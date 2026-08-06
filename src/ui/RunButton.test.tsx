// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { RunButton } from "./RunButton";
import {
  clearModelPricing,
  parseOpenRouterPricing,
  setModelPricing,
} from "../lib/providers/pricing";
import type { RunButton as RunButtonType } from "./RunButton";

type RunButtonProps = Parameters<typeof RunButtonType>[0];

interface Harness {
  container: HTMLDivElement;
  root: { unmount: () => void };
}

function renderButton(props: Partial<RunButtonProps> = {}): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <RunButton
        running={false}
        canRun
        hasPrompt
        enabledCount={2}
        enabledSlugs={["a", "b"]}
        prompt="hello world"
        onClick={() => undefined}
        onAbort={() => undefined}
        {...props}
      />,
    );
  });
  return { container, root };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

afterEach(() => {
  clearModelPricing();
  document.body.innerHTML = "";
});

describe("RunButton forecast", () => {
  it("shows a complete forecast including the Judge when all prices are known", () => {
    setModelPricing(
      parseOpenRouterPricing("openrouter", "a", { prompt: "0.000001", completion: "0.000001" }, 1)!,
    );
    setModelPricing(
      parseOpenRouterPricing("openrouter", "b", { prompt: "0.000001", completion: "0.000001" }, 1)!,
    );
    setModelPricing(
      parseOpenRouterPricing(
        "openrouter",
        "judge",
        { prompt: "0.000001", completion: "0.000001" },
        1,
      )!,
    );
    const h = renderButton({
      mode: "rank",
      judge: { providerId: "openrouter", model: "judge" },
      providerIdsBySlug: { a: "openrouter", b: "openrouter" },
    });
    const text = h.container.textContent ?? "";
    expect(text).toContain("2 models · 1 judge · ~$");
    expect(text).not.toContain("partial");
    cleanup(h);
  });

  it("labels the forecast partial when a stage price is missing", () => {
    const h = renderButton({
      mode: "rank",
      judge: { providerId: "umans", model: "judge" },
      providerIdsBySlug: { a: "openrouter", b: "openrouter" },
    });
    expect(h.container.textContent).toContain("(partial)");
    cleanup(h);
  });

  it("names the conditional Fusion stage in Fuse mode", () => {
    setModelPricing(
      parseOpenRouterPricing("openrouter", "a", { prompt: "0.000001", completion: "0.000001" }, 1)!,
    );
    setModelPricing(
      parseOpenRouterPricing("openrouter", "b", { prompt: "0.000001", completion: "0.000001" }, 1)!,
    );
    setModelPricing(
      parseOpenRouterPricing(
        "openrouter",
        "judge",
        { prompt: "0.000001", completion: "0.000001" },
        1,
      )!,
    );
    const h = renderButton({
      mode: "fuse",
      judge: { providerId: "openrouter", model: "judge" },
      providerIdsBySlug: { a: "openrouter", b: "openrouter" },
    });
    expect(h.container.textContent).toContain("+ fusion");
    cleanup(h);
  });
});
