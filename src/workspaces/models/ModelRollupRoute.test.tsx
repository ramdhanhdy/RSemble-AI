// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ModelConfigurationSnapshot } from "../../lib/evidence/evidence-types";
import { createModelRollupVersion } from "../../lib/model-rollups/model-rollup-types";
import { InMemoryEvidenceRepository } from "../../lib/persistence/evidence-repository";
import { InMemoryModelRollupRepository } from "../../lib/persistence/in-memory-model-rollup-repository";
import { cleanup, render, settle, type Harness } from "./models-test-harness";
import { ModelRollupRoute } from "./ModelRollupRoute";

const MEMBER_A = `mc:sha256:${"a".repeat(64)}`;
const MEMBER_B = `mc:sha256:${"b".repeat(64)}`;

function configuration(id: string, requestedModel: string): ModelConfigurationSnapshot {
  return {
    id,
    providerId: "openrouter",
    requestedModel,
    resolvedModel: requestedModel,
    resolvedVersion: id === MEMBER_A ? "2026-a" : "2026-b",
    reasoningRequested: null,
    reasoningEffective: null,
    toolScaffoldSignature: null,
    runtimeSettings: {},
    observedFrom: 1_000,
    observedTo: 2_000,
    identityCompleteness: "exact",
  };
}

async function repositories(options: { archived?: boolean; omitSecond?: boolean } = {}) {
  const evidence = new InMemoryEvidenceRepository();
  await evidence.putModelConfiguration(configuration(MEMBER_A, "vendor/a"));
  if (!options.omitSecond) await evidence.putModelConfiguration(configuration(MEMBER_B, "vendor/b"));
  const rollups = new InMemoryModelRollupRepository([MEMBER_A, MEMBER_B]);
  const v1 = createModelRollupVersion({
    rollupId: "rollup:route",
    version: 1,
    name: "Route shelf",
    memberConfigurationIds: [MEMBER_A, MEMBER_B],
    aggregationPolicy: "stratified_only",
    createdAt: 1_000,
  });
  await rollups.createModelRollup(
    {
      id: "rollup:route",
      name: "Route shelf",
      latestVersion: 1,
      revision: 0,
      createdAt: 1_000,
      updatedAt: 1_000,
      archivedAt: null,
    },
    v1,
  );
  if (options.archived) await rollups.archiveModelRollup("rollup:route", 0, 2_000);
  return { evidence, rollups };
}

function mount(path: string, repos: Awaited<ReturnType<typeof repositories>>): Harness {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/models/rollups/:rollupId/versions/:version" element={<ModelRollupRoute rollupRepo={repos.rollups} evidenceRepo={repos.evidence} />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ModelRollupRoute", () => {
  it("renders policy banner before heterogeneity and member shelves with no aggregate element", async () => {
    const h = mount("/models/rollups/rollup%3Aroute/versions/1", await repositories());
    await settle();
    const banner = h.$("[data-rollup-banner]")!;
    const table = h.$("[data-heterogeneity-table]")!;
    const shelf = h.$("[data-member-shelf]")!;
    expect(banner.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(table.compareDocumentPosition(shelf) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(h.$("[data-rollup-total], [data-pooled-aggregate]")).toBeNull();
    expect(h.$$('[data-differs=""]').length).toBeGreaterThan(0);
    cleanup(h);
  });

  it("keeps archived rollups readable and renders an immutable missing-member tombstone", async () => {
    const h = mount(
      "/models/rollups/rollup%3Aroute/versions/1",
      await repositories({ archived: true, omitSecond: true }),
    );
    await settle();
    expect(h.$('[data-rollup-state="archived"]')).not.toBeNull();
    expect(h.$("[data-rollup-archived]")).not.toBeNull();
    expect(h.$(`[data-member-tombstone][data-member-id="${MEMBER_B}"]`)).not.toBeNull();
    expect(h.text()).toContain("is not present in this database");
    cleanup(h);
  });

  it("renders typed unknown rollup and unknown version states", async () => {
    const repos = await repositories();
    const unknown = mount("/models/rollups/rollup%3Amissing/versions/1", repos);
    await settle();
    expect(unknown.$('[data-rollup-state="unknown"]')).not.toBeNull();
    cleanup(unknown);
    const unknownVersion = mount("/models/rollups/rollup%3Aroute/versions/99", repos);
    await settle();
    expect(unknownVersion.$('[data-rollup-state="unknown-version"]')).not.toBeNull();
    cleanup(unknownVersion);
  });
});
