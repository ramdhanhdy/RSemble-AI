// Attention is a read model. No persist, dismiss, status, or execute API.

export const ATTENTION_KINDS = [
  "comparison_recovery",
  "evaluation_recovery",
  "storage_preservation",
] as const;

export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export const ATTENTION_REASON_CODES = [
  "comparison_interrupted",
  "comparison_candidate_recoverable",
  "comparison_judge_recoverable",
  "comparison_fusion_recoverable",
  "evaluation_interrupted",
  "evaluation_tasks_incomplete",
  "evaluation_cells_repairable",
  "storage_write_failed",
  "storage_quota_blocked",
  "storage_unavailable",
] as const;

export type AttentionReasonCode = (typeof ATTENTION_REASON_CODES)[number];

export const ATTENTION_SEVERITIES = ["blocking", "actionable"] as const;
export type AttentionSeverity = (typeof ATTENTION_SEVERITIES)[number];

export interface AttentionReasonCopy {
  label: string;
  summary: string;
}

export const ATTENTION_REASON_COPY: Record<AttentionReasonCode, AttentionReasonCopy> = {
  comparison_interrupted: {
    label: "Interrupted comparison",
    summary: "Open the comparison result. Attention does not resume it.",
  },
  comparison_candidate_recoverable: {
    label: "Comparison candidate recoverable",
    summary: "A candidate stage failed. Recovery lives on the live Compare session only.",
  },
  comparison_judge_recoverable: {
    label: "Comparison judge recoverable",
    summary: "Judge failed. Recovery lives on the live Compare session only.",
  },
  comparison_fusion_recoverable: {
    label: "Comparison fusion recoverable",
    summary: "Fusion failed. Recovery lives on the live Compare session only.",
  },
  evaluation_interrupted: {
    label: "Interrupted evaluation",
    summary: "Retry incomplete tasks on the evaluation result page.",
  },
  evaluation_tasks_incomplete: {
    label: "Incomplete evaluation tasks",
    summary: "Retry incomplete or failed planned attempts on the evaluation result page.",
  },
  evaluation_cells_repairable: {
    label: "Repairable missing cells",
    summary: "Complete missing results on the evaluation result page.",
  },
  storage_write_failed: {
    label: "Storage write failed",
    summary: "No durable Attention owner exists for a write failure.",
  },
  storage_quota_blocked: {
    label: "Storage quota blocked",
    summary: "No durable Attention owner exists for a quota failure.",
  },
  storage_unavailable: {
    label: "Storage unavailable",
    summary: "No durable Attention owner exists for unavailable storage.",
  },
};

export interface AttentionItem {
  key: string;
  kind: AttentionKind;
  sourceId: string;
  ownerHref: string;
  title: string;
  summary: string;
  reasonCode: AttentionReasonCode;
  severity: AttentionSeverity;
  occurredAt: number;
  supersessionKey: string;
}

const CREDENTIAL_LIKE = /sk-[A-Za-z0-9_-]{6,}|AIza[A-Za-z0-9_-]{10,}|Bearer\s+\S+/i;
const PROHIBITED_LIFECYCLE = new Set(["status", "dismissed", "dismiss", "snooze"]);
const PROHIBITED_CALLBACK = /^on[A-Z]/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export function isAttentionReasonCode(v: unknown): v is AttentionReasonCode {
  return typeof v === "string" && (ATTENTION_REASON_CODES as readonly string[]).includes(v);
}

export function isAttentionKind(v: unknown): v is AttentionKind {
  return typeof v === "string" && (ATTENTION_KINDS as readonly string[]).includes(v);
}

export function isAttentionSeverity(v: unknown): v is AttentionSeverity {
  return typeof v === "string" && (ATTENTION_SEVERITIES as readonly string[]).includes(v);
}

function assertNoSecrets(label: string, value: string): void {
  if (CREDENTIAL_LIKE.test(value)) {
    throw new Error(`Attention ${label} must not contain secret text`);
  }
}

export function parseAttentionItem(input: unknown): AttentionItem {
  if (!isRecord(input)) {
    throw new Error("Attention item must be an object");
  }
  for (const key of Object.keys(input)) {
    if (PROHIBITED_LIFECYCLE.has(key)) {
      throw new Error("Attention item must not carry lifecycle fields");
    }
    if (PROHIBITED_CALLBACK.test(key) || typeof input[key] === "function") {
      throw new Error("Attention item must not carry a callback");
    }
  }
  if (!isAttentionKind(input.kind)) {
    throw new Error("Unknown attention kind");
  }
  if (!isAttentionReasonCode(input.reasonCode)) {
    throw new Error("Unknown attention reason");
  }
  if (!isAttentionSeverity(input.severity)) {
    throw new Error("Unknown attention severity");
  }
  const required = ["key", "sourceId", "ownerHref", "title", "summary", "supersessionKey"] as const;
  for (const field of required) {
    if (!isNonEmptyString(input[field])) {
      throw new Error(`Attention ${field} must be a non-empty string`);
    }
    assertNoSecrets(field, input[field] as string);
  }
  if (typeof input.occurredAt !== "number" || !Number.isFinite(input.occurredAt)) {
    throw new Error("Attention occurredAt must be a finite number");
  }
  return {
    key: input.key as string,
    kind: input.kind,
    sourceId: input.sourceId as string,
    ownerHref: input.ownerHref as string,
    title: input.title as string,
    summary: input.summary as string,
    reasonCode: input.reasonCode,
    severity: input.severity,
    occurredAt: input.occurredAt,
    supersessionKey: input.supersessionKey as string,
  };
}

export function isAttentionItem(v: unknown): v is AttentionItem {
  try {
    parseAttentionItem(v);
    return true;
  } catch {
    return false;
  }
}
