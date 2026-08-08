# Hybrid Evaluation Criteria — Prime Agent Implementation Plan

> **Worker instruction:** Implement against the current RSemble-AI repository state. Use live
> code and current authority docs. Archived specs are historical traceability only.
>
> Apply TDD for behavioral changes. Keep changes narrowly scoped. Re-read target files before
> editing because the repository changes quickly. Do not push, merge, rebase, or perform
> destructive cleanup unless separately authorized.
>
> **Architecture contract:** the final scoring contract is `rankValue = Q − λ(1−C)`
> (authoritative ranking), `rankScore = max(1, rankValue)` (bounded display),
> `floored = rankValue < 1`. The superseded `binary false → 1 / true → 5` mixed weighted mean
> is **not** implemented. See `hybrid-evaluation-criteria-spec.md` and
> `scoring-reconciliation-decision.md`.

**Goal:** Add mixed evaluation profiles with explicit five-anchor graded criteria and
first-class binary true/false checks organized into ALL-mode Requirement Groups, with a
profile-level `complianceInfluence` (λ), while preserving historical 1/3/5 evidence and the
current 1–5 presentation contract.

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
- Do not rewrite historical records; historical authoritative results are never recalculated.
- Do not introduce automatic hard-gate winner disqualification (`kind:"gate"` is rejected by validation).
- Do not conflate binary Judge checks with `VerifierOutcome.passed`.
- Do not change provider adapters.
- Do not add real provider calls to automated tests.
- Keep Compare and Evaluations operational at the end of each phase.
- If live paths differ from this plan, adapt to equivalent current modules and document the deviation.
- Stage explicit paths only if later authorized to commit.
- Run focused tests after every logical RED/GREEN cycle.
- **Terminology:** use `rankValue` / `rankScore` / `floored` exactly; never reintroduce
  `R`, `R_raw`, "binary block weight", the 5/1 mapping, the min-cost "binary-decided" badge,
  or the δ=0.10 band.

---

# Phase A — Domain model

## A.1 Inspect live assumptions

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

## A.2 RED — domain tests

Add tests for:

1. explicit graded criterion with five anchors validates;
2. missing Score 2 fails;
3. missing Score 4 fails;
4. binary check with both conditions validates;
5. binary check has **no** weight field (weight lives on the group);
6. missing `trueWhen` fails;
7. missing `falseWhen` fails;
8. unknown `kind` fails;
9. `kind:"gate"` is rejected with the reserved-boundary message;
10. Requirement Group: exactly-one membership (dangling check fails save; duplicate membership fails);
11. implicit singleton group materialized at save for an ungrouped check;
12. group with `checkIds` empty / duplicates / resolving to a graded criterion fails;
13. group weight `v_g ≤ 0` fails; mode other than `"ALL"` fails;
14. profile `complianceInfluence`: missing → default 1.0; < 0 or > 1 fails; non-finite fails;
15. legacy 1/3/5 criterion still validates (kind-undefined);
16. mixed legacy + graded + binary + groups profile validates;
17. at least one positive-weight criterion or group remains required;
18. prohibited-key scanning still applies recursively.

Run:

```bash
npm test -- src/lib/evaluations/evaluation-types.test.ts
```

## A.3 GREEN — domain implementation

Implement:

```ts
EvaluationCriterionBase
GradedEvaluationCriterion        (kind "graded", weight, anchors one..five)
BinaryEvaluationCriterion        (kind "binary", trueWhen/falseWhen — no weight)
RequirementGroup                 (id, name, checkIds, weight, mode: "ALL")
LegacyGradedEvaluationCriterion  (kind undefined, 1/3/5 anchors)
EvaluationCriterion              (union)
EvaluationProfile                (+ requirementGroups?: RequirementGroup[],
                                    complianceInfluence?: number)
```

Add explicit guards:

```ts
isGradedEvaluationCriterion
isBinaryEvaluationCriterion
isLegacyGradedEvaluationCriterion
isRequirementGroup
```

Requirements:

- validation must not mutate legacy criteria;
- new criteria require explicit `kind`;
- ungrouped binary checks are assigned a materialized singleton group at save;
- `complianceInfluence` defaults to 1.0 on load for new mixed profiles (never stamped onto legacy profiles);
- group membership validation resolves IDs against the profile's binary checks.

Gate:

```bash
npm test -- src/lib/evaluations/evaluation-types.test.ts
npm run typecheck:web
git diff --check
```

---

# Phase B — Judge schema and strict parser

## B.1 RED — typed Judge result tests

Add parser tests for:

### Explicit graded

Accept:

```text
1 2 3 4 5
```

Reject:

```text
0 6 3.5 missing kind value instead of score blank rationale
```

### Binary

Accept:

```json
true false
```

Reject:

```text
"true" 1 5 "pass" score instead of value missing kind blank rationale
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

## B.2 GREEN — result union and parser

Introduce:

```ts
GradedJudgeCriterionResult      (kind "graded", score: 1|2|3|4|5)
BinaryJudgeCriterionResult      (kind "binary", value: boolean)
LegacyJudgeCriterionResult      (kind undefined, score: number)
JudgeCriterionResult            (union)
```

Change `CandidateEvaluation.criterionScores` to the result union.

Refactor numeric-only parsing into criterion-aware parsing:

```ts
parseCriterionResult(raw, criterion, where)
parseCriterionResults(rawArray, criteria, where)
```

Rules:

- explicit kind must match profile kind;
- new graded score must be integer 1–5 (do not touch `requireScore`'s shared use for the
  top-level `overallScore` or legacy criteria);
- binary value must be a JSON boolean;
- rationale required;
- no coercion.

Note: `isJudgeReport` is shallow on `evaluationsById` — strictness lives at parse time; keep it there.

Gate:

```bash
npm test -- src/lib/pipeline.test.ts
npm run typecheck:web
```

---

# Phase C — Judge prompt

## C.1 RED — formatting tests

Add tests proving:

- legacy criterion renders Score 1/3/5 only;
- explicit graded renders Score 1/2/3/4/5;
- binary renders TRUE/FALSE conditions plus its group ID annotation;
- the binary prompt contains **no** numeric encoding (no "score 5 for true");
- criterion kind appears in rendered Judge instructions;
- Judge JSON schema explains `score` vs `value`;
- output contract remains last.

Run:

```bash
npm test -- src/lib/evaluations/evaluation-profile.test.ts src/lib/pipeline.test.ts
```

## C.2 GREEN — formatter

Make one authoritative criterion formatter (`evaluationCriteriaText` in
`evaluation-profile.ts` is the existing single formatter used by pipeline and fusion-recipes).

Do not duplicate rendering logic between modules.

Judge sees flat checks with group IDs (e.g., `[id: ch-1] [group: g1]`); grouping is
post-processing — the Judge never computes ALL/MEAN and never sees group weights as numeric
encodings.

Preserve evaluator-only behavior: criteria never go to candidate generation.

Gate:

```bash
npm test -- src/lib/evaluations/evaluation-profile.test.ts src/lib/pipeline.test.ts
npm run typecheck:web
```

---

# Phase D — Requirement Group aggregation

## D.1 RED — aggregation tests

Add tests proving:

- ALL group: `c_g = min(member booleans)` — any false fails the group;
- group weights: `C = Σ(v_g·c_g)/Σv_g` with weighted share computed correctly;
- singleton groups behave as weighted checks;
- weighted compliance display: "Compliance 71% · 5/6 groups" (share first, count second);
- zero groups → `C := 1`, display "—";
- decomposition invariance: one requirement as 1 check vs 5 subchecks in one ALL group
  (v unchanged) yields the same `C` and the same `rankValue` for identical member outcomes;
- subcheck-count fragility disclosure data (N and false-fail-rate note) available to the editor;
- save/import validation rejects dangling/duplicate membership and v_g ≤ 0.

Run:

```bash
npm test -- src/lib/evaluations/evaluation-profile.test.ts src/lib/evaluations/suite-package.test.ts
```

## D.2 GREEN — aggregation helper

Create one authoritative compliance aggregator:

```ts
complianceFromGroups(groups, resultsByCheckId): { C: number; groupsPresent: number }
```

Used by scoring (Phase E), experiments (Phase J), Fusion Study (Phase K), and exports (Phase L).

Gate:

```bash
npm test -- src/lib/evaluations
npm run typecheck:web
```

---

# Phase E — Scoring

## E.1 RED — scoring tests

Test each quantity separately:

- `Q` — weighted mean over positive-weight graded criteria, missing skipped; zero graded → no Q;
- `c_g` / `C` — per Phase D;
- `rankValue = Q − λ·(1 − C)` — including values below 1 (e.g., Q=1.2, C=0.5, λ=1 →
  rankValue = 0.7);
- `rankScore = max(1, rankValue)` — floor cases;
- `floored = rankValue < 1`.

Scenarios:

- λ=0 (checks excluded; rankValue = Q);
- λ=1 (full cap);
- no binary (C:=1, rankValue = Q — bit-identical to today's canonical for pure-graded
  profiles, including float behavior);
- no graded (compliance-only: no rankValue; C is the scalar);
- one group; many groups; uneven group weights;
- floor cases: Q=1.0/C=0 → rankValue 1.0 (not floored, rankScore 1.0) and
  Q=1.5/C=0.0 → rankValue 0.5 (floored, rankScore 1.0) display the same rankScore but order
  by rankValue (1.0 > 0.5) — assert ordering by rankValue, never by rankScore;
- candidate ordering below the floor: rankValue desc is the sort key.

Known fixture:

```text
graded 4 (w=2); group A true (v=1); group B false (v=1); λ=1
Q = 4, C = 0.5, rankValue = 4 − 1×0.5 = 3.5, rankScore = 3.5, floored = false
compliance summary = "50% · 1/2 groups"
```

Run:

```bash
npm test -- src/lib/evaluations/evaluation-profile.test.ts
```

## E.2 GREEN — scoring helpers

Create one authoritative scoring module (single source of truth):

```ts
qualityScore(criterionScores, profile): number | null
complianceScore(criterionScores, profile): { C: number; groupsPresent: number } | null
rankValue(Q, C, lambda): number          // Q − λ(1−C)
rankScoreOf(rankValue): number           // max(1, rankValue)
isFloored(rankValue): boolean            // rankValue < 1
```

Use it everywhere criterion evidence becomes numeric (aggregation, Fusion, exports).

For explicit profiles, derive ranking values from the complete validated criterion vector; do
not trust the Judge's top-level `score` over canonical math. Preserve holistic behavior
unchanged.

Gate:

```bash
npm test -- src/lib/evaluations/evaluation-profile.test.ts src/lib/evaluations/experiment-aggregation.test.ts
npm run typecheck:web
```

---

# Phase F — Winner / rank behavior

## F.1 RED — authority tests

Add tests proving:

- winner selection compares `rankValue` with `WINNER_EPSILON = 1e-9` (existing
  `computeWinnerKeys` semantics, applied to rankValue);
- two floored candidates with different rankValue do **not** tie (no artificial ties from
  rankScore);
- rankScore never enters winner logic;
- deterministic tiebreaks: rankValue desc → Q desc → C desc → stable id (quality-first);
- at equal rankValue, higher Q ranks above (the C-first anti-quality order is rejected);
- the ≥0.5 same-conclusion material-gap rule evaluates Q-gap first, then C-gap, for floored
  pairs;
- pure-graded winner behavior is bit-identical to today.

Run:

```bash
npm test -- src/lib/evaluations/evaluation-profile.test.ts src/lib/evaluations/experiment-ranking.test.ts
```

## F.2 GREEN — wiring

- Route Rank winner math through the derived `rankValue` (behavioral change; see spec §15.4).
  Today Rank uses the Judge's top-level `overallScore` (`pipeline.ts` → `scoresById`) while
  experiments recompute from criteria — unify on `rankValue`.
- Ensure `criterionScoresToMap` (studio-engine) and `RankResult` do not crash on boolean
  results (see Phase I).
- Optional deterministic "Compliance changed the winner" signal: **deferred** (spec §9.8).
  Do not implement it in this feature.

Gate:

```bash
npm test -- src/lib/evaluations/evaluation-profile.test.ts src/lib/evaluations/experiment-aggregation.test.ts
npm run typecheck:web
```

---

# Phase G — Persistence, snapshots, fingerprints

## G.1 RED — persistence guards

Add tests proving:

- `RunRecordV2` accepts new graded results, binary results, groups, and λ;
- historical result still validates;
- invalid result kind/value fails;
- binary-profile runs pass `isRunRecordV2`/`isEvaluationProfile` (the union guard fix —
  otherwise history silently drops them);
- prohibited-key scan still works.

## G.2 No historical migration

Do not rewrite IndexedDB rows. Historical authoritative results are never recalculated.
Additive nested runtime compatibility only; top-level run schema version unchanged unless
impossible.

## G.3 Protocol fingerprint RED/GREEN

Add tests:

- Score 2 change alters fingerprint;
- Score 4 change alters fingerprint;
- criterion kind change alters fingerprint;
- trueWhen change alters fingerprint;
- falseWhen change alters fingerprint;
- group membership change alters fingerprint;
- group weight change alters fingerprint;
- group mode change (if represented) alters fingerprint;
- `complianceInfluence` change alters fingerprint.

Then update `semanticFingerprintInput` in `protocol-fingerprint.ts`: whitelist
`complianceInfluence` and `requirementGroups` explicitly (they are profile-level; criteria
flow wholesale but the container does not).

## G.4 Suite-package RED/GREEN

Test imports containing:

- explicit graded criteria;
- binary checks with groups;
- mixed criteria;
- legacy criteria;
- `complianceInfluence`;
- `kind:"gate"` → import rejection with the named message.

Do not coerce.

## G.5 Archive RED/GREEN

Round-trip current archive format with:

- binary Judge result preserved as boolean;
- explicit five anchors preserved;
- groups and λ preserved;
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

# Phase H — Profile editor

## H.1 RED — editor tests

Add tests for:

1. Add criterion exposes Graded and Binary choices;
2. Graded shows Score 1–5 fields;
3. Binary shows True when / False when + group selector; no per-check weight field;
4. group authoring: create group, merge selected singleton checks, group weight input;
5. live per-group fail cost `λ·v_g/Σv` shown;
6. `complianceInfluence` control (0–1, default 1.0) with the "max points" label;
7. λ=0 renders "checks excluded" marker;
8. singleton warning when ≤ 2 groups;
9. subcheck count + ALL-fragility note; warn at N ≥ 4;
10. new graded save fails when Score 2 missing;
11. new graded save fails when Score 4 missing;
12. binary save fails when either condition missing or no group;
13. legacy criterion still renders without forced mutation;
14. explicit graded↔binary in-place conversion is not offered;
15. no gate UI, no MEAN toggle, no member weights, no duplication lint.

## H.2 GREEN — editor UI

Implement a compact criterion-kind choice.

Recommended UX:

```text
Add criterion
  Graded 1–5
  Binary True/False
```

Default can be Graded.

Group container: collapsible sections; "Group into requirement" merge action; group weight
field; live fail cost; no mode toggle.

Compliance influence: number input 0–1 step 0.1, default 1.0, with the inline help text from
spec §11.5.

Keep current accordion density and accessibility patterns.

## H.3 Legacy upgrade

If the product currently supports editing an old profile into a new version:

- allow an explicit "Upgrade anchors" action for legacy graded;
- require Score 2 and Score 4 before save;
- preserve criterion ID;
- never auto-generate anchor text.

Gate:

```bash
npm test -- src/ui/EvaluationProfileEditor.test.tsx
npm run typecheck:web
```

---

# Phase I — Run / Rank UI

## I.1 RED — evidence rendering tests

Add tests for:

- graded criterion renders `4 / 5`;
- binary true renders PASS; binary false renders FAIL (text+icon, not color alone);
- binary rows show rationale and group name;
- summary displays `Compliance 83% · 5/6 groups` (weighted share first);
- derivation line: `Rank Score 4.23 = 4.40 − 1.00 × 0.17`;
- floored: `Rank score 1.0*` with `Rank value 0.72` and the floor footnote;
- two floored candidates with different rankValue display both values (no fake equivalence);
- the rankValue→Q→C order is printed wherever the bounded display ties;
- historical criteria still render;
- no "binary-decided" badge, no closeness band.

## I.2 GREEN — shared criterion evidence view

Prefer a small reusable component rather than duplicating logic in Rank and Run Detail:

```text
CriterionResultList
CriterionResultRow
```

Fix the live TypeError surfaces: `RankResult.tsx` `cs.score.toFixed(1)`/`tier(cs.score)`,
`studio-engine.ts::criterionScoresToMap`, and any other numeric-only consumer of
`criterionScores`.

Fix `buildWhyItWon` to weight contributions (score×weight for graded; group fail-cost for
binary) and never quote a binary PASS as "(5.0)".

Do not redesign surrounding result surfaces.

## I.3 Experiment result support

If experiment detail exposes criterion-level evidence, use the same renderer. The model-by-task
matrix remains numeric (rankScore display with floor marker; floored-task counts visible).

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

# Phase J — Experiment aggregation

## J.1 RED — aggregation tests

Add mixed-profile fixtures proving:

- per-task ranking value = `rankValue_t` (unclamped);
- experiment model score = equal-task arithmetic mean of `rankValue_t` (authoritative);
- floored task values do **not** create fake experiment ties or reversals (mean of rankValue
  vs mean of rankScore comparison fixture);
- any bounded display aggregate (`max(1, mean(rankValue))`) is rendered separately and labeled;
- "n floored tasks" per candidate;
- equal-task averaging unchanged; coverage unchanged; winner eligibility unchanged;
- ranking key mean(rankValue) → Q̄ → C̄ → id;
- compliance-only profiles rank on C̄; pure-graded profiles bit-identical.

## J.2 GREEN — aggregation wiring

Update `experiment-aggregation.ts::canonicalScoresFromRun` (currently maps `cs.score` →
undefined for binary → silently skips the weight): use the Phase E helpers with λ and groups
from the run's profile snapshot. Keep `formatTaskScore`/`formatAggregateMean` semantics for the
display aggregate; document the floor marker in matrix cells.

Gate:

```bash
npm test -- src/lib/evaluations/experiment-aggregation.test.ts src/lib/evaluations/experiment-ranking.test.ts
npm run typecheck:web
```

---

# Phase K — Fusion Study

## K.1 RED — headroom tests

Search current headroom modules:

```bash
rg 'headroom|criterion.*score|VerifierOutcome|Jaccard|phi' src/lib/evaluations
```

Add tests proving:

- `modelTaskScoreFromReport` extracts boolean results without NaN (currently `cs.score` → NaN);
- `taskOverall` consumes the same `rankValue` contract (Q, C, λ + groups from the profile
  snapshot — `fusion-study-stages` must thread the full snapshot, not only `CriterionWeights`);
- H_synth oracle computes at group level (group satisfied if either model's group passes);
- complementary binary failures do not fabricate large headroom;
- per-criterion headroom for binary = pass-rate imbalance (`1 − b_k`), labeled, with a minimum
  sample gate;
- `detectBimodalScores` excludes binary criteria;
- verifier co-failure metrics continue using only `VerifierOutcome.passed`;
- Judge binary results never enter verifier correlation calculations.

Use the Phase E helpers.

Gate:

```bash
npm test -- src/lib/evaluations
npm run typecheck:web
```

---

# Phase L — Export / archive / suite packages

## L.1 RED

Add export fixtures containing:

- graded 4/5;
- binary PASS;
- binary FAIL;
- rationales;
- floored candidate (rankScore 1.0* with rank value);
- groups and λ in suite-package round-trips.

Expected output preserves native semantics.

## L.2 GREEN

Render:

```text
Correctness — 4/5
Uses ITT denominator — PASS (group: Uses ITT denominator)
Rejects untrusted instruction — FAIL
```

Do not flatten binary evidence into 5/5 or 1/5. Both exporters (`export-markdown.ts` and
`archive.ts::buildRunExportMarkdown`) plus `fusion-recipes.ts::criterionScoresSection` must be
kind-aware (the last one must never leak 5.0/1.0 into the synthesizer prompt). Floored values
export as `1.0*` with the raw value.

Gate:

```bash
npm test -- src/lib/export-markdown.test.ts src/lib/persistence/archive.test.ts
npm run typecheck:web
```

---

# Phase M — Authority docs and evaluation suite update

Only after code contracts are stable:

1. Update `PRODUCT.md` current evaluation-profile language from sparse 1/3/5-only wording to
   mixed criteria with the rankValue/rankScore contract and the `complianceInfluence`
   disclosure.
2. Add a new `DECISIONS.md` entry documenting:
   - explicit five-anchor graded criteria;
   - first-class binary checks in ALL-mode Requirement Groups;
   - the rankValue/rankScore/floored contract (rankValue authoritative; bounded display);
   - `complianceInfluence` λ ∈ [0,1] default 1.0 ("max points");
   - no automatic hard-gate semantics (reserved);
   - no closeness band, no min-cost badge;
   - historical authoritative-only compatibility.
3. Add the completed spec under the repository's current spec workflow/location.
4. Update the Frontier Evaluation Suite to use:
   - narrower graded criteria;
   - task-specific binary checks organized into requirement groups;
   - no artificial binary-as-graded encoding.

Do not modify archived specs to describe new behavior.

---

# Phase N — Full validation

## N.1 Focused regression sweep

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
  src/lib/evaluations/experiment-ranking.test.ts \
  src/ui/EvaluationProfileEditor.test.tsx \
  src/lib/export-markdown.test.ts
```

## N.2 Full gate

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

## N.3 Final audit

Search for stale scoring semantics in `src`:

```bash
rg 'false.*-> *1|true.*-> *5|5 : 1|binary.*5|R_raw|binary block weight|binary-decided|too close to call|delta.*0\.10' src
```

Classify every hit as:

```text
legacy compatibility
intentional current behavior
bug / incomplete migration
```

Fix only the third category. Confirm no module implements the superseded 5/1 mixed mean.

Also verify the scoring contract end-to-end:

```bash
rg 'rankValue|rankScore|floored|complianceInfluence|requirementGroups' src
```

Every scoring consumer (aggregation, Fusion, exports, Rank wiring) must route through the
Phase E helpers.

---

# Phase O — Worker completion report

The final Prime Agent report should include:

1. files changed;
2. exact schema/domain changes (criteria union, Requirement Groups, complianceInfluence);
3. Judge prompt/parser changes (per-kind, no boolean encoding);
4. scoring contract: `Q`, `C`, `rankValue`, `rankScore`, `floored` formulas and authority;
5. winner authority statement (rankValue with WINNER_EPSILON);
6. backward-compatibility behavior (pure-graded bit-identical; authoritative-only history);
7. UI changes (editor, Rank, Run Detail, floor disclosure);
8. protocol-fingerprint implications (λ + groups whitelisted);
9. suite-package/archive compatibility;
10. Fusion Study handling (group-level oracle, binary headroom labeling, bimodal exclusion);
11. focused test results;
12. full gate results;
13. any deviations from this plan caused by newer live code;
14. explicit statement that historical records were not rewritten or recalculated;
15. explicit statement that binary Judge results remain distinct from verifier outcomes;
16. explicit statement that no paid provider calls were made;
17. explicit statement that no closeness band, min-cost badge, MEAN groups, member weights, or
    hard-gate behavior shipped.

Do not claim implementation complete if the full gate fails.
