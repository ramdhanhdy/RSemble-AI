import { describe, expect, it } from "vitest";
import {
  ATTENTION_KINDS,
  ATTENTION_REASON_CODES,
  ATTENTION_REASON_COPY,
  isAttentionItem,
  parseAttentionItem,
} from "./attention-types";

const valid = {
  key: "eval:exp-1:evaluation_interrupted",
  kind: "evaluation_recovery",
  sourceId: "exp-1",
  ownerHref: "/evaluations/results/exp-1",
  title: "Interrupted evaluation",
  summary: "Retry incomplete tasks on the result page.",
  reasonCode: "evaluation_interrupted",
  severity: "actionable",
  occurredAt: 1_700_000_000_000,
  supersessionKey: "evaluation:exp-1",
} as const;

describe("Attention domain", () => {
  it("accepts a complete evaluation recovery item", () => {
    const item = parseAttentionItem(valid);
    expect(item.sourceId).toBe("exp-1");
    expect(item.ownerHref).toBe("/evaluations/results/exp-1");
    expect(item.reasonCode).toBe("evaluation_interrupted");
    expect(isAttentionItem(item)).toBe(true);
  });

  it("rejects an unknown reason code", () => {
    expect(() => parseAttentionItem({ ...valid, reasonCode: "vibes_off" })).toThrow(
      /unknown attention reason/i,
    );
  });

  it("rejects unknown kind or severity", () => {
    expect(() => parseAttentionItem({ ...valid, kind: "inbox_item" })).toThrow(
      /unknown attention kind/i,
    );
    expect(() => parseAttentionItem({ ...valid, severity: "urgent" })).toThrow(
      /unknown attention severity/i,
    );
  });

  it("rejects secret-shaped copy and credential-like identifiers", () => {
    expect(() => parseAttentionItem({ ...valid, summary: "retry with sk-abc123secret" })).toThrow(
      /secret/i,
    );
    expect(() => parseAttentionItem({ ...valid, sourceId: "sk-live-not-an-id" })).toThrow(
      /secret/i,
    );
  });

  it("rejects lifecycle or execution fields", () => {
    expect(() => parseAttentionItem({ ...valid, status: "open" })).toThrow(/lifecycle/i);
    expect(() => parseAttentionItem({ ...valid, dismissed: true })).toThrow(/lifecycle/i);
    expect(() => parseAttentionItem({ ...valid, onRecover: () => undefined })).toThrow(/callback/i);
  });

  it("exposes fixed copy for every controlled reason", () => {
    for (const code of ATTENTION_REASON_CODES) {
      expect(ATTENTION_REASON_COPY[code].label.length).toBeGreaterThan(0);
      expect(ATTENTION_REASON_COPY[code].summary.length).toBeGreaterThan(0);
    }
    expect(ATTENTION_KINDS).toEqual([
      "comparison_recovery",
      "evaluation_recovery",
      "storage_preservation",
    ]);
  });
});
