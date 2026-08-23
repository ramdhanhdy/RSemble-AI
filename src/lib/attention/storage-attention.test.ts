import { describe, expect, it } from "vitest";
import { StorageError } from "../persistence/database";
import { queryStorageAttention } from "./storage-attention";

describe("queryStorageAttention", () => {
  it.each(["quota", "unavailable", "validation", "conflict", "blocked", "versionchange"] as const)(
    "excludes classified storage error %s — no durable owner route",
    (kind) => {
      expect(
        queryStorageAttention({
          error: new StorageError(kind, "disk full sk-should-never-leak"),
        }),
      ).toEqual([]);
    },
  );

  it("excludes unsanitized raw payloads and missing diagnostics routes", () => {
    expect(
      queryStorageAttention({
        error: new StorageError("quota", "quota"),
        diagnosticsRouteExists: false,
        rawPayload: "QuotaExceeded: C:\\\\Users\\\\secret",
      }),
    ).toEqual([]);
  });
});
