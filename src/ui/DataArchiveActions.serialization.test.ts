import { describe, expect, it } from "vitest";
import { serializeWorkbenchArchive } from "./DataArchiveActions";

describe("serializeWorkbenchArchive", () => {
  it("pretty-prints exported JSON with stable two-space indentation and a trailing newline", () => {
    const archive = {
      schemaVersion: 1,
      exportedAt: 123,
      runs: { summaries: [{ id: "run-1" }], details: [] },
      profiles: { identities: [], versions: [] },
      suites: [],
      experiments: [],
    };

    const text = serializeWorkbenchArchive(archive);

    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain('\n  "schemaVersion": 1,');
    expect(text).toContain('\n    "summaries": [');
    expect(text.split("\n").length).toBeGreaterThan(5);
    expect(JSON.parse(text)).toEqual(archive);
  });
});
