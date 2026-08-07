# Plan 006: Establish a complete quality gate and reconcile documentation

> **Executor instructions**: Execute after Plan 005. This phase turns the
> hardened behavior into an enforceable repository gate. Do not introduce broad
> stylistic churn: configure lint/format rules around the existing codebase,
> correct genuine defects and warnings, and update documentation to match live
> behavior.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 8f22a6e..HEAD -- \
>   package.json package-lock.json vite.config.* vitest.config.* \
>   .github README.md PRODUCT.md PROVIDERS.md DESIGN.md UI.md DECISIONS.md \
>   src/workspaces/runs/RunDetail.tsx plans
> git status --short
> ```

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MEDIUM
- **Depends on**: Plan 005
- **Blocks**: Plan 007
- **Category**: quality
- **Planned at**: commit `8f22a6e`, 2026-08-06

## Goal

Make the repository's passing state reproducible on every change, prevent new
DOM/accessibility and TypeScript hygiene regressions, measure test coverage
without gaming it, and ensure public/spec documentation describes the actual
hardened product rather than historical implementation stages.

## Quality-gate contract

`npm run check` remains the local umbrella command and expands to include:

1. formatting check;
2. lint;
3. web typecheck;
4. server typecheck;
5. tests;
6. production build.

CI runs the same commands on a clean install. Specialized browser QA may run in a
separate job when deterministic and reasonably bounded.

## Workstream A — Add formatter and lint configuration

1. Select Prettier or the repository's preferred formatter and pin its version.
2. Add `format` and `format:check` scripts.
3. Add ESLint with TypeScript, React, Hooks, and accessibility rules appropriate
   for the current React stack.
4. Start from rules that catch correctness problems rather than enforcing a new
   aesthetic. At minimum detect:
   - unused variables/imports;
   - floating promises where relevant;
   - unsafe exhaustive-switch gaps;
   - React Hook dependency errors;
   - invalid accessibility roles/labels where supported;
   - accidental `any` growth in new code;
   - duplicate imports and unreachable code.
5. Avoid a whole-repository formatting rewrite in the same commit as behavior
   fixes. If baseline formatting is large, land a dedicated mechanical commit.
6. Add ignore rules only with comments explaining generated/vendor artifacts.

## Workstream B — Treat warnings as defects

1. Fix the reported nested interactive-element problem in Run Detail. A
   `CompactModelLabel` containing a button must not be nested inside another
   candidate-selection button.
2. Audit test output for React warnings, invalid DOM nesting, missing keys,
   unhandled promise rejections, and state updates outside expected boundaries.
3. Add a test harness guard that fails on newly emitted `console.error` or
   `console.warn`, with narrow allowlists for known third-party noise only.
4. Remove obsolete no-op controller methods or mark them explicitly unsupported;
   do not leave callable async functions that silently do nothing.
5. Add accessibility-focused tests for controls changed in Plans 003–005.

## Workstream C — Add coverage as evidence, not theater

1. Install the Vitest coverage provider compatible with the current version.
2. Add `test:coverage` and generate text + machine-readable reports.
3. Record the baseline before choosing thresholds.
4. Use modest global thresholds initially; add higher targeted thresholds for
   load-bearing modules:
   - pipeline/Judge parsing;
   - run executor/controller transitions;
   - persistence validators and redaction;
   - bridge routing/authentication;
   - execution leases and protocol fingerprints.
5. Do not count generated files, static catalog data, or type-only modules.
6. Prefer branch coverage for failure-heavy state machines.
7. Add tests for uncovered invariants before raising thresholds.

## Workstream D — Add GitHub Actions CI

Create a workflow triggered on pull requests and pushes to the default branch:

1. checkout;
2. setup the repository's supported Node version with npm cache;
3. `npm ci`;
4. `npm run check`;
5. `npm run test:coverage` if not already included;
6. upload coverage/build diagnostics on failure where useful.

Optional job separation:

- `quality`: format, lint, typecheck;
- `test`: Vitest + coverage;
- `build`: production build;
- `browser-qa`: deterministic CDP scripts.

Do not add live provider integration tests to default CI. Provider adapters must
use mocks/contracts; live smoke tests can be manually dispatched later with
secrets and explicit cost controls.

## Workstream E — Reconcile README and specifications

Update README and authoritative docs based on live code after Plans 003–005:

- correct Vite and dependency-version claims;
- list all supported providers;
- explain environment, session, and remembered credentials;
- describe bridge startup and optional authentication;
- document exact attachment limits and encoded transport behavior;
- explain two-candidate Compare minimum and evaluation single-model baselines;
- document timeout/error categories;
- document cross-tab execution coordination;
- remove or restore references to missing `UI.md`, `DESIGN.md`, or `TODOS.md`;
- replace stale screenshots or clearly mark them historical;
- clarify `.env` loading behavior for Vite and the Node bridge;
- describe Codex integration as experimental/protocol-sensitive.

Add a status header to large specifications:

```md
> Status: Implemented | Partially implemented | Planned | Historical
> Last reconciled: YYYY-MM-DD at commit `<sha>`
```

Do not leave checklist phases unchecked when the code has already shipped.

## Workstream F — Define contribution and release gates

1. Add a short `CONTRIBUTING.md` or README section with required commands.
2. Document when deterministic browser QA is mandatory.
3. Define that a change touching persisted schemas, protocol fingerprints,
   credentials, or paid execution requires focused regression tests.
4. Define release-blocking failures:
   - `npm run check` failure;
   - archive/runtime validator regression;
   - credential leakage test failure;
   - deterministic QA failure for an affected workflow.
5. Document that bundle warnings are tracked but not automatically release-
   blocking until Plan 008 establishes measured budgets.

## Scope

**In scope**:

- package scripts/development dependencies
- formatter/linter config
- Vitest coverage config
- GitHub Actions
- warning/DOM correctness fixes
- documentation and screenshots/references
- contribution/quality-gate guidance

**Out of scope**:

- live paid provider CI;
- large module extraction;
- bundle splitting;
- product feature additions;
- changing evaluation scoring or persistence semantics.

## Verification commands

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck:web
npm run typecheck:server
npm test
npm run test:coverage
npm run build
npm run check
git diff --check
```

Validate the GitHub Actions workflow syntax and confirm a branch run completes on
the same commit.

## Acceptance criteria

- A clean checkout can reproduce the complete gate with documented commands.
- CI runs on pull requests and the default branch.
- No known invalid DOM nesting warning remains.
- New unexpected React/test warnings fail the suite.
- Coverage baseline and thresholds are documented and meaningful.
- README/provider/security/setup documentation matches the implementation.
- Missing/stale document references are resolved.
- No live provider credentials or paid calls are required for CI.

## STOP conditions

Stop if:

- lint adoption would require behavior-changing mass edits without review;
- the coverage provider is incompatible with the pinned Vitest version;
- CI cannot run deterministic tests without introducing real credentials;
- documentation reveals an unresolved product contradiction from Plan 002.

## Handoff to Plan 007

Plan 007 may assume every extraction is protected by CI, focused tests, coverage,
and current architecture documentation. It will reduce module responsibility
convergence without changing externally visible behavior.
