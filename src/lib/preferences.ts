// =============================================================================
// Command preferences — localStorage-backed model roster + judge selection.
// Survives reloads so the user's fanout slots and critic don't snap back to
// SEED_SLOTS / DEFAULT_CRITIC_REF on every app start.
// =============================================================================

import type { ModelSlot } from "../studio-data";
import type { CriticRef, ProviderId } from "./providers/types";

const STORAGE_KEY = "rsemble.preferences.v1";

const PROVIDER_IDS: Record<ProviderId, true> = {
  openrouter: true,
  "chatgpt-codex": true,
  gemini: true,
  commandcode: true,
  clinepass: true,
  umans: true,
  "9router": true,
};

export interface CommandPreferences {
  slots: ModelSlot[];
  critic: CriticRef;
}

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PROVIDER_IDS, value);
}

function isModelSlot(value: unknown): value is ModelSlot {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    s.id.length > 0 &&
    isProviderId(s.providerId) &&
    typeof s.provider === "string" &&
    typeof s.model === "string" &&
    typeof s.slug === "string" &&
    s.slug.length > 0 &&
    typeof s.enabled === "boolean"
  );
}

function isCriticRef(value: unknown): value is CriticRef {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return isProviderId(c.providerId) && typeof c.model === "string" && c.model.length > 0;
}

function readRaw(): Partial<CommandPreferences> | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Partial<CommandPreferences>;
  } catch {
    return null;
  }
}

/**
 * Load stored slots.
 * - `null`  → key missing / corrupt / invalid shape → keep SEED_SLOTS
 * - `[]`    → user intentionally cleared the roster → honor empty
 * - slots   → restored roster
 */
export function loadStoredSlots(): ModelSlot[] | null {
  const raw = readRaw();
  // Absent key or missing field → fall back to seeds. Present empty array is valid.
  if (!raw || !("slots" in raw) || !Array.isArray(raw.slots)) return null;
  const slots = raw.slots.filter(isModelSlot);
  // If every entry was garbage, treat as invalid rather than wiping to empty.
  if (raw.slots.length > 0 && slots.length === 0) return null;
  return slots;
}

/** Load stored critic, or `null` when missing/invalid so callers keep default. */
export function loadStoredCritic(): CriticRef | null {
  const raw = readRaw();
  if (!raw || !isCriticRef(raw.critic)) return null;
  return raw.critic;
}

/** Persist the command-pane model roster and judge selection. */
export function saveCommandPreferences(prefs: CommandPreferences): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Quota / private mode — preferences are best-effort.
  }
}
