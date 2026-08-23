import { describe, expect, it } from "vitest";
import {
  SEARCH_DOCUMENT_TYPES,
  parseSearchDocument,
} from "./search-types";

const valid = {
  type: "task" as const,
  id: "task-1",
  revision: 1,
  title: "Draft a brief",
  subtitle: "Canonical task",
  ownerHref: "/tasks/task-1",
  tokens: ["draft", "brief"],
  updatedAt: 1000,
  indexSchemaVersion: 1,
};

describe("search documents", () => {
  it("accepts every searchable type", () => {
    for (const type of SEARCH_DOCUMENT_TYPES) {
      expect(parseSearchDocument({ ...valid, type, id: type }).type).toBe(type);
    }
  });

  it("rejects unknown types and missing owner routes", () => {
    expect(() => parseSearchDocument({ ...valid, type: "secret" })).toThrow(/unknown search type/i);
    expect(() => parseSearchDocument({ ...valid, ownerHref: "" })).toThrow(/ownerHref/i);
  });

  it("rejects credentials, raw output, rationale, and attachments", () => {
    expect(() => parseSearchDocument({ ...valid, title: "sk-abc123_secret" })).toThrow(/secret/i);
    expect(() => parseSearchDocument({ ...valid, output: "model said hello" })).toThrow(/unsafe/i);
    expect(() => parseSearchDocument({ ...valid, rationale: "because" })).toThrow(/unsafe/i);
    expect(() => parseSearchDocument({ ...valid, attachment: "file.bin" })).toThrow(/unsafe/i);
    expect(() => parseSearchDocument({ ...valid, error: "QuotaExceeded sk-leak" })).toThrow(/unsafe/i);
  });

  it("rejects prototype-polluting keys", () => {
    const polluted = JSON.parse('{"type":"task","id":"t","revision":1,"title":"T","subtitle":"s","ownerHref":"/tasks/t","tokens":["t"],"updatedAt":1,"indexSchemaVersion":1,"__proto__":{"admin":true}}');
    expect(() => parseSearchDocument(polluted)).toThrow(/unsafe/i);
  });
});
