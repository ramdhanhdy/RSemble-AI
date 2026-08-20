// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
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

  it("hydrates narrowings from URL on mount", () => {
    const { result, unmount } = renderProbe("/models/mc-1?narrow=family:code,class:verified");
    expect(result).not.toBeNull();
    expect(result!.narrowings).toHaveLength(2);
    expect(result!.narrowings[0].key).toBe("family:code");
    expect(result!.narrowings[1].key).toBe("class:verified");
    unmount();
  });
});
