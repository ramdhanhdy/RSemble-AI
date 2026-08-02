// =============================================================================
// ConnectionsModal — Minimal Connections & Provider Configuration UI
// Data-driven: provider descriptors live in an array, not hardcoded JSX blocks.
// =============================================================================

import { useEffect, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Check, Loader2, RefreshCw, X, Zap } from "lucide-react";
import { listProviders } from "../lib/providers/registry";
import type { ProviderId, ProviderReadiness } from "../lib/providers/types";
import { DialogSurface } from "./DialogSurface";

interface ConnectionsModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  handle?: Dialog.Handle<unknown>;
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
    description: "OpenAI-compatible Cline API via the local bridge, required because the API blocks credentialed browser CORS requests. Set VITE_CLINEPASS_KEY in .env or below.",
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
  {
    id: "9router",
    label: "9Router",
    subtitle: "via 127.0.0.1:8787 → 9Router",
    description:
      "Local/remote routing gateway with 9Router-managed models and fallback. The API key is optional — leave blank when 9Router auth is disabled.",
    placeholder: "sk-... (optional)",
    keyHint: "VITE_9ROUTER_KEY",
    bridgeHint: "1. Start 9Router separately\n2. Configure providers in its dashboard\n3. Bridge forwards to RSEMBLE_9ROUTER_URL",
  },
];

const TEST_CONNECTION_TIMEOUT_MS = 12_000;

function keyStorageId(providerId: ProviderId): string {
  return `rsemble.key.${providerId}`;
}

function readinessMessage(status: ProviderReadiness): string {
  return status.ok ? "Connection verified." : status.reason;
}

export function ConnectionsModal({ isOpen, onOpenChange, onRefresh, handle }: ConnectionsModalProps) {
  const [statuses, setStatuses] = useState<Record<ProviderId, ProviderReadiness>>({
    openrouter: { ok: false, reason: "Loading..." },
    "chatgpt-codex": { ok: false, reason: "Loading..." },
    gemini: { ok: false, reason: "Loading..." },
    commandcode: { ok: false, reason: "Loading..." },
    clinepass: { ok: false, reason: "Loading..." },
    umans: { ok: false, reason: "Loading..." },
    "9router": { ok: false, reason: "Loading..." },
  });

  const [keys, setKeys] = useState<Record<ProviderId, string>>({
    openrouter: "",
    "chatgpt-codex": "",
    gemini: "",
    commandcode: "",
    clinepass: "",
    umans: "",
    "9router": "",
  });
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [testingProvider, setTestingProvider] = useState<ProviderId | null>(null);
  const [testResults, setTestResults] = useState<Partial<Record<ProviderId, ProviderReadiness>>>({});

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


  const handleSave = (providerId: ProviderId, label: string) => {
    localStorage.setItem(keyStorageId(providerId), keys[providerId].trim());
    setSavedMessage(`${label} key saved to local storage.`);
    void fetchStatuses();
    onRefresh();
    setTimeout(() => setSavedMessage(null), 3000);
  };

  const handleKeyChange = (providerId: ProviderId, value: string) => {
    setKeys((prev) => ({ ...prev, [providerId]: value }));
    setTestResults((prev) => ({ ...prev, [providerId]: undefined }));
  };

  const handleTest = async (providerId: ProviderId, label: string) => {
    if (testingProvider !== null) return;
    const provider = listProviders().find((item) => item.id === providerId);
    if (!provider?.testConnection) {
      setTestResults((prev) => ({ ...prev, [providerId]: { ok: false, reason: "Connection testing is not supported." } }));
      return;
    }
    setTestingProvider(providerId);
    setTestResults((prev) => ({ ...prev, [providerId]: { ok: false, reason: "Testing..." } }));
    const ctrl = new AbortController();
    const timeout = window.setTimeout(() => ctrl.abort(), TEST_CONNECTION_TIMEOUT_MS);
    try {
      const result = await provider.testConnection(keys[providerId], ctrl.signal);
      setTestResults((prev) => ({ ...prev, [providerId]: result }));
      if (result.ok) setSavedMessage(`${label} connection verified. Save the key to use it.`);
    } catch (err) {
      const result: ProviderReadiness = {
        ok: false,
        reason: err instanceof DOMException && err.name === "AbortError"
          ? "Connection test timed out after 12 seconds."
          : err instanceof Error ? err.message : String(err),
      };
      setTestResults((prev) => ({ ...prev, [providerId]: result }));
    } finally {
      window.clearTimeout(timeout);
      setTestingProvider(null);
    }
  };

  return (
    <DialogSurface
      open={isOpen}
      onOpenChange={onOpenChange}
      title="Provider Connections"
      handle={handle}
      className="flex max-w-xl flex-col bg-panel"
    >
        <div className="flex shrink-0 items-center justify-between border-b border-edge px-5 py-3">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-accent" />
            <h2 id="connections-title" className="font-mono text-base font-semibold text-text">Provider Connections</h2>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close connections"
            className="pressable flex h-11 w-11 items-center justify-center rounded-md text-text-secondary hover:bg-card-hover hover:text-text"
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
                  <div className="mt-2.5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <label htmlFor={`key-${d.id}`} className="sr-only">
                      {d.label} API key
                    </label>
                    <input
                      id={`key-${d.id}`}
                      type="password"
                      placeholder={d.placeholder}
                      value={keys[d.id]}
                      onChange={(e) => handleKeyChange(d.id, e.target.value)}
                      disabled={testingProvider === d.id}
                      className="min-h-[44px] min-w-0 flex-1 rounded-sm border border-edge bg-panel px-2.5 py-2 font-mono text-xs text-text placeholder-text-muted focus:border-accent focus:outline-none"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        aria-label={`Test ${d.label} connection`}
                        onClick={() => void handleTest(d.id, d.label)}
                        disabled={testingProvider !== null}
                        className="pressable flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded border border-edge-bright bg-card px-3 font-mono text-xs text-text hover:bg-card-hover disabled:cursor-wait disabled:opacity-60 sm:flex-none"
                      >
                        {testingProvider === d.id ? <Loader2 size={12} className="animate-spin-ease" /> : <Zap size={12} />}
                        Test
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSave(d.id, d.label)}
                        disabled={testingProvider === d.id}
                        className="pressable min-h-[44px] flex-1 rounded border border-accent/40 bg-accent/10 px-3 font-mono text-xs text-accent hover:bg-accent/20 disabled:cursor-wait disabled:opacity-60 sm:flex-none"
                      >
                        Save
                      </button>
                    </div>
                    </div>
                    {testResults[d.id] && (
                      <p
                        role="status"
                        className={`mt-2 font-mono text-xs ${testResults[d.id]?.ok ? "text-success" : "text-error"}`}
                      >
                        {readinessMessage(testResults[d.id]!)}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="mt-2.5 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        void fetchStatuses();
                        onRefresh();
                      }}
                      className="pressable flex items-center gap-1 rounded border border-edge-bright bg-card px-3 py-1.5 font-mono text-xs text-text hover:bg-card-hover"
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
            onClick={() => onOpenChange(false)}
            className="pressable min-h-[44px] rounded-sm border border-edge-bright bg-card-hover px-4 font-mono text-xs text-text hover:bg-raised"
          >
            Done
          </button>
        </div>
    </DialogSurface>
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
