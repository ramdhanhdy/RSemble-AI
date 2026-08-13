// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  RepositoryProvider,
  useRunRepository,
  useTaskRepository,
} from "./repository-context";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  indexedDB.deleteDatabase("rsemble-evaluation");
});

function RepositoryProbe() {
  const runRepo = useRunRepository();
  const taskRepo = useTaskRepository();
  return <div data-run={runRepo ? "ready" : "pending"} data-task={taskRepo ? "ready" : "pending"} />;
}

async function waitUntil(predicate: () => boolean) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error("repository initialization did not complete");
}

describe("RepositoryProvider initialization", () => {
  it("does not publish repositories until database migration completes", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(<RepositoryProvider><RepositoryProbe /></RepositoryProvider>);
    });

    const probe = () => container.querySelector("div[data-run]");
    expect(probe()?.getAttribute("data-run")).toBe("pending");
    expect(probe()?.getAttribute("data-task")).toBe("pending");

    await waitUntil(() => probe()?.getAttribute("data-task") === "ready");
    expect(probe()?.getAttribute("data-run")).toBe("ready");
    act(() => root.unmount());
    container.remove();
  });
});
