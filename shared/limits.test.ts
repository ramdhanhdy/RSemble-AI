// =============================================================================
// Shared limits contract tests — Plan 003 workstream E / Plan 002 D4
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  BRIDGE_MAX_BODY_BYTES,
  MAX_ATTACHMENT_FILE_BYTES,
  MAX_ATTACHMENT_FILES,
  MAX_ATTACHMENT_TOTAL_BYTES,
  projectEncodedBridgeBodyBytes,
} from "./limits";

describe("attachment size authority (Plan 002 D4)", () => {
  it("keeps the documented raw limits", () => {
    expect(MAX_ATTACHMENT_FILES).toBe(10);
    expect(MAX_ATTACHMENT_FILE_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_ATTACHMENT_TOTAL_BYTES).toBe(40 * 1024 * 1024);
  });

  it("sets the bridge encoded ceiling to 64 MiB", () => {
    expect(BRIDGE_MAX_BODY_BYTES).toBe(64 * 1024 * 1024);
  });

  it("proves the maximum UI-admitted raw set fits the encoded bridge ceiling", () => {
    const encoded = projectEncodedBridgeBodyBytes(MAX_ATTACHMENT_TOTAL_BYTES);
    expect(encoded).toBeLessThan(BRIDGE_MAX_BODY_BYTES);
    // 40 MiB raw base64 expands to ~53.4 MiB; the 64 MiB ceiling leaves a
    // margin for JSON envelopes.
    const mib = encoded / (1024 * 1024);
    expect(mib).toBeGreaterThan(53);
    expect(mib).toBeLessThan(64);
  });
});
