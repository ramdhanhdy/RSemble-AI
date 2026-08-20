// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import type { ModelConfigurationSnapshot } from "../../lib/evidence/evidence-types";
import { createModelRollupVersion } from "../../lib/model-rollups/model-rollup-types";
import { InMemoryEvidenceRepository } from "../../lib/persistence/evidence-repository";
import { InMemoryModelRollupRepository } from "../../lib/persistence/in-memory-model-rollup-repository";
import { render, settle } from "./models-test-harness";
import { ModelsWorkspace } from "./ModelsWorkspace";

const MEMBER = `mc:sha256:${"a".repeat(64)}`;

function snapshot(): ModelConfigurationSnapshot {
  return {
    id: MEMBER,
    providerId: "openrouter",
    requestedModel: "vendor/model",
    resolvedModel: "vendor/model",
    resolvedVersion: "2026-08",
    reasoningRequested: null,
    reasoningEffective: null,
    toolScaffoldSignature: null,
    runtimeSettings: {},
    observedFrom: 1_000,
    observedTo: 2_000,
    identityCompleteness: "exact",
  };
}

async function seed() {
  const evidence = new InMemoryEvidenceRepository();
  await evidence.putModelConfiguration(snapshot());
  const rollups = new InMemoryModelRollupRepository([MEMBER]);
  const v1 = createModelRollupVersion({
    rollupId: "rollup:workspace",
    version: 1,
    name: "Workspace shelf",
    memberConfigurationIds: [MEMBER],
    aggregationPolicy: "stratified_only",
    createdAt: 1_000,
  });
  await rollups.createModelRollup(
    {
      id: "rollup:workspace",
      name: "Workspace shelf",
      latestVersion: 1,
      revision: 0,
      createdAt: 1_000,
      updatedAt: 1_000,
      archivedAt: null,
    },
    v1,
  );
  const v2 = createModelRollupVersion({
    ...v1,
    version: 2,
    name: "Workspace shelf v2",
    createdAt: 2_000,
  });
  await rollups.appendModelRollupVersion(
    {
      id: "rollup:workspace",
      name: v2.name,
      latestVersion: 2,
      revision: 0,
      createdAt: 1_000,
      updatedAt: 2_000,
      archivedAt: null,
    },
    v2,
    0,
  );
  return { evidence, rollups };
}

function HistoryControls() {
  const navigate = useNavigate();
  return (
    <>
      <button data-history-back type="button" onClick={() => navigate(-1)}>Back</button>
      <button data-history-forward type="button" onClick={() => navigate(1)}>Forward</button>
    </>
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ModelsWorkspace canonical rollup route", () => {
  it("gives the static rollups route precedence over :modelConfigurationId on direct load", async () => {
    const { evidence, rollups } = await seed();
    const h = render(
      <MemoryRouter initialEntries={["/models/rollups/rollup%3Aworkspace/versions/2"]}>
        <Routes>
          <Route path="/models/*" element={<ModelsWorkspace evidenceRepo={evidence} taskRepo={null} rollupRepo={rollups} />} />
        </Routes>
      </MemoryRouter>,
    );
    await settle();
    expect(h.$("[data-model-rollup-route]")).not.toBeNull();
    expect(h.$('[data-rollup-version]')?.textContent).toBe("v2");
    expect(h.$("[data-model-profile]")).toBeNull();
    act(() => h.root.unmount());
  });

  it("preserves pinned historical versions through browser back and forward navigation", async () => {
    const { evidence, rollups } = await seed();
    const h = render(
      <MemoryRouter
        initialEntries={[
          "/models/rollups/rollup%3Aworkspace/versions/1",
          "/models/rollups/rollup%3Aworkspace/versions/2",
        ]}
        initialIndex={1}
      >
        <HistoryControls />
        <Routes>
          <Route path="/models/*" element={<ModelsWorkspace evidenceRepo={evidence} taskRepo={null} rollupRepo={rollups} />} />
        </Routes>
      </MemoryRouter>,
    );
    await settle();
    expect(h.$('[data-rollup-version]')?.textContent).toBe("v2");
    act(() => h.$("[data-history-back]")!.click());
    await settle();
    expect(h.$('[data-rollup-version]')?.textContent).toBe("v1");
    act(() => h.$("[data-history-forward]")!.click());
    await settle();
    expect(h.$('[data-rollup-version]')?.textContent).toBe("v2");
    act(() => h.root.unmount());
  });
});
