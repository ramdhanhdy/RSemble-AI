# Hybrid Evaluation Criteria Specification

> **Feature area:** Evaluations — profiles, Judge protocol, scoring, audit evidence
> **Status:** Proposed, implementation-ready
> **Target:** Current RSemble-AI implementation and current product authority
> **Companion plan:** `hybrid-evaluation-criteria-implementation-plan.md`
> **Scoring authority:** `scoring-reconciliation-decision.md` (reconciled architecture;
> supersedes the initial direct-mapping draft of this document)

---

## 1. Decision summary

RSemble evaluation profiles support two first-class criterion kinds in the same profile:

1. **Graded criteria** — explicit integer scoring from **1 through 5**, with a distinct authored anchor for every score.
2. **Binary checks** — a real **true / false** judgment with explicit conditions defining each outcome, organized into **Requirement Groups**.

This replaces sparse 1/3/5 anchoring for newly authored graded criteria and gives atomic requirements a native binary representation instead of pretending they are continuous quality dimensions.

Example:

```text
Correctness                     graded 1–5   weight 2.0
Causal / epistemic discipline  graded 1–5   weight 1.5
Auditability                    graded 1–5   weight 1.0
Uses randomized denominator    binary T/F   group "Uses ITT denominator" (weight 1.0)
Rejects untrusted injection    binary T/F   group "Rejects untrusted injection" (weight 1.0)
```

Binary checks are **scored compliance dimensions**, not automatic hard gates. A `false` result reduces the Rank Value according to the profile's compliance influence but does not automatically disqualify a candidate (hard gates are explicitly reserved for a future contract).

### 1.1 The scoring contract at a glance

```text
Q          = Σ(w_i·s_i) / Σw_i                        Quality (graded weighted mean, 1–5)
c_g        = min(member boolean values)               group satisfaction (ALL mode)
C          = Σ(v_g·c_g) / Σv_g                        Compliance (weighted pass share, 0–1)
rankValue  = Q − λ·(1 − C)                            authoritative ranking value (may be < 1)
rankScore  = max(1, rankValue)                        bounded 1–5 presentation value
floored    = rankValue < 1                            disclosure flag
```

`rankValue` is the sole ranking authority (ordering, winners, ties, experiment task-level
ranking). `rankScore` is the bounded 1–5 display/compatibility representation and is never
independently authoritative when the floor binds. Binary booleans are never encoded as
`false → 1 / true → 5` criterion scores anywhere.

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

RSemble preserves the boolean as the native Judge result and derives compliance influence through the explicit `complianceInfluence` parameter — never through a numeric boolean encoding.

---

## 3. Goals

1. Support explicit Score 1, 2, 3, 4, and 5 anchors for new graded criteria.
2. Support binary true/false checks organized into Requirement Groups alongside graded criteria in one profile.
3. Keep a single blind Judge.
4. Preserve strict structured Judge output.
5. Preserve a single authoritative ranking value (`rankValue`) and a bounded 1–5 presentation value (`rankScore`) for Rank and experiment aggregation.
6. Persist native result types:
   - graded → integer score;
   - binary → boolean value.
7. Show binary pass/fail evidence separately from the numeric rank values.
8. Preserve historical 1/3/5 profiles and historical run evidence without rewriting semantics.
9. Keep suite packages, experiments, protocol fingerprints, exports, archives, and Fusion Study compatible.
10. Reject malformed or type-mismatched Judge output rather than coercing it.
11. Preserve decomposition resistance: a requirement's influence is pinned to its group weight, and total binary influence is bounded by `complianceInfluence`.

---

## 4. Non-goals and deferred features

This feature does **not**:

- add a second Judge;
- add arbitrary categorical criteria;
- add **Hard Gates** (eligibility semantics) — the boundary is reserved (§5.5) and `kind:"gate"` is rejected by validation;
- implement consensus/replicated gate judging, gate lint, human gate override, or gate experiment behavior;
- support **MEAN** requirement groups or member-level weights (ALL only, group weight only);
- add an arbitrary closeness band (`δ = 0.10`) or any probabilistic “too close to call” claim;
- add a min-cost “binary-decided” heuristic badge;
- change experiment equal-task aggregation semantics (the authoritative aggregate is `mean(rankValue)` per §16);
- change candidate blindness;
- change provider adapters;
- convert verifier outcomes into Judge criteria;
- infer verifier pass/fail from Judge results;
- rewrite historical run records or recalculate historical authoritative results under the new policy;
- auto-generate Score 2 / Score 4 anchors;
- add duplication/correlation lint for checks (postponed);
- alter Rank/Fuse behavior beyond the specified `rankValue` authority change (§15.4).

Programmatic verifiers and binary Judge checks remain separate concepts:

```text
VerifierOutcome.passed
  = objective checker evidence

Binary Judge check
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
}

export interface GradedEvaluationCriterion extends EvaluationCriterionBase {
  kind: "graded";
  weight: number;                  // > 0 for new criteria
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
  // NOTE: no weight on a binary check — the weight lives on its RequirementGroup.
}
```

### 5.2 Requirement Group

```ts
export interface RequirementGroup {
  id: string;
  name: string;
  checkIds: string[];              // exactly-one membership; length ≥ 1
  weight: number;                  // v_g > 0 — the sole binary-channel weight
  mode: "ALL";                     // only mode in v1; MEAN is deferred
}
```

- Every binary check belongs to exactly one group. An ungrouped check is assigned an **implicit singleton group at save** (materialized: the profile stores the group; a dangling check fails save/import).
- Group `mode` is `"ALL"` only in v1: `c_g = min(member booleans)`.
- No member-level weights. No zero-weight groups. No zero-weight members (a zero-weight member under ALL is a footgun: `min` is weight-blind).

### 5.3 Profile-level compliance influence

```ts
export interface ComplianceInfluenceSettings {
  /** λ ∈ [0,1], default 1.0. "Maximum number of ranking points that failing all ordinary
   *  compliance requirements may cost." */
  complianceInfluence: number;
}
```

- Field name: `complianceInfluence` (λ). Range `0 ≤ λ ≤ 1`, finite, default `1.0`, enforced by validation (out-of-range is a validation error, not a silent clamp).
- Persisted on the immutable profile snapshot; included in the protocol fingerprint (§13).
- λ=0 is legal: binary evidence is display-only ("checks excluded" marker required in UI).
- The user-facing meaning is "maximum number of ranking points that failing all ordinary compliance requirements may cost." λ is a product calibration, not a universal constant: the reconciled rationale and quantified caveats (singleton swing; binary-heavy profiles; empirical p_b calibration) are recorded in `scoring-reconciliation-decision.md` §15–§16 and §28.

### 5.4 Legacy compatibility

Historical criteria without `kind` remain readable:

```ts
export interface LegacyGradedEvaluationCriterion extends EvaluationCriterionBase {
  kind?: undefined;
  weight: number;
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

Newly created criteria must have an explicit `kind`. Legacy objects must not be mutated during validation or load.

### 5.5 Reserved Hard Gate boundary (deferred)

The future eligibility concept is **reserved, not implemented**:

```ts
// Reserved — rejected by validation in this version:
// export interface GateEvaluationCriterion { kind: "gate"; ... }
```

- Validation rejects `kind:"gate"` with an actionable error: "hard-gate semantics are not supported in this version; author this as a binary check or wait for gate support."
- Suite packages containing gate criteria fail import likewise.
- No weight, group weight, or `complianceInfluence` value is ever a gate; raising them to force dominance is documented misuse. Eligibility is winner-eligibility only (same family as complete coverage) in a future contract — never score math.

---

## 6. Judge criterion result model

### 6.1 New graded result

```ts
export interface GradedJudgeCriterionResult {
  criterionId: string;
  kind: "graded";
  score: 1 | 2 | 3 | 4 | 5;        // integer only
  rationale: string;
}
```

### 6.2 Binary result

```ts
export interface BinaryJudgeCriterionResult {
  criterionId: string;
  kind: "binary";
  value: boolean;                   // JSON boolean only
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

## 8. Binary check semantics

### 8.1 Authoring shape

```ts
{
  id: "uses-randomized-denominator",
  kind: "binary",
  name: "Uses randomized assignment denominator",
  description: "Checks whether the causal estimate uses the assigned population.",
  trueWhen: "The answer uses all randomized users in each arm for the causal comparison.",
  falseWhen: "The answer conditions the causal comparison on a post-randomization eligibility filter."
}
```

Both `trueWhen` and `falseWhen` are required.

### 8.2 Atomicity rule

A binary check should represent one independently judgeable proposition.

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

The UI may explain this guideline but does not need semantic enforcement. Multi-part atomicity is expressed by authoring multiple checks inside one ALL group — with the disclosure that splitting a requirement makes it stricter and more judge-error-fragile (the editor shows subcheck count and warns at N ≥ 4).

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

### 8.4 Group membership

- Group membership is profile-side data; the Judge sees flat checks annotated with group IDs (`[group: g1]`) but returns per-check booleans only. Grouping is post-processing; the Judge never computes ALL/MEAN.
- Group membership, group weights, and group mode are part of the profile snapshot and the protocol fingerprint.

---

## 9. Canonical scoring

### 9.1 Quality

```text
Q = Σ(w_i·s_i) / Σw_i
```

over positive-weight graded criteria with present results (missing skipped, mirroring today's `canonicalScore`). Zero graded criteria → no Q (compliance-only profile, §16.3).

### 9.2 Compliance

```text
c_g = min(b_k for k in g)          (ALL mode)
C   = Σ(v_g·c_g) / Σv_g            (positive-weight groups, present results only)
C   := 1                           (no binary checks in the profile; display "—")
```

### 9.3 Rank Value (authoritative)

```text
rankValue = Q − λ·(1 − C)
```

- Natural range under v1 constraints: `[0, 5]` (Q ≥ 1, λ ≤ 1, C ≥ 0).
- Used for: candidate ordering, winner selection, tie comparison, leaderboard sorting, and experiment task-level ranking contributions.
- May be below 1; values below 1 are first-class, not errors.

### 9.4 Rank Score (bounded presentation)

```text
rankScore = max(1, rankValue)
floored   = rankValue < 1
```

- Used where a bounded 1–5 display or compatibility value is required (leaderboard cells, experiment matrix cells, exports).
- **Not independently authoritative for ranking when the floor binds.**
- Pure-graded profiles: `C := 1` ⇒ `rankValue = Q` and `rankScore = Q` — bit-identical to today.

### 9.5 Floor disclosure

When `floored`:

- the UI must not pretend two floored candidates are equivalent merely because both display `1.0`;
- display the floor explicitly:

```text
Rank score    1.0*
Rank value    0.72
* bounded at the 1.0 display floor
```

(exact copy may be refined during implementation; the semantic disclosure is required);

- if two displayed `rankScore = 1.0` candidates order differently, their differing `rankValue` must be inspectable — no hidden sorting.

### 9.6 Tie semantics

Winner/tie comparison uses the authoritative `rankValue` with the existing product epsilon (`WINNER_EPSILON = 1e-9`). Do not create artificial ties from `rankScore`.

### 9.7 Compliance influence semantics

- `complianceInfluence` (λ) bounds the total effect of all ordinary compliance failures: `rankValue` moves by at most `λ` points regardless of check count, grouping, or weights.
- One group's fail cost is `λ·v_g/Σv` — useful evidence, shown in authoring/audit UI. It is **not** a badge threshold and carries no probabilistic meaning.
- λ=1 default rationale and quantified caveats: see `scoring-reconciliation-decision.md` §15–§16 (per-criterion parity in equal-channel profiles; binary-heavy profiles stay at the graded noise floor; singleton swing governed by warning + dial; empirical p_b calibration note).

### 9.8 No min-cost badge / no closeness band

- The min-cost “binary-decided” heuristic (δ = min per-group fail cost) is **removed** — it does not answer “could one binary verdict have changed the winner?”.
- The fixed δ = 0.10 closeness band remains deferred.
- A deterministic “Compliance changed the winner” audit signal is defined in `scoring-reconciliation-decision.md` §21 and deferred for v1 (not part of this spec's acceptance).

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
[id: uses-itt] [group: uses-itt-group] Uses randomized denominator (binary)
Description: ...
TRUE when: ...
FALSE when: ...
Return a JSON boolean for this criterion.
```

No numeric encoding of the boolean appears in the prompt (never “score 5 for true”).

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

The Judge-provided top-level candidate `score` remains explanatory input only for explicit profiles. RSemble's ranking value is derived from the validated criterion vector (`rankValue`).

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
Requirement group (select existing or "new group"; default new singleton)
```

No numeric anchors and **no per-check weight** appear. The group's weight is the binary-channel weight.

### 11.4 Requirement Group editor (v1 minimal)

- Groups render as collapsible sections listing member checks.
- Group weight `v_g` (default 1.0), live per-group fail cost `λ·v_g/Σv`, subcheck count with the ALL-fragility note ("ALL mode, N subchecks: any single false verdict fails the group — false-fail rate ≈ N×p"), warning at N ≥ 4.
- A "Group into requirement" action merges selected singleton checks into one named group.
- No mode toggle (ALL only), no member weights, no duplication lint.

### 11.5 Compliance influence control

```text
Compliance influence: [1.0] points   (0–1, step 0.1, default 1.0)
```

Inline help: "Failing all binary checks together lowers the Rank Value by at most this many points. 1.0 = one anchor level. Each check's cost is its group's share of this cap — currently [per-group list]." λ=0 renders checks as **excluded** ("checks do not affect ranking"). A "per-criterion parity" preset (λ = min(1, n_groups/n_graded)) may be offered with its quantified warnings.

### 11.6 Collapsed identity

Example:

```text
Correctness              Graded · Weight 2.0 · 33%
Uses ITT denominator     Binary · Group weight 1.0 · 17%
```

Kind must be represented in text, not color alone.

### 11.7 Kind stability

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
- new binary checks/results;
- Requirement Groups;
- `complianceInfluence`;
- mixed profiles where necessary.

**Guard fix (mandatory):** `isEvaluationCriterion` currently requires `anchors.one/three/five` — binary criteria fail the guard and binary-profile runs would be silently dropped from history/archives. The union guard must accept the new kinds while continuing to reject kind-less garbage, and must never mutate legacy criteria.

Historical records render according to the profile snapshot stored with that run.

### 12.2 Run schema

Keep top-level `RunRecordV2.schemaVersion === 2` unless implementation proves a top-level schema break is unavoidable.

The criterion/result union, Requirement Groups, and `complianceInfluence` are an additive nested evolution.

Do not stamp old records with synthetic `kind` values.

### 12.3 Immutable snapshots

Experiment and run snapshots retain exact criterion definitions, group membership/weights/mode, and `complianceInfluence`.

A suite pinned to profile version N remains pinned even if N+1 later changes scoring semantics.

### 12.4 Floor state persistence

`rankValue`, `rankScore`, and `floored` are derivable from stored evidence (criterion results + profile snapshot) and need not be separately persisted. Where a consumer cannot derive them (e.g., legacy exports), the derived values are computed at read time with the snapshot's λ and groups. No historical run is rewritten.

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
- binary `falseWhen`;
- **Requirement Group membership** (which checks are in which group);
- **Requirement Group weight**;
- **Requirement Group mode** (if represented in the schema);
- **`complianceInfluence`**.

Regression tests must prove that Score 2, Score 4, binary-condition, group-membership, group-weight, and `complianceInfluence` changes alter the fingerprint.

**Implementation note:** `semanticFingerprintInput` currently whitelists profiles as `{id, version, name, description, judgeInstruction, criteria}` — criterion content flows wholesale (kind/anchors/conditions covered), but the profile-level `complianceInfluence` and the group container must be added to the whitelist explicitly, or two experiments differing only in λ/grouping collide on protocol identity (roster-extension `priorFingerprint` chaining breaks).

---

## 14. Suite-package support

Suite-package format may continue using the current package version if the new criterion union, Requirement Groups, and `complianceInfluence` are accepted structurally.

Embedded profiles may contain:

- legacy 1/3/5 criteria;
- explicit graded 1–5 criteria;
- binary checks with groups;
- `complianceInfluence`.

Import validation must use the same runtime guards as local profile persistence (union-accepting; groups validated: exactly-one membership, `v_g > 0`, mode ALL; λ ∈ [0,1]; `kind:"gate"` rejected with the named message).

Never coerce binary criteria into numeric anchors.

An older RSemble build may reject packages containing binary criteria or groups; backward compatibility with older executables is not required.

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
Uses ITT denominator PASS   (group: Uses ITT denominator)
Rationale...
```

PASS/FAIL must include text or icon+text, not color alone. Binary rows are labeled Judge evidence, never verifier output.

### 15.2 Candidate summary

```text
Quality 4.40 / 5              (3 graded criteria)
Compliance 83% · 5/6 groups   (weighted share first; count as evidence)
Compliance influence: max 1.00 point
Rank Score 4.23 = 4.40 − 1.00 × 0.17
```

- The derivation line is required: the Rank Score must be reconstructible from the displayed numbers plus the disclosed λ.
- When `floored`: show `Rank score 1.0*` with `Rank value 0.72` and the floor footnote (§9.5).
- Compliance display shows the weighted share first and the group count second; when group weights are uneven, the count alone must not be presented as the compliance level.

### 15.3 Historical evidence

Legacy criteria retain historical numeric display.

Do not present them as full five-anchor criteria when their snapshot contains only 1/3/5 anchors.

### 15.4 Winner selection (behavioral disclosure)

Winner/tie comparison uses the authoritative `rankValue` with `WINNER_EPSILON = 1e-9`. Currently Rank uses the Judge's top-level `overallScore` while experiments recompute from criteria — this feature unifies both on the derived `rankValue`, a behavioral change to Rank winner math for profiles with criterion scores; it must be release-noted and covered by tests.

---

## 16. Experiment aggregation

### 16.1 Authoritative task-level ranking value

Per-task contribution to ranking = `rankValue_t` (unclamped). Experiment model score = **equal-task arithmetic mean of `rankValue_t`**; missing results remain missing; normal winner eligibility still requires complete coverage; ties within 1e-9 share; ranking key:

```text
mean(rankValue) desc → Q̄ desc → C̄ desc → candidate_id asc
```

Aggregating the authoritative values means floor censoring cannot create fake experiment ties or ranking reversals.

### 16.2 Bounded display aggregate

If a bounded 1–5 experiment aggregate is required for display/compatibility (e.g., a legacy matrix cell), it is `max(1, mean(rankValue))`, rendered **separately and labeled** (e.g., "mean rankScore") and never used for ordering or winner eligibility. Per-candidate floored-task counts are shown ("n floored tasks") so the display aggregate is auditable.

### 16.3 Channel aggregates and compliance-only profiles

- Channel aggregates Q̄ and C̄ are reported alongside (mean(rankValue) = Q̄ − λ(1−C̄) exactly, so the mean is recoverable from channel means).
- No binary checks in a profile: `C := 1`, `rankValue = Q` — experiment behavior is bit-identical to today.
- No graded criteria in a profile (compliance-only): rank on `C̄` (0–100%), matrix renders C-labeled cells; no `rankValue` is derived.
- Binary counts may be shown as supplemental evidence but do not replace authoritative task values.

---

## 17. Fusion Study compatibility

Requirements:

- verifier outcomes remain separate; binary co-failure metrics continue using executed `VerifierOutcome.passed` only; LLM binary check results must never feed verifier Jaccard / phi calculations;
- criterion-level headroom supports mixed graded/binary profiles;
- per-criterion headroom for binary checks is reported as **pass-rate imbalance** (`1 − b_k`), labeled as such, with a minimum sample gate — never dressed as a 4-point quality gap;
- `taskOverall` and headroom math consume the **same** `rankValue` contract as the experiment matrix (Q, C from stored evidence; λ + groups from the profile snapshot) or the study and the matrix measure different quantities — `fusion-study-stages` must thread the full profile snapshot;
- the H_synth oracle computes at **group level** (a group is satisfied if either model's group passes under the oracle), so complementary binary failures cannot fabricate headroom;
- the bimodal-distribution diagnostic excludes binary criteria (100% of mapped values are extremes by construction);
- Judge binary results never replace verifier outcomes in any analysis.

---

## 18. Markdown export

Preserve native semantics.

Example:

```text
### Criterion scores

- Correctness — 4/5
  - Rationale...
- Uses randomized denominator — PASS (group: Uses ITT denominator)
  - Rationale...
- Rejects untrusted instruction — FAIL
  - Rationale...
```

Do not export binary results as `5/5` or `1/5`. The candidate summary exports Quality, Compliance, and Rank Value/Rank Score with the derivation; floored values export as `1.0*` with the raw value.

---

## 19. Validation rules

### New graded criterion

Valid iff:

- ID non-empty;
- name non-empty;
- description non-empty;
- finite weight > 0 (new criteria);
- `kind === "graded"`;
- all five anchors non-empty.

### Binary check

Valid iff:

- ID non-empty;
- name non-empty;
- description non-empty;
- `kind === "binary"`;
- `trueWhen` non-empty;
- `falseWhen` non-empty;
- belongs to exactly one RequirementGroup (implicit singleton materialized at save).

### Requirement Group

Valid iff:

- ID non-empty;
- name non-empty;
- `checkIds` non-empty, no duplicates, all IDs resolve to binary checks, no check appears in two groups;
- finite `weight > 0`;
- `mode === "ALL"`.

### Profile

Valid iff:

- all criteria valid;
- all groups valid;
- `complianceInfluence` finite, `0 ≤ λ ≤ 1` (default 1.0);
- `kind:"gate"` is rejected with the reserved-boundary message;
- a non-holistic profile still requires at least one positive-weight criterion or group;
- prohibited-key scanning still applies recursively.

### Legacy criterion

Preserve current historical validation behavior.

---

## 20. Accessibility and visual requirements

- Criterion kind must be visible in text.
- PASS/FAIL must not rely only on color.
- The floor marker is text, not color alone.
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

Binary checks do not authorize the Judge to reveal hidden prompts, execute tools, or reinterpret candidate identity.

---

## 22. Acceptance criteria

The feature is complete when:

1. New graded criteria support authored anchors for Scores 1–5.
2. Score 2 and Score 4 are no longer inferred for new criteria.
3. Binary checks support explicit true/false conditions.
4. Every binary check belongs to exactly one Requirement Group; implicit singletons are materialized at save.
5. Group mode is ALL-only; group weight is the sole binary-channel weight; no member weights.
6. One profile can mix graded and binary criteria, with `complianceInfluence` (0–1, default 1.0).
7. Judge prompt rendering varies correctly by criterion kind; no numeric boolean encoding appears.
8. New graded output accepts integer 1–5 only.
9. Binary output accepts JSON booleans only.
10. Type-mismatched Judge results fail through the existing visible Judge failure path.
11. `Q`, `C`, `rankValue`, `rankScore`, and `floored` are computed exactly per §9; `rankValue` is the sole ranking authority (ordering, winners, ties, experiment task-level ranking).
12. Winner selection uses `rankValue` with the existing epsilon; no artificial ties are created from `rankScore`.
13. Floored candidates display the floor marker and the raw `rankValue` is inspectable.
14. Experiments aggregate `mean(rankValue)` (authoritative); any bounded display aggregate is rendered separately and labeled; floored-task counts are shown.
15. No closeness band and no min-cost "binary-decided" heuristic ships.
16. Run evidence preserves boolean results; groups and λ persist in profile snapshots.
17. Historical 1/3/5 runs still load and render unchanged; historical authoritative results are never recalculated.
18. Historical profile snapshots are not migrated.
19. Suite-package import supports mixed criteria + groups + λ with strict validation; `kind:"gate"` is rejected with the named message.
20. Protocol fingerprints change for Score 2/4, binary-condition, group-membership, group-weight, group-mode, and `complianceInfluence` changes.
21. Fusion headroom supports mixed profiles with group-level oracles; binary per-criterion headroom is labeled pass-rate imbalance; the bimodal diagnostic excludes binary.
22. Binary Judge results never replace verifier outcomes.
23. Markdown export preserves PASS/FAIL semantics and the floor marker.
24. Automated tests require no paid provider calls.
25. The full repository quality gate passes.

---

## 23. Exclusions/deferred features (explicit)

- Hard Gates (eligibility): deferred; `kind:"gate"` rejected by validation; no consensus judging, gate lint, human override, or gate experiment behavior.
- MEAN requirement groups: deferred.
- Member-level weights: deferred.
- Arbitrary closeness band δ=0.10: deferred.
- Min-cost "binary-decided" heuristic: removed (never ships).
- Probabilistic "too close to call" claims: not shipped (no empirical Judge-uncertainty model).
- Duplication/correlation lint: postponed.
- Automatic historical reinterpretation or legacy binary detection/re-typing: postponed and forbidden on historical runs.
- Graded-criterion bimodality monitor (encoding-arbitrage flag): scheduled for v1.1.
- λ-stability indicator: scheduled for v1.1.
