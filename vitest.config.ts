import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}", "server/tests/**/*.test.ts", "shared/**/*.test.ts"],
    // Shared test environment setup (Plan 006 quality gate):
    //  - marks the environment as a React act() environment;
    //  - fails tests that emit unexpected console.warn/console.error so new
    //    React/DOM warnings cannot land silently (narrow allowlist inside).
    setupFiles: ["./test/setup-tests.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      // text for humans, json/json-summary for machines and CI artifacts.
      reporter: ["text", "text-summary", "json", "json-summary", "lcov"],
      include: ["src/**/*.{ts,tsx}", "server/codex-bridge/**/*.ts", "shared/**/*.ts"],
      exclude: [
        // Test code and fixtures are evidence, not coverage targets.
        "**/*.test.{ts,tsx}",
        "**/__fixtures__/**",
        "server/tests/**",
        // App bootstrap: side-effectful entry only.
        "src/main.tsx",
        // Type-only modules and ambient declarations carry no runtime code.
        "src/vite-env.d.ts",
        "src/lib/attachments/types.ts",
        "src/lib/credentials/types.ts",
        // Pure re-export shim kept for import compatibility.
        "src/lib/openrouter.ts",
        // Generated build outputs (also gitignored).
        "vite.config.js",
        "vite.config.d.ts",
        "vitest.config.js",
        "vitest.config.d.ts",
      ],
      // Plan 006 workstream C — thresholds set against the recorded baseline
      // (statements 79.17 / branches 72.07 / functions 80.85 / lines 83.29 at
      // commit e306cb3 + the bridge-auth tests). Global thresholds are modest;
      // load-bearing modules carry higher targeted floors so regressions in
      // judging, execution, persistence validation/redaction, bridge
      // routing/auth, leases, and protocol identity cannot hide behind the
      // global average.
      thresholds: {
        statements: 78,
        branches: 71,
        functions: 80,
        lines: 82,

        // Pipeline + blind Judge parsing.
        "src/lib/pipeline.ts": { lines: 90, branches: 85 },
        // Compare preflight cardinality/truthfulness (Plan 002 D2/D4).
        "src/lib/compare-preflight.ts": { lines: 95, branches: 85 },
        // Run executor/controller state transitions.
        "src/lib/run-executor.ts": { lines: 78, branches: 66 },
        "src/lib/run-controller.ts": { lines: 84, branches: 72 },
        // Persistence validators, redaction, and archive boundaries.
        "src/lib/persistence/run-types.ts": { lines: 72, branches: 78 },
        "src/lib/persistence/error-redaction.ts": { lines: 95, branches: 90 },
        "src/lib/persistence/archive.ts": { lines: 86, branches: 76 },
        // Credential containment (Plan 002 D1).
        "src/lib/credentials/credential-store.ts": { lines: 95, branches: 95 },
        // Bridge routing and authentication (Plan 002 D3).
        "server/codex-bridge/index.ts": { lines: 84, branches: 72 },
        "server/codex-bridge/auth.ts": { lines: 95, branches: 88 },
        // Execution leases, deadlines, and protocol fingerprints (Plan 005).
        "src/lib/execution-lease.ts": { lines: 88, branches: 78 },
        "src/lib/execution-deadline.ts": { lines: 90, branches: 78 },
        "src/lib/evaluations/protocol-fingerprint.ts": { lines: 95, branches: 90 },
      },
    },
  },
});
