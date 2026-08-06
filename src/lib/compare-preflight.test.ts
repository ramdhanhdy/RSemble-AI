import { describe, expect, it } from "vitest";
import { evaluateComparePreflight } from "./compare-preflight";
import type { ModelSlot } from "../studio-data";
import type { Attachment } from "./attachments/types";

const slots: ModelSlot[] = [
  {
    id: "s1",
    providerId: "openrouter",
    provider: "OpenRouter",
    model: "A",
    slug: "a",
    enabled: true,
  },
  { id: "s2", providerId: "9router", provider: "9Router", model: "B", slug: "b", enabled: true },
];
const ready = { openrouter: true, "9router": true, gemini: true } as const;
const base = {
  running: false,
  experimentActive: false,
  prompt: "task",
  slots,
  readinessMap: ready,
  critic: { providerId: "openrouter" as const, model: "judge" },
  attachments: [] as Attachment[],
};

describe("Compare preflight", () => {
  it("uses the locked zero- and one-candidate messages", () => {
    expect(evaluateComparePreflight({ ...base, slots: [] })).toMatchObject({
      ok: false,
      code: "candidate-count",
      message: "Enable at least two candidate models.",
    });
    expect(
      evaluateComparePreflight({
        ...base,
        slots: [
          { ...slots[0], enabled: true },
          { ...slots[1], enabled: false },
        ],
      }),
    ).toMatchObject({
      ok: false,
      code: "candidate-count",
      message: "Add or enable one more candidate to compare.",
    });
  });
  it("identifies the exact unavailable candidate and Judge", () => {
    expect(
      evaluateComparePreflight({
        ...base,
        readinessMap: { ...ready, "9router": false },
        readinessReasons: { "9router": "Bridge unavailable" },
      }),
    ).toMatchObject({
      ok: false,
      code: "candidate-provider",
      message: expect.stringContaining("9Router (B) is unavailable: Bridge unavailable"),
    });
    expect(
      evaluateComparePreflight({
        ...base,
        critic: { providerId: "gemini", model: "judge" },
        readinessMap: { ...ready, gemini: false },
        readinessReasons: { gemini: "Missing key" },
      }),
    ).toMatchObject({
      ok: false,
      code: "judge-provider",
      message: expect.stringContaining("Judge gemini:judge is unavailable: Missing key"),
    });
  });
  it("distinguishes reading and failed attachments", () => {
    const attachment = {
      id: "a",
      name: "brief.pdf",
      kind: "pdf",
      mimeType: "application/pdf",
      bytes: 1,
      status: "reading",
    } as Attachment;
    expect(evaluateComparePreflight({ ...base, attachments: [attachment] })).toMatchObject({
      ok: false,
      code: "attachment-reading",
    });
    expect(
      evaluateComparePreflight({
        ...base,
        attachments: [{ ...attachment, status: "error", error: "parse failed" }],
      }),
    ).toMatchObject({
      ok: false,
      code: "attachment-failed",
      message: expect.stringContaining("parse failed"),
    });
  });
  it("blocks an encoded transport payload before a paid call", () => {
    expect(
      evaluateComparePreflight({
        ...base,
        transport: { blocked: true, message: "Bridge payload exceeds 64 MiB encoded limit." },
      }),
    ).toMatchObject({
      ok: false,
      code: "transport-size",
      message: expect.stringContaining("64 MiB"),
    });
  });
  it("allows two ready candidates when Judge and inputs are ready", () => {
    expect(evaluateComparePreflight(base)).toEqual({ ok: true });
  });
});
