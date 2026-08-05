import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
var DEV_LOG_KEYS = new Set([
    "event", "level", "at", "experimentId", "runId", "taskId", "attemptId",
    "experimentAttemptId",
    "modelKey", "stage", "status", "durationMs", "tokensIn", "tokensOut",
    "candidateCalls", "judgeCalls", "reusedOutputs", "error", "stack",
]);
function terminalDevLogPlugin() {
    return {
        name: "rsemble-terminal-dev-log",
        apply: "serve",
        configureServer: function (server) {
            server.middlewares.use("/__rsemble/dev-log", function (req, res) {
                if (req.method !== "POST") {
                    res.statusCode = 405;
                    res.end();
                    return;
                }
                var body = "";
                req.setEncoding("utf8");
                req.on("data", function (chunk) {
                    if (body.length <= 16384)
                        body += chunk;
                });
                req.on("end", function () {
                    try {
                        var raw = JSON.parse(body);
                        var safe = Object.fromEntries(Object.entries(raw).filter(function (_a) {
                            var key = _a[0], value = _a[1];
                            return DEV_LOG_KEYS.has(key) &&
                                (typeof value === "string" || typeof value === "number" || value === null);
                        }));
                        var event_1 = typeof safe.event === "string" ? safe.event : "unknown";
                        var level = typeof safe.level === "string" ? safe.level : "debug";
                        delete safe.event;
                        delete safe.level;
                        console.log("[RSemble][".concat(level, "][").concat(event_1, "] ").concat(JSON.stringify(safe)));
                        res.statusCode = 204;
                    }
                    catch (_a) {
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
