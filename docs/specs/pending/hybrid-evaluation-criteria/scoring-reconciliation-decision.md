# Scoring Reconciliation Decision — Prime Block Blend vs Fusion Capped Penalty

> **Status:** Decision closure for the hybrid graded/binary scoring architecture.
> **Branch:** `feat/hybrid-evaluation-criteria`
> **Inputs:** `scoring-adversarial-review.md` (Prime's prior review), `fusion-result.md`,
> `holistic-judge-result.md`, `hybrid-evaluation-criteria-spec.md`,
> `hybrid-evaluation-criteria-implementation-plan.md`, live code where contract-relevant.
> **Method:** 13 focused adversarial investigator tracks (7 RLM investigators), root-level
> synthesis, then 3 mandatory post-convergence falsification loops against the final design.
> **Scope:** decision only — no spec/plan/code changes yet. All simulation definitions are
> documented in Appendix A; every randomized claim below is reproducible.

---

## 1. Executive decision

RSemble will standardize on **R = clamp(Q − λ(1−C), 1, 5)** as the canonical Rank Score for
mixed profiles:

- **Quality Q** — the existing weighted mean of graded criterion scores (1–5), unchanged.
- **Compliance C** — the weighted pass share of **Requirement Groups** (0–1, displayed as %),
  computed from native boolean evidence; never encoded onto the 1–5 scale.
- **λ ∈ [0,1]** — the profile-level **compliance influence** parameter ("maximum points all
  compliance failures together may cost"), **default 1.0**, hard-bounded by validation.
- **Requirement Groups** ship in v1: first-class containers, **ALL mode only**, group weight
  `v_g > 0` as the sole binary-channel weight, every check in exactly one group (implicit
  singleton materialized at save).
- **Hard Gates are reserved, not shipped**: the schema boundary is documented and `kind:"gate"`
  is rejected by validation with an actionable message; every gate-coupled Fusion proposal is
  postponed (consensus judging conflicts with the single-blind-judge invariant).
- The floor (`R_raw < 1 → R = 1.0`) is kept but made honest (post-falsification): sorting uses
  **R_raw** (evidence order survives the plateau), the floor marker shows the raw value, the
  ≥0.5 material-gap rule judges Q-gap first on flagged pairs, the tiebreak is **quality-first
  (Q desc → C desc)** — the pre-falsification C-first order was proven to rank equal-R
  candidates by *ascending* quality.
- **Closeness band δ=0.10: deferred**; a derived display-only **"binary-decided" badge**
  (δ = min per-check fail cost) ships instead — the authored exchange rate made visible.
  Historical runs: authoritative-only (pure-graded runs are bit-identical — R = Q); no v2
  recalculation, no legacy re-typing.

The decisive reconciliation: **Prime's block blend and Fusion's capped penalty are the same
ranking family.** With `r = W_bin/W_g` and `λ = 4r`, `(1+r)·S = R_raw + 5r` — a positive affine
transformation, so candidate ordering, ties, and experiment-level ordering are identical on the
unclamped region. The genuine differences are (a) the floor clamp (Fusion only), (b) distance
scale `1/(1+r)` (S compresses every gap), and (c) parameter semantics. RSemble adopts the
**penalty parameterization** (λ, "max points") because it is the least-misunderstood author
control, keeps thresholds in quality units the Judge actually assigns, and never inflates a
compliant candidate above its quality score; the floor is handled by disclosure, not by
switching to the compressed blend.

---

## 2. Evidence reconciled

| Source | Core proposal | Reconciled status |
|---|---|---|
| Pending spec §9 | mixed weighted mean, false→1/true→5 | **Rejected** (decomposition 3.18×, dilution →5.0, graded span collapse to 0.36, 4× judge-error leverage, H_synth fabrication) |
| Prime review (C-revised) | block blend `S = (W_g·Q + W_bin(1+4C))/(W_g+W_bin)`, parity default `W_bin = W_b/4` | **Same family** as R (`λ = 4W_bin/W_g`); rejected as the canonical representation (distance compression, inflation, drift), retained as the mathematical identity and as a "per-criterion parity" preset |
| Holistic Judge | capped penalty `R = Q − λ(1−C)` first; grouping = best imported idea; λ calibration = main open question | **Adopted** as the canonical family; grouping adopted (ALL-only v1); λ = 1.0 default with quantified tradeoffs |
| Fusion result | three-type model, Requirement Groups ALL/MEAN, hard gates with consensus judging, δ=0.10, v2 recalculation | Groups **adopted (ALL-only, minimal)**; gates **reserved** (consensus violates single-judge invariant); δ **deferred**; v2 recalculation **rejected** (authoritative-only history) |
| Live code | `canonicalScore` weighted mean, unclamped, null-on-no-positive-weight; WINNER_EPSILON 1e-9; equal-task experiment means; complete-coverage eligibility; strict parser | R reduces to `canonicalScore` exactly for pure-graded profiles; all live invariants preserved; guard/fingerprint/render fixes enumerated in §26 |

## 3. Formal equivalence proof

**Theorem (affine equivalence).** Let `r = W_bin/W_g` (requires W_g > 0) and `λ = 4r`. Define
`S = (W_g·Q + W_bin·(1+4C))/(W_g+W_bin)` and `R_raw = Q − λ(1−C)`. Then

```
(1+r)·S = Q + r + 4rC = Q − 4r(1−C) + 5r = R_raw + 5r.
```

*Proof:* `(1+r)S = (1+r)·(Q + r(1+4C))/(1+r) = Q + r + 4rC`; and `R_raw + 5r =
Q − 4r(1−C) + 5r = Q + r + 4rC`. ∎

**Corollaries (each verified — see Appendix A.2):**

1. **Order identity (unclamped):** for a fixed profile, `R_A > R_B ⟺ S_A > S_B` and ties agree.
   Verified: 0 ordering mismatches in 200,000 random pairs; residual ≤ 3e-14. Exhaustive
   sweeps over all achievable (Q,C) for 6g+1b, 2g+8b, 3g+3b, 1g+1b, 4g+4b, 6g+6b agree 1.0.
2. **Distance scaling:** `S_A − S_B = (R_A − R_B)/(1+r)` — S compresses every gap by
   `1/(1+r) ≤ 1` (0.8 at λ=1).
3. **Range:** S ∈ [1,5] by convexity; R needs the lower clamp. The ceiling never binds for
   either.
4. **Commutation:** the affine map commutes with means and max oracles when r is constant:
   `mean_t(S_t) = (mean_t(R_raw,t) + 5r)/(1+r)`; `max(S_A,S_B)` likewise. Verified: 0
   experiment-level ordering mismatches in 200 simulated 5-task candidates.
5. **Where equivalence fails (each verified):**
   - **The floor clamp:** `R_raw < 1` collapses distinct evidence to R = 1.0 (plateau). Binds
     12.5% of *uniform* (Q,C) space at λ=1, 3.23% in a realistic 8%-broken mixture, 0.004% on
     good leaderboards. S keeps such pairs distinct (1.0 vs 1.8 for Q=1.0/C=0 vs Q=1.5/C=0.5).
   - **Defaults differ:** `W_bin = W_b/4` matches `λ = 1` only when `W_b = W_g`. At the two
     defaults, 6g+1b reverses 10.1% of candidate pairs and 2g+8b 16.6% (interior, no clamping).
     Example: 6g+1b, A=(Q=4.5, check FAIL), B=(Q=4.0, PASS): S-default ranks A first (4.36 vs
     4.04), R-default ranks B first (3.50 vs 4.00).
   - **Expressible range:** Fusion λ ∈ [0,1] ⇔ r ∈ [0, 0.25]; Prime's parity default reaches
     r = 1 (2g+8b) — outside R's parameter space.
   - **Per-task parameter differences:** means of S with per-task r_t are not affine in means
     of R; reversals without clamping (1.7% in a 100k-trial two-task simulation).
   - **Zero-graded profiles:** S is undefined (0/0); R-family defines compliance-only ranking
     on C.

**Verdict: the reconciliation hypothesis is TRUE.** Prime and Fusion discovered the same
ranking family under different parameterizations. The remaining differences are representational
(distance scale, floor behavior, parameter semantics) and default-calibration — not ranking
architecture.

## 4. What Prime and Fusion actually agree on

1. Direct mixed mean with false→1/true→5 is rejected (both, with matching evidence).
2. Two channels: graded quality and binary compliance, aggregated separately, blended by ONE
   explicit bounded profile parameter (λ or W_bin).
3. Native boolean evidence preserved end-to-end; the only cross-channel exchange rate is the
   disclosed parameter.
4. Total binary influence is composition-invariant (≤ λ ⇔ ≤ 4r/(1+r) of the span — same
   ceiling in both units).
5. Decomposition resistance requires more than a cap: semantic grouping (Fusion) / block
   count-boundedness (Prime) — reconciled: **groups ship**.
6. Ranking: deterministic scalar, ties within 1e-9 share; R→C→Q→id tiebreak chain.
7. Judge contract: checks stay flat boolean results; grouping/blending is post-processing.
8. Fusion headroom must consume the same contribution math; bimodal diagnostics must exclude
   binary criteria; verifier outcomes stay separate.

## 5. Material disagreements that remained (and how they were resolved)

| Disagreement | Prime (S) | Fusion (R) | Resolution |
|---|---|---|---|
| Canonical representation | S, naturally bounded | R + clamp | **R** — quality-unit thresholds, R ≤ Q, no inflation, no distance compression (rec-math; rec-param; rec-clamp's fallback) |
| Author parameter | W_bin (block weight) | λ (max penalty) | **λ** — one multiplication in points, drift-invariant, the parameter *is* the cap guarantee; W_bin's parity default is order-dependent and drifts 10× under profile edits (rec-param) |
| Default | W_bin = W_b/4 (per-criterion parity) | λ = 1 | **λ = 1** — roundest interpretable unit; exact per-criterion parity at equal channels (6g+6b); binary-heavy profiles stay at the graded noise floor on equal-check boards; systematic-error bound 4–12× tighter than parity (rec-calib) |
| Floor | none (convex bounds) | clamp | **Keep clamp + honest floor** (marker, component materiality, printed tiebreak) — the plateau's information is preserved via Q/C components and the flag; S's alternative costs global compression and inflation (rec-math; rec-clamp §5) |
| Groups | not in v1 (flat block) | ALL/MEAN + member weights | **ALL-only v1, singleton default, group weight only** — MEAN+member-weights recreates decomposition one level down (rec-groups) |
| Gates | future eligibility contract | ship with consensus | **Reserve** — consensus violates single-judge/no-trials invariants; single-judged gate = worst option (rec-groups) |
| History | authoritative-only | v2 recalculation labeled | **Authoritative-only** — no mixed history exists; pure-graded is bit-identical; recalculation contradicts snapshot immutability (§22) |
| δ=0.10 band | not considered | display-only badge | **Defer** — uncalibrated without an uncertainty model; floor makes it lie (rec-clamp 3.4) |

## 6. Final semantic model

Three concepts, exactly:

1. **Quality** — graded criteria (anchored integer 1–5, weights). "How good is the answer on
   the graded dimensions?"
2. **Compliance** — ordinary binary checks organized into Requirement Groups. "Which atomic
   requirements does the answer satisfy?" Compliance is evidence, shown natively
   (`5/6 groups · 83%`); its influence on ranking is bounded and explicit.
3. **Eligibility** — (reserved) hard gates. "Is the answer acceptable at all?" Not shipped;
   the boundary is documented so scoring never absorbs gates.

There is no fourth path: a boolean never receives a numeric 1–5 encoding anywhere in the
system; the only cross-channel quantity is λ.

## 7. Requirement Group decision — SHIP (ALL-only, minimal)

**Ship now, cut hard.** The cap alone does not control *within-channel* redistribution:
measured — one requirement as 5 flat checks inflates its all-fail influence 1.67× (0.5 → 0.833
of C) and dilutes partial failure 5×; with one ALL group per requirement, influence is
`v_g/Σv` **exactly, for any member count** (rec-groups §2). Deferring groups now means a
schema+snapshot+fingerprint migration later, and the plan's Phase 10 mandates binary-heavy
profiles.

- Every BinaryCheck belongs to exactly one RequirementGroup; ungrouped checks get a
  **materialized implicit singleton** at save (dangling check fails save).
- **Mode ALL only** in v1: `c_g = min over members` (conjunction of atomic propositions — the
  natural reading of spec §8.2 atomicity). MEAN deferred: partial credit is a graded concept
  in boolean clothes; MEAN + member weights re-creates the decomposition attack one level down
  (measured: splitting a weight-2 member into two weight-1 members with one failing dilutes
  `c_g` 0.333 → 0.667).
- **Group weight `v_g > 0`** is the only binary-channel weight (a singleton group IS a weighted
  check). No member weights, no zero-weight groups/members (a zero-weight member under ALL is a
  footgun: `min` is weight-blind, so "mark it 0" silently *strengthens* the requirement).
- No duplication/correlation lint in v1 (text heuristics + judge-output history = separate
  feature; the cap bounds the damage, the merge affordance covers the honest case).
- "Checks X/Y" counts only positive-weight, present group results; the display shows the
  **weighted share** first ("Compliance 71% · groups 5/6") because a naive count contradicts
  the weighted score (rec-product Q2).
- Groups are profile-side; the Judge sees flat checks annotated with group IDs and returns
  per-check booleans (grouping is post-processing).

## 8. Hard Gate scope decision — RESERVE (schema boundary only)

**Decisive reason: gates are defensible only with consensus/elevated judging (the Judge and the
review both concluded a gate bit is the one place a single Judge error retains full leverage),
and consensus judging (2-of-3 replicated votes) violates the product's single-blind-judge
invariant and DECISIONS #7 (no multiple Judges, no multiple trials, no confidence machinery).**
A gate without consensus — the only version that could ship today — is a single noisy bit with
full veto power and zero reliability budget: the worst option. The current objective (graded
1–5 + ordinary binary checks) is fully solvable without gates; the pending spec's non-goals and
plan §0 already exclude them.

**Reserved boundary (exact):** document `GateEvaluationCriterion` (kind `"gate"`, unweighted,
trueWhen/falseWhen) and `GateJudgeCriterionResult` (kind `"gate"`, boolean) as reserved union
members; validation **rejects** `kind:"gate"` today with an actionable error ("hard-gate
semantics are not supported in this version; author this as a binary check or wait for gate
support"); suite packages containing gates fail import likewise. Spec paragraph (load-bearing):
*no weight, group weight, or λ is ever a gate; raising them to force dominance is documented
misuse; eligibility is winner-eligibility only (same family as complete coverage), never score
math.*

**Postponed with gates (complete list — nothing half-ships):** consensus/replicated judging;
elevated-scrutiny judge configuration; scarcity lint (keep only editor text "checks are scored,
not gates"); human override + audit trail; HARD_GATE_FAILED status and the flagged R:=1 mapping;
eligibility-first ranking key; experiment gate semantics (F counter, strict mode, gate pass
rate); gate UI states; GateResult persistence; legacy gate detection / bimodal re-typing
(postponed AND forbidden on historical runs); Fusion gate audit trails; status-code R:=1 in
exporters.

## 9. Graded Quality formula

```
Q = Σ w_i·s_i / Σ w_i     (positive-weight graded criteria, present results only; missing skipped)
```

Identical to today's `canonicalScore` (evaluation-profile.ts). Zero graded criteria → no Q
(compliance-only profile, §22-adjacent). One-anchor change on criterion i moves Q by
`w_i/Σw`.

## 10. Compliance formula

```
c_g = min_{k∈g} b_k                          (ALL mode; b_k ∈ {0,1})
C   = Σ v_g·c_g / Σ v_g                      (positive-weight groups, present results only)
C   := 1, displayed "—"                       (no binary criteria in the profile)
```

Zero-weight members/groups are invalid. Group verdict is deterministic from per-check booleans;
the Judge never computes C.

## 11. Ranking semantics

Deterministic sort key, descending except id (single task and per-task experiment cell):

```
R_raw desc → Q desc → C desc → candidate_id asc     (R_raw = Q − λ(1−C); R = clamp(R_raw,1,5))
```

- Winner = all candidates within `WINNER_EPSILON = 1e-9` of the max displayed R (existing
  logic); a leaderboard whose max is a floor-flagged 1.0 shows no winner badge on censored
  ties.
- **Sorting uses R_raw, not the clamped R** (post-falsification revision): among floored
  candidates the R column ties at 1.0 but the evidence order is preserved; the floor marker
  shows the raw value in detail. This eliminates the contradiction found in falsification loop
  1 (31.7% of floored pairs reordered against evidence by the old key).
- **Tiebreak is quality-first: Q desc before C desc** (post-falsification revision). At fixed
  R_raw, Q = R_raw + λ − λC, so Q desc ⟺ C asc: the previous C-first order ranked equal-R
  candidates by *ascending* quality (a 5.0-quality candidate below a 4.0 one at equal R). Q
  first matches user expectation; C is then redundant but retained for explicitness.
- The ≥0.5 material-gap rule (DECISIONS #8) judges **Q-gap first, then C-gap**, for
  floor-flagged pairs (a floored pair can have both gaps material in opposite directions; Q is
  the headline).
- **Binary-decided badge (display-only):** when the top-2 margin is below the minimum per-check
  fail cost `δ = min_g λ·v_g/Σv`, the UI badges the pair "binary-decided / too close to call"
  — the smallest margin one wrong verdict could flip. This is the *derived* band (not the
  deferred arbitrary 0.10), an auditability feature.
- Ordering is monotone: improving any graded score or flipping any check false→true never
  lowers R (verified by construction; no Pareto violations in 2,160-vector sweep in the prior
  review, re-checked for R).

## 12. Canonical Rank Score formula

```
R_raw = Q − λ·(1 − C)
R     = clamp(R_raw, 1, 5)          λ ∈ [0,1], profile parameter, default 1.0
floor = R_raw < 1                   (censored; R displays 1.0 with a floor marker)
```

- R = Q when C = 1 (perfect compliance) — pure-graded profiles are bit-identical to today.
- R ≤ Q always; compliance can only deduct, never inflate.
- The maximum total effect of ALL compliance failures is λ points — composition-invariant by
  construction (no check count, grouping choice, or weight can move it past λ).
- The floor marker distinguishes "bottomed out" (Q/C shown alongside; raw value in detail)
  from a genuine anchor-1 score; the ≥0.5 material-gap rule judges flagged pairs on Q/C
  components, Q-gap first (a full-point gap cannot hide at the floor).

## 13. Parameterization tournament (Track 3)

Finalists (all are the same ordering family; the tournament decides author semantics):

| Dial | Author reads | Fatal/limiting flaw | Verdict |
|---|---|---|---|
| `W_bin` (absolute block weight) | "checks as a group weigh W_bin" | parity default order-dependent (0.44 → 2.86 pts cap for identical final profiles authored differently); frozen constant drifts 10× when graded criteria are added; five UI patches needed to be legible; W_bin=0 silent kill | eliminated (runner-up) |
| `r = W_bin/W_g` (relative) | "compliance relative to graded" | unitless; effect = 4r in points (hidden ×4); r=0.5 ⇒ λ=2 = hidden automatic disqualifier (Q=2.5 + one fail clamps to 1.0) | eliminated |
| `α` (channel share) | "20% of influence is compliance" | α→λ map is convex: 20%→1.0, 30%→1.71, 80%→16; benign-looking positions are hidden gates; naive "20% of 5 = 1.0" arithmetic wrong (span is 4) | eliminated |
| **`λ` (max compliance penalty, points)** | "all unmet requirements together cost at most λ points" | floor plateau (disclosed); singleton swing 1.0 at λ=1 (governed by warning + the dial itself) | **WINNER** |
| per-check cap (E) | "each check costs at most X" | splitting grows the total (5×0.25 = 1.25) — decomposition-sensitive by construction | eliminated |

Decisive argument: the author's three recurring tasks — predict a failed check's cost, explain
why A beat B, edit without silently changing semantics — are under λ: one multiplication
(λ × group share) in the score's own unit; raw point arithmetic in the explanation
("4.40 − 1.0 × 0.17"); and the cap's meaning is invariant to adding graded criteria, adding
checks, or regrouping, because it is defined in absolute points. **λ is hard-bounded at 1.0**
(validation error, not silent clamp): at λ=2 one ordinary check becomes a de facto eligibility
veto (Q=2.5 + fail → R=1.0) — a hidden gate. Authors needing more influence promote the check
to graded (quality) or wait for gates (eligibility).

## 14. Selected author-facing parameter

**`complianceInfluence` — λ, "Maximum compliance penalty (points)", ∈ [0,1], default 1.0.**

Editor field: `Max compliance penalty: [1.0] points` (set when the first binary check is
authored; a stored constant thereafter). Inline help: "Failing **all** binary checks together
lowers the Rank Score by at most this many points. 1.0 = one anchor level (e.g., 4.2 → 3.2).
Each check's cost is its group's share of this cap — currently [per-group live list]."
Per-group disclosure: "fail cost: X pts = λ × v_g/Σv" (pivotal-gated under ALL). Singleton
warning when ≤ 2 groups. λ=0 renders checks as **excluded** (evidence-only marker). A
"per-criterion parity" preset (λ = min(1, n_b/n_g)) is offered with its quantified warnings
(§15) for authors who want one check ≡ one graded level.

## 15. Default calibration

**Default λ = 1.0.** The five parity definitions (per-criterion marginal; channel-level;
expected-error; typical-profile; maximum-error) were quantified: per-criterion parity requires
λ = n_b/n_g — a 72× spread (0.167 at 6g+1b → 12.0 at 1g+12b) — impossible under the λ ≤ 1 cap
in binary-heavy profiles and the wrong target (it amplifies the noisier channel). Channel-level
parity (λ=4) is outside the design by construction. Expected-error parity
(λ = √(p_g·n_b/(p_b·n_g)) ≈ 0.58–4.9) is composition-dependent. Only **typical-profile parity
(λ=1)** is a constant; at λ=1, the equal-channel profile (6g+6b) has exact per-criterion
marginal parity (0.167 = 0.167), and "20% compliance share" (λ/(4+λ) = 0.2) is the exact
channel share.

Why λ=1 is the least surprising product default (rec-calib, full MC):
- Equal-check close leaderboards stay at today's graded noise floor (2g+8b δ=0.3: 7.9% reversal
  vs 6.7% graded-only baseline; 1g+12b: 14.9% vs 14.4%) — binary noise is negligible because
  Var ∝ λ²/n_b.
- Systematic-error bound is composition-invariant and 4–12× tighter than Prime's parity default
  (a fully misjudged channel costs ≤ 1.0 point vs 4–12 under λ = W_b/W_g; with one judge and no
  trials, systematic error does not average out).
- The costs are disclosed and per-profile fixable: singleton swing 1.0 (warning + dial), and
  28–39% one-check reversals in binary-heavy profiles (per-check Δ disclosure; the true
  difference there IS small — 0.125 — by authored share).
- Prime's parity default (λ = W_b/W_g) is offered as the explicit **"per-criterion parity"
  preset** with its quantified warnings (49–60% of tasks move ≥ 0.5 points from check noise in
  binary-heavy profiles; 3× the graded reversal baseline on equal-check boards); a
  "parity-when-affordable" variant (λ = min(1, n_b/n_g)) fixes the singleton swing without
  breaking the cap.

## 16. Judge-noise results (definitions in Appendix A.3)

| Scenario (T=5, p_g=0.2, p_b=0.1) | λ=1.0 | λ=0.5 | λ=0.25 | parity λ=W_b/W_g | graded-only baseline |
|---|---|---|---|---|---|
| 6g+1b one-check leaderboard | 0.000–0.001 | 0.001 | 0.023–0.052 | 0.083–0.111 | 7.4% (6g one-level gap) |
| 6g+6b one-check | 0.119–0.147 | 0.248 | 0.361 | 0.119 | — |
| 3g+3b one-check | 0.048 | 0.168 | 0.308 | 0.048 | 2.1% (3g) |
| 2g+8b one-check | **0.276–0.295** | 0.384–0.392 | 0.407–0.438 | 0.074–0.090 | 0.6% (2g) |
| 1g+12b one-check | 0.386 | 0.442 | 0.471 | 0.091 | 0.02% (1g) |
| Equal-check δ=0.3 (2g+8b) | 0.079 | 0.070 | 0.068 | 0.193 | 6.7% |
| Equal-check δ=0.3 (1g+12b) | 0.149 | 0.146 | 0.145 | 0.344 | 14.4% |

**Reading:** (1) The sharp one-check reversal in binary-heavy profiles (28–30% at λ=1) is the
honest consequence of an authored small share (0.125/task): the true difference IS small; the
alternative (parity λ=4–12) makes binary noise dominate every other board (49–60% of tasks
move ≥ 0.5). (2) The singleton swing at λ=1 (1.0 point, 6× a graded level in 6g profiles) is
the strongest argument for a lower default; it is governed by the singleton warning + the dial
itself. (3) λ=1 keeps equal-check boards at the graded-only noise floor — the boards where
winners actually sit. (4) ALL-mode groups do NOT reduce judge-error leverage: P(group verdict
error) = 1−(1−p_b)^k ≈ k·p_b (up to 3.75× a singleton for predominantly-passing groups); ALL's
benefit is decomposition-invariance, never noise reduction. (5) Systematic misjudgment of one
check shifts the experiment mean by λ/n_b per task (0.125 at 8 groups) — bounded, T-independent,
and 4–12× tighter than parity defaults.

**Model-parameter sensitivity (falsification loop 2 re-verification):** the one-check
reversal in 2g+8b is 0.205–0.295 depending on the noise model: p_g=0.20/p_b=0.10 → 0.276–0.295
(root/calib); p_g=0.15/p_b=0.05 → 0.205 (falsify-2, full noise). In both models the reversal is
**dominated by pre-existing graded noise** (graded-only baseline 0.227 vs binary-only 0.007 in
falsify-2's model; the binary channel *lowers* reversal below the pure-graded baseline). The
28–30% regime is bracketed to true margins ≤ one check (the knife-edge 0.46–0.50 is a
tiebreak artifact; margins ≥ 2 checks: ≤ 0.053). Per-item leverage in this profile class is
0.125 for both a check flip and a one-level graded error on a weight-1 criterion — equal, not
disproportionate.

**The central question — answered:** with the λ=1 default, binary classification error has
disproportionate per-bit leverage ONLY in singleton/small-group profiles (6× a graded level in
6g+1b), where it is disclosed and dial-adjustable; in binary-heavy profiles binary error is
*under*-powered relative to graded disagreement (0.25×–0.083×), which is the accepted price of
the composition-invariant cap. No single default achieves per-criterion parity everywhere (the
72× spread is structural); λ=1 is the least-surprising constant.

## 17. Decomposition results

| Encoding of requirement X (plus one other group Y, v=1; λ=1) | ΔC all-fail | ΔC one-subcheck | ΔR one-subcheck |
|---|---|---|---|
| 1 check = 1 group (v=1) | 0.500 | 0.500 | 0.500 |
| 5 subchecks in 1 ALL group (v=1) | **0.500** | **0.500** | **0.500** — invariant |
| 5 checks = 5 groups (v=1 each) | 0.833 | 0.167 | 0.167 — diluted |
| 5 groups with redistributed v=0.2 | 0.500 | 0.100 | 0.100 |

- The **λ cap** bounds total binary power (≤ λ regardless of count/grouping/weights) — verified
  in every encoding.
- **Grouping** pins each requirement's influence to its authored share `v_g/Σv` — verified
  under ALL for any member count; the container alone changes nothing (5 singleton groups ≡
  flat), so materialized-singleton default + merge affordance are load-bearing.
- Residual: ungrouped duplication dilutes partial failure and inflates all-fail share within
  the channel — bounded by λ, flagged by the future lint; "count-bounded, not count-invariant"
  is the honest claim.
- Fusion §8's "5 ungrouped checks share identical" row is corrected: it holds only when X is
  the entire binary content; with other groups present the share is 5/(W+4) ≠ 1/W.

## 18. Profile-composition results

| Profile | one check fail cost (λ=1, equal v) | total binary influence | graded-level cost | notes |
|---|---|---|---|---|
| 6g+1b | 1.000 | ≤ 1.0 | 0.167 | singleton warning fires |
| 6g+6b | 0.167 | ≤ 1.0 | 0.167 | exact per-criterion parity |
| 3g+3b | 0.333 | ≤ 1.0 | 0.333 | symmetric shares |
| 2g+8b | 0.125 | ≤ 1.0 | 0.500 | checks quieter than graded levels by design |
| 1g+12b | 0.083 | ≤ 1.0 | 1.000 | graded-dominant noise |
| all-graded | — | — | — | C:=1, R=Q, bit-identical |
| all-binary (compliance-only) | 1/n_b | 1.0 | — | rank on C (0–100%); no R |
| 1 group with 5 subchecks | 1.000 (group fail) | ≤ 1.0 | — | stricter than singleton; judge-error-fragile |
| λ=0 | 0 | 0 | — | evidence-only; checks-excluded marker |

**Composition invariance holds for the channel:** total binary influence ≤ λ in every
composition (decomposition, group duplication, member count changes). Per-check cost scales as
`λ·v_g/Σv` — the mechanism of the cap, disclosed live. Group duplication doubles a requirement's
weight if both copies fail — the same property as any weighted design; visible weights + the
cap are the defense.

## 19. Clamp analysis

**Keep the clamp, made honest.** The floor is forced by the penalty parameterization:
"penalty form ∧ 1–5 domain ∧ no floor" is unsatisfiable (the largest floor-free penalty is
`min(λ(1−C), Q−1)`, i.e., the clamp; verified to 0.0 error over a 200k grid). The alternative
canonical S removes the floor by construction but pays global compression (20% at λ=1),
inflation of compliant candidates above Q, threshold drift, and the 1+4C algebra.

Quantified floor behavior at λ=1 (definitions in Appendix A.4): binds 12.5% of uniform (Q,C)
space, 3.23% in an 8%-broken realistic mixture, 0.004% on good leaderboards; among Q<2.5
candidates 34% are flattened; pair ties 0.098% (mixture); multi-winner artifacts 0.98%;
mean bias +0.010; suite-ranking reversal risk 2.3% (10 tasks, 3 broken); closeness-band
mislabeling 1.33% of in-band pairs. **Mitigations adopted (the "honest floor"):**
1. `floor` flag persisted/derived on every R (R_raw < 1); UI and exports render "1.0* floor".
2. The ≥0.5 material-gap rule judges flagged pairs on Q/C components (a full-point gap cannot
   hide).
3. R→C→Q→id tiebreak is printed wherever R ties; winner badges suppressed on censored ties.
4. Experiment means report floor-task counts; the +0.010 mean bias is disclosed in the
   aggregation footer.
5. The closeness band (if ever adopted) judges flagged pairs on components.

These neutralizations preserve the information the plateau would otherwise flatten (Q and C
columns always accompany R), while keeping the number in quality units. S remains the
documented affine image (`S = (R_raw + 5r)/(1+r)`, r = λ/4) if a "blended overview" is ever
wanted as display-only.

## 20. Score-distance vs rank-equivalence analysis

R and S are rank-equivalent (fixed profile, unclamped) but **product-inequivalent**:

- **Distances:** R's gaps are in quality units (net quality points); S compresses by 1/(1+r).
- **≥0.5 material-gap rule:** same-conclusion pairs under R preserve Q-gaps up to a bounded
  compliance term (misfire 3.9%); under S the rule misfires up to 25.8% in binary-heavy
  profiles (a genuine 0.6-quality gap displays 0.48 and escapes the mandated same-conclusion
  comparison).
- **Tier bands (≥4.0/≥3.0) and the close-call margin:** R keeps their quality meaning (R=Q at
  C=1); S shifts them (Q=3.2, C=1 → S=4.1 at r=1 — a weak candidate displayed in the top tier).
- **Absolute value:** R=Q at C=1, R≤Q always; S>Q at C=1 (compliance "raises quality" — reads
  odd).
- **Profile-edit stability:** R changes only when λ or evidence changes; S's scale drifts with
  composition (Q=4.0, all checks pass: S = 4.04 → 4.50 as checks are added; R stays 4.000).
- **Historical:** R keeps v1/v2 boundaries transparent (R=Q when C=1); S re-reads a 4.0-quality
  historical run as 4.2+.
- **Aggregation:** mean(R_raw) = Q̄ − λ(1−C̄) exactly (affine in channel means — the Fusion
  channel-separate rule); mean(S) is affine only for fixed r and never decomposes into channels.

**Conclusion:** RSemble's canonical is an ordinal index with interval-style product thresholds
(order authoritative; magnitudes meaningful only within one formula + one profile generation).
Because thresholds are defined on the canonical, the representation that keeps thresholds in
quality units — R — is the product-correct one.

## 21. Closeness-band decision — the arbitrary band (δ=0.10) is DEFERRED; a derived "binary-decided" badge ships

Fusion's δ=0.10 ("too close to call") is deferred: it is (a) not required to solve hybrid
scoring; (b) uncalibrated — the product has no uncertainty model (DECISIONS #7 excludes
trials/CI), so 0.10 is a noise guess; (c) mislabeled at the floor (every censored pair is
|R−R|=0, in-band regardless of true distance — 27.4% of in-band pairs in uniform populations
have true gaps > 0.10); (d) a profile parameter for a non-scoring concern.

**However, falsification loop 2 supplied a principled replacement:** a display-only
**"binary-decided" badge** with the *derived* band `δ = min_g λ·v_g/Σv` — the smallest margin
one wrong binary verdict could flip. This is not a noise guess; it is the authored exchange
rate made visible ("the top-2 margin is smaller than the cost of one wrong check verdict").
It is judged on components for floor-flagged pairs. The arbitrary 0.10 remains deferred; an
evaluation-confidence feature (with trials/CI evidence) could later generalize the badge.

## 22. Historical compatibility decision — authoritative-only

1. **Pure-graded runs (all historical runs today):** C := 1 ⇒ R = Q exactly — bit-identical to
   the current canonical. No recomputation, no drift, no migration.
2. **Mixed runs:** none exist (feature unimplemented) — the Fusion "v2 recalculation" scenario
   has no instances in v1; the proposal is rejected anyway: run records and snapshots are
   immutable and pinned (spec §12; PRODUCT.md), and a score computed under a policy that did
   not exist at run time is a different artifact, not a correction.
3. **Schema migration:** additive only — new profile fields (λ, requirementGroups) on new
   profile versions; legacy snapshots untouched; `isEvaluationCriterion` extended to the union
   (guard fix — without it, binary-profile runs are silently dropped from history).
4. **Legacy re-typing (bimodal 1/5 → binary detection):** deferred AND forbidden on historical
   runs; at most a read-only diagnostic in a future release, never a rewrite (spec §12.1).

## 23. Experiment implications

- Per-task score = R_t (floor-flagged). Experiment model score = equal-task arithmetic mean of
  R_t; missing = missing; complete-coverage winner eligibility unchanged; ties within 1e-9
  share; ranking key R̄ desc → Q̄ desc → C̄ desc → id (quality-first, matching the task key).
- Channel aggregates Q̄ and C̄ are reported alongside (Fusion's channel-separate rule; verified:
  mean(R_raw) = Q̄ − λ(1−C̄) exactly — the mean is recoverable from channel means).
- Floor tasks are counted and disclosed: each candidate shows an "n floored tasks" column and
  the raw mean in the detail view (the +0.010 floor boost is reported, not hidden; the
  0.48–2.3% suite-reversal risk — falsification loop 1 measured 0.48% with 2-task suites,
  2.3% with heavier mixtures — is the disclosed price of the floor, mitigated by the column and
  by the fact that winners at the top are never floor-bound).
- Compliance-only profiles rank on C̄ (0–100%), matrix renders C-labeled cells.

## 24. Fusion Study implications

- `taskOverall` and headroom math consume the **same** R formula (Q, C from stored evidence,
  λ + groups from the profile snapshot) or the study and the matrix measure different
  quantities; `fusion-study-stages` must thread the full profile snapshot (currently only
  `CriterionWeights`).
- Per-criterion headroom: graded criteria unchanged (5 − s_i); binary checks use pass-rate
  imbalance `1 − b_k` (labeled, min-sample gate) — never a 4-point quality gap; headroom
  *rankings* are representation-independent (verified: H_synth magnitudes scale 1/(1+r) under
  S, rankings identical).
- H_synth/H_select oracle: compute at **group level** (a group is satisfied if either model's
  group passes under the oracle) — bounded by λ; complementary binary failures no longer
  fabricate large headroom (the A-design artifact).
- `detectBimodalScores` excludes binary criteria (100% of mapped values are extremes by
  construction). Verifier Jaccard/φ untouched (`gateBinaryMetrics` consumes
  `VerifierOutcome.passed` only). The Fuse synthesizer prompt renders PASS/FAIL, never 5.0/1.0.

## 25. UI / authoring semantics

One candidate row (the honest label set — the only one that survives the skeptical-author test):

```text
Quality 4.40 / 5              (3 graded criteria)
Compliance 83% · 5/6 groups   (weighted share first; count as evidence)
Compliance influence: max 1.00 point
Rank Score 4.23 = 4.40 − 1.00 × 0.17
```

- "Why did A outrank B?" = one visible subtraction; the derivation line is mandatory (a bare
  "Rank Score 4.34" fails the test).
- Rejected labels: "Quality weight 80% / Compliance weight 20%" (false under R — the affine
  transform check 0.8×4.40+0.2×4.33 = 4.39 ≠ 4.23 catches the lie); "Requirements 5/6 passed"
  alone (contradicts the weighted score once groups are weighted); "Compliance influence: 1.00"
  without "points" (rate vs cap vs weight ambiguity).
- Editor: kind chips (Graded 1–5 / Binary True–False); per-kind fields; group container shown
  as collapsible sections with ALL-mode hint ("splitting this requirement makes it stricter");
  per-group fail-cost line; singleton warning (≤ 2 groups); λ=0 "checks excluded" marker;
  "per-criterion parity" preset with warnings.
- Floor: "1.0* (floor)" marker (raw value in detail) in Rank, matrix cells, Run Detail, and
  exports; tiebreak printed with equal R values; "binary-decided" badge when the top-2 margin
  < min per-check fail cost.
- ALL groups: subcheck count shown with a fragility note ("ALL mode, N subchecks: any single
  false verdict fails the group — false-fail rate ≈ N×p"); warn at N ≥ 4; guidance: prefer
  singleton groups; split only when atomicity demands.
- Compliance display: weighted share first, count second, weights visible under concentration
  ("Compliance 71% · 5/6 groups"), never the naive count alone (a v=100-group profile shows
  "99% · 5/6 groups" — the count without weights misleads).
- No gate UI in v1 (reserved boundary documented in the editor as a future type).

## 26. Systems compatibility

Contract fixes required regardless of finalist (all enumerated with live-file references):

1. **Persistence guard (data-loss bug):** `isEvaluationCriterion` requires
   `anchors.one/three/five` — binary criteria fail the guard and binary-profile runs are
   silently dropped from history/archives. Extend to the union FIRST (evaluation-types.ts,
   run-types.ts; RunRecordV2 stays schemaVersion 2, additive).
2. **Protocol fingerprint:** `semanticFingerprintInput` whitelists
   `{id, version, name, description, judgeInstruction, criteria}`; `criteria` flows wholesale
   (kind/anchors/conditions covered) but profile-level fields are invisible — **whitelist λ and
   requirementGroups explicitly** + regression tests (two experiments differing only in λ or
   grouping must not collide on protocol identity; roster-extension `priorFingerprint` chaining
   depends on it).
3. **Judge prompt/parser:** `evaluationCriteriaText` becomes kind-aware (graded 5 anchors;
   binary TRUE/FALSE + group ID); pipeline prompt contract gains `value` for binary and
   per-kind validation (integer 1–5 graded; JSON boolean binary; cross-kind rejection; no
   coercion); the "(1.0–5.0 scale)" header becomes kind-aware; legacy numeric results keep
   historical parsing.
4. **Rank:** `RankResult.tsx` `cs.score.toFixed(1)` and `tier(cs.score)` throw on binary —
   PASS/FAIL native cells required; `buildWhyItWon` must use score×weight contributions (never
   quote a PASS as "(5.0)"); `criterionScoresToMap` (studio-engine) must not drop booleans;
   **behavioral disclosure:** Rank currently uses the Judge's top-level `overallScore` while
   experiments recompute from criteria (spec §10.4 unifies on derived R — a change to Rank
   winner math for all profiles; release-note it).
5. **Experiment aggregation:** `canonicalScoresFromRun` maps `cs.score` → undefined for binary
   → `canonicalScore` silently skips the weight (wrong denominator, silent corruption). Use the
   shared R helper (Q, C, λ from the run's profile snapshot).
6. **Fusion Study:** `modelTaskScoreFromReport` (NaN on binary), `taskOverall` (blend formula),
   group-level oracle, bimodal exclusion, min-sample gate for binary headroom, full profile
   snapshot threading.
7. **Exports/packages:** `export-markdown.ts`, `archive.ts`, `fusion-recipes.ts` —
   `cs.score.toFixed(1)` TypeErrors; PASS/FAIL native + Q/C/R triple; suite-package profile
   types carry λ + groups (additive).
8. **Editor:** `EvaluationProfileEditor.tsx` `addCriterion()` kind choice; per-kind fields;
   group container; λ control with disclosures (the component already owns the profile object).
9. **Verifier separation:** confirmed intact in every path (Judge booleans never enter
   Jaccard/φ); PASS/FAIL rows labeled Judge evidence, never checker output.
10. **Zero channels:** zero-binary → C:=1, R=Q (bit-identical); zero-graded → compliance-only
    (C 0–100%, no R; matrix renders C-labeled cells).

## 27. Finalist decision table

| Criterion | R-final (λ, groups, honest floor) | S-final (W_bin blend, groups) | Notes |
|---|---|---|---|
| Monotonicity | ✓ (verified; no Pareto violations) | ✓ | tie |
| Natural 1–5 bounds | floor + marker | by convexity | S cleaner; R acceptable with disclosure |
| Decomposition resistance | ALL groups: influence = v_g/Σv exactly; cap ≤ λ | needs groups (flat = 1.67× inflation) | tie (both ship groups) |
| Dilution resistance | cap ≤ λ; per-check = λ·v_g/Σv | cap 4r/(1+r) | tie |
| Judge-noise sensitivity | equal-check boards at graded baseline; singleton 1.0 (warned) | same ordering; different scale | tie (ordering) |
| Rank stability | ties only at floor (~0.1–1.6% pairs) | no ties | S slightly better |
| Experiment stability | +0.010 floor bias (disclosed); 2.3% reversal risk | affine-commutes | S slightly better |
| Criterion-count invariance | total ≤ λ always | total ≤ 4r/(1+r) | tie |
| Group-count invariance | per-check = λ·v_g/Σv (disclosed) | same structure | tie |
| Graded resolution | full Q span preserved | compressed 1/(1+r) | **R** |
| Weight semantics | group weights = channel shares; λ = cap in points | W_bin = block weight | **R** (one multiplication, drift-invariant) |
| Parameter interpretability | λ "max points" — best of 4 dials tested | W_bin needs 5 disclosure patches; order-dependent parity default | **R** |
| Score-distance interpretability | quality units; ≥0.5 rule misfires 3.9% | compressed; misfires up to 25.8% | **R** |
| Backward compatibility | pure-graded bit-identical | pure-graded bit-identical | tie |
| Implementation complexity | clamp flag + marker | no clamp | S slightly lower |
| UI complexity | derivation line + floor marker + warnings | blend formula + 1+4C algebra + live share | **R** (penalty framing reads as subtraction) |
| Fingerprint implications | whitelist λ + groups | whitelist W_bin + groups | tie |
| Fusion Study compatibility | group-level oracle, quality-unit headroom | scaled magnitudes | **R** |

**Winner: R-final** — strictly better on the axes that touch product semantics (graded
resolution, weight semantics, parameter interpretability, score distances, Fusion units), at
the cost of a floor that is neutralized by disclosure (marker + component materiality +
printed tiebreak). S-final is the documented affine image, available as a display-only
overview if ever wanted.

## 28. Post-convergence falsification results

Three mandatory loops attacked the final design (R = clamp(Q − λ(1−C), 1, 5), λ∈[0,1] default
1.0, ALL-only groups, floor marker, Q/C tiebreak). All were completed; **no loop found a
formula-level failure** — every material finding was resolved by display/validation-level
revisions (below), none touching Q, C, R, the λ bound, or the fingerprint.

### 28.1 Loop 1 — Mathematical/pathological (5 material findings → 5 revisions)

1. **Tiebreak contradicted evidence order in the floored band** (31.7% of floored pairs
   reordered against R_raw; e.g., A=(Q=1.40,C=0.55), B=(Q=1.00,C=0.80) both R=1.0, C-first
   ranked B above A against a 0.15 raw margin). **Revision:** sort by R_raw desc; floor
   marker shows the raw value. Also: the material-gap rule can see both gaps material in
   opposite directions for floored pairs (5e-5) — **Q-gap precedence** adopted.
2. **ALL-mode false-fail compounding:** P(group falsely fails) = 1−(1−p_b)^k — k=14 subchecks
   at p_b=5% is a 51% coin flip; the design measures no p_b. **Revision:** validation/UX cap —
   warn at N ≥ 4, subcheck-count + fragility disclosure, authoring guidance ("prefer singleton
   groups"); quorum mode scheduled v1.1.
3. **Count/weight conflation:** "(5/6 groups)" with a v=100 group shows 99% vs 5% weighted
   compliance under identical counts. **Revision:** weighted share first, weights visible.
4. **Experiment floor-boost flipped a winner on a 0.225 raw margin** (0.48% of 2-task suites;
   floor the sole cause). **Revision:** "n floored tasks" column + raw mean in detail.
5. **C-first tiebreak = ascending-quality order** (the sharpest invariant violation): at fixed
   R_raw, Q = R_raw + λ − λC, so C desc ⟺ Q asc; the Q-desc key was dead code and 8% of
   coarse-profile pair orderings put 4.0-quality above 5.0-quality. **Revision:** Q desc before
   C desc (quality-first) in both single-task and experiment keys.

Verdict: **survives with 5 one-line, formula-untouched revisions.**

### 28.2 Loop 2 — Judge-error (no formula change)

Verified against the final design (p_g=0.15, p_b=0.05, integer-realizable profiles, seed
20240613):

- **(a) 6g+1b single-bit leverage:** one wrong verdict moves R by exactly 1.0 (the authored
  fail cost) and flips the winner for every graded margin < 1.0 (P ≈ 0.098/task at p_b=0.05).
  Verdict: the disclosed exchange rate, not a defect; the residual risk is the **empirical
  p_b calibration** (revisit λ if measured p_b ≥ p_g/6 in single-check profiles — do not
  pre-ship a change). Revision: binary-decided badge (R1).
- **(b) 2g+8b one-check gap, T=5:** failing candidate wins 0.205 (full noise) — dominated by
  **pre-existing graded noise** (graded-only 0.227; binary-only 0.007); the binary channel
  *lowers* reversal below the pure-graded baseline; margins ≥ 2 checks: ≤ 0.053; the 0.46–0.50
  knife-edge is a tiebreak artifact. Per-item leverage equals graded (0.125 each). Verdict:
  defensible; binary-heavy profiles are stable.
- **(c) ALL 5-subcheck false-fail:** 0.226 vs 0.05 (4.5×); expected R error 0.0283 vs 0.0063;
  MEAN's expected error is composition-invariant (= singleton). Verdict: material in
  probability, bounded in magnitude; revision = authoring guidance + fragility disclosure now,
  MEAN on the roadmap (not now — it changes semantics).
- **(d) Systematic one-check misjudgment:** mean shift 0.125/task, flips iff margin < 0.125;
  the comparable graded systematic error is 4× worse in 2g+8b. Verdict: acceptable; the λ cap
  and disclosure are the defense; judge-reliability is the real mitigation (reserved for
  gates).

Verdict: **survives; no formula change; three non-formula revisions (badge, guidance,
calibration note).**

### 28.3 Loop 3 — Product-authoring (no formula change)

- **Decomposition:** influence-invariant by construction (ALL group); only *probabilistically*
  harsher (fragility — see 28.1.2). Confirmed non-attack for ranking power.
- **Group duplication ≡ weight authoring** (exactly equal scores to v=3 authoring) — no new
  power; visible in the group list and fingerprint.
- **Group-weight dilution:** capped by λ, disclosed by per-check fail-cost; zero-score-impact
  checks are the author's right.
- **λ tie-engineering:** an author can choose λ ∈ [0,1] to force an exact R tie and win via
  the C tiebreak (λ* = (Q_A−Q_B)/(C_A−C_B)); disclosed (tiebreak printed, λ displayed,
  fingerprint-bound), bounded (≤1.0). Mitigation: the λ-stability indicator (interval of λ
  preserving the order) — scheduled with the badge.
- **Singleton soft gate:** 1-graded+1-check with λ=1 — a bit worth 1.0 point, but genuinely
  soft (Q=5.0/Fail ties Q=4.0/Pass); it is the only criticality mechanism while gates are
  reserved; warned and disclosed.
- **Encoding arbitrage (the largest residual hole):** an atomic requirement authored as a
  *graded* criterion bypasses the λ cap at up to 4× leverage (Q spans 4 points vs λ = 1), and
  presence-only anchor validation cannot stop it. Direction: graded→binary is self-harming
  (loses partial credit); binary→graded is attractive. **Revision (v1.1):** runtime
  bimodality monitor on graded criteria (Judge outcomes only 1/5 after ≥ N runs → suggest
  re-typing to binary, capping influence at λ). Not a v1 blocker: the graded channel's power
  is pre-existing behavior, but the "≤ λ" promise is bypassable and the flag is cheap.
- **Trivial-check farming:** erodes the C tiebreak rather than gaming it (adding passing
  checks compresses the C gap toward the quality side) — confirmed non-attack.
- **All-binary profiles:** transparent checklist semantics; check-farming cannot overtake a
  perfect rival.

Verdict: **survives; three governance amendments (ALL fragility disclosure, v1.1 bimodality
flag, tiebreak printed / Q-first).**

### 28.4 Adopted revision set (all loops)

1. Sort by R_raw desc; floor marker shows raw; Q-gap precedence in the material-gap rule.
2. Tiebreak Q desc → C desc → id (single-task and experiment keys).
3. ALL-group subcheck cap guidance: warn N ≥ 4, fragility disclosure, prefer singletons;
   quorum/MEAN scheduled v1.1 (not shipped — semantics change).
4. Compliance display: weighted share first, counts second, weights visible.
5. "n floored tasks" column + raw mean in experiment detail.
6. "Binary-decided" badge: display-only, δ = min_g λ·v_g/Σv, components-based at the floor;
   λ-stability indicator scheduled with it.
7. v1.1 roadmap: MEAN (member-weight-free), quorum mode, graded-criterion bimodality monitor,
   duplication lint, λ-stability indicator.
8. Empirical p_b calibration note: revisit the λ default if measured p_b ≥ p_g/6 in
   single-check profiles (do not pre-ship a change).

## 29. Strongest argument against the final architecture

**"The floor is a censoring machine in exactly the region evaluations exist to discriminate."**
rec-clamp's attack: at λ=1, 34% of Q<2.5 candidates are flattened to 1.0 in realistic
populations — the "how bad is it" signal, the single most decision-relevant fact about a bad
candidate, is destroyed in the Rank scalar; the C/Q tiebreak can rank evidence-contradictory
pairs (12.3% of censored pairs order differently than raw evidence); the floor manufactures
multi-winner leaderboards (1% of mixture boards); and the penalty form is the only reason the
floor exists at all — S never leaves [1,5]. The counter (adopted): RSemble enforces its 1–5
contract by construction elsewhere, but the product's disclosure philosophy (visible JUDGE_FAILED,
missing = missing, coverage eligibility) supports a flagged floor; the Q and C columns always
accompany R, so the information is preserved in the components; the marker, component
materiality, and printed tiebreak convert the plateau from a silent distortion into a disclosed
one. If the team values sub-anchor discrimination in the scalar over threshold purity, S
(display-only, r = λ/4) is the drop-in alternative — but S's global 20% compression and
compliance-inflation must then be accepted. Post-falsification, the objection is weaker than
it first appeared: the three loops confirmed the ordering information survives the floor via
the R_raw sort, the Q/C components, and the markers — and the falsify-2 re-verification showed
the feared binary-heavy noise is dominated by pre-existing graded noise. The strongest *new*
objection is the encoding arbitrage (§28.3): an atomic requirement authored as graded bypasses
the λ cap at 4× leverage, so the "≤ λ" promise is not airtight until the v1.1 bimodality
monitor ships.

## 30. Known weaknesses

1. **Singleton swing (λ=1):** one check in a ≤2-group profile moves R up to 1.0 on one wrong
   verdict — 6× a graded level in 6g profiles. Mitigated: singleton warning, per-check Δ
   disclosure, the dial itself; residual risk accepted (the Judge's flagged concern).
2. **Binary-heavy sharp leaderboards:** 28–30% reversal on one-check boards (2g+8b, T=5) — the
   authored share is 0.125 and graded noise dominates; the true difference is small by design.
   Mitigated: per-check disclosure; λ-stability indicator; the type-system escape (grade it or
   gate it).
3. **ALL-group judge-error compounding:** a k-subcheck ALL group fails by judge error with
   P ≈ k·p_b; splitting a requirement makes it stricter AND more error-fragile. Mitigated:
   authoring hint; MEAN reserved for a future release if partial-credit requirements emerge.
4. **Floor plateau artifacts:** ties, band mislabels, +0.010 mean bias, 2.3% suite-reversal
   risk — disclosed via the marker and component materiality; the product's winners live at the
   top where the floor never binds.
5. **Group-convention dependence:** the container alone does not enforce grouping (5 singleton
   groups ≡ flat); materialized singletons + merge affordance + future lint are the defense;
   the cap bounds the damage when grouping is refused.
6. **Group duplication:** duplicating a group multiplies the requirement's weight (bounded by
   λ) — visible weights are the defense; no automated duplicate detection in v1.
7. **λ=0 footgun:** checks silently excluded unless the "checks excluded" marker renders —
   required in editor, Rank, and exports.
8. **Compliance-only profiles:** C as the ranking scalar is a new display type for the
   experiment matrix (percentage cells) — small but real systems surface.
9. **Encoding arbitrage:** an atomic requirement can be authored as a graded criterion,
   bypassing the λ cap at up to 4× leverage; presence-only anchor validation cannot stop it;
   the v1.1 bimodality monitor is the planned flag.
10. **ALL-mode false-fail compounding:** P(group falsely fails) ≈ k·p_b — multi-subcheck ALL
    groups are stricter AND more error-fragile; guidance + fragility disclosure ship in v1,
    quorum/MEAN on the roadmap.
11. **λ tie-engineering:** an author can dial λ to force an exact R tie and win via the
    tiebreak; disclosed (printed key, displayed λ), bounded (≤1.0), and mitigated by the
    scheduled λ-stability indicator.
12. **Empirical calibration gap:** λ=1 rests on the assumption p_b ≪ p_g (the atomicity rule
    keeps binary checks low-error); no judge-rejudge data exists (DECISIONS #7 excludes
    trials/CI). If measured p_b ≥ p_g/6 in single-check profiles, revisit the default — do not
    pre-ship a change.
13. **λ is still an exchange rate:** the architecture relocates the categorical→interval
   arbitrariness into one visible, bounded, sensitivity-reportable parameter rather than
   eliminating it; profiles with compliance-heavy needs may find the 1-point cap weak (the
   type system absorbs the pressure).

## 31. Exact required changes to the pending spec

1. **§5 (domain model):** add `kind: "graded" | "binary"` criteria union (5-anchor graded;
   binary with trueWhen/falseWhen); add `RequirementGroup { id, name, checkIds, weight, mode:
   "ALL" }` container and profile fields `complianceInfluence` (λ, 0–1, default 1.0); remove
   per-check binary weights (weight lives on the group); document reserved
   `GateEvaluationCriterion` (kind "gate") as rejected-by-validation.
2. **§6 (Judge results):** add `BinaryJudgeCriterionResult { kind: "binary", value: boolean,
   rationale }`; keep legacy numeric union.
3. **§8 (binary semantics):** atomicity rule retained; every check in exactly one group
   (implicit singleton materialized); ALL mode only; no zero-weight members/groups.
4. **§9 (canonical scoring):** REPLACE the false→1/true→5 weighted mean with
   `R = clamp(Q − λ(1−C), 1, 5)`; define Q, C (group formula), λ semantics ("maximum points"),
   floor marker, R→C→Q tiebreak; delete the 5/1 mapping and its rationale; add the
   `λ = 4·W_bin/W_g` affine identity as a compatibility note (the block blend is the
   display-only overview form).
5. **§9.4 (binary summary):** weighted share first ("Compliance 71% · 5/6 groups"); counts over
   positive-weight present results only.
6. **§9.5 (no hard gate):** strengthen — gates reserved as kind "gate", rejected by validation;
   λ/weights are never gates.
7. **§13 (fingerprint):** whitelist `complianceInfluence` + `requirementGroups`; regression
   tests for λ-change and group-membership-change altering the hash.
8. **§15 (Rank UI):** PASS/FAIL native; Quality/Compliance/Rank triple with derivation line;
   floor marker; tiebreak display; per-group fail-cost; singleton warning.
9. **§16 (experiments):** per-task R; equal-task mean of R; ranking R̄→C̄→Q̄→id; floor-task
   counts disclosed; compliance-only profiles rank on C.
10. **§17 (Fusion Study):** group-level oracle; binary per-criterion headroom = pass-rate
    imbalance with min-sample gate; bimodal diagnostic excludes binary; taskOverall uses R with
    λ + groups from the snapshot.
11. **§18 (export):** PASS/FAIL native; never 5/5 or 1/5; "1.0* floor" marker.
12. **§19 (validation):** group rules (exactly-one membership, v_g > 0, ALL mode); λ ∈ [0,1]
    enforced; kind:"gate" rejected with named message.
13. **§22 (acceptance):** replace items 9–10 with the R-formula items; add floor-marker,
    group-invariance, λ-bound, fingerprint-whitelist, guard-fix acceptance criteria; add
    post-falsification acceptance: R_raw sort, Q-first tiebreak, binary-decided badge,
    subcheck-fragility disclosure, "n floored tasks" column.

## 32. Exact required changes to the implementation plan

1. **Phase 1 (domain):** criterion union + RequirementGroup container + λ profile field;
   validation tests for groups (membership, weight > 0, mode), λ bounds, gate rejection.
2. **Phase 2 (parser):** per-kind validation (integer 1–5 graded; boolean binary; cross-kind
   rejection); groups are profile-side — parser unchanged for results.
3. **Phase 3 (prompt):** kind-aware rendering with group IDs on checks; "(1.0–5.0 scale)"
   header conditional on profile containing graded criteria.
4. **Phase 4 (scoring):** REPLACE `criterionContribution` (5/1) with the R helper
   `rankScore(Q, C, λ)` + compliance aggregator; tests for: pure-graded R=Q identity; group
   ALL semantics; λ cap; floor marker; tiebreak; zero-channel profiles.
5. **Phase 6 (persistence):** `isEvaluationCriterion` union guard FIRST (data-loss fix);
   whitelist λ + groups in `semanticFingerprintInput`; suite-package profile fields; no
   historical migration.
6. **Phase 7 (UI):** shared CriterionResultList with PASS/FAIL; Rank/Quality/Compliance triple
   + derivation; floor marker; editor kind chips + group container + λ control + disclosures;
   `buildWhyItWon` contribution-weighted.
7. **Phase 8 (experiments/Fusion):** `canonicalScoresFromRun` via R helper; Fusion
   `taskOverall` via R with full snapshot; group-level oracle; binary headroom labeling;
   bimodal exclusion.
8. **Phase 9 (export):** PASS/FAIL + triple + floor marker in both exporters.
9. **Phase 10 (docs):** PRODUCT.md gains the two-channel sentence and λ disclosure; DECISIONS.md
   entry records: R formula, λ default 1.0, ALL-only groups, gates reserved, authoritative-only
   history, δ deferred.
10. **Phase 11 (gates):** REMOVE gate implementation phases; keep only validation rejection +
    named error (extend plan Phase 1.2 test #7).
11. **Phase 12 (report):** add — floor-marker counts, group-invariance evidence, λ-bound
    enforcement proof, guard-fix verification, statement that no historical record was
    reinterpreted; add post-falsification items — R_raw sort + Q-first tiebreak tests,
    subcheck-fragility cap (N ≥ 4 warning), binary-decided badge (δ = min fail cost),
    floored-tasks column, v1.1 roadmap note (MEAN/quorum/bimodality monitor/duplication
    lint/λ-stability indicator).

## 33. Confidence and evidence that would change the decision

| Claim | Confidence | Would change if |
|---|---|---|
| Affine equivalence (S ≡ R family) | **Very high** (algebraic proof + 200k-sample verification + exhaustive sweeps) | a counterexample pair is produced (none found in 7 independent checks) |
| R as canonical over S | **High** (semantics: thresholds, inflation, drift — quantitative) | user study shows authors read the penalty framing worse than the blend; or product decides sub-anchor scalar discrimination outweighs threshold purity |
| λ = 1 default | **Medium-high** (quantified tradeoffs; least-surprising among constants tested) | judge-rejudge data shows p_b ≈ 0 for well-specified checks (rehabilitates lower λ); author-behavior data shows profiles rarely exceed 2 checks (weakens the binary-heavy arguments); a user study of the singleton swing |
| ALL-only groups in v1 | **High** (MEAN+member-weights reproduces decomposition; ALL is the atomicity reading) | observed requirements that are genuinely partial-credit in nature (then reserve MEAN without member weights) |
| Gates reserved | **High** (consensus conflicts with single-judge invariant; single-judged gate is the worst option) | product policy changes the judging invariant (multiple judges/trials become in scope) — then revisit |
| Floor + marker | **High** (costs quantified and neutralized by disclosure; falsification loops found the residual defects — R_raw sort, Q-first tiebreak — and they are one-line fixes) | team rejects flagged values in the 1–5 contract (then S display-only is the drop-in) |
| δ=0.10 deferred | High | an uncertainty model ships (trials/CI) — then recalibrate with evidence |

**Convergence statement:** the reconciliation (equivalence proof) and all three
post-convergence falsification loops are complete; the design was revised in response to loop
findings where material (floor marker; group scope; gate reservation; λ bound). Remaining
uncertainty is calibration and UX judgment, both flagged with the evidence that would move
them.

---

## Appendix A — Simulation definitions (reproducibility)

Every Monte Carlo / randomized claim in this document is defined below. Scripts were scratch
code in /tmp (not committed); all used Python's `random` with fixed seeds.

### A.1 Common conventions
- A **trial** = one independent draw of noisy Judge evidence for one candidate on one task
  (or one pair on one task for leaderboard scenarios). "n trials" = number of such draws; all
  percentages are empirical frequencies over that many trials.
- **Candidate truth** is FIXED per scenario (graded scores, check values, true gaps are
  authored), unless stated "randomly generated" (uniform Q ∈ [1,5], C ∈ [0,1] for equivalence
  checks; see A.2). Noise is applied to the truth; the winner comparison uses the noisy
  canonicals.
- **Graded Judge error model:** per graded criterion per task, with probability p_g the score
  moves ±1 level (equal chance both directions), clamped to [1,5]; otherwise unchanged.
  p_g = 0.20 unless stated.
- **Binary Judge error model:** per check per task, with probability p_b the boolean flips to
  the wrong value (true→false or false→true); otherwise unchanged. p_b = 0.10 (or 0.05 where
  stated). Checks are judged independently.
- **Winner reversal (leaderboard):** candidates X (true superior by the stated gap) and Y are
  scored under noisy evidence; a reversal is counted when Y's noisy score exceeds X's (mean
  over T tasks for experiments; single-task for Compare). Ties (|Δ| ≤ 1e-9) are not reversals.
  Reported as fraction over n trials.
- **Seeds:** fixed per scenario (e.g., 5, 7, 42, 77, 99, 123); all reported numbers were
  re-run at 2–3 seeds; variation across seeds ≤ 0.5 percentage points for n ≥ 20,000.

### A.2 Equivalence verification (200k samples / 0 mismatches)
- What one "sample" is: a random (Q, C, W_g, W_bin) tuple — Q uniform [1,5], C uniform [0,1],
  W_g uniform [0.5, 10], W_bin uniform [0, 5].
- n = 200,000 draws, seed 5. For each: r = W_bin/W_g, λ = 4r, S = (Q + r(1+4C))/(1+r),
  R_raw = Q − λ(1−C). "Mismatch" = |(1+r)·S − (R_raw + 5r)| > 1e-9. Result: 0 mismatches;
  max residual ≤ 3e-14. **This is a numerical verification of the algebraic proof
  ((1+r)S = Q + r + 4rC = R_raw + 5r), not evidence replacing the proof** — the proof is §3.
- Ordering check: 500 random candidate pairs per profile (fixed W_g, W_bin), 6 profiles;
  mismatch = (S_A > S_B) ≠ (R_A > R_B); result 0/1,875. Exhaustive sweeps: all achievable
  (Q, C) for profiles up to 6g+6b (integer-score means; C = k/n) — agreement 1.0.
- Experiment-level: 200 candidates × 5 tasks, per-task (Q,C) uniform; mean(S) vs mean(R_raw)
  ordering — 0 mismatches.

### A.3 Judge-noise reversal simulations
- **One-check leaderboards (Tables in §16):** profile has n_g graded criteria (all score 4)
  and n_b singleton groups (v=1). X passes all checks; Y fails exactly one (the true
  difference). T tasks (5 or 10); p_g = 0.20, p_b = 0.10 (some runs 0.05). R computed per task
  with clamp; experiment score = mean over T. Reversal = P(mean_Y > mean_X). n = 50,000–300,000
  per cell; seeds 123/77/99. Root's earlier Gaussian-linearized numbers are lower bounds;
  exact MC runs 0–2 percentage points higher (calib re-verification: 2g+8b λ=1 0.295 vs root
  0.276; 6g+1b λ=0.25 0.052 vs 0.027; 6g+6b 0.147 vs 0.112) — directions identical.
- **Equal-check leaderboards:** candidates differ by a true Q gap δ (all checks identical);
  same noise model; reversal = P(lower-Q candidate's mean exceeds).
- **Per-task shift distribution:** single task, one candidate, n = 60,000; |ΔR| = |R(noisy) −
  R(true)|; P(|ΔR| ≥ 0.5) reported.
- **Leverage ratio:** analytic (λ·n_g/n_b for λ-form; 4r·n_g/n_b for parity) — deterministic,
  not simulated.

### A.4 Floor/clamp simulations
- Binding rate: n = 2,000,000 draws of (Q, C); P(Q − λ(1−C) < 1). Distributions: uniform
  [1,5]×[0,1]; "good leaderboard" Q truncated normal (μ=3.7, σ=0.6, clipped [1,5]), C beta
  (6,2); "8%-broken mixture" = 92% good + 8% Q~TN(1.8,0.5), C~Beta(2,5); "low-quality board"
  Q~TN(2.8,0.8), C~Beta(3,2). Seeds 3/11/17.
- Pair ties: random pairs under the mixture/uniform; tie = R values equal with R_raw distinct.
- Multi-winner: 5 candidates drawn from the distribution; ≥2 censored to exactly 1.0 and max
  = 1.0.
- Mean bias: E[clamp(R_raw) − R_raw] over the population.
- Suite reversal: 10-task suites, one model with 3/10 broken tasks; reversal = model ranking
  (by mean of clamped R) differs from ranking by mean of raw R; n = 20,000 suites, seed 42.
- Band mislabels: |R_A − R_B| ≤ 0.10 while |R_raw,A − R_raw,B| > 0.10.
- ALL-group pivotality: per-subcheck fail probability p; P(other 4 subchecks all pass) =
  (1−p)⁴ = 0.657 at p=0.1 — analytic, cross-checked by n=200,000 draws.

### A.5 Decomposition / composition tables (§17–18)
Analytic (exact share arithmetic) — C = Σ v_g c_g/Σ v_g and R = Q − λ(1−C) are deterministic
functions of the boolean vector; no randomness. The 1.67×/5× distortion figures are exact
share computations for the stated group configurations.

### A.6 Falsification-loop numbers
- Falsify-1 (floor/tiebreak): exact algebra on the formula; broken-mixture MC — 8% of
  candidates Q~U[1,2.5], 92% Q~U[2.5,5], C~Beta correlated with Q (mean 0.15+0.75(Q−1)/4);
  n=300,000 suites, seed per run. Findings: 3.77% scores floored; 31.7% of floored pairs
  contradicted by C-first key; 0.48% of 2-task suites flipped by floor boost; 8% of
  coarse-profile pairs ordered anti-quality by C-first.
- Falsify-2 (judge error): numpy MC, n=60k–200k, seed 20240613; p_g=0.15 (±1 level), p_b=0.05
  (0.075/0.10 probed); integer-realizable profiles (w=(1,7) for 0.125 margins). Figures:
  (a) ΔR=1.0, leverage 6.0, P(flip)=0.098/task; (b) one-check margin T=5: 0.205 full /
  0.007 binary-only / 0.227 graded-only; knife-edge 0.46–0.50; 2-check 0.053; (c) ALL 5-subcheck
  false-fail 0.226 vs 0.05 singleton (4.5×), expected R error 0.0283 vs 0.0063, MEAN 0.0063;
  (d) systematic shift 0.125/task, graded systematic 0.5 (4×) in 2g+8b.
- Falsify-3 (authoring): exact formula evaluations for the attack table (decomposition
  invariance, duplication ≡ v=3, dilution, λ tie-engineering λ* = (Q_A−Q_B)/(C_A−C_B),
  singleton soft gate, encoding arbitrage 4×, trivial-check erosion, all-binary checklist).
- The root's 27.6–29.5% (2g+8b one-check, T=5) corresponds to p_g=0.20/p_b=0.10 (Appendix A.3
  parameters); falsify-2's 0.205 to p_g=0.15/p_b=0.05. Both models agree the reversal is
  dominated by graded noise (binary-only 0.7–2% range) and bracketed to margins ≤ 1 check.

### A.7 Parameter-tournament numbers (rec-param)
Per-check costs at defaults are exact algebra (λ·v_g/Σv; 4·W_bin/(W_g+W_bin)·v_g/Σv). The
"hidden gate" exhibits (r=0.5 ⇒ λ=2; α=30% ⇒ λ=1.71; λ=2, Q=2.5, C=0 → R=1.0) are exact
formula evaluations. The 1,547/20,000 ordering mismatches between S and clamped R are from
n=20,000 random fixed-profile pairs, seed 17; 100% had min(R) = 1.0 (floor-only).

---

*Decision record: `scoring-reconciliation-decision.md` supersedes no prior document; it
reconciles `scoring-adversarial-review.md`, `fusion-result.md`, and `holistic-judge-result.md`
into a single product decision. Spec and implementation-plan changes are listed in §31–§32 and
await team review.*
