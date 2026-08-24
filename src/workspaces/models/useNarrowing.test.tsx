// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useNarrowing, type UseNarrowingResult } from "./useNarrowing";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// A test component that exposes the hook result via a callback.
function NarrowingProbe({
  onResult,
}: {
  onResult: (result: UseNarrowingResult) => void;
}): ReactNode {
  const result = useNarrowing();
  onResult(result);
  return null;
}
function FocusProbe(): ReactNode {
  const result = useNarrowing();
  return (
    <>
      <button
        id="origin-control"
        type="button"
        onClick={() => {
          result.apply({ key: "family:code", label: "Family: Code" });
          result.focusTableHeading();
        }}
      >
        Apply narrowing
      </button>
      <h2 ref={result.tableHeadingRef} tabIndex={-1}>
        Evidence table
      </h2>
      <button id="clear-control" type="button" onClick={result.clearAll}>
        Clear all
      </button>
    </>
  );
}

function renderFocusProbe(): {
  container: HTMLDivElement;
  unmount: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/models/mc-1"]}>
        <Routes>
          <Route path="/models/:modelConfigurationId" element={<FocusProbe />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function renderProbe(initialEntry: string): {
  container: HTMLDivElement;
  result: UseNarrowingResult | null;
  unmount: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let captured: UseNarrowingResult | null = null;
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/models/:modelConfigurationId"
            element={
              <NarrowingProbe
                onResult={(r: UseNarrowingResult) => {
                  captured = r;
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  });
  return {
    container,
    result: captured,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("useNarrowing", () => {
  it("starts with no narrowings", () => {
    const { result, unmount } = renderProbe("/models/mc-1");
    expect(result).not.toBeNull();
    expect(result!.narrowings).toHaveLength(0);
    unmount();
  });

  it("provides tableHeadingRef and originRef", () => {
    const { result, unmount } = renderProbe("/models/mc-1");
    expect(result).not.toBeNull();
    expect(result!.tableHeadingRef).toBeDefined();
    expect(result!.originRef).toBeDefined();
    expect(typeof result!.focusTableHeading).toBe("function");
    expect(typeof result!.captureOrigin).toBe("function");
    unmount();
  });

  it("apply, remove, clearAll are functions", () => {
    const { result, unmount } = renderProbe("/models/mc-1");
    expect(result).not.toBeNull();
    expect(typeof result!.apply).toBe("function");
    expect(typeof result!.remove).toBe("function");
    expect(typeof result!.clearAll).toBe("function");
    unmount();
  });

  it("restores focus to the originating control after clear all", async () => {
    const { container, unmount } = renderFocusProbe();
    const origin = container.querySelector<HTMLButtonElement>("#origin-control")!;
    const heading = container.querySelector<HTMLHeadingElement>("h2")!;
    const clear = container.querySelector<HTMLButtonElement>("#clear-control")!;

    act(() => {
      origin.focus();
      origin.click();
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(document.activeElement).toBe(heading);

    act(() => {
      clear.focus();
      clear.click();
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(origin);
    unmount();
  });
});
