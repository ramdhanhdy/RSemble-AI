// =============================================================================
// RSemble AI — Canonical Task instance identity pure rules
//
// Child 02 (Canonical Tasks) Milestone A — Task 2.
//
// Pure normalizers / comparators / builders for Task Instances and the
// byte-level artifact digest/equality that the spec requires (spec §3.3,
// §3.4, §4). No Dexie, no provider calls, no I/O. Digests are integrity aids
// only — instance reuse is governed by deep equality of the complete
// normalized input/context under the same Task Version, not by digest alone
// (spec §3.4, §4.1).
//
// P2 conflict resolution: the shipped `hashArtifactContent` is string-only
// (UTF-8). Spec §3.3 requires byte equality before reuse and §3.4 requires
// exact normalized input/context/artifact digest. This module adds a
// byte-level SHA-256 (`computeArtifactDigest(Uint8Array)`) and a byte
// equality comparator (`artifactsByteEqual`). The byte digest of UTF-8(text)
// is identical to `hashArtifactContent(text)`, so text and byte paths agree.
// =============================================================================

import { canonicalJsonString, hashArtifactContent } from "../evaluations/protocol-fingerprint";
import type {
  ContextManifestEntry,
  NormalizedTaskInput,
  TaskArtifact,
  TaskInstance,
  TaskInputCompleteness,
} from "./task-types";

// --- byte-level SHA-256 -----------------------------------------------------
//
// Self-contained synchronous SHA-256 over a Uint8Array. Mirrors the shipped
// pure-JS implementation in protocol-fingerprint.ts so that
// `computeArtifactDigest(TextEncoder().encode(text))` ===
// `hashArtifactContent(text)`. Kept local to the Task domain to avoid
// editing the no-edit protocol-fingerprint.ts; the algorithm is the standard
// FIPS 180-4 round function.

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const SHA256_H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

function sha256Bytes(data: Uint8Array): string {
  const H = new Uint32Array(SHA256_H0);
  const bitLen = data.length * 8;
  const paddedLen = ((data.length + 9 + 63) >>> 6) << 6; // next multiple of 64
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;
  // High 32 bits of length are 0 for our use case (messages are small).
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
      const t1 = (hh + S1 + ch + SHA256_K[i] + W[i]) >>> 0;
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

/**
 * Byte-level content digest: `sha256:<lowercase hex>` over the raw bytes of a
 * Task Artifact (spec §3.3). For UTF-8 text, this equals
 * `hashArtifactContent(text)`.
 */
export function computeArtifactDigest(bytes: Uint8Array): string {
  return `sha256:${sha256Bytes(bytes)}`;
}

// --- byte equality (spec §3.3) ----------------------------------------------

/**
 * Constant-time-ish byte equality for artifact reuse verification (spec §3.3:
 * digest matches require byte equality before reuse). Compares only the
 * logical byte ranges of two Uint8Array views (length + elements), not their
 * backing buffers.
 */
export function artifactsByteEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

// --- artifact digest match --------------------------------------------------

/**
 * True if `storedDigest` is a well-formed `sha256:<hex>` digest AND it equals
 * the digest of `bytes`. This is the necessary (not sufficient) guard before
 * artifact reuse — the repository layer must additionally verify byte
 * equality via {@link artifactsByteEqual} when reusing an existing artifact
 * (spec §3.3).
 */
export function isArtifactDigestMatch(storedDigest: string, bytes: Uint8Array): boolean {
  if (!/^sha256:[0-9a-f]{64}$/.test(storedDigest)) return false;
  return storedDigest === computeArtifactDigest(bytes);
}

// --- artifact builder -------------------------------------------------------

/** Inputs to {@link buildTaskArtifact}. */
export interface BuildTaskArtifactInput {
  id: string;
  bytes: Uint8Array;
  mediaType: string;
  storageRef: string;
  createdAt: number;
}

/**
 * Build an immutable TaskArtifact from real bytes (spec §3.3). The
 * `contentDigest` is derived from the bytes and `byteCount` from
 * `bytes.byteLength`. Empty byte content is rejected — an artifact must
 * carry real bytes (spec §6.4: migration never fabricates a Task Artifact).
 */
export function buildTaskArtifact(input: BuildTaskArtifactInput): TaskArtifact {
  if (input.bytes.byteLength === 0) {
    throw new Error("TaskArtifact requires non-empty bytes");
  }
  return {
    id: input.id,
    contentDigest: computeArtifactDigest(input.bytes),
    mediaType: input.mediaType,
    byteCount: input.bytes.byteLength,
    storageRef: input.storageRef,
    createdAt: input.createdAt,
  };
}

// --- normalized input digest (spec §3.4) ------------------------------------

/**
 * The normalized-input slice used for the instance input digest: `text`,
 * `artifactIds` (order-significant), and `metadata`. Excludes identity
 * fields (`id`, `taskId`, `taskVersion`, `createdAt`, `sourceRef`) and the
 * computed `inputDigest`/`inputCompleteness`.
 */
export type NormalizedNormalizedTaskInput = Pick<
  NormalizedTaskInput,
  "text" | "artifactIds" | "metadata"
>;

/** Strip identity/computed fields, keeping the input slice only. */
export function normalizeNormalizedInputForDigest(
  input: NormalizedTaskInput,
): NormalizedNormalizedTaskInput {
  return {
    text: input.text,
    artifactIds: input.artifactIds,
    metadata: input.metadata,
  };
}

/**
 * The normalized instance slice used for the input digest: the normalized
 * input plus the context manifest. Excludes identity/computed fields.
 */
export type NormalizedTaskInstance = {
  normalizedInput: NormalizedNormalizedTaskInput;
  contextManifest: ContextManifestEntry[];
};

/** Strip identity/computed fields, keeping the input + context slice only. */
export function normalizeInstanceForDigest(instance: TaskInstance): NormalizedTaskInstance {
  return {
    normalizedInput: normalizeNormalizedInputForDigest(instance.normalizedInput),
    contextManifest: instance.contextManifest.map((entry) => ({ ...entry })),
  };
}

/**
 * Instance input digest: `sha256:<hex>` over canonical JSON of the normalized
 * input + context manifest (spec §3.4: exact normalized input/context/
 * artifact digest). Stable across instances with different `id`, `taskId`,
 * `taskVersion`, `createdAt`, or `sourceRef` but identical inputs; changes
 * with any input/context content or `artifactIds` order change.
 */
export function computeInstanceInputDigest(instance: TaskInstance): string {
  return hashArtifactContent(canonicalJsonString(normalizeInstanceForDigest(instance)));
}

// --- instance reuse equality (spec §3.4) ------------------------------------

/**
 * Deduplication scope for `getOrCreateTaskInstance` (spec §3.4: reuse is
 * allowed only under the same Task Version and exact complete normalized
 * input/context/artifact digest, with equality verification). The key is
 * scoped by `taskId` + `taskVersion` + `inputDigest`; a digest collision
 * must still be verified by deep equality ({@link instancesReuseEqual})
 * before reuse.
 */
export interface InstanceReuseKey {
  taskId: string;
  taskVersion: number;
  inputDigest: string;
}

/** Build the deduplication key for an instance. */
export function buildInstanceReuseKey(instance: TaskInstance): InstanceReuseKey {
  return {
    taskId: instance.taskId,
    taskVersion: instance.taskVersion,
    inputDigest: computeInstanceInputDigest(instance),
  };
}

/**
 * Deep reuse equality between two instances (spec §3.4). Two instances are
 * reuse-equal iff:
 *   1. both have `inputCompleteness === "complete"` — reuse is allowed only
 *      for exact complete inputs; `metadata_only` and `incomplete` pairs
 *      never establish identity;
 *   2. they share the same `taskId` AND `taskVersion` (same Task Version
 *      only);
 *   3. their normalized input + context manifest are deeply equal (canonical
 *      JSON string equality — order-significant for `artifactIds` and
 *      manifest entries, insertion-order-invariant for object keys).
 *
 * Identity fields (`id`, `createdAt`, `sourceRef`) and the stored
 * `inputDigest` are deliberately ignored: a digest collision must be backed
 * by deep equality before reuse (spec §3.4).
 */
export function instancesReuseEqual(a: TaskInstance, b: TaskInstance): boolean {
  if (a.inputCompleteness !== "complete" || b.inputCompleteness !== "complete") return false;
  if (a.taskId !== b.taskId) return false;
  if (a.taskVersion !== b.taskVersion) return false;
  return (
    canonicalJsonString(normalizeInstanceForDigest(a)) ===
    canonicalJsonString(normalizeInstanceForDigest(b))
  );
}

// --- completeness resolution (spec §3.4, §6.4) ------------------------------

/** Inputs to {@link resolveInstanceCompleteness}. */
export interface ResolveInstanceCompletenessInput {
  normalizedInput: NormalizedTaskInput;
  /** Real bytes available for each artifactId referenced by the input. */
  availableArtifactBytes: Map<string, Uint8Array>;
}

/**
 * Resolve the `inputCompleteness` of a candidate instance from the bytes
 * actually available (spec §3.4, §6.4):
 *   - `complete` — every referenced `artifactId` has real bytes (or there
 *     are no artifact references and the input carries text);
 *   - `incomplete` — some, but not all, referenced artifacts have bytes;
 *   - `metadata_only` — no referenced artifact has bytes (and the input is
 *     metadata/text only).
 *
 * Metadata-only/incomplete instances are never upgraded to complete without
 * real bytes for every referenced artifact (spec §6.4).
 */
export function resolveInstanceCompleteness(
  input: ResolveInstanceCompletenessInput,
): TaskInputCompleteness {
  const ids = input.normalizedInput.artifactIds;
  if (ids.length === 0) {
    // No artifact references: complete iff there is candidate-visible text,
    // otherwise the input is metadata-only.
    return input.normalizedInput.text.length > 0 ? "complete" : "metadata_only";
  }
  let present = 0;
  for (const id of ids) {
    if (input.availableArtifactBytes.has(id)) present += 1;
  }
  if (present === ids.length) return "complete";
  if (present === 0) return "metadata_only";
  return "incomplete";
}
