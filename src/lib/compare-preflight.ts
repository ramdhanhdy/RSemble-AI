// =============================================================================
// Compare preflight — one deterministic, user-actionable gate for every entry
// point. This module is provider-agnostic and performs no network calls.
// =============================================================================

import type { Attachment } from "./attachments/types";
import type { AttachmentEligibility } from "./pipeline";
import type { CriticRef, ProviderId } from "./providers/types";
import type { ModelSlot } from "../studio-data";

export type CompareBlockCode =
  | "active-execution"
  | "missing-task"
  | "candidate-count"
  | "candidate-provider"
  | "judge-provider"
  | "attachment-reading"
  | "attachment-failed"
  | "attachment-capability"
  | "transport-size";

export type ComparePreflight =
  | { ok: true }
  | { ok: false; code: CompareBlockCode; message: string; details?: unknown };

export interface ComparePreflightInput {
  running: boolean;
  experimentActive: boolean;
  prompt: string;
  slots: ModelSlot[];
  readinessMap: Partial<Record<ProviderId, boolean>>;
  readinessReasons?: Partial<Record<ProviderId, string>>;
  critic: CriticRef;
  attachments: Attachment[];
  attachmentEligibility?: AttachmentEligibility;
  /** Optional transport preflight result supplied by bridge-body serialization. */
  transport?: { blocked: boolean; message: string };
}

/**
 * Stable preflight order. Every UI command and the controller should consult
 * this result before creating a paid attempt; provider adapters remain the
 * final transport-size/capability boundary.
 */
export function evaluateComparePreflight(input: ComparePreflightInput): ComparePreflight {
  if (input.running || input.experimentActive) {
    return { ok: false, code: "active-execution", message: "Another execution is already active." };
  }
  if (input.prompt.trim().length === 0) {
    return { ok: false, code: "missing-task", message: "Enter a task to run." };
  }

  const enabled = input.slots.filter((slot) => slot.enabled);
  if (enabled.length === 0) {
    return { ok: false, code: "candidate-count", message: "Enable at least two candidate models.", details: { count: 0 } };
  }
  if (enabled.length === 1) {
    return { ok: false, code: "candidate-count", message: "Add or enable one more candidate to compare.", details: { count: 1 } };
  }

  const unavailableCandidate = enabled.find((slot) => input.readinessMap[slot.providerId] !== true);
  if (unavailableCandidate) {
    const reason = input.readinessReasons?.[unavailableCandidate.providerId];
    return {
      ok: false,
      code: "candidate-provider",
      message: `${unavailableCandidate.provider} (${unavailableCandidate.model}) is unavailable${reason ? `: ${reason}` : "."}`,
      details: { slotId: unavailableCandidate.id, providerId: unavailableCandidate.providerId },
    };
  }

  if (input.readinessMap[input.critic.providerId] !== true) {
    const reason = input.readinessReasons?.[input.critic.providerId];
    return {
      ok: false,
      code: "judge-provider",
      message: `Judge ${input.critic.providerId}:${input.critic.model} is unavailable${reason ? `: ${reason}` : "."}`,
      details: { providerId: input.critic.providerId, model: input.critic.model },
    };
  }

  const reading = input.attachments.find((a) => a.status === "reading" || a.status === "extracting");
  if (reading) {
    return {
      ok: false,
      code: "attachment-reading",
      message: `Waiting for attachment to finish reading: ${reading.name}.`,
      details: { attachmentId: reading.id },
    };
  }
  const failed = input.attachments.find((a) => a.status === "error");
  if (failed) {
    return {
      ok: false,
      code: "attachment-failed",
      message: `Attachment failed: ${failed.name} — ${failed.error ?? "remove or retry it"}.`,
      details: { attachmentId: failed.id, error: failed.error },
    };
  }
  if (input.attachmentEligibility && "blocked" in input.attachmentEligibility) {
    return { ok: false, code: "attachment-capability", message: input.attachmentEligibility.blocked };
  }
  if (input.transport?.blocked) {
    return { ok: false, code: "transport-size", message: input.transport.message };
  }
  return { ok: true };
}
