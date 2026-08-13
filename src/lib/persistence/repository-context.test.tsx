// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { hashArtifactContent } from "../evaluations/protocol-fingerprint";
import { RSembleEvaluationDB } from "./database";
import {
  RepositoryProvider,
  useRunRepository,
  useStorageState,
  useTaskMigrationError,
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
  const storageState = useStorageState();
  const taskMigrationError = useTaskMigrationError();
  return <div
    data-run={runRepo ? "ready" : "pending"}
    data-task={taskRepo ? "ready" : "pending"}
    data-storage={storageState}
    data-task-error={taskMigrationError?.kind ?? "none"}
  />;
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

async function seedMigrationFailure() {
  const db = new RSembleEvaluationDB("rsemble-evaluation");
  await db.open();
  const legacyTask = {
    id: "migration-failure-task",
    title: "Summarize",
    prompt: "Summarize the passage.",
    systemPrompt: "",
    evaluation: { kind: "inherit" },
    judgeInstructionOverride: "",
    order: 0,
  };
  const suiteId = "migration-failure-suite";
  await db.suites.put({
    id: suiteId,
    suite: { id: suiteId, version: 1, tasks: [legacyTask] },
    revision: 1,
    version: 1,
    updatedAt: 1,
    archivedAt: null,
  });
  const taskId = `legacy-task-${hashArtifactContent(`${suiteId}::${legacyTask.id}`).slice(7, 30)}`;
  await db.taskVersions.put({
    taskId,
    version: 1,
    version_: {
      taskId,
      version: 1,
      source: { kind: "legacy-task-set", legacyScopeKey: "wrong-scope", note: "wrong-note" },
    },
    createdAt: 1,
  } as never);
  db.close();
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

  it("keeps Compare repositories available and reports a bounded Task migration error", async () => {
    await seedMigrationFailure();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(<RepositoryProvider><RepositoryProbe /></RepositoryProvider>);
    });

    const probe = () => container.querySelector("div[data-run]");
    await waitUntil(() => probe()?.getAttribute("data-task-error") === "validation");
    expect(probe()?.getAttribute("data-run")).toBe("ready");
    expect(probe()?.getAttribute("data-task")).toBe("pending");
    expect(probe()?.getAttribute("data-storage")).toBe("ready");
    act(() => root.unmount());
    container.remove();
  });
});
