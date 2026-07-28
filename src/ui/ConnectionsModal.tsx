// =============================================================================
// ConnectionsModal — Minimal Connections & Provider Configuration UI
// Data-driven: provider descriptors live in an array, not hardcoded JSX blocks.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import { Check, RefreshCw, X, Zap } from "lucide-react";
import { listProviders } from "../lib/providers/registry";
import type { ProviderId, ProviderReadiness } from "../lib/providers/types";
import { useDialogA11y } from "./useDialogA11y";

interface ConnectionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  subtitle?: string;
  description: string;
  placeholder: string;
  keyHint: string;
  bridgeHint?: string;
}

const PROVIDER_DESCRIPTORS: ProviderDescriptor[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "Broad catalog of open and commercial models. Set key in .env or below.",
    placeholder: "sk-or-v1-...",
    keyHint: "VITE_OPENROUTER_KEY",
  },
  {
    id: "chatgpt-codex",
    label: "ChatGPT (Codex Bridge)",
    subtitle: "127.0.0.1:8787",
    description: "Subscription-backed model access via local credential cache (~/.codex/auth.json).",
    placeholder: "",
    keyHint: "",
    bridgeHint: "1. Login: npx @openai/codex login\n2. Bridge: npm run dev:bridge",
  },
  {
    id: "gemini",
    label: "Gemini (Google AI Studio)",
    description: "Google models via AI Studio key. Set VITE_GEMINI_KEY in .env or below.",
    placeholder: "AIzaSy-...",
    keyHint: "VITE_GEMINI_KEY",
  },
  {
    id: "commandcode",
    label: "CommandCode",
    description: "Multi-provider catalog via Command Code. Set VITE_COMMANDCODE_KEY in .env or below.",
    placeholder: "cmd-...",
    keyHint: "VITE_COMMANDCODE_KEY",
  },
  {
    id: "clinepass",
    label: "ClinePass",
    description: "Open-weight models via Cline API. Set VITE_CLINEPASS_KEY in .env or below.",
    placeholder: "cline-...",
    keyHint: "VITE_CLINEPASS_KEY",
  },
  {
    id: "umans",
    label: "Umans",
    description:
      "Open-weight coding models (Kimi K2.7-Code, GLM 5.2) via code by Umans. Set VITE_UMANS_KEY in .env or below. Requests route through the local bridge (npm run dev:bridge) — the Umans API has no browser CORS support.",
    placeholder: "sk-...",
    keyHint: "VITE_UMANS_KEY",
  },
];

function keyStorageId(providerId: ProviderId): string {
  return `rsemble.key.${providerId}`;
}

export function ConnectionsModal({ isOpen, onClose, onRefresh }: ConnectionsModalProps) {
  const [statuses, setStatuses] = useState<Record<ProviderId, ProviderReadiness>>({
    openrouter: { ok: false, reason: "Loading..." },
    "chatgpt-codex": { ok: false, reason: "Loading..." },
    gemini: { ok: false, reason: "Loading..." },
    commandcode: { ok: false, reason: "Loading..." },
    clinepass: { ok: false, reason: "Loading..." },
    umans: { ok: false, reason: "Loading..." },
  });

  const [keys, setKeys] = useState<Record<ProviderId, string>>({
    openrouter: "",
    "chatgpt-codex": "",
    gemini: "",
    commandcode: "",
    clinepass: "",
    umans: "",
  });
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogA11y(isOpen, onClose, dialogRef);

  const fetchStatuses = async () => {
    const providers = listProviders();
    const map: Record<string, ProviderReadiness> = {};
    for (const p of providers) {
      try {
        map[p.id] = await p.readiness();
      } catch (err) {
        map[p.id] = { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
    }
    setStatuses(map as Record<ProviderId, ProviderReadiness>);
  };

  useEffect(() => {
    if (isOpen) {
      void fetchStatuses();
      const loaded: Record<string, string> = {};
      for (const d of PROVIDER_DESCRIPTORS) {
        loaded[d.id] = localStorage.getItem(keyStorageId(d.id)) ?? "";
      }
      setKeys(loaded as Record<ProviderId, string>);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = (providerId: ProviderId, label: string) => {
    localStorage.setItem(keyStorageId(providerId), keys[providerId].trim());
    setSavedMessage(`${label} key saved to local storage.`);
    void fetchStatuses();
    onRefresh();
    setTimeout(() => setSavedMessage(null), 3000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="connections-title"
        tabIndex={-1}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-edge-bright bg-panel shadow-popover focus:outline-none"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-edge px-5 py-3">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-accent" />
            <h2 id="connections-title" className="font-mono text-base font-semibold text-text">Provider Connections</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close connections"
            className="flex h-11 w-11 items-center justify-center rounded-md text-text-secondary hover:bg-card-hover hover:text-text"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 scroll-thin">
          {savedMessage && (
            <div className="flex items-center gap-2 rounded border border-success/30 bg-success/15 px-3 py-1.5 font-mono text-xs text-success">
              <Check size={12} /> {savedMessage}
            </div>
          )}

          <div className="mt-4 space-y-4">
            {PROVIDER_DESCRIPTORS.map((d) => (
              <div key={d.id} className="rounded-md border border-edge bg-card p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-mono text-sm font-semibold text-text">{d.label}</span>
                    {d.subtitle && (
                      <span className="ml-2 font-mono text-xs text-text-muted">{d.subtitle}</span>
                    )}
                  </div>
                  <StatusBadge status={statuses[d.id]} />
                </div>
                <p className="mt-1 font-mono text-xs text-text-muted">{d.description}</p>
                {d.bridgeHint && (
                  <div className="mt-2 rounded bg-card p-2 font-mono text-xs text-text-secondary">
                    {d.bridgeHint.split("\n").map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                )}
                {d.keyHint ? (
                  <div className="mt-2.5 flex items-center gap-2">
                    <label htmlFor={`key-${d.id}`} className="sr-only">
                      {d.label} API key
                    </label>
                    <input
                      id={`key-${d.id}`}
                      type="password"
                      placeholder={d.placeholder}
                      value={keys[d.id]}
                      onChange={(e) => setKeys((prev) => ({ ...prev, [d.id]: e.target.value }))}
                      className="min-h-[44px] flex-1 rounded-sm border border-edge bg-panel px-2.5 py-2 font-mono text-xs text-text placeholder-text-muted focus:border-accent focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleSave(d.id, d.label)}
                      className="rounded border border-accent/40 bg-accent/10 px-3 py-1.5 font-mono text-xs text-accent hover:bg-accent/20"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <div className="mt-2.5 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        void fetchStatuses();
                        onRefresh();
                      }}
                      className="flex items-center gap-1 rounded border border-edge-bright bg-card px-3 py-1.5 font-mono text-xs text-text hover:bg-card-hover"
                    >
                      <RefreshCw size={12} /> Refresh status
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 justify-end border-t border-edge px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-sm border border-edge-bright bg-card-hover px-4 font-mono text-xs text-text hover:bg-raised"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status?: ProviderReadiness }) {
  if (!status) return null;
  if (status.ok) {
    return (
      <span className="flex items-center gap-1.5 rounded-full border border-success/40 bg-success/15 px-2 py-0.5 font-mono text-xs text-success">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        Connected
      </span>
    );
  }
  return (
    <span
      title={status.reason}
      className="flex items-center gap-1.5 rounded-full border border-error/40 bg-error/15 px-2 py-0.5 font-mono text-xs text-error"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-error" />
      Not connected
    </span>
  );
}
