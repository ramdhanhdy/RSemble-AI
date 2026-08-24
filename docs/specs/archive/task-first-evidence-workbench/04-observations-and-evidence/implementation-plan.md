# Observations and Evidence Provenance Implementation Plan

> **For Hermes:** Implement task-by-task with strict RED → GREEN → REFACTOR. Load `rsemble-ai-development`, `test-driven-development`, and `subagent-driven-development` before execution.

**Goal:** Derive idempotent, explainable Observations and eligibility decisions from exact selected attempts without duplicating evidence or inflating counts.

**Architecture:** Build pure source-selection, model-identity, cohort, classification, and counting modules first. Persist only references/normalized outcomes and decisions in additive stores. Run derivation after source commits, with resumable reindex/backfill isolated from paid execution.

**Tech stack:** TypeScript, Dexie, Vitest/property fixtures, React/happy-dom, existing Run/Evaluation repositories and execution events.

**Specification:** [`observations-and-evidence-spec.md`](./observations-and-evidence-spec.md)
**Execution authorization:** Explicit approval required; local commits only; no push.

---

## Milestone map

| Milestone | Result | Gate |
|---|---|---|
| A | Pure evidence rules | Counting/classification tables green |
| B | Durable idempotent index | Repository/rebuild tests green |
| C | Evaluation integration/backfill | Source evidence unchanged |
| D | Evidence receipts/Task views | Responsive/a11y/full gate green |

## Task 0: Dependency/drift/source audit

Verify children 01–03 complete. Record branch/HEAD/worktree and hashes. Re-read selected-attempt structures, judge/verifier evidence, protocol fingerprints, roster extension, repair, RunRecordV2, ExperimentRecord, repositories, unit-of-work, storage errors. Run current full targeted evaluation/persistence suite.

**STOP:** Any source cannot identify selected candidate and assessment, parent/spec drift, unexplained test failure, or dirty overlap.

## Task 1: Define evidence domain and runtime guards

**Files:**
- Create `src/lib/evidence/evidence-types.ts`
- Create `src/lib/evidence/evidence-validation.ts`
- Create tests.

**RED:** ModelConfigurationSnapshot, Observation, AssessmentRef, EligibilityDecision, allowed uses, classes, reason codes, outcomes, prohibited keys/secrets, malformed source refs.

**GREEN:** Implement exact guards and canonical serializers. No raw candidate output/full rationale fields allowed in Observation.

Commit: `feat(evidence): define observation and eligibility domain`.

## Task 2: Canonicalize model configuration identity

**Files:**
- Create `src/lib/evidence/model-configuration.ts` + test

**RED:** Exact/rolling/partial identity; unknown version; reasoning/tool/runtime differences; canonical key permutation; secret omission; collision deep-check; date-window updates.

**GREEN:** Resolve only stored facts. Unknown remains null/partial. No marketing-name rollup.

Commit: `feat(evidence): canonicalize model configurations`.

## Task 3: Select active source attempts and assessments

**Files:**
- Create `src/lib/evidence/observation-source.ts` + exhaustive test

**RED:** Fresh success, retry success, rejected/failed attempts, missing-cell repair, interrupted partial, re-judge, roster extension reused output, added model, full-roster fallback, multiple extension events, verifier-only, judge+verifier.

Assert selected candidate/assessment, execution lineage, source cell, and audit-only alternatives.

**GREEN:** Pure selector over current immutable source records. No writes.

Commit: `feat(evidence): select canonical observation sources`.

## Task 4: Implement classes, allowed uses, and explanations

**Files:**
- Create `src/lib/evidence/evidence-eligibility.ts` + table tests
- Create `src/lib/evidence/evidence-explanation.ts` + snapshot tests

**RED:** Every specification reason combination asserts class/status/uses/reasons; unknown version disclosure; incomplete roster allows only qualified uses; verifier pass/fail; legacy/corrupt/input-incomplete.

**GREEN:** Version rule set as constant, deterministic output/sorted reasons, fixed safe explanation copy.

Commit: `feat(evidence): classify allowed evidence uses`.

## Task 5: Implement comparability cohorts

**Files:**
- Create `src/lib/evidence/comparability-cohort.ts` + property tests

**RED:** Split on task/version/instance, Rubric/verifier, protocol, evaluator, response mode, reasoning/tools, provider/resolved version; stable permutation/canonical serialization; readable split reasons.

**GREEN:** Return fingerprint plus disclosure fields. Never pool.

Commit: `feat(evidence): fingerprint comparability cohorts`.

## Task 6: Lock counting invariants

**Files:**
- Create `src/lib/evidence/evidence-counting.ts` + property/table tests

**RED fixtures:** ten retries/one success; same instance repeats; two versions/one Task; planned versus undeclared replicates; missing paired cell; roster extension reuse; multiple judges same output; changed active assessment.

Assert separate Task/version/instance/observation/replicate/attempt counts and one active observation per lineage cell.

**GREEN:** Implement pure grouping/selection. Commit: `feat(evidence): prevent evidence count inflation`.

## Task 7: Add evidence stores/repository

**Files:**
- Modify `src/lib/persistence/database.ts` using next schema version
- Create `src/lib/persistence/evidence-repository.ts` + contract tests
- Add in-memory parity.

**RED:** Idempotent unique key, conflicting duplicate error, source/model/task queries, active decisions, rule revisions, pagination, storage failure, CAS/source-revision behavior.

**GREEN:** Add stores/indexes and transactional repository methods.

Commit: `feat(storage): persist evidence references`.

## Task 8: Build derivation service and post-commit integration

**Files:**
- Create `src/lib/evidence/derive-observations.ts` + tests
- Integrate at Evaluation source commit/event seam, not inside stream data plane.

**RED:** Source commits succeed even if derived indexing fails; no provider call; retry indexing; source revision change; exactly-once result under duplicate events; all existing Fusion Study `FusionObservation` events/stores are ignored by canonical derivation.

**GREEN:** Queue post-commit local job. Preserve single paid-execution owner and unit-of-work.

Commit: `feat(evidence): derive observations after source commit`.

## Task 9: Add resumable backfill/reindex

**Files:**
- Create `src/lib/persistence/evidence-reindex.ts` + migration fixtures/tests

**RED:** Clean/legacy/partial/corrupt, interrupted cursor, repeated N runs, roster extension source update, Compare exploratory inventory, unresolved Task, existing Fusion Study stores skipped unchanged, multi-tab owner, quota/unavailable.

**GREEN:** Deterministic cursor and marker-after-verify. Never mutate source or invoke provider.

Commit: `feat(storage): backfill evidence idempotently`.

## Task 10: Build Evidence receipt components

**Files:**
- Create `src/ui/EvidenceReceipt.tsx` + happy-dom test
- Integrate Evaluation cell/task detail.

**RED:** Eligible/provisional/excluded, all classes, reasons, uses, missingness, retry/reuse/version warnings, exact Task/Observation/Record links, loading/index-error states, no badge-only meaning.

**GREEN:** Implement accessible disclosure and compact summary.

Commit: `feat(evidence): explain why results count`.

## Task 11: Add Task observations view

**Files:**
- Create `src/workspaces/tasks/TaskObservations.tsx` + tests
- Modify Task route/detail.

**RED:** Group/filter/paginate by version/instance/model/class/use/cohort/source/date; counts differentiated; unknown/legacy states; direct observation link.

**GREEN:** Implement over evidence repository; no Models workspace.

Commit: `feat(tasks): inspect task observations`.

## Task 12: Extend archive v2

Extend child-03 archive v2 validators/export/import with immutable canonical Task Observations, Eligibility Decisions, exact Model Configuration snapshots, evidence rule/version metadata, and required crosswalks. Preserve child-02 Fusion Study `fusionObservations` as a separately typed collection without conversion or ID collision. Add earlier-v2 and v1 fixtures, source-reference verification, no raw-output/rationale duplication, prohibited-content checks, and collision-abort-before-write behavior.

Commit: `feat(archive): preserve evidence derivations`.

## Task 13: Final invariant and QA gate

Run:

```bash
npx vitest run src/lib/evidence src/lib/persistence src/workspaces/tasks src/workspaces/evaluations
npm run typecheck:web
npm run check
```

Run deterministic fixture twice and compare IDs/counts/decisions. Browser-test Evaluation result → receipt → Task observations → exact Record at all viewports/zoom/keyboard/reduced motion; test partial/reused/unknown/corrupt states and secret probes.

**STOP conditions:** source payload copied, retry/reuse inflation, missing pair gets comparative use, unknown provenance fabricated, indexing changes result state, or real provider call.

## Done definition

All exact sources remain unchanged; derivation/reindex is idempotent; eligibility and counts match parent; receipts and Task views are truthful; full gate/browser evidence green; no push.
