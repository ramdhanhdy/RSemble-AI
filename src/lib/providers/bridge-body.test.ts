// =============================================================================
// Bridge body preflight tests — Plan 003 workstream E
// =============================================================================

import { describe, expect, it } from "vitest";
import { assertBridgeBodyWithinLimit, buildBridgeRequestBody } from "./bridge-body";
import { ProviderError } from "./types";

describe("assertBridgeBodyWithinLimit", () => {
  it("passes a body at or under the limit", () => {
    expect(() =>
      assertBridgeBodyWithinLimit(
        '{"a":"x".repeat(100)}'.replace('"x".repeat(100)', "x".repeat(100)),
        "umans",
        4096,
      ),
    ).not.toThrow();
  });

  it("throws a ProviderError naming the encoded size and limit when over", () => {
    const body = "y".repeat(5000);
    const err = (() => {
      try {
        assertBridgeBodyWithinLimit(body, "umans", 1024);
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).providerId).toBe("umans");
    expect((err as ProviderError).message).toMatch(/bridge limit/i);
    expect((err as ProviderError).message).toContain("Reduce attachment sizes");
  });
});

describe("buildBridgeRequestBody", () => {
  it("serializes without preflight when the payload has no parts", () => {
    const body = buildBridgeRequestBody({ model: "m", messages: [] }, "umans", false, 16);
    expect(typeof body).toBe("string");
  });

  it("preflights part-bearing payloads against the ceiling", () => {
    const payload = {
      model: "m",
      messages: [{ role: "user", content: [{ type: "text", text: "z".repeat(2000) }] }],
    };
    expect(() => buildBridgeRequestBody(payload, "clinepass", true, 512)).toThrow(ProviderError);
  });
});
