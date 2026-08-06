import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The terminal endpoint is development-only, but it still accepts browser
 * input. Keep both the field names and value shapes bounded so a prompt,
 * attachment, credential, or arbitrary request body can never become a
 * terminal diagnostic. Keep this list in sync with DevTerminalFields.
 */
export const DEV_LOG_KEYS = new Set([
  "event",
  "level",
  "at",
  "experimentId",
  "runId",
  "taskId",
  "attemptId",
  "experimentAttemptId",
  "modelKey",
  "stage",
  "status",
  "durationMs",
  "tokensIn",
  "tokensOut",
  "candidateCalls",
  "judgeCalls",
  "reusedOutputs",
  "error",
  "timeoutKind",
]);
const DEV_LOG_MAX_BODY_BYTES = 16 * 1024;
const DEV_LOG_MAX_STRING_LENGTH = 512;
const DEV_LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);
const DEV_LOG_TIMEOUT_KINDS = new Set([
  "connect_timeout",
  "stream_inactivity_timeout",
  "overall_timeout",
]);
const SAFE_EVENT = /^[A-Za-z0-9_.-]{1,80}$/;

type SafeDevLogValue = string | number | null;

/** Strip unknown/oversized values before anything reaches console.log. */
export function sanitizeDevLogPayload(raw: unknown): Record<string, SafeDevLogValue> | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const safe: Record<string, SafeDevLogValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!DEV_LOG_KEYS.has(key)) continue;
    if (typeof value === "string") {
      if (value.length <= DEV_LOG_MAX_STRING_LENGTH) safe[key] = value;
    } else if (typeof value === "number") {
      if (Number.isFinite(value)) safe[key] = value;
    } else if (value === null) {
      safe[key] = null;
    }
  }

  if (typeof safe.event !== "string" || !SAFE_EVENT.test(safe.event)) safe.event = "unknown";
  if (typeof safe.level !== "string" || !DEV_LOG_LEVELS.has(safe.level)) safe.level = "debug";
  if (
    safe.timeoutKind !== undefined &&
    (typeof safe.timeoutKind !== "string" || !DEV_LOG_TIMEOUT_KINDS.has(safe.timeoutKind))
  ) {
    delete safe.timeoutKind;
  }
  return safe;
}

function terminalDevLogPlugin(): Plugin {
  return {
    name: "rsemble-terminal-dev-log",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__rsemble/dev-log", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }

        let body = "";
        let bodyBytes = 0;
        let oversized = false;
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => {
          if (oversized) return;
          bodyBytes += Buffer.byteLength(chunk, "utf8");
          if (bodyBytes > DEV_LOG_MAX_BODY_BYTES) {
            oversized = true;
            return;
          }
          body += chunk;
        });
        req.on("end", () => {
          if (oversized) {
            res.statusCode = 413;
            res.end();
            return;
          }
          try {
            const safe = sanitizeDevLogPayload(JSON.parse(body));
            if (safe === null) throw new Error("payload must be an object");
            const event = safe.event as string;
            const level = safe.level as string;
            delete safe.event;
            delete safe.level;
            console.log(`[RSemble][${level}][${event}] ${JSON.stringify(safe)}`);
            res.statusCode = 204;
          } catch {
            res.statusCode = 400;
          }
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), terminalDevLogPlugin()],
});
