// =============================================================================
// RSemble AI — Protocol fingerprint (spec §11.1)
//
// sha256:<lowercase hex> over UTF-8 canonical JSON. Object keys are recursively
// sorted; semantically ordered arrays (tasks, criteria) retain order.
// Includes task instructions, generation parameters, pinned profile versions,
// Judge model/instruction, and aggregation policy. Excludes experiment IDs,
// timestamps, execution status, outputs, and display-only metadata.
// =============================================================================

import type {
  EvaluationSuite,
  EvaluationProfile,
  EvaluationTask,
  EvaluationSelection,
  ExperimentSnapshot,
} from "./evaluation-types";
import type { ModelSlot } from "../../studio-data";
import {
  DEFAULT_REASONING_POLICY,
  type ProviderId,
  type ReasoningPolicy,
} from "../providers/types";

/**
 * Recursively sort object keys to produce canonical JSON.
 * Arrays retain their order (tasks, criteria are semantically ordered).
 */
export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeys(obj[key]);
  }
  return sorted;
}

/**
 * Semantic pieces that make up the canonical fingerprint input. Extracted so
 * the suite-based and snapshot-based computations share ONE input builder and
 * can never diverge (roster spec §B3). Only semantic content is included — no
 * IDs, timestamps, statuses, or metadata.
 */
interface SemanticFingerprintPieces {
  tasks: Array<
    Pick<
      EvaluationTask,
      "title" | "prompt" | "systemPrompt" | "evaluation" | "judgeInstructionOverride" | "order"
    >
  >;
  modelSlots: Array<Pick<ModelSlot, "providerId" | "slug" | "model" | "enabled">>;
  defaultJudge: { providerId: ProviderId; model: string };
  defaultEvaluation: EvaluationSelection;
  profiles: EvaluationProfile[];
  reasoningPolicy: ReasoningPolicy;
}

function semanticFingerprintInput(pieces: SemanticFingerprintPieces): unknown {
  return {
    tasks: pieces.tasks.map((t) => ({
      title: t.title,
      prompt: t.prompt,
      systemPrompt: t.systemPrompt,
      evaluation: t.evaluation,
      judgeInstructionOverride: t.judgeInstructionOverride,
      order: t.order,
    })),
    modelSlots: pieces.modelSlots.map((s) => ({
      providerId: s.providerId,
      slug: s.slug,
      model: s.model,
      enabled: s.enabled,
    })),
    defaultJudge: {
      providerId: pieces.defaultJudge.providerId,
      model: pieces.defaultJudge.model,
    },
    defaultEvaluation: pieces.defaultEvaluation,
    reasoningPolicy: pieces.reasoningPolicy,
    profiles: pieces.profiles.map((p) => ({
      id: p.id,
      version: p.version,
      name: p.name,
      description: p.description,
      judgeInstruction: p.judgeInstruction,
      criteria: p.criteria,
      // Hybrid fields: requirementGroups and complianceInfluence drive
      // rankValue = Q - lambda*(1-C); they MUST be fingerprinted so two
      // experiments with different groups or lambda get different fingerprints.
      // JSON.stringify drops undefined, so legacy profiles (no these fields)
      // produce identical hashes to before (fingerprint stability).
      requirementGroups: p.requirementGroups,
      complianceInfluence: p.complianceInfluence,
    })),
    aggregationPolicy: "equal-task",
    trialsPerTask: 1,
  };
}

/**
 * Build the canonical fingerprint input from a suite and its pinned profiles.
 */
export function buildFingerprintInput(
  suite: EvaluationSuite,
  profiles: EvaluationProfile[],
): unknown {
  return semanticFingerprintInput({
    tasks: suite.tasks,
    modelSlots: suite.modelSlots,
    defaultJudge: suite.defaultJudge,
    defaultEvaluation: suite.defaultEvaluation,
    reasoningPolicy: suite.reasoningPolicy ?? DEFAULT_REASONING_POLICY,
    profiles,
  });
}

/**
 * Compute the protocol fingerprint for a suite + profiles.
 * Returns `sha256:<lowercase hex>`.
 */
export function computeProtocolFingerprint(
  suite: EvaluationSuite,
  profiles: EvaluationProfile[],
): string {
  const input = buildFingerprintInput(suite, profiles);
  const canonical = canonicalJsonString(input);
  const hash = sha256Hex(canonical);
  return `sha256:${hash}`;
}

/**
 * Compute the protocol fingerprint from an experiment snapshot's semantic
 * content. Shares the single input builder with the suite-based computation so
 * the two can never diverge (roster spec §B3). Returns `sha256:<hex>`.
 */
export function computeSnapshotProtocolFingerprint(snapshot: ExperimentSnapshot): string {
  const input = semanticFingerprintInput({
    tasks: snapshot.tasks,
    modelSlots: snapshot.modelSlots,
    defaultJudge: snapshot.defaultJudge,
    defaultEvaluation: snapshot.defaultEvaluation,
    reasoningPolicy: snapshot.reasoningPolicy ?? DEFAULT_REASONING_POLICY,
    profiles: snapshot.profiles,
  });
  const canonical = canonicalJsonString(input);
  const hash = sha256Hex(canonical);
  return `sha256:${hash}`;
}

/**
 * Create an immutable experiment snapshot from a suite and its pinned profiles.
 * Deep-copies suite, pinned profile versions, roster, Judge, and protocol fingerprint.
 */
export function createExperimentSnapshot(
  suite: EvaluationSuite,
  profiles: EvaluationProfile[],
  now: number,
): ExperimentSnapshot {
  const fingerprint = computeProtocolFingerprint(suite, profiles);

  return {
    suiteId: suite.id,
    suiteVersion: suite.version,
    tasks: JSON.parse(JSON.stringify(suite.tasks)),
    modelSlots: JSON.parse(JSON.stringify(suite.modelSlots)),
    defaultJudge: { ...suite.defaultJudge },
    defaultEvaluation: suite.defaultEvaluation,
    reasoningPolicy: suite.reasoningPolicy
      ? { ...suite.reasoningPolicy }
      : { ...DEFAULT_REASONING_POLICY },
    profiles: JSON.parse(JSON.stringify(profiles)),
    protocolFingerprint: fingerprint,
    createdAt: now,
  };
}

// --- SHA-256 implementation (synchronous, via Web Crypto fallback) -----------

/**
 * Content hash for immutable experimental artifacts (fusion-study spec §6.3).
 * Identical output text under different generation settings is NOT the same
 * artifact — callers hash text plus full generation provenance (model, prompt,
 * decode settings), never text alone.
 */
export function hashArtifactContent(content: string): string {
  return `sha256:${sha256Hex(content)}`;
}

/**
 * Compute SHA-256 hex hash of a string.
 * Uses Web Crypto (available in browser and Node ≥20).
 */
function sha256Hex(text: string): string {
  // In a synchronous context, we can't use crypto.subtle (async).
  // Use a simple but correct synchronous SHA-256 implementation.
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  return sha256Sync(data);
}

/**
 * Synchronous SHA-256 using a pure-JS implementation.
 * This avoids async crypto.subtle in contexts where we need synchronous hashing.
 */
function sha256Sync(data: Uint8Array): string {
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  // Padding: append 0x80, then zeros, then 64-bit big-endian length
  const bitLen = data.length * 8;
  const paddedLen = ((data.length + 9 + 63) >>> 6) << 6; // next multiple of 64
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;
  // High 32 bits of length (0 for our use case — messages are small)
  padded[paddedLen - 4] = (bitLen >>> 24) & 0xff;
  padded[paddedLen - 3] = (bitLen >>> 16) & 0xff;
  padded[paddedLen - 2] = (bitLen >>> 8) & 0xff;
  padded[paddedLen - 1] = bitLen & 0xff;

  const W = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      W[i] =
        (padded[offset + i * 4] << 24) |
        (padded[offset + i * 4 + 1] << 16) |
        (padded[offset + i * 4 + 2] << 8) |
        padded[offset + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }

    let a = H[0],
      b = H[1],
      c = H[2],
      d = H[3];
    let e = H[4],
      f = H[5],
      g = H[6],
      hh = H[7];

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + hh) >>> 0;
  }

  return Array.from(H, (v) => v.toString(16).padStart(8, "0")).join("");
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}
