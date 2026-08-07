// =============================================================================
// ESLint flat config — Plan 006 quality gate.
//
// Policy: correctness first, not aesthetics. These rules catch real defects —
// unused code, floating promises, React Hook dependency errors, invalid ARIA,
// duplicate imports, unreachable code, switch gaps, accidental `any` growth.
// Formatting is Prettier's job; ESLint never fights it.
//
// Every disabled/relaxed rule below carries a comment explaining why.
// =============================================================================

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import importX from "eslint-plugin-import-x";

export default tseslint.config(
  {
    // Generated/vendor artifacts and build outputs are never linted.
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      // Emitted from vite.config.ts / vitest.config.ts by `tsc -b`.
      "vite.config.js",
      "vite.config.d.ts",
      "vitest.config.js",
      "vitest.config.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "import-x": importX,
    },
    languageOptions: {
      parserOptions: {
        // Type-aware rules (no-floating-promises et al.) resolve through the
        // local tsconfig projects without hard-coding a file list.
        projectService: {
          allowDefaultProject: [],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // --- Unused code --------------------------------------------------------
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "all" },
      ],

      // --- Async correctness --------------------------------------------------
      // Floating promises hide rejected provider calls and persistence writes.
      // Deliberate fire-and-forget must be spelled `void promise`.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: false, checksConditionals: true },
      ],
      "@typescript-eslint/await-thenable": "error",

      // --- Switch gaps ----------------------------------------------------------
      // Union switches must cover every member; non-union switches need default.
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { requireDefaultForNonUnion: true },
      ],

      // --- Type hygiene ---------------------------------------------------------
      // Accidental `any` growth is surfaced as a warning: existing sites are
      // grandfathered but visible, and new ones must be consciously dismissed.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "error",

      // --- React ----------------------------------------------------------------
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",

      // --- Core correctness -----------------------------------------------------
      "no-unreachable": "error",
      "no-unreachable-loop": "error",
      // Core no-duplicate-imports cannot merge TypeScript `import type`
      // specifiers; import-x/no-duplicates is TS-aware and auto-fixable.
      "no-duplicate-imports": "off",
      "import-x/no-duplicates": ["error", { "prefer-inline": true }],
      // Existing justified disables reference this rule; keep it meaningful.
      "no-control-regex": "error",
    },
  },
  {
    // Accessibility rules from jsx-a11y's recommended set (roles, ARIA props,
    // labels, interactive-element semantics).
    files: ["**/*.{tsx,jsx}"],
    ...jsxA11y.flatConfigs.recommended,
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // Tailwind preflight removes list styling, and Safari/VoiceOver then drop
      // <ul>/<ol> list semantics; the codebase restores them with explicit
      // role="list". The "redundant role" finding is a known false positive for
      // that pattern, so the rule is disabled repository-wide (documented in
      // Plan 006's lint exception record).
      "jsx-a11y/no-redundant-roles": "off",
      // Focusable ARIA widgets: the resizable split separator (role=separator
      // with aria-valuenow) and the scrollable result-matrix region need
      // keyboard focus by design; tabindex on those roles is intentional.
      "jsx-a11y/no-noninteractive-tabindex": ["error", { roles: ["separator", "region"] }],
      // Labels style their visible text through nested spans; the association
      // and accessible-text checks must walk that depth to see it.
      "jsx-a11y/label-has-associated-control": ["error", { assert: "either", depth: 4 }],
    },
  },
  {
    // Tests may use `any` fixtures and non-null assertions freely; every other
    // rule above still applies.
    files: ["**/*.test.{ts,tsx}", "server/tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      // Tests stub iterables with empty generators (`function* () {}`);
      // requiring a yield there would force pointless `yield undefined`.
      "require-yield": "off",
    },
  },
  {
    // Node scripts (CDP browser QA, diagnostics, research generators) run
    // outside the app's tsconfig projects, so type-aware parsing is off and
    // Node globals are declared. Style rules that only add noise to standalone
    // scripts are relaxed here — correctness rules stay on.
    files: ["scripts/**/*.{mjs,cjs,ts,tsx}", "*.mjs", "*.cjs", "docs/research/**/*.cjs"],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: false,
        project: null,
      },
    },
    rules: {
      // Type-aware rules cannot run here: these files sit outside the tsconfig
      // projects on purpose (standalone Node tooling).
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/switch-exhaustiveness-check": "off",
      // Empty catch blocks are common deliberate "best effort" teardown in QA
      // scripts; require-yield fights the `function* () {}` iterable stubs.
      "no-empty": ["error", { allowEmptyCatch: true }],
      "require-yield": "off",
    },
  },
  {
    // CommonJS research generators legitimately use require().
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // Plan 007 Workstream G — import-boundary rules.
    // pipeline.ts is the provider-neutral prompt/parse domain module (the "one
    // pipeline" spine). It must stay free of React and persistence so it can be
    // unit-tested deterministically and reused without a React/storage runtime.
    // This is a stable, useful boundary, not an aesthetic preference: it
    // protects the "one pipeline, transport- and React-independent" invariant
    // (plans/README.md, Decision #5). The stage runners (execution-stages) are
    // deliberately NOT included: they emit PersistedError records and so import
    // error-redaction/run-types by contract.
    files: ["src/lib/pipeline.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react",
              message: "Domain modules must not import React (Plan 007 boundary).",
            },
            {
              name: "react-dom",
              message: "Domain modules must not import react-dom (Plan 007 boundary).",
            },
          ],
          patterns: [
            {
              group: ["**/persistence/*"],
              message: "Domain modules must not import persistence (Plan 007 boundary).",
            },
          ],
        },
      ],
    },
  },
);
