// =============================================================================
// RSemble AI — Study fingerprint property tests (spec §4)
//
// RED: specifies canonical serialization and fingerprinting — stable under
// key/order permutations and changed by every material field.
// =============================================================================

import { describe, expect, it } from "vitest";
import { canonicalStudyJson, fingerprintStudyValue, isStudyFingerprint } from "./study-fingerprint";

describe("canonical study JSON", () => {
  it("sorts object keys recursively", () => {
    const a = { z: 1, a: 2, m: { y: 3, b: 4 } };
    const b = { a: 2, m: { b: 4, y: 3 }, z: 1 };
    expect(canonicalStudyJson(a)).toBe(canonicalStudyJson(b));
  });

  it("preserves array order (semantically ordered)", () => {
    expect(canonicalStudyJson([3, 1, 2])).not.toBe(canonicalStudyJson([1, 2, 3]));
    expect(canonicalStudyJson([1, 2, 3])).toBe(canonicalStudyJson([1, 2, 3]));
  });

  it("is stable under key permutation at any depth", () => {
    const deep = {
      workload: { taskSetId: "ts1", version: 6, manifestDigest: "sha256:abc" },
      policies: ["fuse", "rank"],
      judge1: { id: "mc:sha256:def" },
    };
    const permuted = {
      judge1: { id: "mc:sha256:def" },
      policies: ["fuse", "rank"],
      workload: { manifestDigest: "sha256:abc", version: 6, taskSetId: "ts1" },
    };
    expect(canonicalStudyJson(deep)).toBe(canonicalStudyJson(permuted));
  });
});

describe("fingerprintStudyValue", () => {
  it("returns a sha256:<hex> fingerprint", () => {
    const fp = fingerprintStudyValue({ a: 1, b: 2 });
    expect(isStudyFingerprint(fp)).toBe(true);
  });

  it("is stable under key order permutation", () => {
    const a = { z: 1, a: { y: 2, x: 3 } };
    const b = { a: { x: 3, y: 2 }, z: 1 };
    expect(fingerprintStudyValue(a)).toBe(fingerprintStudyValue(b));
  });

  it("is changed by every material field", () => {
    const base = {
      workload: { taskSetId: "ts1", version: 6, manifestDigest: "sha256:aa" },
      modelPool: { poolId: "p1", version: 3, digest: "sha256:bb" },
      judge1: { id: "mc:sha256:cc" },
      policies: ["fuse", "rank"],
    };
    const fp0 = fingerprintStudyValue(base);
    // every material field change alters the fingerprint
    expect(
      fingerprintStudyValue({ ...base, workload: { ...base.workload, taskSetId: "ts2" } }),
    ).not.toBe(fp0);
    expect(fingerprintStudyValue({ ...base, workload: { ...base.workload, version: 7 } })).not.toBe(
      fp0,
    );
    expect(
      fingerprintStudyValue({
        ...base,
        workload: { ...base.workload, manifestDigest: "sha256:zz" },
      }),
    ).not.toBe(fp0);
    expect(
      fingerprintStudyValue({ ...base, modelPool: { ...base.modelPool, poolId: "p2" } }),
    ).not.toBe(fp0);
    expect(
      fingerprintStudyValue({ ...base, modelPool: { ...base.modelPool, version: 4 } }),
    ).not.toBe(fp0);
    expect(
      fingerprintStudyValue({ ...base, modelPool: { ...base.modelPool, digest: "sha256:ww" } }),
    ).not.toBe(fp0);
    expect(fingerprintStudyValue({ ...base, judge1: { id: "mc:sha256:dd" } })).not.toBe(fp0);
    expect(fingerprintStudyValue({ ...base, policies: ["rank", "fuse"] })).not.toBe(fp0);
    expect(fingerprintStudyValue({ ...base, policies: ["fuse"] })).not.toBe(fp0);
  });

  it("is deterministic across calls with identical input", () => {
    const v = { x: 1, nested: { a: [1, 2], b: "s" } };
    expect(fingerprintStudyValue(v)).toBe(fingerprintStudyValue(v));
  });
});
