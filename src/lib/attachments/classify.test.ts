import { describe, it, expect } from "vitest";
import { classifyFile, sanitizeName } from "./classify";

function makeFile(name: string, type: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("classifyFile", () => {
  // --- accepted types ---

  it("accepts image/png by MIME", () => {
    const result = classifyFile(makeFile("chart.png", "image/png"));
    expect(result).toEqual({ kind: "image", mimeType: "image/png" });
  });

  it("accepts image/jpeg by MIME", () => {
    const result = classifyFile(makeFile("photo.jpg", "image/jpeg"));
    expect(result).toEqual({ kind: "image", mimeType: "image/jpeg" });
  });

  it("accepts image/webp by MIME", () => {
    const result = classifyFile(makeFile("pic.webp", "image/webp"));
    expect(result).toEqual({ kind: "image", mimeType: "image/webp" });
  });

  it("accepts image/gif by MIME", () => {
    const result = classifyFile(makeFile("anim.gif", "image/gif"));
    expect(result).toEqual({ kind: "image", mimeType: "image/gif" });
  });

  it("accepts application/pdf by MIME", () => {
    const result = classifyFile(makeFile("report.pdf", "application/pdf"));
    expect(result).toEqual({ kind: "pdf", mimeType: "application/pdf" });
  });

  it("accepts text/markdown by MIME", () => {
    const result = classifyFile(makeFile("notes.md", "text/markdown"));
    expect(result).toEqual({ kind: "text", mimeType: "text/markdown" });
  });

  it("accepts text/plain by MIME", () => {
    const result = classifyFile(makeFile("readme.txt", "text/plain"));
    expect(result).toEqual({ kind: "text", mimeType: "text/plain" });
  });

  it("accepts text/csv by MIME", () => {
    const result = classifyFile(makeFile("data.csv", "text/csv"));
    expect(result).toEqual({ kind: "text", mimeType: "text/csv" });
  });

  it("accepts application/json by MIME", () => {
    const result = classifyFile(makeFile("config.json", "application/json"));
    expect(result).toEqual({ kind: "text", mimeType: "application/json" });
  });

  it("accepts .docx by MIME", () => {
    const result = classifyFile(
      makeFile("doc.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    );
    expect(result).toEqual({
      kind: "doc",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  });

  // --- extension fallback (browser reports "" for MIME) ---

  it("accepts .png by extension when MIME is empty", () => {
    const result = classifyFile(makeFile("chart.png", ""));
    expect(result).toEqual({ kind: "image", mimeType: "image/png" });
  });

  it("accepts .jpg by extension when MIME is empty", () => {
    const result = classifyFile(makeFile("photo.jpg", ""));
    expect(result).toEqual({ kind: "image", mimeType: "image/jpeg" });
  });

  it("accepts .pdf by extension when MIME is empty", () => {
    const result = classifyFile(makeFile("report.pdf", ""));
    expect(result).toEqual({ kind: "pdf", mimeType: "application/pdf" });
  });

  it("accepts .md by extension when MIME is empty", () => {
    const result = classifyFile(makeFile("notes.md", ""));
    expect(result).toEqual({ kind: "text", mimeType: "text/markdown" });
  });

  it("accepts .ts by extension when MIME is empty", () => {
    const result = classifyFile(makeFile("index.ts", ""));
    expect(result).toEqual({ kind: "text", mimeType: "text/plain" });
  });

  it("accepts .py by extension when MIME is empty", () => {
    const result = classifyFile(makeFile("script.py", ""));
    expect(result).toEqual({ kind: "text", mimeType: "text/plain" });
  });

  it("accepts .docx by extension when MIME is empty", () => {
    const result = classifyFile(makeFile("doc.docx", ""));
    expect(result).toEqual({
      kind: "doc",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  });

  it("accepts source code extensions as text", () => {
    const exts = ["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "sql", "yml", "yaml", "toml"];
    for (const ext of exts) {
      const result = classifyFile(makeFile(`file.${ext}`, ""));
      expect(result).toHaveProperty("kind", "text");
    }
  });

  // --- rejections ---

  it("rejects .doc with legacy reason", () => {
    const result = classifyFile(makeFile("old.doc", ""));
    expect(result).toHaveProperty("rejected");
    expect((result as { rejected: string }).rejected).toContain("Legacy .doc");
  });

  it("rejects archives", () => {
    for (const ext of ["zip", "tar", "gz", "rar", "7z"]) {
      const result = classifyFile(makeFile(`archive.${ext}`, ""));
      expect(result).toHaveProperty("rejected");
    }
  });

  it("rejects audio files", () => {
    for (const ext of ["mp3", "wav", "ogg"]) {
      const result = classifyFile(makeFile(`audio.${ext}`, ""));
      expect(result).toHaveProperty("rejected");
    }
  });

  it("rejects video files", () => {
    for (const ext of ["mp4", "webm", "avi", "mov"]) {
      const result = classifyFile(makeFile(`video.${ext}`, ""));
      expect(result).toHaveProperty("rejected");
    }
  });

  it("rejects spreadsheets", () => {
    for (const ext of ["xlsx", "xls", "ods"]) {
      const result = classifyFile(makeFile(`sheet.${ext}`, ""));
      expect(result).toHaveProperty("rejected");
    }
  });

  it("rejects unknown extensions", () => {
    const result = classifyFile(makeFile("file.xyz", ""));
    expect(result).toHaveProperty("rejected");
    expect((result as { rejected: string }).rejected).toContain("Unsupported file type");
  });

  it("rejects files with no extension", () => {
    const result = classifyFile(makeFile("noext", ""));
    expect(result).toHaveProperty("rejected");
  });

  // --- edge cases ---

  it("handles case-insensitive extensions", () => {
    const result = classifyFile(makeFile("CHART.PNG", ""));
    expect(result).toHaveProperty("kind", "image");
  });

  it("handles .heic by extension", () => {
    const result = classifyFile(makeFile("photo.heic", ""));
    expect(result).toEqual({ kind: "image", mimeType: "image/heic" });
  });

  it("handles .heif by extension", () => {
    const result = classifyFile(makeFile("photo.heif", ""));
    expect(result).toEqual({ kind: "image", mimeType: "image/heif" });
  });
});

describe("sanitizeName", () => {
  it("strips control characters", () => {
    expect(sanitizeName("file\x00name\x1f.png")).toBe("file name .png");
  });

  it("strips ANSI escape sequences", () => {
    expect(sanitizeName("file\x1b[31mred\x1b[0m.png")).toBe("filered.png");
  });

  it("collapses whitespace", () => {
    expect(sanitizeName("file   name\t\t.png")).toBe("file name .png");
  });

  it("trims leading/trailing whitespace", () => {
    expect(sanitizeName("  file.png  ")).toBe("file.png");
  });

  it("caps at 120 characters", () => {
    const long = "a".repeat(200) + ".png";
    expect(sanitizeName(long).length).toBeLessThanOrEqual(120);
  });

  it("handles path traversal attempts", () => {
    expect(sanitizeName("..\\..\\etc\\passwd")).toBe("..\\..\\etc\\passwd");
  });

  it("handles CRLF injection", () => {
    expect(sanitizeName("file\r\nname.png")).toBe("file name.png");
  });
});