import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { createModelRollupVersion, type ModelRollupRecord } from "../model-rollups/model-rollup-types";
import { buildValidArchiveV3Fixture } from "./archive-v3-fixtures";
import { buildValidNonFusionArchiveV2Fixture } from "./archive-v2-fixtures";
import { computeArchiveV3PayloadDigest, validateArchiveV3 } from "./archive-v3-types";
import {
  commitPreviewWorkbenchArchiveV3,
  exportWorkbenchArchiveV3,
  importWorkbenchArchiveAuto,
  previewWorkbenchArchive,
} from "./archive";
import { RSembleEvaluationDB } from "./database";
import { fusionToResearchLabReceiptKey } from "../migrations/fusion-to-research-lab";

const MEMBER =
  "mc:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const RECORD: ModelRollupRecord = {
  id: "rollup:archive",
  name: "Archive shelf",
  latestVersion: 1,
  revision: 0,
  createdAt: 1_000,
  updatedAt: 1_000,
  archivedAt: null,
};
const VERSION = createModelRollupVersion({
  rollupId: RECORD.id,
  version: 1,
  name: RECORD.name,
  memberConfigurationIds: [MEMBER],
  aggregationPolicy: "stratified_only",
  createdAt: 1_000,
});

function withRollups() {
  const archive = buildValidArchiveV3Fixture();
  archive.modelRollups = { records: [RECORD], versions: [VERSION] };
  archive.manifest.counts.modelRollups = 1;
  archive.manifest.counts.modelRollupVersions = 1;
  archive.manifest.payloadDigest = computeArchiveV3PayloadDigest(archive);
  return archive;
}

const opened: RSembleEvaluationDB[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) db.close();
  await Dexie.delete("model-rollup-archive");
  await Dexie.delete("model-rollup-archive-target");
  await Dexie.delete("model-rollup-archive-v1");
});

async function db(name: string) {
  await Dexie.delete(name);
  const value = new RSembleEvaluationDB(name);
  await value.open();
  opened.push(value);
  return value;
}

describe("archive v3 Model Rollup authority", () => {
  it("validates definitions and immutable versions, while older v3 remains readable", () => {
    expect(validateArchiveV3(withRollups()).valid).toBe(true);
    const earlier = buildValidArchiveV3Fixture();
    delete earlier.modelRollups;
    delete earlier.manifest.counts.modelRollups;
    delete earlier.manifest.counts.modelRollupVersions;
    earlier.manifest.payloadDigest = computeArchiveV3PayloadDigest(earlier);
    expect(validateArchiveV3(earlier).valid).toBe(true);
  });

  it("rejects non-stratified policy and dangling member IDs", () => {
    const policy = withRollups();
    policy.modelRollups!.versions[0] = {
      ...VERSION,
      aggregationPolicy: "pooled",
    } as unknown as typeof VERSION;
    policy.manifest.payloadDigest = computeArchiveV3PayloadDigest(policy);
    expect(validateArchiveV3(policy).valid).toBe(false);

    const dangling = withRollups();
    dangling.modelRollups!.versions[0] = createModelRollupVersion({
      ...VERSION,
      memberConfigurationIds: [`mc:sha256:${"f".repeat(64)}`],
    });
    dangling.manifest.payloadDigest = computeArchiveV3PayloadDigest(dangling);
    expect(validateArchiveV3(dangling).valid).toBe(false);
  });

  it("round-trips definitions only and omits derived computation products", async () => {
    const source = await db("model-rollup-archive");
    await source.storageMeta.put({
      key: fusionToResearchLabReceiptKey,
      value: buildValidArchiveV3Fixture().lab.cutoverReceipt,
    });
    await source.modelConfigurations.put({
      id: MEMBER,
      snapshot: withRollups().evidence.modelConfigurations[0],
      providerId: "openrouter",
      requestedModel: "vendor/a",
      resolvedVersion: "2026-08",
      observedTo: 1_000,
    });
    await source.modelRollups.put({
      id: RECORD.id,
      record: RECORD,
      name: RECORD.name,
      latestVersion: RECORD.latestVersion,
      revision: RECORD.revision,
      createdAt: RECORD.createdAt,
      updatedAt: RECORD.updatedAt,
      archivedAt: RECORD.archivedAt,
    });
    await source.modelRollupVersions.put({
      rollupId: VERSION.rollupId,
      version: VERSION.version,
      version_: VERSION,
      memberManifestDigest: VERSION.memberManifestDigest,
      createdAt: VERSION.createdAt,
    });
    const exported = await exportWorkbenchArchiveV3(source, { now: 9_000 });
    expect(exported.modelRollups).toEqual({ records: [RECORD], versions: [VERSION] });
    const forbiddenDerivedKeys = ["pro" + "fileResult", "queryResult", "cache"];
    expect(JSON.stringify(exported)).not.toMatch(new RegExp(forbiddenDerivedKeys.join("|"), "i"));

    const target = await db("model-rollup-archive-target");
    await target.storageMeta.put({
      key: fusionToResearchLabReceiptKey,
      value: buildValidArchiveV3Fixture().lab.cutoverReceipt,
    });
    const preview = await previewWorkbenchArchive(target, exported);
    await commitPreviewWorkbenchArchiveV3(target, preview);
    expect((await target.modelRollups.get(RECORD.id))?.record).toEqual(RECORD);
    expect((await target.modelRollupVersions.get([RECORD.id, 1]))?.version_).toEqual(VERSION);
  });

  it("reports every rollup collision in preview and writes nothing", async () => {
    const target = await db("model-rollup-archive-target");
    const archive = withRollups();
    await target.modelRollups.put({
      id: RECORD.id,
      record: { ...RECORD, name: "Collision" },
      name: "Collision",
      latestVersion: RECORD.latestVersion,
      revision: RECORD.revision,
      createdAt: RECORD.createdAt,
      updatedAt: RECORD.updatedAt,
      archivedAt: RECORD.archivedAt,
    });
    const preview = await previewWorkbenchArchive(target, archive);
    expect(preview.collisions).toContainEqual(
      expect.objectContaining({ collection: "modelRollups.records", key: RECORD.id }),
    );
    await expect(commitPreviewWorkbenchArchiveV3(target, preview)).rejects.toMatchObject({
      kind: "conflict",
    });
    expect(await target.modelRollupVersions.count()).toBe(0);
  });

  it("keeps supported v2 and v1 imports readable with empty rollup collections", async () => {
    const v2Target = await db("model-rollup-archive-target");
    const v2 = await importWorkbenchArchiveAuto(v2Target, buildValidNonFusionArchiveV2Fixture());
    expect(v2.format).toBe("v2");
    expect(await v2Target.modelRollups.count()).toBe(0);
    expect(await v2Target.modelRollupVersions.count()).toBe(0);

    const v1Target = await db("model-rollup-archive-v1");
    const v1 = await importWorkbenchArchiveAuto(v1Target, {
      schemaVersion: 1,
      exportedAt: 1_000,
      runs: { summaries: [], details: [] },
      profiles: { identities: [], versions: [] },
      suites: [],
      experiments: [],
    });
    expect(v1.format).toBe("v1");
    expect(await v1Target.modelRollups.count()).toBe(0);
    expect(await v1Target.modelRollupVersions.count()).toBe(0);
  });
});
