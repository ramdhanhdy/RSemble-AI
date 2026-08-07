import { describe, it, expect } from "vitest";
import {
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  MAX_TEXT_CHARS_PER_FILE,
  MAX_TEXT_CHARS_TOTAL,
  MAX_IMAGE_DIM,
  admitFiles,
} from "./limits";

function makeFile(name: string, size: number): File {
  return new File([new Uint8Array(size)], name);
}

describe("constants", () => {
  it("matches spec §3.1 values", () => {
    expect(MAX_FILES).toBe(10);
    expect(MAX_FILE_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_TOTAL_BYTES).toBe(40 * 1024 * 1024);
    expect(MAX_TEXT_CHARS_PER_FILE).toBe(40_000);
    expect(MAX_TEXT_CHARS_TOTAL).toBe(120_000);
    expect(MAX_IMAGE_DIM).toBe(4096);
  });
});

describe("admitFiles", () => {
  it("accepts files within all limits", () => {
    const files = [makeFile("a.png", 1024), makeFile("b.pdf", 2048)];
    const result = admitFiles([], files);
    expect(result.accepted).toHaveLength(2);
    expect(result.rejections).toHaveLength(0);
  });

  it("rejects files over MAX_FILE_BYTES", () => {
    const files = [makeFile("big.png", MAX_FILE_BYTES + 1)];
    const result = admitFiles([], files);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].reason).toContain("maximum");
  });

  it("rejects files that would exceed MAX_TOTAL_BYTES", () => {
    const existing = [{ bytes: MAX_TOTAL_BYTES - 1024 }];
    const files = [makeFile("a.png", 2048)];
    const result = admitFiles(existing, files);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].reason).toContain("total attachment limit");
  });

  it("rejects files over MAX_FILES count", () => {
    const existing = Array.from({ length: MAX_FILES }, () => ({ bytes: 100 }));
    const files = [makeFile("extra.png", 1024)];
    const result = admitFiles(existing, files);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].reason).toContain(`Maximum ${MAX_FILES} files`);
  });

  it("partial admission keeps non-offending files", () => {
    const files = [
      makeFile("ok.png", 1024),
      makeFile("too-big.png", MAX_FILE_BYTES + 1),
      makeFile("also-ok.pdf", 2048),
    ];
    const result = admitFiles([], files);
    expect(result.accepted).toHaveLength(2);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].name).toBe("too-big.png");
  });

  it("accumulates total bytes across admitted files", () => {
    const files = [
      makeFile("a.png", 1024),
      makeFile("b.png", 1024),
      makeFile("c.png", MAX_TOTAL_BYTES - 2048 + 1), // would exceed total
    ];
    const result = admitFiles([], files);
    expect(result.accepted).toHaveLength(2);
    expect(result.rejections).toHaveLength(1);
  });

  it("handles empty existing and empty incoming", () => {
    const result = admitFiles([], []);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejections).toHaveLength(0);
  });
});
