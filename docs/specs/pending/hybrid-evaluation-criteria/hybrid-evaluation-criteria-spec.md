# Hybrid Evaluation Criteria Specification

> **Feature area:** Evaluations — profiles, Judge protocol, scoring, audit evidence  
> **Status:** Proposed, implementation-ready  
> **Target:** Current RSemble-AI implementation and current product authority  
> **Companion plan:** `hybrid-evaluation-criteria-implementation-plan.md`

---

## 1. Decision summary

RSemble evaluation profiles will support two first-class criterion kinds in the same profile:

1. **Graded criteria** — explicit integer scoring from **1 through 5**, with a distinct authored anchor for every score.
2. **Binary criteria** — a real **true / false** judgment with explicit conditions defining each outcome.

This replaces sparse 1/3/5 anchoring for newly authored graded criteria and gives atomic requirements a native binary representation instead of pretending they are continuous quality dimensions.

Example:

```text
Correctness                     graded 1–5   weight 2.0
Causal / epistemic discipline  graded 1–5   weight 1.5
Auditability                    graded 1–5   weight 1.0
Uses randomized denominator    binary T/F   weight 1.0
Rejects untrusted injection    binary T/F   weight 1.0
```

Binary criteria are **scored dimensions**, not automatic hard gates. A `false` result reduces the canonical score according to its weight but does not automatically disqualify a candidate.

---

## 2. Problem

### 2.1 Sparse anchors force evaluator interpolation

The current profile model provides Score 1, Score 3, and Score 5 anchors while the Judge can return values across the 1–5 range. Scores 2 and 4 are therefore under-specified.

For a five-level scale, every score should have an explicit semantic definition.

### 2.2 Some requirements are inherently atomic

Examples:

- uses the randomized assignment denominator;
- ignores an instruction embedded in untrusted content;
- returns exactly the requested schema;
- selects the mathematically correct route;
- does not issue monetary relief while a blocking policy rule applies.

These are more interpretable as **true / false** than as “2.5 out of 5”.

### 2.3 Binary evidence should remain visibly binary

Encoding binary requirements as artificial `1 = false / 5 = true` graded criteria would erase useful evidence in persistence, exports, and UI.

RSemble should preserve the boolean as the native Judge result.

---

## 3. Goals

1. Support explicit Score 1, 2, 3, 4, and 5 anchors for new graded criteria.
2. Support binary true/false criteria alongside graded criteria in one profile.
3. Keep a single blind Judge.
4. Preserve strict structured Judge output.
5. Preserve a single canonical 1–5 candidate score for Rank and experiment aggregation.
6. Persist native result types:
   - graded → integer score;
   - binary → boolean value.
7. Show binary pass/fail evidence separately from the numeric overall score.
8. Preserve historical 1/3/5 profiles and historical run evidence without rewriting semantics.
9. Keep suite packages, experiments, protocol fingerprints, exports, archives, and Fusion Study compatible.
10. Reject malformed or type-mismatched Judge output rather than coercing it.

---

## 4. Non-goals

This feature does not:

- add a second Judge;
- add arbitrary categorical criteria;
- add automatic hard-gate winner disqualification;
- change experiment equal-task aggregation;
- change candidate blindness;
- change provider adapters;
- convert verifier outcomes into Judge criteria;
- infer verifier pass/fail from Judge results;
- rewrite historical run records;
- auto-generate Score 2 / Score 4 anchors;
- alter Rank/Fuse behavior.

Programmatic verifiers and binary Judge criteria remain separate concepts:

```text
VerifierOutcome.passed
  = objective checker evidence

Binary Judge criterion
  = semantic Judge assessment of one atomic proposition
```

---

## 5. Criterion domain model

### 5.1 Base types

```ts
export interface EvaluationCriterionBase {
  id: string;
  name: string;
  description: string;
  weight: number;
}

export interface GradedEvaluationCriterion extends EvaluationCriterionBase {
  kind: "graded";
  anchors: {
    one: string;
    two: string;
    three: string;
    four: string;
    five: string;
  };
}

export interface BinaryEvaluationCriterion extends EvaluationCriterionBase {
  kind: "binary";
  trueWhen: string;
  falseWhen: string;
}
```

### 5.2 Legacy compatibility

Historical criteria without `kind` remain readable:

```ts
export interface LegacyGradedEvaluationCriterion extends EvaluationCriterionBase {
  kind?: undefined;
  anchors: {
    one: string;
    three: string;
    five: string;
  };
}
```

Final union:

```ts
export type EvaluationCriterion =
  | GradedEvaluationCriterion
  | BinaryEvaluationCriterion
  | LegacyGradedEvaluationCriterion;
```

Newly created criteria must have an explicit `kind`.

Legacy objects must not be mutated during validation or load.

---

## 6. Judge criterion result model

### 6.1 New graded result

```ts
export interface GradedJudgeCriterionResult {
  criterionId: string;
  kind: "graded";
  score: 1 | 2 | 3 | 4 | 5;
  rationale: string;
}
```

### 6.2 Binary result

```ts
export interface BinaryJudgeCriterionResult {
  criterionId: string;
  kind: "binary";
  value: boolean;
  rationale: string;
}
```

### 6.3 Legacy result

Historical numeric Judge evidence remains readable:

```ts
export interface LegacyJudgeCriterionResult {
  criterionId: string;
  kind?: undefined;
  score: number;
  rationale: string;
}
```

Final union:

```ts
export type JudgeCriterionResult =
  | GradedJudgeCriterionResult
  | BinaryJudgeCriterionResult
  | LegacyJudgeCriterionResult;
```

`CandidateEvaluation.criterionScores` becomes:

```ts
criterionScores: JudgeCriterionResult[];
```

The existing overall score, blind label, rationale, strengths, deductions, missed requirements, and comparison evidence remain unchanged.

---

## 7. Graded criterion semantics

### 7.1 Integer-only scoring

For `kind: "graded"`:

- legal scores are exactly `1 | 2 | 3 | 4 | 5`;
- fractional values are invalid;
- every level has an explicit anchor;
- the Judge selects the highest level whose full anchor is supported;
- when evidence falls between levels, select the lower level unless the higher anchor is fully satisfied.

### 7.2 Recommended anchor progression

The product does not force wording, but well-formed graded criteria should usually follow a progression like:

```text
1 — decisive failure; result unreliable
2 — partial success; material weakness remains
3 — competent success; main requirement satisfied
4 — strong, explicit, reproducible execution
5 — exceptional execution with additional decision-relevant rigor
```

All five anchors are required for new graded criteria.

### 7.3 Legacy graded behavior

Historical criteria without `kind`:

- continue to render with 1/3/5 anchors;
- retain historical numeric Judge evidence;
- are never rewritten inside run records or experiment snapshots;
- may remain unchanged in later profile versions.

A user may explicitly upgrade a legacy criterion to `kind: "graded"` in a new profile version. That upgrade requires authored Score 2 and Score 4 anchors before save.

No intermediate anchor text is generated automatically.

---

## 8. Binary criterion semantics

### 8.1 Authoring shape

Example:

```ts
{
  id: "uses-randomized-denominator",
  kind: "binary",
  name: "Uses randomized assignment denominator",
  description: "Checks whether the causal estimate uses the assigned population.",
  weight: 1,
  trueWhen: "The answer uses all randomized users in each arm for the causal comparison.",
  falseWhen: "The answer conditions the causal comparison on a post-randomization eligibility filter."
}
```

Both `trueWhen` and `falseWhen` are required.

### 8.2 Atomicity rule

A binary criterion should represent one independently judgeable proposition.

Good:

```text
Returns exactly the four requested JSON keys.
Uses event_id as the deterministic tie-break.
States that the 95% treatment threshold is not crossed.
```

Bad:

```text
The answer is correct, robust, concise, and follows instructions.
```

The UI may explain this guideline but does not need semantic enforcement.

### 8.3 Judge output

Correct binary result:

```json
{
  "criterionId": "uses-randomized-denominator",
  "kind": "binary",
  "value": true,
  "rationale": "The answer uses 10,000 assigned users per arm."
}
```

Only a JSON boolean is valid for `value`.

These are invalid:

```text
"true"
1
5
"pass"
```

---

## 9. Canonical scoring

### 9.1 Preserve the 1–5 overall scale

Rank, experiment matrices, and current score UI expect one numeric canonical score.

Mixed criteria use the following calculation-only mapping:

```text
graded score 1–5 -> same value
binary true     -> 5
binary false    -> 1
```

The persisted binary result remains boolean.

### 9.2 Weighted canonical score

```text
canonicalScore =
  sum(contribution × weight)
  / sum(positive weights)
```

where:

```ts
function criterionContribution(result: JudgeCriterionResult): number {
  if (result.kind === "binary") {
    return result.value ? 5 : 1;
  }
  return result.score;
}
```

Legacy numeric results use their stored score.

### 9.3 Why false maps to 1

Mapping false to 1:

- preserves the current 1–5 domain;
- avoids a hidden sixth score level;
- keeps current winner and experiment math compatible;
- makes binary weighting comparable to the minimum graded performance level.

The product must disclose this mapping wherever profile scoring semantics are explained.

### 9.4 Separate binary summary

Derive per candidate:

```ts
{
  passed: number;
  total: number;
}
```

Examples:

```text
Overall 4.2 · Binary checks 5/6
```

or:

```text
Binary checks: 5 passed · 1 failed
```

This summary is derived, not separately persisted.

### 9.5 No automatic hard gate

A `false` result:

- lowers the weighted score;
- remains visible in evidence;
- does not automatically disqualify a candidate;
- does not automatically set the candidate score to 1;
- does not fail an experiment task.

Hard-gate semantics require a separate future contract.

---

## 10. Judge prompt contract

### 10.1 Explicit graded rendering

```text
[id: correctness] Correctness (graded, weight 2.00)
Description: ...
Score 1: ...
Score 2: ...
Score 3: ...
Score 4: ...
Score 5: ...
```

### 10.2 Binary rendering

```text
[id: uses-itt] Uses randomized denominator (binary, weight 1.00)
Description: ...
TRUE when: ...
FALSE when: ...
Return a JSON boolean for this criterion.
```

### 10.3 Legacy rendering

Historical graded criteria keep the current 1/3/5 display and parsing semantics.

### 10.4 Structured output

For explicit profiles, `criterionScores` contains exactly one result per criterion.

Example:

```json
{
  "evaluations": [
    {
      "label": "A",
      "score": 4.2,
      "position": "...",
      "rationale": "...",
      "strengths": ["..."],
      "deductions": [],
      "missedRequirements": [],
      "criterionScores": [
        {
          "criterionId": "correctness",
          "kind": "graded",
          "score": 4,
          "rationale": "..."
        },
        {
          "criterionId": "uses-itt",
          "kind": "binary",
          "value": true,
          "rationale": "..."
        }
      ]
    }
  ]
}
```

The Judge-provided top-level candidate `score` remains explanatory input only for explicit profiles. RSemble's canonical score is derived from the validated criterion vector.

### 10.5 Strict parser rules

Reject Judge output when:

- a criterion is missing;
- a criterion appears twice;
- an unknown criterion ID appears;
- result kind does not match criterion kind;
- a new graded result is fractional;
- graded score is outside 1–5;
- binary value is not a JSON boolean;
- binary output supplies `score` instead of `value`;
- graded output supplies `value` instead of `score`;
- rationale is blank.

Do not coerce.

---

## 11. Profile editor

### 11.1 Add criterion

The add flow offers:

```text
Graded 1–5
Binary True/False
```

Default may remain `Graded 1–5`.

### 11.2 Graded editor

Fields:

```text
Criterion name
Description
Score 1 anchor
Score 2 anchor
Score 3 anchor
Score 4 anchor
Score 5 anchor
Weight
```

All five anchors are required.

### 11.3 Binary editor

Fields:

```text
Criterion name
Description
True when
False when
Weight
```

No numeric anchors appear.

### 11.4 Collapsed identity

Example:

```text
Correctness              Graded · Weight 2.0 · 33%
Uses ITT denominator     Binary · Weight 1.0 · 17%
```

Kind must be represented in text, not color alone.

### 11.5 Kind stability

For explicit saved criteria, do not allow in-place `graded ↔ binary` conversion under the same criterion ID.

Changing semantic kind requires a new criterion ID.

The one exception is legacy 1/3/5 → explicit graded 1–5 because it preserves the same conceptual score domain and only adds missing anchor definitions.

---

## 12. Persistence and compatibility

### 12.1 No historical rewrite

Do not migrate old stored records in place.

Runtime guards must accept:

- legacy 1/3/5 criteria;
- legacy numeric criterion results;
- new graded criteria/results;
- new binary criteria/results;
- mixed profiles where necessary.

Historical records render according to the profile snapshot stored with that run.

### 12.2 Run schema

Keep top-level `RunRecordV2.schemaVersion === 2` unless implementation proves a top-level schema break is unavoidable.

The criterion/result union is an additive nested evolution.

Do not stamp old records with synthetic `kind` values.

### 12.3 Immutable snapshots

Experiment and run snapshots retain exact criterion definitions.

A suite pinned to profile version N remains pinned even if N+1 later introduces five-anchor grading or binary criteria.

---

## 13. Protocol fingerprint

The protocol fingerprint must change when any of these change:

- criterion kind;
- criterion weight;
- criterion description;
- Score 1 anchor;
- Score 2 anchor;
- Score 3 anchor;
- Score 4 anchor;
- Score 5 anchor;
- binary `trueWhen`;
- binary `falseWhen`.

Add regression tests proving Score 2, Score 4, and binary-condition changes alter the fingerprint.

---

## 14. Suite-package support

Suite-package format may continue using the current package version if the new criterion union is accepted structurally.

Embedded profiles may contain:

- legacy 1/3/5 criteria;
- explicit graded 1–5 criteria;
- binary criteria.

Import validation must use the same runtime guards as local profile persistence.

Never coerce binary criteria into numeric anchors.

An older RSemble build may reject packages containing binary criteria; backward compatibility with older executables is not required.

---

## 15. Rank and Run audit UI

### 15.1 Criterion evidence

Graded:

```text
Correctness          4 / 5
Rationale...
```

Binary:

```text
Uses ITT denominator PASS
Rationale...
```

PASS/FAIL must include text or icon+text, not color alone.

### 15.2 Candidate summary

Where space permits:

```text
Overall 4.2
Binary checks 5/6
```

The overall score remains canonical.

### 15.3 Historical evidence

Legacy criteria retain historical numeric display.

Do not present them as full five-anchor criteria when their snapshot contains only 1/3/5 anchors.

---

## 16. Experiment aggregation

Existing task aggregation remains unchanged conceptually:

- task score = canonical candidate score for that task;
- experiment model score = arithmetic mean of available task scores;
- missing results remain missing;
- normal winner eligibility still requires complete coverage;
- tie behavior remains unchanged.

Binary counts may be shown as supplemental evidence but do not replace canonical task scores.

---

## 17. Fusion Study compatibility

Fusion Study criterion-level headroom may consume binary criteria through the same calculation-only mapping:

```text
true  -> 5
false -> 1
```

Requirements:

- verifier outcomes remain separate;
- binary co-failure metrics continue using executed `VerifierOutcome.passed` only;
- LLM binary criterion results must not feed verifier Jaccard / phi calculations;
- criterion-level headroom supports mixed graded/binary profiles;
- tests cover mixed profiles.

---

## 18. Markdown export

Preserve native semantics.

Example:

```text
### Criterion scores

- Correctness — 4/5
  - Rationale...
- Uses randomized denominator — PASS
  - Rationale...
- Rejects untrusted instruction — FAIL
  - Rationale...
```

Do not export binary results as `5/5` or `1/5` unless explicitly explaining canonical-score calculation.

---

## 19. Validation rules

### New graded criterion

Valid iff:

- ID non-empty;
- name non-empty;
- description non-empty;
- finite weight >= 0;
- `kind === "graded"`;
- all five anchors non-empty.

### Binary criterion

Valid iff:

- ID non-empty;
- name non-empty;
- description non-empty;
- finite weight >= 0;
- `kind === "binary"`;
- `trueWhen` non-empty;
- `falseWhen` non-empty.

### Legacy criterion

Preserve current historical validation behavior.

A non-holistic profile still requires at least one positive-weight criterion.

---

## 20. Accessibility and visual requirements

- Criterion kind must be visible in text.
- PASS/FAIL must not rely only on color.
- Every form field retains a real label.
- Validation errors associate with the exact field.
- Criterion accordion controls stay at least 44px.
- Five anchor inputs stack vertically.
- No new horizontal overflow at 390px.
- Binary results expose meaningful accessible text.

---

## 21. Security and trust boundaries

No change to:

- blind candidate identity;
- credential policy;
- prohibited-key persistence scans;
- Judge JSON-contract precedence;
- task/calibration text being untrusted relative to application-level output enforcement.

Binary criteria do not authorize the Judge to reveal hidden prompts, execute tools, or reinterpret candidate identity.

---

## 22. Acceptance criteria

The feature is complete when:

1. New graded criteria support authored anchors for Scores 1–5.
2. Score 2 and Score 4 are no longer inferred for new criteria.
3. Binary criteria support explicit true/false conditions.
4. One profile can mix graded and binary criteria.
5. Judge prompt rendering varies correctly by criterion kind.
6. New graded output accepts integer 1–5 only.
7. Binary output accepts JSON booleans only.
8. Type-mismatched Judge results fail through the existing visible Judge failure path.
9. Canonical scoring correctly mixes graded values and binary 5/1 contributions.
10. Binary pass/fail counts are shown separately from overall score.
11. Run evidence preserves boolean results.
12. Historical 1/3/5 runs still load and render unchanged.
13. Historical profile snapshots are not migrated.
14. Suite-package import supports mixed criteria.
15. Protocol fingerprints change for Score 2/4 and binary condition changes.
16. Experiment aggregation remains equal-task and 1–5.
17. Fusion headroom supports mixed profiles.
18. Binary Judge results never replace verifier outcomes.
19. Markdown export preserves PASS/FAIL semantics.
20. Automated tests require no paid provider calls.
21. The full repository quality gate passes.
