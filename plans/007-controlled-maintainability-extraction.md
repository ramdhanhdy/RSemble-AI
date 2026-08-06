# Plan 007: Reduce module responsibility convergence without behavior drift

> **Executor instructions**: Execute only after Plan 006 establishes CI,
> coverage, warning gates, and current documentation. This is not a line-count
> cleanup. Extract stable responsibilities behind existing contracts, one
> workstream at a time, and prove behavioral equivalence before continuing.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 8f22a6e..HEAD -- \
>   src/lib/run-executor.ts src/lib/run-controller.ts src/rsemble.tsx \
>   src/lib/evaluations/experiment-controller.ts \
>   src/lib/evaluations/fusion-study-stages.ts \
>   src/lib/pipeline.ts src/lib/persistence plans
> git status --short
> ```

## Status

- **Priority**: P2
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: Plan 006
- **Blocks**: Plan 008
- **Category**: maintainability
- **Planned at**: commit `8f22a6e`, 2026-08-06

## Goal

Make future correctness changes safer by aligning file boundaries with actual
responsibilities. Preserve the product spine, persisted evidence, protocol
fingerprints, paid-call counts, retry semantics, and UI behavior. File size is a
signal, not the acceptance criterion.

## Extraction principles

1. Extract around stable domain responsibilities, not arbitrary line ranges.
2. Pure functions and typed ports precede orchestration movement.
3. Existing public contracts remain stable until callers migrate.
4. No-op APIs are removed rather than carried into new modules.
5. Each workstream is independently shippable and fully green.
6. No workstream may combine schema changes with structural extraction.
7. Persistence commits and provider calls remain visible boundaries.
8. Avoid generic `utils.ts`, `helpers.ts`, or dependency containers that obscure
   ownership.

## Target responsibility map

### Run execution

Split `run-executor.ts` conceptually into:

- `candidate-executor.ts`: one candidate request/stream, usage, terminal result;
- `judge-executor.ts`: blind set construction, Judge request, parse/validation;
- `fusion-executor.ts`: synthesis and re-Fuse execution;
- `execution-cost.ts`: reported/estimated/unknown resolution;
- `run-executor.ts`: stage ordering and lifecycle coordination only.

`pipeline.ts` remains the provider-neutral prompt/parse domain module. Do not move
HTTP or persistence into it.

### Compare controller

Split `run-controller.ts` into:

- request snapshot construction;
- event-to-reducer adapter;
- recorder/event persistence adapter;
- retry request construction;
- thin public controller facade.

Remove `runJudge: async () => {}` and `runFusion: async () => {}` or replace them
with real typed operations already used by callers. Silent no-op methods are
forbidden.

### Application root

Reduce `rsemble.tsx` ownership to shell composition and high-level wiring:

- `useProviderReadiness` owns probe lifecycle/catalog aggregation;
- `useCompareExecution` owns preflight, owner/lease, run lifecycle;
- `CompareWorkspace` renders toolbar/split panes;
- dialog/palette state may remain local or move into a focused shell hook.

Do not create a global state framework merely to shrink the root component.

### Experiment controller

Split `experiment-controller.ts` around:

- queue planning;
- lease/fence lifecycle;
- task attempt execution;
- compound reuse/repair/roster extension;
- atomic terminal commit;
- public controller facade.

Preserve one authoritative queue loop and one atomic commit boundary. Extraction
must not duplicate execution paths.

### Fusion Study stages

Represent each stage behind a common typed stage contract with explicit inputs,
outputs, paid-call plan, and validation. Suggested modules:

- baseline/single-model stage;
- pair screening stage;
- recipe elimination stage;
- holdout evaluation stage;
- playbook/confirmation stage.

Blindness, dev/holdout separation, and reuse provenance remain invariants owned by
shared contracts, not duplicated comments.

## Workstream A — Characterization and dependency mapping

1. Record current module responsibilities and imports in an architecture note.
2. Add characterization tests for every public method and stage transition that
   will move.
3. Snapshot or assert:
   - event ordering;
   - provider call counts;
   - attempt IDs/references;
   - persisted terminal records;
   - abort behavior;
   - cost provenance;
   - blind label behavior;
   - lease/fence interactions.
4. Identify dependency cycles before creating files.
5. Define narrow interfaces for clock, ID generation, providers, recorder, and
   repository only where tests or boundaries require them.

No production extraction begins until characterization coverage is green.

## Workstream B — Extract candidate/Judge/Fusion executors

1. Move one stage at a time, beginning with the most self-contained candidate
   executor.
2. Keep dependency injection from the current `createRunExecutor` factory.
3. Preserve timeout, redaction, and usage/cost helpers from prior phases.
4. Verify exact lifecycle events and abort cleanup.
5. Extract Judge execution with blind-set generation and parse validation intact.
6. Extract Fusion execution and re-Fuse semantics.
7. Leave the parent executor responsible for ordering and insufficient-candidate
   decisions.
8. Run focused and full gates after each extraction commit.

## Workstream C — Simplify the Compare controller API

1. Enumerate actual callers of every controller method.
2. Remove dead/no-op methods first with compile-time caller verification.
3. Extract snapshot builders as pure functions with tests.
4. Extract event adapters without changing reducer action ordering.
5. Extract persistence recorder wiring while preserving failure behavior.
6. Keep the facade small and intention-revealing:
   - `startCompare`;
   - `abort`;
   - `retryCandidate`;
   - `retryJudge`;
   - `fuse`/`refuse` if both are real operations.
7. Avoid leaking executor event internals into React components.

## Workstream D — Decompose root readiness and Compare wiring

1. Extract provider probe lifecycle into a hook/service using the existing
   coordinator.
2. Extract registry-derived readiness and catalog state.
3. Extract Compare preflight/execution ownership integration.
4. Move large rendering blocks into route/workspace components without changing
   DOM semantics, focus behavior, or responsive geometry.
5. Preserve root-level mounting when it is required to keep Compare state alive
   across navigation.
6. Re-run deterministic design/motion and execution QA.

## Workstream E — Extract experiment execution responsibilities

1. Start from pure queue/planning functions.
2. Extract lease/fence coordination only if the shared implementation from Plan
   005 is already stable.
3. Extract one task-attempt executor that receives an immutable plan and returns
   a terminal payload.
4. Keep UoW persistence atomic and outside provider-stage helpers.
5. Preserve pause-at-boundary, abort, recovery, roster extension, and repair
   behavior through characterization tests.
6. Ensure there remains one path for fresh, repair, and roster-extension attempts
   where their shared behavior is genuinely identical; retain discriminants for
   distinct provenance.

## Workstream F — Modularize Fusion Study stages

1. Define stage input/output discriminated unions.
2. Encode prerequisites so an invalid stage transition is rejected before paid
   calls.
3. Move stage-specific pure planning first.
4. Move execution adapters second.
5. Keep holdout Judge isolation and recipe/version fingerprints explicit.
6. Verify complete screened-pair tables and playbook claim levels are unchanged.
7. Avoid redesigning the experiment or scoring methodology in this phase.

## Workstream G — Documentation and dependency enforcement

1. Update architecture documentation with new ownership.
2. Add import-boundary lint rules only where stable and useful—for example,
   domain modules may not import React or persistence.
3. Document extension points for adding providers, evaluation policies, and
   Fusion Study stages.
4. Remove transitional re-export shims after all callers migrate and tests pass.
5. Update plan status after every completed workstream.

## Scope

**In scope**:

- structural extraction of named responsibilities
- removal of dead/no-op APIs
- characterization tests
- narrow internal interfaces
- architecture/import-boundary documentation

**Out of scope**:

- new product features;
- changing persistent schemas or fingerprints;
- changing scoring, prompts, or Judge output contracts;
- switching state-management frameworks;
- broad UI redesign;
- bundle optimization unless an extraction naturally enables it;
- rewriting all modules to satisfy a line-count target.

## Verification commands

After every workstream:

```bash
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

Also run all deterministic QA scripts affected by the moved surface, including
roster extension, suite reliability, design motion, and cross-tab execution.

## Acceptance criteria

- Public behavior and persisted evidence remain equivalent.
- Provider call counts and stage ordering are unchanged.
- No silent no-op controller APIs remain.
- Domain/pipeline code remains transport- and React-independent.
- Root/controller modules become orchestration facades rather than mixed
  implementations.
- Experiment repair/extension/fresh execution retain honest discriminants and
  one atomic terminal commit path.
- Fusion Study dev/holdout separation remains mechanically enforced.
- CI, coverage, lint, and deterministic QA stay green after each workstream.

## STOP conditions

Stop a workstream if:

- characterization tests cannot state the current intended behavior;
- extraction changes serialized records, fingerprints, prompt bytes, or paid-call
  counts;
- a proposed shared abstraction erases meaningful provenance differences;
- dependency cycles require a product-level redesign;
- the diff becomes a broad rewrite that cannot be reviewed incrementally.

## Handoff to Plan 008

Plan 008 may assume stable, measurable module and route boundaries. It will
optimize loading and isolate protocol-sensitive integrations based on profiling,
not bundle-warning anxiety.
