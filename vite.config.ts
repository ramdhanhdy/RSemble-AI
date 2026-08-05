import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const DEV_LOG_KEYS = new Set([
  "event", "level", "at", "experimentId", "runId", "taskId", "attemptId",
  "experimentAttemptId",
  "modelKey", "stage", "status", "durationMs", "tokensIn", "tokensOut",
  "candidateCalls", "judgeCalls", "reusedOutputs", "error", "stack",
]);

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
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => {
          if (body.length <= 16_384) body += chunk;
        });
        req.on("end", () => {
          try {
            const raw = JSON.parse(body) as Record<string, unknown>;
            const safe = Object.fromEntries(
              Object.entries(raw).filter(([key, value]) =>
                DEV_LOG_KEYS.has(key) &&
                (typeof value === "string" || typeof value === "number" || value === null),
              ),
            );
            const event = typeof safe.event === "string" ? safe.event : "unknown";
            const level = typeof safe.level === "string" ? safe.level : "debug";
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
