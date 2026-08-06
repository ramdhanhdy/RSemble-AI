import type {
  ModelReasoningCapabilities,
  ProviderId,
  ReasoningEffort,
  ReasoningResolution,
  ReasoningTransport,
} from "./types";
import { REASONING_EFFORTS } from "./types";
import type { ModelSlot } from "../../studio-data";

const UNKNOWN_REASONING: ModelReasoningCapabilities = Object.freeze({
  supportedEfforts: ["provider-default"] as const,
  source: "unknown",
  transport: "none",
});

const DEEPSEEK_REASONING: ModelReasoningCapabilities = Object.freeze({
  supportedEfforts: ["provider-default", "low", "high", "max"] as const,
  source: "provider-docs",
  transport: "deepseek",
  aliases: { medium: "high", xhigh: "max" } as const,
});

const GEMINI_FLASH_REASONING: ModelReasoningCapabilities = Object.freeze({
  supportedEfforts: ["provider-default", "minimal", "low", "medium", "high"] as const,
  source: "provider-docs",
  transport: "gemini3",
});

const GEMINI_PRO_REASONING: ModelReasoningCapabilities = Object.freeze({
  supportedEfforts: ["provider-default", "low", "medium", "high"] as const,
  source: "provider-docs",
  transport: "gemini3",
});

const modelCapabilities = new Map<string, ModelReasoningCapabilities>();

const CAPABILITIES_STORAGE_KEY = "rsemble.catalog.reasoning.v1";
let capabilitiesHydrated = false;
let capabilitiesPersistPending = false;

function cacheKey(providerId: ProviderId, model: string): string {
  return `${providerId}:${model}`;
}

function isValidEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value);
}

/** Catalog capability metadata is volatile but load-bearing for the pickers;
 *  persist it so a reload does not regress every model to provider-default
 *  until the next probe completes. Corrupt entries are dropped silently. */
function parseStoredCapabilities(value: unknown): ModelReasoningCapabilities | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const efforts = record.supportedEfforts;
  if (!Array.isArray(efforts) || !efforts.every(isValidEffort)) return null;
  const source = record.source;
  const transport = record.transport;
  if (source !== "catalog" && source !== "provider-docs") return null;
  if (
    transport !== "openrouter" &&
    transport !== "deepseek" &&
    transport !== "gemini3" &&
    transport !== "none"
  )
    return null;
  return { supportedEfforts: [...efforts], source, transport };
}

function hydrateCapabilities(): void {
  if (capabilitiesHydrated) return;
  capabilitiesHydrated = true;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(CAPABILITIES_STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const capabilities = parseStoredCapabilities(value);
      if (capabilities && !modelCapabilities.has(key)) modelCapabilities.set(key, capabilities);
    }
  } catch {
    // Corrupt storage — start fresh; the next catalog probe repopulates.
  }
}

function scheduleCapabilitiesPersist(): void {
  if (capabilitiesPersistPending) return;
  capabilitiesPersistPending = true;
  queueMicrotask(() => {
    capabilitiesPersistPending = false;
    try {
      const entries: Record<string, ModelReasoningCapabilities> = {};
      for (const [key, capabilities] of modelCapabilities) entries[key] = capabilities;
      localStorage.setItem(CAPABILITIES_STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Storage unavailable (private mode, quota) — registry stays in-memory.
    }
  });
}

export function setModelReasoningCapabilities(
  providerId: ProviderId,
  model: string,
  capabilities: ModelReasoningCapabilities,
): void {
  modelCapabilities.set(cacheKey(providerId, model), {
    ...capabilities,
    supportedEfforts: [...capabilities.supportedEfforts],
    aliases: capabilities.aliases ? { ...capabilities.aliases } : undefined,
  });
  scheduleCapabilitiesPersist();
}

export function clearModelReasoningCapabilities(): void {
  modelCapabilities.clear();
  // Drop the persisted copy and allow a fresh hydration pass, so tests and
  // explicit resets never resurrect stale catalog metadata.
  capabilitiesHydrated = false;
  try {
    localStorage.removeItem(CAPABILITIES_STORAGE_KEY);
  } catch {
    // Storage unavailable — nothing to clear.
  }
}

function geminiCapabilities(model: string): ModelReasoningCapabilities {
  const normalized = model.replace(/^models\//i, "").toLowerCase();
  if (!/^gemini-3(?:\.\d+)?(?:-|$)/.test(normalized)) return UNKNOWN_REASONING;
  if (normalized.includes("pro")) return GEMINI_PRO_REASONING;
  if (normalized.includes("flash")) return GEMINI_FLASH_REASONING;
  return UNKNOWN_REASONING;
}

export function capabilitiesForModel(
  providerId: ProviderId,
  model: string,
): ModelReasoningCapabilities {
  hydrateCapabilities();
  const exact = modelCapabilities.get(cacheKey(providerId, model));
  if (exact) return exact;
  if (providerId === "deepseek") return DEEPSEEK_REASONING;
  if (providerId === "gemini") return geminiCapabilities(model);
  return UNKNOWN_REASONING;
}

export function resolveReasoningEffort(
  providerId: ProviderId,
  model: string,
  requested: ReasoningEffort = "provider-default",
  strict = false,
): ReasoningResolution {
  const capabilities = capabilitiesForModel(providerId, model);
  if (requested === "provider-default") {
    return {
      ok: true,
      requested,
      effective: "provider-default",
      transport: capabilities.transport,
      capabilities,
    };
  }
  if (capabilities.supportedEfforts.includes(requested)) {
    return {
      ok: true,
      requested,
      effective: requested,
      transport: capabilities.transport,
      capabilities,
    };
  }
  const mapped = capabilities.aliases?.[requested];
  if (mapped) {
    if (strict) {
      return {
        ok: false,
        requested,
        reason: `${providerId}:${model} maps ${requested} to ${mapped}; strict suite parity requires an exact supported effort.`,
        capabilities,
      };
    }
    return {
      ok: true,
      requested,
      effective: mapped,
      transport: capabilities.transport,
      capabilities,
    };
  }
  return {
    ok: false,
    requested,
    reason: `${providerId}:${model} does not report support for reasoning effort ${requested}. Supported levels: ${capabilities.supportedEfforts.join(", ")}.`,
    capabilities,
  };
}

export function commonReasoningEfforts(slots: readonly ModelSlot[]): ReasoningEffort[] {
  const enabled = slots.filter((slot) => slot.enabled);
  if (enabled.length === 0) return ["provider-default"];
  return REASONING_EFFORTS.filter((effort) =>
    enabled.every((slot) =>
      capabilitiesForModel(slot.providerId, slot.slug).supportedEfforts.includes(effort),
    ),
  );
}

export function nativeReasoningPayload(
  providerId: ProviderId,
  model: string,
  requested: ReasoningEffort | undefined,
  strict = false,
): { resolution: Extract<ReasoningResolution, { ok: true }>; payload: Record<string, unknown> } {
  const resolution = resolveReasoningEffort(
    providerId,
    model,
    requested ?? "provider-default",
    strict,
  );
  if (!resolution.ok) {
    throw new Error(resolution.reason);
  }
  if (resolution.effective === "provider-default") {
    return { resolution, payload: {} };
  }
  switch (resolution.transport as ReasoningTransport) {
    case "openrouter":
      return { resolution, payload: { reasoning: { effort: resolution.effective } } };
    case "deepseek":
      return {
        resolution,
        payload: { thinking: { type: "enabled" }, reasoning_effort: resolution.effective },
      };
    case "gemini3":
    case "none":
      return { resolution, payload: {} };
  }
}
