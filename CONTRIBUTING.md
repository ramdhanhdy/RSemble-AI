# Contributing to RSemble AI

RSemble is a personal local tool; contributions are changes that keep the
hardened behavior honest and the gate green. This file defines the required
commands and the release-blocking failures.

## Required commands

```bash
npm ci                 # clean, reproducible install
npm run format:check   # Prettier (formatting)
npm run lint           # ESLint (correctness)
npm run typecheck:web  # tsc -b (src, shared, test setup)
npm run typecheck:server  # tsc -p server (bridge + server tests)
npm test               # Vitest (guarded: unexpected console noise fails)
npm run test:coverage  # Vitest + coverage thresholds
npm run build          # production build
npm run check          # umbrella: format:check + lint + typechecks + test + build
```

`npm run check` is the local umbrella and mirrors CI
(`.github/workflows/ci.yml`). A change is ready when every command above passes
on a clean checkout.

## Formatting and lint policy

- Prettier owns formatting; ESLint owns correctness. Never hand-fight either.
- Lint exceptions and console-guard allowlists must stay **narrow and
  documented** (a comment naming the rule and the reason). Hiding an important
  module from coverage or lint to improve a percentage is a regression.

## When deterministic browser QA is mandatory

Run the deterministic CDP QA scripts (`npm run qa:*`) whenever a change affects
the observable behavior of the workflow a script covers:

- `npm run qa:design-motion` — motion/press-feedback contracts
- `npm run qa:evaluations-identity` — workspace identity/navigation
- `npm run qa:roster-extension` — finished-experiment roster extension
- `npm run qa:suite-reliability` — suite execution reliability

These scripts use the dev server with no provider credentials. If a change
touches a covered workflow and the relevant script fails, the change is not
ready.

## Focused regression tests are required when touching

- **Persisted schemas** (run records, suites, profiles, archives) — validator
  and migration tests.
- **Protocol fingerprints** — fingerprint stability/identity tests.
- **Credentials** (CredentialStore, bridge auth, redaction) — leakage and
  persistence-policy tests.
- **Paid execution** (executor, preflight, deadlines, leases) — transition and
  cardinality tests proving no hidden calls and truthful preflight.

## Release-blocking failures

A change must not ship if any of the following fails:

1. `npm run check` (format, lint, typechecks, tests, build).
2. Archive/runtime validator regression (persistence truthfulness).
3. Credential leakage test failure (credentials in runs/logs/archives/exports/
   fixtures).
4. Deterministic QA failure for an affected workflow.

## Tracked but not release-blocking

Bundle-size warnings are tracked (Plan 008 establishes measured budgets) but
are **not** automatically release-blocking until then.

## Commit and PR discipline

- Stage explicit paths; never `git add .` / `-A` / `--all`.
- Keep commits logical (tooling, mechanical formatting, behavior fixes,
  coverage, CI, docs). A broad formatting baseline goes in its own mechanical
  commit.
- Never commit `.env`, `dist/`, generated coverage output, or sensitive
  fixtures.
