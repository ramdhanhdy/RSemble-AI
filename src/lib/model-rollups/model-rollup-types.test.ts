import { describe, expect, it } from "vitest";
import {
  createModelRollupVersion,
  isModelRollupRecord,
  isModelRollupVersion,
  modelRollupVersionToResolvedManifest,
} from "./model-rollup-types";

const MEMBER_A = `mc:sha256:${"a".repeat(64)}`;
const MEMBER_B = `mc:sha256:${"b".repeat(64)}`;

function record() {
  return {
    id: "rollup:alpha",
    name: "Alpha shelf",
    latestVersion: 1,
    revision: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    archivedAt: null,
  };
}

describe("Model Rollup runtime authority", () => {
  it("accepts only strict records and immutable stratified-only versions", () => {
    const version = createModelRollupVersion({
      rollupId: "rollup:alpha",
      version: 1,
      name: "Alpha shelf",
      memberConfigurationIds: [MEMBER_A, MEMBER_B],
      aggregationPolicy: "stratified_only",
      createdAt: 1_000,
    });
    expect(isModelRollupRecord(record())).toBe(true);
    expect(isModelRollupVersion(version)).toBe(true);
    expect(modelRollupVersionToResolvedManifest(version)).toEqual({
      rollupId: "rollup:alpha",
      version: 1,
      aggregationPolicy: "stratified_only",
      name: "Alpha shelf",
      memberConfigurationIds: [MEMBER_A, MEMBER_B],
      createdAt: 1_000,
    });
  });

  it.each(["pooled", "synthetic", "average", "unknown"])(
    "rejects the unauthorized %s policy",
    (aggregationPolicy) => {
      expect(
        isModelRollupVersion({
          rollupId: "rollup:alpha",
          version: 1,
          name: "Alpha shelf",
          memberConfigurationIds: [MEMBER_A],
          aggregationPolicy,
          memberManifestDigest: `sha256:${"0".repeat(64)}`,
          createdAt: 1_000,
        }),
      ).toBe(false);
    },
  );

  it("rejects duplicate, non-canonical, empty, and reordered-manifest forgery", () => {
    const version = createModelRollupVersion({
      rollupId: "rollup:alpha",
      version: 1,
      name: "Alpha shelf",
      memberConfigurationIds: [MEMBER_A, MEMBER_B],
      aggregationPolicy: "stratified_only",
      createdAt: 1_000,
    });
    expect(isModelRollupVersion({ ...version, memberConfigurationIds: [MEMBER_A, MEMBER_A] })).toBe(
      false,
    );
    expect(isModelRollupVersion({ ...version, memberConfigurationIds: ["friendly-name"] })).toBe(
      false,
    );
    expect(isModelRollupVersion({ ...version, memberConfigurationIds: [] })).toBe(false);
    expect(isModelRollupVersion({ ...version, memberConfigurationIds: [MEMBER_B, MEMBER_A] })).toBe(
      false,
    );
  });
});
