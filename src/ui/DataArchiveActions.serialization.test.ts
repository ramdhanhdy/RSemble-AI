// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { serializeWorkbenchArchive, serializeWorkbenchArchiveV2 } from "./DataArchiveActions";
import { parseWorkbenchArchive, type WorkbenchArchiveV1 } from "../lib/persistence/archive";
import { validateArchiveV2 } from "../lib/persistence/archive-v2-types";
import { buildValidArchiveV2Fixture } from "../lib/persistence/archive-v2-fixtures";

// A valid v1 archive with empty collections — the same shape export produces
// for a fresh workbench. Every collection array is empty so the record guards
// in parseWorkbenchArchive pass trivially, making this a real round-trip
// fixture rather than a structurally-shaped-but-invalid blob.
const validArchive: WorkbenchArchiveV1 = {
  schemaVersion: 1,
  exportedAt: 123,
  runs: { summaries: [], details: [] },
  profiles: { identities: [], versions: [] },
  suites: [],
  experiments: [],
};

describe("serializeWorkbenchArchive", () => {
  it("pretty-prints exported JSON with stable two-space indentation and a trailing newline", () => {
    const text = serializeWorkbenchArchive(validArchive);

    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain('\n  "schemaVersion": 1,');
    expect(text).toContain('\n    "summaries": [');
    expect(text.split("\n").length).toBeGreaterThan(5);
    expect(JSON.parse(text)).toEqual(validArchive);
  });

  it("round-trips through parseWorkbenchArchive: the serialized output re-imports as an equivalent valid archive", () => {
    // Serialize → parse the JSON text → feed the parsed value through the real
    // import validator. This observes the actual production import path, not
    // just JSON.parse equivalence: parseWorkbenchArchive re-checks schema
    // version, structure, limits, safe IDs, and every record guard before
    // returning ok. A serialization that produced structurally-invalid output
    // (wrong key names, dropped fields, extra prohibited keys) would fail here.
    const text = serializeWorkbenchArchive(validArchive);
    const parsed = JSON.parse(text);
    const check = parseWorkbenchArchive(parsed);

    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.archive).toEqual(validArchive);
    }
  });
});

describe("serializeWorkbenchArchiveV2", () => {
  it("serializes deterministically: identical envelope yields byte-identical text", () => {
    const archive = buildValidArchiveV2Fixture();
    const once = serializeWorkbenchArchiveV2(archive);
    const twice = serializeWorkbenchArchiveV2(JSON.parse(JSON.stringify(archive)));
    expect(once).toBe(twice);
    expect(once.endsWith("\n")).toBe(true);
    expect(once).toContain('\n  "manifest": {');
    expect(once).toContain('"formatVersion": 2');
  });

  it("round-trips through the v2 validator: serialized output re-validates completely", () => {
    const archive = buildValidArchiveV2Fixture();
    const text = serializeWorkbenchArchiveV2(archive);
    const check = validateArchiveV2(JSON.parse(text));
    expect(check.errors).toEqual([]);
    expect(check.valid).toBe(true);
    // Digest integrity survives serialization: the recomputed digest over the
    // parsed envelope equals the manifest digest carried in the text.
    expect(text).toContain(archive.manifest.payloadDigest);
  });

  it("keeps the v1 serializer byte-stable for the same v1 input", () => {
    const text = serializeWorkbenchArchive(validArchive);
    expect(text).toBe(serializeWorkbenchArchive(validArchive));
    expect(parseWorkbenchArchive(JSON.parse(text)).ok).toBe(true);
  });
});
