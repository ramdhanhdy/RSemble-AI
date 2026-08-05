import type { ModelPricingSnapshot, ProviderId } from "./types";

const pricingByModel = new Map<string, ModelPricingSnapshot>();

const PRICING_STORAGE_KEY = "rsemble.catalog.pricing.v1";
let pricingHydrated = false;
let pricingPersistPending = false;

function key(providerId: ProviderId, modelId: string): string {
  return `${providerId}:${modelId}`;
}

/** Catalog pricing is volatile but load-bearing: persist it so a reload does
 *  not degrade Estimated costs to Unknown until the next probe completes.
 *  Corrupt or stale-shaped entries are dropped silently. */
function parseStoredPricing(value: unknown): ModelPricingSnapshot | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.providerId !== "string" || typeof record.modelId !== "string") return null;
  if (typeof record.fetchedAt !== "number" || !Number.isFinite(record.fetchedAt)) return null;
  const fields = [
    "inputPerToken",
    "outputPerToken",
    "reasoningPerToken",
    "cacheReadPerToken",
    "cacheWritePerToken",
    "requestCostUsd",
    "imagePerToken",
  ] as const;
  const parsed = {} as Record<(typeof fields)[number], number | null>;
  for (const field of fields) {
    const raw = record[field];
    if (raw !== null && finiteNonNegative(raw) === null) return null;
    parsed[field] = raw === null ? null : finiteNonNegative(raw);
  }
  return {
    providerId: record.providerId as ProviderId,
    modelId: record.modelId,
    fetchedAt: record.fetchedAt,
    inputPerToken: parsed.inputPerToken,
    outputPerToken: parsed.outputPerToken,
    reasoningPerToken: parsed.reasoningPerToken,
    cacheReadPerToken: parsed.cacheReadPerToken,
    cacheWritePerToken: parsed.cacheWritePerToken,
    requestCostUsd: parsed.requestCostUsd,
    imagePerToken: parsed.imagePerToken,
  };
}

function hydratePricing(): void {
  if (pricingHydrated) return;
  pricingHydrated = true;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PRICING_STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
    for (const [k, value] of Object.entries(parsed as Record<string, unknown>)) {
      const snapshot = parseStoredPricing(value);
      if (snapshot && !pricingByModel.has(k)) pricingByModel.set(k, snapshot);
    }
  } catch {
    // Corrupt storage — the next catalog probe repopulates.
  }
}

function schedulePricingPersist(): void {
  if (pricingPersistPending) return;
  pricingPersistPending = true;
  queueMicrotask(() => {
    pricingPersistPending = false;
    try {
      const entries: Record<string, ModelPricingSnapshot> = {};
      for (const [k, snapshot] of pricingByModel) entries[k] = snapshot;
      localStorage.setItem(PRICING_STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Storage unavailable — registry stays in-memory.
    }
  });
}

function finiteNonNegative(value: unknown): number | null {
  const numberValue = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof numberValue === "number" && Number.isFinite(numberValue) && numberValue >= 0
    ? numberValue
    : null;
}

export function parseOpenRouterPricing(
  providerId: ProviderId,
  modelId: string,
  raw: unknown,
  fetchedAt = Date.now(),
): ModelPricingSnapshot | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const pricing = raw as Record<string, unknown>;
  const snapshot: ModelPricingSnapshot = {
    providerId,
    modelId,
    fetchedAt,
    inputPerToken: finiteNonNegative(pricing.prompt),
    outputPerToken: finiteNonNegative(pricing.completion),
    reasoningPerToken: finiteNonNegative(pricing.reasoning),
    cacheReadPerToken: finiteNonNegative(pricing.input_cache_read),
    cacheWritePerToken: finiteNonNegative(pricing.input_cache_write),
    requestCostUsd: finiteNonNegative(pricing.request),
    imagePerToken: finiteNonNegative(pricing.image),
  };
  const hasComponent = [
    snapshot.inputPerToken,
    snapshot.outputPerToken,
    snapshot.reasoningPerToken,
    snapshot.cacheReadPerToken,
    snapshot.cacheWritePerToken,
    snapshot.requestCostUsd,
    snapshot.imagePerToken,
  ].some((value) => value !== null);
  return hasComponent ? snapshot : undefined;
}

export function setModelPricing(snapshot: ModelPricingSnapshot): void {
  pricingByModel.set(key(snapshot.providerId, snapshot.modelId), { ...snapshot });
  schedulePricingPersist();
}

export function getModelPricing(providerId: ProviderId, modelId: string): ModelPricingSnapshot | null {
  hydratePricing();
  return pricingByModel.get(key(providerId, modelId)) ?? null;
}

export function clearModelPricing(): void {
  pricingByModel.clear();
  // Drop the persisted copy and allow a fresh hydration pass, mirroring the
  // reasoning registry: tests and explicit resets never resurrect stale pricing.
  pricingHydrated = false;
  try {
    localStorage.removeItem(PRICING_STORAGE_KEY);
  } catch {
    // Storage unavailable — nothing to clear.
  }
}
