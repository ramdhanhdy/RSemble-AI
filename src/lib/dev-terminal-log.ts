// Development-only structured logging for browser-owned execution stages.
// Vite forwards these events to the terminal through /__rsemble/dev-log.
// Keep the payload deliberately allowlisted: prompts, messages, responses,
// credentials, and provider headers must never cross this boundary.

export type DevLogLevel = "debug" | "info" | "warn" | "error";

export interface DevTerminalFields {
  experimentId?: string;
  runId?: string;
  taskId?: string;
  attemptId?: string;
  experimentAttemptId?: string;
  modelKey?: string;
  stage?: string;
  status?: string;
  durationMs?: number;
  tokensIn?: number | null;
  tokensOut?: number | null;
  candidateCalls?: number;
  judgeCalls?: number;
  reusedOutputs?: number;
  error?: string;
}

export function devTerminalLog(
  event: string,
  fields: DevTerminalFields = {},
  level: DevLogLevel = "debug",
): void {
  if (!import.meta.env.DEV || import.meta.env.MODE === "test" || typeof fetch !== "function") {
    return;
  }

  const body = JSON.stringify({ event, level, at: new Date().toISOString(), ...fields });
  void fetch("/__rsemble/dev-log", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // Diagnostics must never affect execution.
  });
}
