import type { StorageError } from "../persistence/database";
import type { AttentionItem } from "./attention-types";

/**
 * Storage Attention requires a durable classified record AND a concrete
 * diagnostics/retry owner. Neither exists today (Task 0 rows 17–19).
 */
export interface StorageAttentionSource {
  error: StorageError;
  diagnosticsRouteExists?: boolean;
  rawPayload?: string;
}

export function queryStorageAttention(_source: StorageAttentionSource): AttentionItem[] {
  return [];
}
