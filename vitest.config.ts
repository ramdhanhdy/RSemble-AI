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
      // Thresholds live below the recorded baseline; see Plan 006 workstream C
      // and the coverage baseline section of the PR description.
    },
  },
});
