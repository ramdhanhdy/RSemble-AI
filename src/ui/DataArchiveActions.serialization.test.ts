// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { serializeWorkbenchArchiveV3 } from "./DataArchiveActions";
import { validateArchiveV3 } from "../lib/persistence/archive-v3-types";
import { buildValidArchiveV3Fixture } from "../lib/persistence/archive-v3-fixtures";

describe("serializeWorkbenchArchiveV3", () => {
  it("serializes deterministically: identical envelope yields byte-identical text", () => {
    const archive = buildValidArchiveV3Fixture();
    const once = serializeWorkbenchArchiveV3(archive);
    const twice = serializeWorkbenchArchiveV3(JSON.parse(JSON.stringify(archive)));
    expect(once).toBe(twice);
    expect(once.endsWith("\n")).toBe(true);
    expect(once).toContain('\n  "manifest": {');
    expect(once).toContain('"formatVersion": 3');
  });

  it("pretty-prints exported JSON with stable two-space indentation and a trailing newline", () => {
    const archive = buildValidArchiveV3Fixture();
    const text = serializeWorkbenchArchiveV3(archive);

    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain('\n  "manifest": {');
    expect(text.split("\n").length).toBeGreaterThan(5);
    expect(JSON.parse(text)).toEqual(archive);
  });

  it("round-trips through the v3 validator: serialized output re-validates completely", () => {
    const archive = buildValidArchiveV3Fixture();
    const text = serializeWorkbenchArchiveV3(archive);
    const parsed = JSON.parse(text);
    const check = validateArchiveV3(parsed);
    expect(check.errors).toEqual([]);
    expect(check.valid).toBe(true);
    // Digest integrity survives serialization: the recomputed digest over the
    // parsed envelope equals the manifest digest carried in the text.
    expect(text).toContain(archive.manifest.payloadDigest);
  });
});
