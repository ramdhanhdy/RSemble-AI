# Phased implementation plan

> **Executor instructions:** Read this file, `analysis.md`, and all seven files
> under `specs/` before editing. Preserve the existing dirty working tree. Run
> every phase gate and stop on any STOP condition instead of improvising.

## Status

- **Planned at:** commit `fdf078b`, 2026-08-05, with uncommitted
  roster-extension/repair/terminal-log changes already present
- **Overall risk:** high (provider and persistence contracts in phases 3–4)
- **Verification baseline:** `npm run check` currently passes 128 test files and
  1,808 tests before this planned work
- **Package manager / stack:** npm, React 18, TypeScript, Vite, Vitest, Dexie

## Execution order and status

| Phase | Scope | Priority | Effort | Depends on | Status |
|---|---|---:|---:|---|---|
| 0 | Characterize current regressions | P0 | S | — | TODO |
| 1 | Truthful progress scope + cancelled probes | P0 | S–M | 0 | TODO |
| 2 | Simplify experiment/header/run-time UX | P2 | M | 1 | TODO |
| 3 | Reasoning-effort request and provenance contract | P1 | L | 1 | TODO |
| 4 | Provider usage and pricing provenance | P1 | L | 3 | TODO |
| 5 | Integrated QA, docs, and archive compatibility | P1 | M | 2–4 | TODO |

Phases 3 and 4 both touch every provider adapter. Execute them sequentially;
parallel implementations will create conflicting request/response contracts.

## Drift check

Run first:

```powershell
git diff --stat fdf078b..HEAD -- src server PRODUCT.md UI.md DESIGN.md DECISIONS.md
git status --short
```

Expected: inspect and preserve all listed local modifications. In particular,
do not discard current changes in experiment controller/engine/repair, terminal
logging, hook extraction, Vite middleware, or dynamic blind labels.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Focused tests | `npx vitest run <test files>` | exit 0, all selected tests pass |
| Web typecheck | `npm run typecheck:web` | exit 0 |
| Server typecheck | `npm run typecheck:server` | exit 0 |
| Full gate | `npm run check` | typechecks, all tests, and build pass |
| Roster QA | `npm run qa:roster-extension` | exit 0 with updated evidence when applicable |

Do not use `npm install` unless `package.json` or the lockfile intentionally
changes. None of phases 0–3 should require a new dependency.

## Phase 0 — characterization before fixes

### Step 0.1: Freeze the banner mismatch

In `ExperimentProgress.test.tsx`, create an experiment containing:

- historical extensions in order: DeepSeek, then Umans GLM;
- a live `missing-cells` attempt whose requested keys contain only
  `deepseek:deepseek-v4-flash`;
- experiment status `running`.

Assert current behavior reproduces the stale Umans banner, then phrase the
target assertion according to spec 01. Commit the test and fix together if the
repository requires green commits; do not weaken it to a generic banner check.

### Step 0.2: Freeze the mixed probe-cancellation race

In `provider-probes.test.ts`, arrange one provider to complete and OpenRouter’s
catalog stage to remain pending. Abort the coordinator and assert a cycle-level
cancellation outcome. Add a shell-level test that no `Catalog probe issue`
appears after execution ownership becomes active.

### Gate 0

```powershell
npx vitest run src/workspaces/evaluations/ExperimentProgress.test.tsx src/lib/provider-probes.test.ts src/rsemble-shell.test.tsx
```

Expected before implementation: the new target assertions fail for the two
reported regressions while existing tests remain green.

## Phase 1 — execution truthfulness hotfixes

### Step 1.1: Derive active operation scope

Implement spec 01 in:

- `src/lib/evaluations/experiment-task-ledger.ts`
- `src/workspaces/evaluations/ExperimentProgress.tsx`
- their tests

Use persisted `attempt.repair` as the canonical plan. Reuse the exported
`currentAttemptOf` rule, which already prefers running work over selected older
evidence. Delete `latestExtension` from the live-scope path. Do not remove the
terminal roster-extension history in Results.

### Step 1.2: Add cycle-level probe cancellation

Implement spec 03 in:

- `src/lib/provider-probes.ts`
- `src/rsemble.tsx`
- `src/lib/provider-probes.test.ts`
- the smallest shell/component test that exercises the effect race

Return a discriminated cycle result. A cancelled cycle commits no React state.
Keep deadline timeouts diagnosable while idle.

### Gate 1

```powershell
npx vitest run src/workspaces/evaluations/ExperimentProgress.test.tsx src/lib/evaluations/experiment-task-ledger.test.ts src/lib/provider-probes.test.ts src/rsemble-shell.test.tsx
npm run typecheck:web
```

Expected: the DeepSeek banner regression and mixed-cancellation test pass; no
provider execution tests change behavior.

## Phase 2 — remove misleading chrome and add completion facts

This phase is presentation-only except for removing unused task-ledger view
fields. Keep persistence untouched.

### Step 2.1: Remove experiment attempt ordinals

Implement spec 02 in:

- `src/workspaces/evaluations/ExperimentTaskLedger.tsx`
- `src/lib/evaluations/experiment-task-ledger.ts`
- `src/workspaces/evaluations/ExperimentResults.tsx`
- corresponding tests

Delete `attemptLabel`, the Attempt column, `Attempts (N)`, and terminal Attempt
history. Preserve task errors, current coverage/time, and `View run` evidence.
Do not edit `ExperimentTaskAttempt`, repository schemas, engine selection, or
run-source IDs.

### Step 2.2: Stabilize the header and move Finish mode

Implement spec 04 in:

- `src/ui/Header.tsx`
- `src/rsemble.tsx`
- optionally a new focused `src/ui/CompareToolbar.tsx`
- header/navigation/shell tests
- `PRODUCT.md`, `UI.md`, `DESIGN.md`, `DECISIONS.md`

Use a fixed three-zone header grid and mount the existing `ModeToggle` exactly
once inside Compare. Preserve shortcuts and mode state above the router.

### Step 2.3: Show completion time

Implement spec 05 in:

- `src/workspaces/runs/run-view-model.ts`
- `src/workspaces/runs/RunDetail.tsx`
- their tests

Do not change repository ordering. Render start, end/completion, relative end
age, duration, timezone, and semantic `<time>` elements.

### Gate 2

```powershell
npx vitest run src/workspaces/evaluations/ExperimentTaskLedger.test.tsx src/workspaces/evaluations/ExperimentProgress.test.tsx src/workspaces/evaluations/ExperimentResults.test.tsx src/rsemble-shell.test.tsx src/ui/WorkspaceNav.test.tsx src/workspaces/runs/run-view-model.test.ts src/workspaces/runs/RunDetail.test.tsx
npm run typecheck:web
```

Manual viewport gate: 390×844, 768×1024, 1024×768, and 1440×1000. Primary
workspace navigation must not shift between routes.

## Phase 3 — reasoning-effort foundation

Read the primary provider docs linked from spec 07 immediately before coding;
provider model capabilities change over time. Do not rely on slug heuristics.

### Step 3.1: Add normalized request and capability types

Modify:

- `src/lib/providers/types.ts`
- `src/lib/providers/registry.ts` if capability lookup belongs there
- provider catalog parsers and adapter tests

Add `ReasoningEffort`, request policy, supported-level metadata, and a pure
resolution function. Resolution returns requested and effective values or a
typed incompatibility. It must never silently discard/remap an explicit value.

### Step 3.2: Forward provider-native settings

Modify every adapter in `src/lib/providers/` plus bridge request types where
needed. Cover both streaming candidates and non-streaming Judge/Fusion calls.
Unknown compatible gateways expose `provider-default` only until verified.

### Step 3.3: Persist and fingerprint evaluation policy

Modify:

- `src/studio-data.ts` and `src/studio-engine.ts`
- `src/lib/evaluations/evaluation-types.ts`
- `src/lib/evaluations/protocol-fingerprint.ts`
- snapshot/controller/repair/roster-extension paths
- `src/lib/persistence/run-types.ts`, validators, builders, archive/export

Add backward-compatible optional parsing/defaults for existing records.
Fingerprint candidate and Judge effort. Recovery must read the immutable
experiment snapshot, never live Compare preferences.

### Step 3.4: Add Compare and Suite controls

Modify Compare configuration components, `SuiteSettings.tsx`, suite validation,
and RunDetail. The suite picker must offer only the common strict levels for all
enabled candidates. `provider-default` remains available with explicit fairness
copy.

### Gate 3

```powershell
npx vitest run src/lib/providers/*.test.ts src/lib/evaluations/protocol-fingerprint.test.ts src/lib/evaluations/experiment-controller.test.ts src/lib/evaluations/experiment-roster-extension.test.ts src/lib/persistence/run-types.test.ts src/lib/persistence/archive.test.ts src/workspaces/evaluations/SuiteSettings.test.tsx src/workspaces/runs/RunDetail.test.tsx
npm run typecheck:web
npm run typecheck:server
```

Expected: unsupported strict effort fails before any mocked paid provider call;
repair and roster-extension requests retain snapshot effort.

## Phase 4 — usage and cost provenance

### Step 4.1: Define usage/cost/pricing snapshots

Implement spec 06 types in provider and persistence contracts. Keep new run
fields optional so old schema-v2 records remain valid. Add validators that
reject negative/non-finite token and cost values.

### Step 4.2: Capture OpenRouter catalog and response accounting

Parse exact model pricing and supported parameters from `/models`. Consume the
final streaming usage event and non-streaming usage. Persist provider-reported
tokens, reasoning/cache breakdown, total cost, and the execution-time pricing
snapshot.

Do not add deprecated usage-request flags; current OpenRouter documentation says
usage is returned automatically.

### Step 4.3: Roll out honest provider fallbacks

For every other adapter:

- persist native usage/cost when actually present;
- otherwise persist char/token estimates as `catalog-estimate` only when an
  exact price is known;
- otherwise persist `unknown`.

Never apply the current five-entry substring table as provider-reported truth.

### Step 4.4: Cover all paid stages and repairs

Extend Judge and Fusion attempt records with usage/cost. Aggregate incremental
run total without charging reused candidates. Update RunButton forecast to
include the Judge and conditional Fusion. Add RunDetail stage breakdown and
evaluation incremental totals.

### Gate 4

```powershell
npx vitest run src/lib/cost.test.ts src/lib/providers/openrouter.test.ts src/lib/providers/sse-stream.test.ts src/lib/run-executor.test.ts src/lib/persistence/run-record-builder.test.ts src/lib/persistence/run-types.test.ts src/lib/persistence/archive.test.ts src/ui/RunButton.test.tsx src/workspaces/runs/RunDetail.test.tsx src/lib/evaluations/experiment-controller.test.ts
npm run typecheck:web
npm run typecheck:server
```

Expected: fixtures prove reported vs estimated vs unknown provenance, all paid
stages, and no reused-evidence double count.

## Phase 5 — integrated verification and documentation

### Step 5.1: Full automated gate

```powershell
npm run check
```

Expected: exit 0; no reduction in total test coverage from deleted attempt UI
tests—replace them with task/evidence assertions.

### Step 5.2: Manual scenario matching the report

Using a disposable/local suite:

1. Begin with a completed multi-model experiment.
2. Add DeepSeek and Umans GLM as separate roster extensions and allow both to
   leave missing results.
3. Click DeepSeek’s `Complete missing result` action.
4. Confirm the progress scope names DeepSeek and says missing-results completion.
5. Confirm terminal logs name DeepSeek and no cancelled catalog-probe banner
   appears mid-run.
6. Confirm no Attempt 1/2/3 UI is visible.
7. Confirm Run detail shows start/end/duration, reasoning policy, and cost-source
   breakdown.

Do not require a paid live run in CI. Keep deterministic adapter fixtures for
all contract assertions.

### Step 5.3: Archive and backward-compatibility gate

Import a pre-change archive and confirm defaults (`provider-default`, unknown
cost) render without mutation. Export a new archive and re-import it; usage,
pricing snapshots, requested/effective reasoning, repairs, and reused evidence
must round-trip.

### Step 5.4: Documentation reconciliation

Update root product/design/provider docs to reflect:

- Compare-local Finish mode placement;
- no user-facing numbered experiment attempts;
- reasoning policy as protocol provenance;
- reported/estimated/unknown cost semantics.

Do not claim all providers have exact pricing or equivalent reasoning levels.

## Done criteria

- [ ] Active DeepSeek missing-cell repair cannot display Umans scope.
- [ ] Lifecycle-cancelled probe cycles cannot update readiness, catalog, or errors.
- [ ] Experiment UI contains no numbered attempt/trial concept.
- [ ] Global workspace navigation is route-invariant; Rank/Fuse is Compare-local.
- [ ] Run detail shows explicit start, terminal time, relative terminal age, and duration.
- [ ] Candidate, Judge, and Fusion usage/cost carry reported/estimated/unknown provenance.
- [ ] Reused outputs are not double-charged.
- [ ] Candidate/Judge reasoning policies are configurable, validated, persisted, and fingerprinted.
- [ ] Existing records and archives remain readable.
- [ ] `npm run check` exits 0.
- [ ] No unrelated dirty-worktree changes were reverted or overwritten.

## STOP conditions

Stop and report instead of improvising if:

1. The active `missing-cells` attempt does not contain the clicked model key in
   `repair.requestedModelKeys`; that would indicate a controller/persistence bug
   beyond the confirmed display bug.
2. A provider adapter cannot expose a reliable supported-effort set. Mark it
   `provider-default` only; do not infer from model names.
3. Exact provider pricing/usage cannot be obtained from the response or catalog.
   Show Estimated/Unknown; do not scrape dashboards or hard-code a guessed price.
4. Backward-compatible optional fields are insufficient and a schema-version
   bump appears necessary. Stop and write a migration design before changing
   `schemaVersion: 2`.
5. Header relocation would create two ModeToggle instances or reset Compare
   reducer state across navigation.
6. Any step requires deleting attempt history or changing selected-attempt
   semantics. That is explicitly out of scope.
7. An in-scope file has drifted materially from the analysis excerpts or a
   verification gate fails twice after a reasonable correction.

## Maintenance notes

- Treat `rosterExtensions` as immutable history and task-attempt plans as
  execution truth in every future status surface.
- Provider catalog metadata is volatile; historical runs must always render
  from their stored pricing/reasoning snapshot, not today’s catalog.
- A shared effort name controls a request but does not equalize hidden compute
  across model families. Preserve that caveat in future evaluation claims.
- Cost aggregation must remain incremental whenever repair/reuse paths evolve.

