# Hybrid Evaluation Criteria — Prime Agent Implementation Plan

> **Worker instruction:** Implement against the current RSemble-AI repository state. Use live code and current authority docs. Archived specs are historical traceability only.
>
> Apply TDD for behavioral changes. Keep changes narrowly scoped. Re-read target files before editing because the repository changes quickly. Do not push, merge, rebase, or perform destructive cleanup unless separately authorized.

**Goal:** Add mixed evaluation profiles with explicit five-anchor graded criteria and first-class binary true/false criteria while preserving historical 1/3/5 evidence and the current 1–5 canonical score.

**Companion spec:** `hybrid-evaluation-criteria-spec.md`

---

## 0. Execution rules

Before every phase:

```bash
git status --short --branch
git diff --check
```

Rules:

- Preserve blind judging.
- Preserve strict Judge parsing.
- Preserve the existing visible `JUDGE_FAILED` path.
- Preserve immutable run/profile/experiment snapshots.
- Do not rewrite historical records.
- Do not introduce automatic hard-gate winner disqualification.
- Do not conflate binary Judge criteria with `VerifierOutcome.passed`.
- Do not change provider adapters.
- Do not add real provider calls to automated tests.
- Keep Compare and Evaluations operational at the end of each phase.
- If live paths differ from this plan, adapt to equivalent current modules and document the deviation.
- Stage explicit paths only if later authorized to commit.
- Run focused tests after every logical RED/GREEN cycle.

---

# Phase 1 — Criterion domain model

## 1.1 Inspect live assumptions

Search:

```bash
rg 'EvaluationCriterion|anchors\.(one|three|five)|criterionScores|JudgeCriterionScore|Score 1|Score 3|Score 5' src
```

Read current:

```text
src/lib/evaluations/evaluation-types.ts
src/lib/evaluations/evaluation-profile.ts
src/studio-data.ts
src/lib/pipeline.ts
```

Identify every numeric-only or 1/3/5-only assumption before editing.

## 1.2 RED — criterion union tests

Add tests for:

1. explicit graded criterion with five anchors validates;
2. missing Score 2 fails;
3. missing Score 4 fails;
4. binary criterion with both conditions validates;
5. missing `trueWhen` fails;
6. missing `falseWhen` fails;
7. unknown `kind` fails;
8. legacy 1/3/5 criterion still validates;
9. mixed legacy + graded + binary profile validates;
10. at least one positive weight remains required;
11. prohibited-key scanning still applies recursively.

Run:

```bash
npm test -- src/lib/evaluations/evaluation-types.test.ts
```

## 1.3 GREEN — criterion union

Implement:

```ts
EvaluationCriterionBase
GradedEvaluationCriterion
BinaryEvaluationCriterion
LegacyGradedEvaluationCriterion
EvaluationCriterion
```

Add explicit guards:

```ts
isGradedEvaluationCriterion
isBinaryEvaluationCriterion
isLegacyGradedEvaluationCriterion
```

Requirements:

- validation must not mutate legacy criteria;
- new criteria require explicit `kind`;
- weight semantics remain unchanged.

Gate:

```bash
npm test -- src/lib/evaluations/evaluation-types.test.ts
npm run typecheck:web
git diff --check
```

---

# Phase 2 — Judge result types and strict parsing

## 2.1 RED — typed Judge result tests

Add parser tests for:

### Explicit graded

Accept:

```text
1
2
3
4
5
```

Reject:

```text
0
6
3.5
missing kind
value instead of score
blank rationale
```

### Binary

Accept:

```json
true
false
```

Reject:

```text
"true"
1
5
"pass"
score instead of value
missing kind
blank rationale
```

### Cross-kind failures

Reject:

- binary result for graded criterion;
- graded result for binary criterion;
- missing criterion;
- duplicate criterion;
- unknown criterion ID.

### Legacy behavior

Existing legacy numeric Judge fixtures must continue parsing according to historical behavior.

Run:

```bash
npm test -- src/lib/pipeline.test.ts
```

## 2.2 GREEN — result union

Introduce:

```ts
GradedJudgeCriterionResult
BinaryJudgeCriterionResult
LegacyJudgeCriterionResult
JudgeCriterionResult
```

Change:

```ts
CandidateEvaluation.criterionScores
```

to the result union.

Avoid broad `any` or coercion.

## 2.3 GREEN — criterion-aware parser

Refactor numeric-only parsing into criterion-aware parsing.

Recommended shape:

```ts
parseCriterionResult(raw, criterion, where)
parseCriterionResults(rawArray, criteria, where)
```

Rules:

- explicit kind must match profile kind;
- new graded score must be integer 1–5;
- binary value must be JSON boolean;
- rationale required;
- no coercion.

Gate:

```bash
npm test -- src/lib/pipeline.test.ts
npm run typecheck:web
```

---

# Phase 3 — Judge prompt rendering

## 3.1 RED — formatting tests

Add tests proving:

- legacy criterion renders Score 1/3/5 only;
- explicit graded renders Score 1/2/3/4/5;
- binary renders TRUE/FALSE conditions;
- criterion kind appears in rendered Judge instructions;
- Judge JSON schema explains `score` vs `value`;
- output contract remains last.

Run:

```bash
npm test -- src/lib/evaluations/evaluation-profile.test.ts src/lib/pipeline.test.ts
```

## 3.2 GREEN — formatter

Make one authoritative criterion formatter.

Do not duplicate rendering logic between evaluation-profile and pipeline modules.

Preserve evaluator-only behavior: criteria never go to candidate generation.

Gate:

```bash
npm test -- src/lib/evaluations/evaluation-profile.test.ts src/lib/pipeline.test.ts
npm run typecheck:web
```

---

# Phase 4 — Canonical scoring

## 4.1 RED — mixed scoring tests

Test:

1. graded-only explicit profile;
2. binary true contributes 5;
3. binary false contributes 1;
4. mixed graded/binary weighted mean;
5. zero-weight binary criterion excluded;
6. legacy numeric result still contributes directly;
7. missing required criterion result does not silently reduce denominator;
8. binary summary returns passed/total counts.

Known fixture:

```text
graded score 4, weight 2
binary true, weight 1
binary false, weight 1

canonical = (4*2 + 5*1 + 1*1) / 4 = 3.5
binary summary = 1/2
```

## 4.2 GREEN — contribution helper

Create one authoritative helper:

```ts
criterionContribution(result): number
```

Use it everywhere criterion evidence becomes numeric.

Do not duplicate 5/1 mapping in multiple modules.

## 4.3 Canonical score authority

For explicit profiles:

- derive overall score from the complete validated criterion vector;
- do not trust the Judge's top-level `score` over canonical math.

Preserve holistic behavior unchanged.

Gate:

```bash
npm test -- src/lib/evaluations/evaluation-profile.test.ts src/lib/evaluations/experiment-aggregation.test.ts
npm run typecheck:web
```

---

# Phase 5 — Profile editor

## 5.1 RED — editor tests

Add tests for:

1. Add criterion exposes Graded and Binary choices;
2. Graded shows Score 1–5 fields;
3. Binary shows True when / False when fields;
4. irrelevant fields are hidden by kind;
5. collapsed row visibly says Graded/Binary;
6. new graded save fails when Score 2 missing;
7. new graded save fails when Score 4 missing;
8. binary save fails when either condition missing;
9. legacy criterion still renders without forced mutation;
10. explicit graded↔binary in-place conversion is not offered.

## 5.2 GREEN — editor UI

Implement a compact criterion-kind choice.

Recommended UX:

```text
Add criterion
  Graded 1–5
  Binary True/False
```

Default can be Graded.

Keep current accordion density and accessibility patterns.

## 5.3 Legacy upgrade

If the product currently supports editing an old profile into a new version:

- allow an explicit “Upgrade anchors” action for legacy graded;
- require Score 2 and Score 4 before save;
- preserve criterion ID;
- never auto-generate anchor text.

Gate:

```bash
npm test -- src/ui/EvaluationProfileEditor.test.tsx
npm run typecheck:web
```

---

# Phase 6 — Persistence, archives, suite packages, fingerprints

## 6.1 RED — persistence guards

Add tests proving:

- RunRecordV2 accepts new graded result;
- RunRecordV2 accepts binary result;
- historical result still validates;
- invalid result kind/value fails;
- prohibited-key scan still works.

## 6.2 No historical migration

Do not rewrite IndexedDB rows.

Prefer additive nested runtime compatibility.

Keep top-level run schema version unchanged unless impossible.

## 6.3 Protocol fingerprint RED/GREEN

Add tests:

- Score 2 change alters fingerprint;
- Score 4 change alters fingerprint;
- criterion kind change alters fingerprint;
- trueWhen change alters fingerprint;
- falseWhen change alters fingerprint.

Then update fingerprint normalization.

## 6.4 Suite-package RED/GREEN

Test imports containing:

- explicit graded criteria;
- binary criteria;
- mixed criteria;
- legacy criteria.

Do not coerce.

## 6.5 Archive RED/GREEN

Round-trip current archive format with:

- binary Judge result preserved as boolean;
- explicit five anchors preserved;
- legacy evidence unchanged.

Gate:

```bash
npm test -- \
  src/lib/persistence/run-types.test.ts \
  src/lib/persistence/archive.test.ts \
  src/lib/evaluations/protocol-fingerprint.test.ts \
  src/lib/evaluations/suite-package.test.ts
npm run typecheck:web
```

Use current equivalent test paths if names differ.

---

# Phase 7 — Rank, Run Detail, and experiment evidence UI

## 7.1 RED — evidence rendering tests

Add tests for:

- graded criterion renders `4 / 5`;
- binary true renders PASS;
- binary false renders FAIL;
- binary results show rationale;
- summary displays `Binary checks X/Y`;
- color is not the sole outcome indicator;
- historical criteria still render.

## 7.2 GREEN — shared criterion evidence view

Prefer a small reusable component rather than duplicating logic in Rank and Run Detail.

Suggested:

```text
CriterionResultList
CriterionResultRow
```

Do not redesign surrounding result surfaces.

## 7.3 Experiment result support

If experiment detail exposes criterion-level evidence, use the same renderer.

The model-by-task matrix remains numeric 1–5.

Gate:

```bash
npm test -- \
  src/workspaces/runs/RunDetail.test.tsx \
  src/ui/rank-explainability.test.tsx \
  src/workspaces/evaluations/ExperimentResults.test.tsx \
  src/workspaces/evaluations/ResultMatrix.test.tsx
npm run typecheck:web
```

Use current equivalent paths where necessary.

---

# Phase 8 — Experiment aggregation and Fusion Study

## 8.1 Experiment aggregation

Add mixed-profile fixtures.

Prove:

- canonical task score uses the 5/1 binary contribution;
- equal-task averaging is unchanged;
- coverage is unchanged;
- winner eligibility is unchanged.

## 8.2 Fusion Study

Search current headroom modules:

```bash
rg 'headroom|criterion.*score|VerifierOutcome|Jaccard|phi' src/lib/evaluations
```

Add tests proving:

- binary criterion true maps to 5 at numeric headroom boundary;
- false maps to 1;
- mixed profiles do not crash headroom calculations;
- verifier co-failure metrics continue using only `VerifierOutcome.passed`;
- Judge binary results never enter verifier correlation calculations.

Use the shared `criterionContribution()` helper.

Gate:

```bash
npm test -- src/lib/evaluations
npm run typecheck:web
```

---

# Phase 9 — Markdown export

## 9.1 RED

Add export fixture containing:

- graded 4/5;
- binary PASS;
- binary FAIL;
- rationales.

Expected output preserves native semantics.

## 9.2 GREEN

Render:

```text
Correctness — 4/5
Uses ITT denominator — PASS
Rejects untrusted instruction — FAIL
```

Do not flatten binary evidence into 5/5 or 1/5.

Gate:

```bash
npm test -- src/lib/export-markdown.test.ts
```

---

# Phase 10 — Authority docs and evaluation suite update

Only after code contracts are stable:

1. Update `PRODUCT.md` current evaluation-profile language from sparse 1/3/5-only wording to mixed criteria.
2. Add a new `DECISIONS.md` entry documenting:
   - explicit five-anchor graded criteria;
   - first-class binary criteria;
   - binary 5/1 canonical contribution;
   - no automatic hard-gate semantics;
   - historical compatibility.
3. Add the completed spec under the repository's current spec workflow/location.
4. Update the Frontier Evaluation Suite to use:
   - narrower graded criteria;
   - task-specific binary checks;
   - no artificial binary-as-graded encoding.

Do not modify archived specs to describe new behavior.

---

# Phase 11 — Full validation

## 11.1 Focused regression sweep

Run all affected suites discovered during implementation.

At minimum:

```bash
npm test -- \
  src/lib/evaluations/evaluation-types.test.ts \
  src/lib/evaluations/evaluation-profile.test.ts \
  src/lib/pipeline.test.ts \
  src/lib/persistence/run-types.test.ts \
  src/lib/persistence/archive.test.ts \
  src/lib/evaluations/protocol-fingerprint.test.ts \
  src/lib/evaluations/experiment-aggregation.test.ts \
  src/ui/EvaluationProfileEditor.test.tsx \
  src/lib/export-markdown.test.ts
```

## 11.2 Full gate

```bash
npm run format:check
npm run lint
npm run typecheck:web
npm run typecheck:server
npm run test
npm run build
npm run check
git diff --check
```

No provider credentials are needed.

## 11.3 Final audit

Search:

```bash
rg 'anchors:\s*\{\s*one:|Score 3 anchor|Score 5 anchor|criterionScores.*score' src
```

Inspect every remaining match.

Classify each as:

```text
legacy compatibility
intentional current behavior
bug / incomplete migration
```

Fix only the third category.

---

# Phase 12 — Worker completion report

The final Prime Agent report should include:

1. files changed;
2. exact schema/domain changes;
3. Judge prompt/parser changes;
4. scoring formula and 5/1 binary mapping;
5. backward-compatibility behavior;
6. UI changes;
7. protocol-fingerprint implications;
8. suite-package/archive compatibility;
9. Fusion Study handling;
10. focused test results;
11. full gate results;
12. any deviations from this plan caused by newer live code;
13. explicit statement that historical records were not rewritten;
14. explicit statement that binary Judge results remain distinct from verifier outcomes;
15. explicit statement that no paid provider calls were made.

Do not claim implementation complete if the full gate fails.
