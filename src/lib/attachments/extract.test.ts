import { describe, it, expect } from "vitest";
import { truncateText, readAsBase64 } from "./extract";
import { MAX_TEXT_CHARS_PER_FILE } from "./limits";

describe("truncateText", () => {
  it("returns text unchanged when under the limit", () => {
    const short = "hello world";
    const result = truncateText(short);
    expect(result.text).toBe(short);
    expect(result.truncated).toBe(false);
  });

  it("returns text unchanged at exactly the limit", () => {
    const exact = "x".repeat(MAX_TEXT_CHARS_PER_FILE);
    const result = truncateText(exact);
    expect(result.text).toBe(exact);
    expect(result.truncated).toBe(false);
  });

  it("truncates text over the limit and appends marker", () => {
    const over = "x".repeat(MAX_TEXT_CHARS_PER_FILE + 100);
    const result = truncateText(over);
    expect(result.text.length).toBeLessThanOrEqual(over.length);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("[truncated:");
    expect(result.text).toContain(`${MAX_TEXT_CHARS_PER_FILE} of ${over.length} characters shown`);
  });

  it("truncated text starts with the original content", () => {
    const over = "abcdef".repeat(MAX_TEXT_CHARS_PER_FILE + 100);
    const result = truncateText(over);
    expect(result.text.startsWith("abcdef")).toBe(true);
  });
});

describe("readAsBase64", () => {
  it("round-trips a small buffer", async () => {
    const content = "hello world";
    const file = new File([content], "test.txt");
    const b64 = await readAsBase64(file);
    expect(atob(b64)).toBe(content);
  });

  it("handles a buffer larger than one chunk (8192 bytes)", async () => {
    const size = 20_000;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i % 256;
    const file = new File([bytes], "large.bin");
    const b64 = await readAsBase64(file);
    const decoded = atob(b64);
    expect(decoded.length).toBe(size);
    // Verify byte values round-trip
    for (let i = 0; i < size; i += 1000) {
      expect(decoded.charCodeAt(i)).toBe(i % 256);
    }
  });

  it("produces no data-URL prefix", async () => {
    const file = new File(["test"], "test.txt");
    const b64 = await readAsBase64(file);
    expect(b64.startsWith("data:")).toBe(false);
  });
});
