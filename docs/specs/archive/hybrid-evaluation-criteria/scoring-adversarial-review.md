# Scoring Adversarial Review — Mixing Graded (1–5) and Binary (T/F) Evaluation Criteria

> **Status:** Adversarial design review — recommendation only. No spec/plan/code changes.
> **Branch:** `feat/hybrid-evaluation-criteria`
> **Scope:** How should RSemble combine ordinal 1–5 graded judgments and atomic true/false
> judgments into evaluation evidence and a canonical ranking score?
> **Method:** 8-round recursive adversarial investigation (6 parallel RLM investigator rounds +
> counterexample tournament + synthesis) followed by 3 mandatory post-convergence falsification
> loops against the preferred design. All quantitative claims are reproducible from the scratch
> simulations documented in §5 (scripts in `/tmp`, not committed).

---

## 1. Executive conclusion

**RSemble should NOT keep the pending design's single weighted mean with `false→1 / true→5`
as-is.** That mapping (Architecture A) is algebraically simple and product-familiar, but it is the
most gameable and noise-vulnerable of all candidates examined: decomposing one requirement into
five near-duplicate checks amplifies its ranking influence **3.18×** (unbounded toward 4×); adding
trivially-passable checks inflates scores **toward 5.0** without bound; a single misclassified
check can move a task score by **up to 3.96 points**; and in binary-heavy profiles the entire
graded 1–5 quality range collapses to **0.36 canonical points**.

**The strongest architecture is a dual-channel block blend ("C")**: keep a *graded quality
channel* (weighted mean of graded criteria, exactly today's math) and a *binary compliance
channel* (weighted pass share, shown natively as `Checks 5/6`), each normalized inside its own
block, then blend with one explicit, authored, profile-level **binary block weight** `W_bin`
(default `W_b/4` at first binary authoring — one check flip ≡ one graded level flip — then an
authored constant). The canonical formula `(W_g·G + W_bin·(1+4B)) / (W_g + W_bin)` stays on the 1–5
domain with no clamping, is monotone, reduces **exactly** to today's canonical for pure-graded
profiles, and reduces **exactly** to the pending design A when `W_bin = Σ binary weights` — so C
is a strict generalization of the pending design, not a different species.

C is count-bounded against binary decomposition (5 duplicates: 1.00× vs A's 3.18×), bounds
dilution to a disclosed constant (+0.286 in the tested profile vs unbounded under A), dampens
judge ambiguity 3–4×, preserves graded resolution (≥2.0 pts of the 1–5 span even with 10 binary
checks vs 0.36 under A), and keeps a single disclosed knob the author can reason about. Three
mandatory post-convergence falsification loops refined C into **C-revised**: the block-weight
default is set for parity with graded levels (`W_bin = W_b/4` at first binary authoring, then an
authored constant — fixing an 18%-regime sharp-reversal the constant default caused), the editor
discloses the block's live share and per-check swing, `W_bin=0` renders checks as *excluded*
(never a silent kill), block-absence returns `null` not `NaN`, and `binaryBlockWeight` is added
to the protocol fingerprint. The product-UI loop's strongest challenge — "drop the knob, ship
A-with-fixes" — is preserved as the dissenting case in §20. Its honest costs: one new profile-level field,
a within-block reinterpretation of binary criterion weights, and a small set of systems changes
(persistence guard, fingerprint whitelist, Fusion Study blend math, PASS/FAIL rendering).

**The review's second conclusion: binary criteria should remain scored dimensions — but the
"scored" part is compliance, not quality.** Mapping an atomic pass to anchor-5 ("exceptional
execution") and an atomic fail to anchor-1 ("decisive failure; result unreliable") co-opts graded
anchor semantics the binary channel never earned. C keeps the boolean native, labels the channel
compliance, and makes the category→interval embedding explicit instead of pretending the 4-point
gap is measured.

---

## 2. Problem statement

The pending hybrid-criteria design (spec §9) preserves a canonical 1–5 overall score by mapping
`graded score → itself`, `binary true → 5`, `binary false → 1`, then taking the existing weighted
mean. A single binary flip therefore moves the canonical by `4·w_b/Σw` — a 4-point swing in the
per-unit-weight sense. The concern under review: disproportionate influence, unintuitive weight
semantics, instability under Judge noise, ranking pathologies, and gaming incentives.

The question is not only "which formula" but three nested questions:

1. **Measurement**: what does a weighted mean of ordinal 1–5 judgments and categorical booleans
   claim, and is the claim defensible?
2. **Product**: can a profile author understand the weight semantics and predict ranking effects?
3. **Systems**: do Rank, experiments, persistence, protocol fingerprints, exports, and Fusion
   Study survive the chosen math?

---

## 3. Design invariants

Derived from PRODUCT.md, DECISIONS.md #7/#8, the pending spec, and the live implementation
(`evaluation-profile.ts`, `experiment-aggregation.ts`, `complementarity.ts`,
`protocol-fingerprint.ts`, `studio-data.ts`). Every candidate was scored against these; the
recommendation must not violate any of them.

| # | Invariant | Origin |
|---|---|---|
| I1 | One canonical 1–5 score per candidate; Rank and experiment matrix consume it | PRODUCT.md spine; spec §3.5/§9.1 |
| I2 | Strict structured Judge output; type mismatches rejected, never coerced | DECISIONS #6; spec §10.5 |
| I3 | Native binary evidence preserved as boolean in persistence, UI, exports | spec §3.7, §12, §18 |
| I4 | No automatic hard-gate disqualification in scoring | spec §9.5 (non-goal) |
| I5 | Weighted-mean family semantics: weights are non-negative, zero-weight excluded, missing skipped | live `canonicalScore` |
| I6 | Winner = all models within `WINNER_EPSILON=1e-9` of max; ties share | `evaluation-profile.ts` |
| I7 | Experiment aggregation: equal-task mean, complete-coverage winner eligibility, missing = missing | `experiment-aggregation.ts`; DECISIONS #7 |
| I8 | Monotonicity: improving any criterion never worsens the canonical | product requirement |
| I9 | Historical 1/3/5 runs and profiles load and render unchanged; no rewrite | spec §12 |
| I10 | Verifier outcomes stay separate from Judge binary results (Jaccard/φ from `VerifierOutcome` only) | DECISIONS #8(e); spec §17 |
| I11 | Material score gaps (≥0.5) between materially similar candidates require a same-conclusion comparison | DECISIONS #8 |
| I12 | Protocol fingerprint changes when any semantic criterion content changes | spec §13 |
| I13 | No new arbitrary per-criterion weights or hidden parameters beyond what is disclosed | DECISIONS #7 spirit |

---

## 4. Architectures investigated

Nine candidate architectures (A–I) plus the affine-family insight that unifies them. Notation:
`G = Σ_g w_g·s_g / W_g` (graded weighted mean), `B = Σ_b w_b·v_b / W_b` (weighted binary pass
share), `W_g = Σ_g w_g`, `W_b = Σ_b w_b`, `W = W_g + W_b`.

| ID | Formula / rule | Semantic claim about a binary outcome | Family |
|---|---|---|---|
| **A** (pending) | `Σ (s or 5/1)·w / W` | pass = full credit (5), fail = no credit (1); an atomic check is an extreme-valued graded dimension | affine |
| **B** | `Σ (s or 4/2)·w / W` | pass ≈ 4/5 quality, fail ≈ 2/5 quality; binaries must not touch the extremes | affine |
| **C** (block blend) | `(W_g·G + W_bin·(1+4B)) / (W_g + W_bin)` | compliance is a rate; the binary block's total influence is an explicit authored weight | block |
| **Cα** | `α·G + (1−α)·(1+4B)` | same as C with a fixed blend ratio | block (≡ C reparametrization) |
| **D** | `G` (binaries evidence-only) | binary outcomes are checklist evidence, not quality evidence | none |
| **E** | `clamp(G − 4λ(1−B), 1, 5)` | checks are requirements; failure is a deduction from graded quality | affine (≡ C rank-family) |
| **F** | lexicographic (binary pass count, then G) | checks are binding; no quality points outweigh an unmet check | ordering |
| **G** | hard gate: any false → ineligible / clamped to 1 | some checks are non-negotiable | gate |
| **H** | 0–1 latent: `(s−1)/4`, `0/1`, weighted mean, ×4+1 | both kinds measure one latent satisfaction degree | affine |
| **I** (discovered) | two-point affine family + block normalization family | **any** choice of `(false, true)` endpoints is a policy, not a measurement | meta |

**Two collapse theorems (proven numerically, 2000–50000 random profiles each):**

1. **H ≡ A.** `1 + 4·Σw·h/Σw = Σw·c/Σw` for `h = (s−1)/4` and `c ∈ {s, 5v+1}` — the 0–1 latent
   is A wearing a costume; identical rankings, weights, and lattice.
2. **E_λ ≡ C_{1/(1+λ)}** as an ordering: `G − 4λ(1−B) = (1+λ)·C_{1/(1+λ)} − 5λ`, so "penalty" is a
   relabeling of "blend"; E differs from A only when `λ ≠ W_b/W_g`. **E + lower clamp at λ≥1 is a
   hidden hard gate**, contradicting invariant I4.
3. **Cα ≡ C** with `W_bin = W_g·(1−α)/α` — not a distinct architecture.
4. **C ≡ A** when `W_bin = Σ_b w_b` — C generalizes the pending design exactly.

The eight "architectures" reduce to **five distinct families: A/H, B, C-family (C, Cα, E), D, F**,
plus the orthogonal gate concept G.

---

## 5. Quantitative experiments / simulations

All simulations are simple, auditable Python (scratch in `/tmp`, not committed; assumptions
stated). Architectures implemented exactly as in §4. Monte Carlo uses fixed seeds; analytic
results cross-checked.

### 5.1 Scenario table — one binary flip (false→true), equal weights

| Profile | A | B | C (W_bin=1) | Cα (α=0.7) | E (λ=0.3) | D |
|---|---|---|---|---|---|---|
| 6 graded + 1 binary | **+0.571** | +0.286 | **+0.571** | +1.200 | +1.200 | 0 |
| 2 graded + 8 binary (one flip) | +0.400 | +0.200 | +0.167 | +0.150 | +0.150 | 0 |
| 2 graded + 8 binary (all 8 flip) | **+3.200** | +1.600 | **+1.333** | +1.200 | +1.200 | 0 |
| 1 graded + 1 binary | +2.000 | +1.000 | +2.000 | +2.000 | +1.000 | 0 |
| 1 graded + 10 binary | +0.364 | +0.182 | +0.200 | +0.200 | +0.100 | 0 |
| Worst case (skewed weights) | **≈3.96** | ≈1.99 | bounded by `4·W_bin/(W_g+W_bin)` | ≤1.2 | ≤1.2 | 0 |

**Reading:** A's per-flip swing grows with the binary block's weight share and is unbounded by
authoring (weight 100 on one check → 3.96). C's block swing is bounded by an authored constant;
Cα/E hard-cap at 1.2 but concentrate the whole block influence into each check in few-binary
profiles (P1: Cα/E flip = 1.2 vs A/C 0.571).

### 5.2 Rank-reversal probability under Judge noise (Monte Carlo, 20k–300k reps)

Noise model: per graded criterion, ±1 level with `p_g=0.15` (clamped); per binary check, flip
with `p_b=0.05` (or 0.10). Candidate pair: identical graded evidence, one binary difference.

| Profile, gap | A | B | C | Cα | E | D |
|---|---|---|---|---|---|---|
| 6g+1b, p_b=0.05, T=1 | 0.037 | 0.062 | 0.037 | 0.037 | 0.035 | 0.342 |
| 6g+1b, p_b=0.10, T=1 | 0.073 | 0.098 | 0.074 | 0.072 | 0.074 | 0.345 |
| 2g+8b, true gap 0.05, T=5 | **0.395** | 0.213 | 0.213 | 0.213 | 0.095 | 0 |
| 2g+8b, true gap 0.30, T=5 | 0.035 | 0.000 | 0.000 | 0.001 | 0.000 | 0 |
| 1g+10b, true gap 0.05, T=5 | **0.407** | 0.240 | 0.240 | 0.240 | 0.121 | 0 |
| Close graded leaderboard (0.5 gap, binary equal) | 0.041 | — | 0.041 | 0.053 | 0.054 | — |

**Reading:** (1) **B is worse than A** on binary-different pairs — the narrower mapping halves
the true gap while graded noise stays, so signal-to-noise degrades (0.062 vs 0.037). (2) **D is a
coin flip** on compliance differences (0.34–0.47) — it cannot see the evidence at all. (3) **A's
winner churn on 0.05-gap leaderboards with many binary checks is ~40%** per 5-task experiment;
C/E cut it by 2–4×. (4) Cα fabricates reversals at gaps A cannot touch (P1, δ=0.3, T=5: Cα 0.180
vs A 0.001) because its per-check swing is 2.0.

### 5.3 Noise variance per architecture (single task, 6g+1b, p_g=0.15, p_b=0.05)

| | A | B | C | Cα | E | D |
|---|---|---|---|---|---|---|
| std of canonical | 0.184 | 0.150 | 0.184 | 0.285 | 0.309 | 0.158 |
| P(\|shift\| ≥ 0.5) | 0.037 | 0.004 | 0.038 | 0.051 | 0.062 | 0.011 |

**Reading:** Cα/E are *more* jittery than A/C in typical few-binary profiles (the hard cap
concentrates block influence into few checks); C-block keeps A's noise profile there and bounds it
in binary-heavy profiles. **Calibration:** under A, one binary flip ≡ 4 one-level graded steps
(any profile shape); binary noise dominates graded noise whenever `p_b > p_g/4` (e.g. p_g=0.20 ⇒
p_b > 5%). Conservative null: a same-judge binary error rate ≈ p_g/2 — only B and E/C-family
survive that bar in binary-heavy profiles; C with W_bin≤1 survives in all but single-check
profiles.

### 5.4 Experiment-level compounding (10 tasks, systematic check failure on k tasks)

| k/10 | A (6g+1b) | C (6g+1b) | A (2g+8b) | C (2g+8b) |
|---|---|---|---|---|
| 0 | 4.143 | 4.143 | 4.800 | 4.333 |
| 3 | 3.971 | 3.971 | 3.840 | 3.933 |
| 10 | 3.571 | 3.571 | **1.600** | **3.000** |

**Reading:** with one judge, one pass per task, and no trials (DECISIONS #7), binary errors are
**correlated across tasks** — independent-flip averaging is the wrong null model; the *systematic*
bound is what matters. A's systematic bound approaches 4.0 and is unbounded by authoring; C's is
`4·W_bin/(W_g+W_bin)` (author-tunable); E's is a hard `4λ`.

### 5.5 Fusion Study headroom distortion (one task, complementary binary failures)

A passes check c1/fails c2; B the reverse; graded identical (2g+8b):

| | A | C (W_bin=1) | per-check headroom (both) |
|---|---|---|---|
| H_synth | **+0.400** | +0.000 (block oracle) / +0.167 (per-check oracle) | 4.0 per disagreeing check |

**Reading:** A inflates H_synth — a fusion-encouragement signal — purely from complementary
binary failures (a per-check oracle can "pass" every check by picking either model). C bounds the
binary contribution to the block; per-criterion headroom still surfaces the disagreement (labeled
as pass-rate imbalance, not quality gap).

---

## 6. Adversarial scenarios

### Scenario 1 — One binary vs six graded (equal weights)
A/C: one flip = **0.571** (≈4 graded steps); B: 0.286; Cα/E: 1.200; D: 0. Verdict: a single
binary check among seven is not disproportionate under A/C; Cα/E's 1.2 makes one check worth
~10 graded steps — disproportionate; D erases it.

### Scenario 2 — Two graded vs eight binary
A: binary block swings **3.2** (all 8 flip) and graded 1–5 span collapses to **0.80**; C: block
swing 1.333, graded span 2.67; Cα/E: 1.2/2.0. Verdict: **A lets check count overwhelm quality**;
C-family bounds the block; this is the clearest quantitative strike against A.

### Scenario 3 — Strong model misses one check vs weak model passes all
6 graded + 1 binary: A and C both rank "graded 5 + 1 fail" (4.43) above "graded 4 + pass" (4.14)
and even "graded 3 + pass" (3.29) — a single check does not outrank two full graded levels.
Cα/E: the tie-point is graded 3.8–4.0 (a stronger check penalty). 2 graded + 8 binary: A ties at
graded 3.0 (**a 2-point-per-criterion graded advantage is fully consumed by one failed check**);
C keeps A winning until graded 5. Verdict: A's tradeoff surface is count-driven; C's is
author-driven (W_bin) — the defensible direction.

### Scenario 4 — Judge error (binary vs graded)
See §5.2–5.3. One binary misclassification = 4 graded levels of movement under A/C-block; one
erroneous flip on a 0.05-gap 5-task leaderboard flips the winner **39–41%** of the time under A
(2g+8b, 1g+10b); C cuts this to 21–24%; E to 9–12%. A single binary flip ≥0.5 trips the
same-conclusion comparison rule (I11) under A/C/Cα/E (not B, not D).

### Scenario 5 — Decomposition attack
One semantic requirement as 1 vs 5 near-duplicate checks (6 graded + block):

| | A | B | C | Cα | E | D |
|---|---|---|---|---|---|---|
| 1 check gap | 0.571 | 0.286 | 0.571 | 1.200 | 1.200 | 0 |
| 5-dup gap | **1.818** | 0.909 | **0.571** | 1.200 | 1.200 | 0 |
| amplification | **3.18×** | 3.18× | **1.00×** | 1.00× | 1.00× | — |

Verdict: **A is structurally gameable by decomposition; C-family is invariant** (the weighted
rate is unchanged by splitting). This also kills the "over-binarization" accident: authors who
naturally decompose correctness into many atomic checks do not accidentally multiply binary
influence under C.

### Scenario 6 — Weight equivalence
Under A, "weight 1" on graded = one 1–5 point of influence; "weight 1" on binary = a 4-point
swing — **one binary weight unit is four graded weight units, hard-coded with no evidence**.
Under C, the answer is explicit: graded weights set within-block importance in the graded
channel; binary weights set within-block importance in the compliance channel; `W_bin` sets the
channel's total weight. The UI must state this (see §10).

### Scenario 7 — Critical policy rule
A critical check under A needs a weight of ~5 to cost 2.5 points — but then a judge error on it
moves 2.5 points. Under C the same criticality is expressed by raising `W_bin` (single disclosed
number; W_bin→∞ reproduces a soft gate at 1.0). **Beyond that ceiling, criticality is an
eligibility concept, not a score concept**: the review recommends a separate future
`required` contract (winner-eligibility only, like complete coverage — invariant I4/I7 family),
never score math. G as pure score-gate is rejected (single-judge variance + product policy).

### Scenario 8 — Close leaderboard
A 0.05 true gap with 8–10 binary checks: winner churn **39–41%** (A) vs 21–24% (C) vs 12% (E) at
T=5, p_b=0.05. C does not eliminate churn (nothing can with one judge) but bounds the swing each
noisy check can cause.

### Scenario 9 — Experiment aggregation
Equal-task means unchanged in all affine designs; per-task deltas average under independent
noise but **do not** under correlated (systematic) judge error — the systematic bound table
(§5.4) is the defense: A unbounded toward 4.0, C `4·W_bin/(W_g+W_bin)`, E `4λ`. C's canonical
must flow through `canonicalScoresFromRun` and Fusion `taskOverall` with the *same* blend formula
or the experiment matrix and Fusion Study measure different quantities (§11).

### Scenario 10 — Fusion Study
Binary criteria saturate per-criterion headroom at its 2.0 maximum whenever models disagree
(graded criteria give ~0.11 under realistic noise) — **binary criteria would dominate shortlists
by construction**; and A inflates H_synth from complementary failures (+0.400 in §5.5). Required:
per-criterion headroom on binary checks labeled as pass-rate imbalance; the bimodal diagnostic
excluded for binary criteria; H_select/H_synth computed with the block blend so binary influence
is bounded by W_bin.

---

## 7. Observed ranking pathologies

1. **Graded-span collapse (A/H, B)**: 1 graded + 10 binary maps the entire graded 1–5 quality
   range to **0.36 points** — a garbage answer and an exceptional answer are 0.36 apart.
2. **Count-driven tradeoffs (A/H, B)**: the price of one failed check in graded-equivalent
   points depends on *how many checks the profile has*, not on the check's importance.
3. **Score inflation by dilution (A/H, B)**: always-passing checks push the canonical toward
   5.0/4.0 — "12/12 checks" scores higher than "2/2" with identical substance.
4. **Fabricated fusion signals (A/H)**: complementary binary failures manufacture H_synth
   (+1.000 in the 2-check exhibit) — an author can create "complementary strengths" by
   construction.
5. **Hidden tie-break wins (F)**: 4.199 vs 4.204 both display "4.2"; the binary tie-break
   decides invisibly; exact graded-mean ties (common with integer scores) put the winner 100%
   under binary noise.
6. **Floor plateau (E)**: graded 1.5→2.3 produces zero canonical change when a check fails
   (clamp at 1.0) — graded discrimination silently vanishes for weak candidates; λ≥1 + clamp is
   a hidden hard gate.
7. **Unbounded per-check leverage (A/H)**: weight 100 on one check → 3.96-point single-flip
   swing; a noisy judge flips a winner outright.
8. **Non-identifiable canonicals (C-family, A)**: many evidence vectors map to the same number
   (19 collisions in a 81-vector sweep under C; inherent to any mean) — mitigated by displaying
   both channel means, never the canonical alone.
9. **Anchor-semantic collision (A/H, B)**: PASS renders as 5.0 (="exceptional execution") and
   FAIL as 1.0 (="decisive failure; result unreliable") in the matrix/micro-bars — an atomic
   check is neither.

---

## 8. Judge-noise analysis

- **Leverage**: one binary misclassification ≡ 4 one-level graded disagreements (A, C-block with
  W_bin=1; more under Cα/E). The 4× is structural to any 1–5 embedding of a 2-point outcome.
- **Dominance condition**: binary noise dominates when `p_b > p_g/4` under A (per-criterion).
  With 8–10 binary checks vs 1–2 graded, binary is the variance budget even at `p_b = p_g/4`.
- **The null model is correlation, not independence**: one blind judge, one pass per task, no
  trials/CI (I7/DECISIONS #7) ⇒ per-task binary errors are correlated; a systematic
  misjudgment shifts the experiment mean by the **full per-flip Δ regardless of T**. Only
  systematic bounds matter: A →4.0 (unbounded by authoring), C → `4·W_bin/(W_g+W_bin)`, E → 4λ.
- **Calibration honesty**: well-specified `trueWhen/falseWhen` conditions plausibly reduce
  binary error vs graded level-interpolation, but the claim is untestable in scope (no
  judge-rejudge data; trials out of scope). Conservative design should not *rely* on p_b < 5%.
- **Required mitigations (any architecture)**: disclose the 4-level equivalence; render
  PASS/FAIL natively (never derived 5.0/1.0 cells); exempt binary criteria from
  `detectBimodalScores`; gate Fusion headroom thresholds for binary criteria (one flip = 0.80 at
  T=5, 8–16× the material-headroom epsilons); surface per-criterion pass rates with sample
  counts in Runs/Evaluations.

---

## 9. Criterion decomposition / gaming analysis

Full attack table (Round 5; verified simulator):

| Attack | A/H | B | C (W_bin) | Cα | E | D | F |
|---|---|---|---|---|---|---|---|
| 1. Decompose 1 check → 5 | **broken 3.18×** | broken 3.18× | **invariant** | invariant | invariant | inert | broken |
| 2. Merge 8 → 2 (weight-preserving) | broken 4× | broken 4× | broken 4× (bounded) | broken 4× | broken 4× | inert | broken |
| 3. Always-pass dilution | **→5.0 unbounded** | →4.0 unbounded | **+0.286 bounded** | +0.6 | +0.6 | inert | rewarded |
| 4. Encoding swap graded↔binary | both directions pay | both pay | graded-pull mildly attractive | graded-pull forced | graded-pull forced | **forces wrong encoding** | n/a |
| 5. Extreme weight on one check | **→3.96 unbounded** | →1.99 | bounded per block | capped 1.2 | capped 1.2 | inert | unbounded |
| 6. Zero-weight checks | ok; display gap | ok | ok; display gap | ok | ok | ok | counts if naive |
| 7. Ambiguous trueWhen/falseWhen | **amplifies (+0.144)** | amplifies | **dampens (+0.032)** | dampens | dampens | free noise | amplifies |

**Governance gaps no architecture closes alone** (must be spec rules): the "passed/total"
summary must count only positive-weight, present binary results (a naive count turns 1/2 into
5/8 under zero-weight poisoning); weight-ratio guidance (or a W_bin ceiling) for extreme
criticality; per-criterion Fusion headroom on binary checks labeled as `1+4v` pass-rate
imbalance, never a real 4-point quality gap.

---

## 10. Product and UX implications

Live surfaces audited: `RankResult.tsx` (numeric `score.toFixed(1)/5` cells, tier colors,
`buildWhyItWon` picks the winner's *highest raw* criterion score), `RunDetail.tsx` (no criterion
evidence today), `ExperimentResults.tsx` (numeric matrix), `EvaluationProfileEditor.tsx`
("Weight X · Y%" normalized shares), `export-markdown.ts` + `archive.ts` (two numeric
renderers), `fusion-recipes.ts` (criterion scores fed into the synthesizer prompt).

1. **A is the most familiar but lies by layout**: PASS renders as a green 5.0 identical to a
   graded 5; FAIL as a warning 1.0 identical to a garbage score; `buildWhyItWon` can print
   "Won on Rejects-injection (5.0)" when the real driver was a graded 4 on a heavier weight.
   Every architecture needs PASS/FAIL native rendering (text+icon, never color alone) in all
   four render sites plus the Fuse synthesizer prompt (5.0/1.0 must not leak into the Fuse
   stage as if the Judge said it).
2. **C's new knob is one number with a plain meaning**: "Binary checks weight: 1.0 — the whole
   set of checks counts as much as one weight-1 graded criterion; raise it to make checks matter
   more." This is more principled than Cα's α (a blend percentage with no referent) and than E's
   λ (a penalty rate that must be disclosed in every explanation).
3. **Weight semantics under C**: graded weight = within-graded-block importance (unchanged);
   binary weight = within-check-block importance; W_bin = block weight. The editor must label
   binary weights "importance among checks" and show `Checks block weight: 1.0` separately, or
   authors will read binary weight as absolute (the A semantics).
4. **Explanation surface**: Rank rows show `Overall 4.2 · Graded 4.4 · Checks 5/6` — the two
   channels make the canonical reconstructible from visible evidence plus one disclosed formula.
   A needs the same disclosure ("binary checks count as 5 (pass) / 1 (fail)") but has no second
   number to show.
5. **Zero-weight / missing edge cases**: "Binary checks X/Y" must count only positive-weight,
   present results, matching the canonical denominator; the "(1.0–5.0 scale)" judge header
   should be dropped when a profile contains binary criteria.
6. **Authoring guidance**: the atomicity rule ("one independently judgeable proposition") stays
   advisory but should be surfaced in the editor; over-binarization is harmless under C (no
   amplification), which removes the main reason authors would split dimensions.

---

## 11. Rank / Experiment implications

1. **Rank winner math changes for EVERY architecture** — including D. Today Rank uses the
   Judge's top-level `overallScore` (`pipeline.ts` → `scoresById`), while experiments recompute
   from criterion scores (`canonicalScoresFromRun`). Pending spec §10.4 (criterion vector
   becomes canonical-authoritative) is a behavioral change to Rank winner selection that must be
   called out in the spec and shipped with tests; the same run can currently show different
   scores in Rank vs the experiment matrix.
2. **Aggregation chokepoint**: `canonicalScoresFromRun` must map results via one shared
   `criterionContribution()` (for A) or the block blend (for C); C additionally needs
   `W_bin` from the profile snapshot. `WINNER_EPSILON`, equal-task means, coverage eligibility,
   and missing-is-missing are untouched.
3. **F is not expressible** in the numeric matrix/`winnerKeys` contract without a surrogate
   numeric that defeats its purpose; G requires a third candidate state (gated) that the 1–5
   contract cannot express and changes `complete`/coverage semantics — both rejected at the
   systems level.
4. **Fingerprint**: criterion `kind`/anchors/`trueWhen`/`falseWhen` flow into the hash
   automatically (`semanticFingerprintInput` passes `criteria` wholesale), but **any new
   top-level profile field is invisible** — `W_bin` (and `alpha`/`lambda` for Cα/E) MUST be
   added to the fingerprint whitelist explicitly, or two experiments differing only in block
   weight collide on protocol identity (roster-extension `priorFingerprint` chaining breaks).

---

## 12. Fusion Study implications

1. `modelTaskScoreFromReport` extracts `cs.score` — binary results need the shared contribution
   mapping at extraction (all architectures).
2. **Per-criterion headroom saturates at 2.0 for binary criteria** whenever models disagree
   (graded gives ~0.11 under realistic noise) — in mixed profiles binary criteria dominate the
   shortlist rationale by construction. Label binary headroom as pass-rate imbalance and require
   a minimum sample count before it can drive shortlisting.
3. **H_synth/H_select inflation**: complementary binary failures manufacture +0.400 H_synth
   under A (§5.5) and H_select ~2 for graded-indistinguishable pairs. Under C the binary block
   contributes at most `2·W_bin·(1−B_avg)/(W_g+W_bin)` to H_synth — bounded by the authored
   block weight.
4. **Coherence**: Fusion stages re-derive `taskOverall` as a plain weighted mean. Under C the
   stages must implement the blend (they already receive the profile snapshot), or a recipe can
   beat "best fixed" under study math and lose under the canonical — the study and the matrix
   must measure the same quantity.
5. **Bimodal diagnostic**: `detectBimodalScores` fires on every binary criterion (100% of
   mapped values are 1 or 5) — exclude binary criteria from the diagnostic input.
6. Verifier separation is preserved for every architecture; G must not piggyback on the verifier
   gate machinery, and PASS/FAIL rows in Rank must be labeled Judge evidence, never objective
   checker output.

---

## 13. Backward-compatibility implications

- **Pure-graded legacy profiles**: C reduces to today's formula exactly (`canonical = G`); A,
  B, Cα, E, D also reduce to today when no binary criteria exist. Historical 1/3/5 runs render
  unchanged; no rewrite (I9).
- **Persistence**: `RunRecordV2` stays schemaVersion 2 (additive nested union). C adds one
  profile-level field (`binaryBlockWeight`) that flows automatically into run records,
  experiment snapshots, and suite packages once the type carries it; the suite-package profile
  type and fingerprint whitelist must be extended.
- **Mandatory guard fix (all architectures)**: `isEvaluationCriterion`/`isEvaluationProfile`
  currently require `anchors.one/three/five` — a run whose profile contains any binary criterion
  **fails the persistence guard and is silently dropped from history** unless the guard accepts
  the union first.
- **Rank semantics**: §10.4 canonical-authority is a behavioral change to Rank winner math;
  historical Rank scores recomputed under the new authority can differ from what the Judge
  top-level said — disclose in release notes.

---

## 14. Rejected designs and exact reasons

| Design | Rejected because |
|---|---|
| **A** (pending 5/1) | Count-sensitive (decomposition 3.18×, dilution →5.0, graded span 0.36 in binary-heavy profiles); unbounded per-check leverage (3.96); ambiguity-amplifying (+0.144); H_synth fabrication; weight-1 binary ≡ 4 weight-1 graded with no evidence; anchor-semantic collision (PASS=5.0 "exceptional", FAIL=1.0 "decisive failure"). Acceptable only as a *disclosed convention* for profiles with ≤1–2 binary checks — which is exactly where C reduces to it. |
| **B** (2/4) | Same structural flaws at half amplitude; the (2,4) constants are unprincipled (no anchor justifies 4="strong" for a routine pass; 2="partial success" for an atomic fail contradicts atomicity); *worse* rank-reversal than A on binary-different pairs (0.062 vs 0.037) because the true gap shrinks while noise stays; "5/6 passed → overall 3.8" optics confuse users. |
| **Cα** (alpha blend) | Not a distinct architecture (≡ C with `W_bin = W_g(1−α)/α`); graded compression (span 2.0 at α=0.5; 0.5-graded gaps display as 0.2–0.3); fabricates reversals at gaps A cannot touch (P1 δ=0.3: 0.180 vs 0.001); α is an abstract percentage with no referent. |
| **D** (evidence-only) | Binaries become decision-irrelevant: compliance-different pairs are a coin flip (0.34–0.47 reversal; 6/6 vs 0/6 = shared win); authors re-encode checks as artificial graded criteria — the exact disease the feature exists to cure; "Binary criteria are scored dimensions" (spec goal) is abandoned. Its only legitimate role is the W_bin=0 special case of C. |
| **E** (penalty) | Rank-equivalent to C-family (affine relabeling); floor plateau hides graded differences for weak candidates (12.7% of space at λ=0.25); λ≥1 + clamp = hidden hard gate (violates I4); "Overall = mean minus deductions" contradicts every existing label; penalty magnitude is profile-size-dependent; absolute levels depressed (all-pass gives no credit for compliance). |
| **F** (lexicographic) | Breaks the numeric aggregation contract (I7): equal-task means, `winnerKeys`, and the model-by-task matrix have no lexicographic semantics; one failed nit check outranks a 4.9-graded all-pass candidate; exact-tie domain puts winners 100% under binary noise; hierarchy is an arbitrary weight vector in disguise; duplicate-check farming in the primary key. |
| **G** (hard gate in score) | Contradicts spec §9.5 no-gate and DECISIONS #7 scope; single-judge variance makes one boolean a veto; gated candidates need a third state the 1–5 contract cannot express; eligibility changes (complete ∧ no-fail) touch repair/coverage logic. The *eligibility* half of G is a legitimate future contract (see §15), the *score* half is not. |
| **H** (0–1 latent) | Proven ≡ A (affine round-trip); "normalization" adds vocabulary, not behavior; in 0–1 display it breaks the 1–5 contract, tier thresholds, and exports; invites precision overclaim ("0.82" reads as a percentage). |

---

## 15. Preferred design

**C — block-weighted dual-channel canonical** ("quality + compliance").

- Graded channel `G` keeps today's weighted-mean semantics (invariant I5) — pure-graded
  profiles are bit-identical to today.
- Binary channel is the planned "Binary checks X/Y" summary, made first-class: `B` = weighted
  pass share; `C_bin = 1 + 4B` is its 1–5-domain projection, explicitly labeled *compliance*.
- One authored profile-level **binary block weight** `W_bin` (finite ≥ 0) sets the
  channel's total influence: `canonical = (W_g·G + W_bin·C_bin)/(W_g + W_bin)`.
- **Default `W_bin = W_b/4`**, initialized when the first binary check is authored (one check
  flip ≡ one graded level flip at the margin — the pending spec's own 1:1 weight semantics),
  then an **authored constant**: adding checks later does not grow the block weight
  (count-bounded). `W_bin = Σ_b w_b` reproduces the pending design A exactly (continuity for
  early adopters); `W_bin = 0` gives evidence-only mode (D), rendered as *checks excluded*;
  large `W_bin` on a single check approaches a soft gate — criticality is expressed by this one
  number (with editor disclosure of the per-check swing), and *non-negotiable* requirements
  belong to a **separate future `required` eligibility contract** (winner-eligibility like
  complete coverage; never score math; explicitly out of this feature's scope per I4).
- **Edge semantics**: block-absence returns `null` (never `NaN`); validation rejects
  binary-only profiles with `W_bin=0`; B and the "Checks X/Y" summary count positive-weight,
  present results only; missing results renormalize per present-only (today's skip semantics);
  ties break deterministically (higher C_bin, then higher G, then roster order).
- Judge contract unchanged — `W_bin` is post-processing; the Judge still returns booleans and
  integers, still blind.
- Display everywhere: `Overall 4.2 · Graded 4.4 · Checks 5/6`, with PASS/FAIL native
  rendering, never derived 5.0/1.0 cells.

---

## 16. Mathematical definition of the preferred design

```
Inputs:
  graded criteria g ∈ G:  score s_g ∈ {1..5}, weight w_g ≥ 0
  binary criteria b ∈ B:  value v_b ∈ {0,1}, weight w_b ≥ 0   (within-block importance)
  binary block weight:    W_bin ≥ 0 (profile-level, default W_b/4 at first binary authoring,
                          then an authored constant; W_b = Σ_b w_b)

Present results only (missing skipped per invariant I5; zero-weight excluded):

  W_g  = Σ_g w_g                          (present graded weight)
  W_b  = Σ_b w_b                          (present binary weight)
  G    = Σ_g w_g·s_g / W_g                (graded quality; undefined if W_g = 0)
  B    = Σ_b w_b·v_b / W_b                (binary compliance rate; undefined if W_b = 0)
  C_bin = 1 + 4·B                         (compliance on the 1–5 domain)

Canonical (block-absence semantics; never NaN):
  if W_g > 0 and W_b > 0:  (W_g·G + W_bin·C_bin) / (W_g + W_bin)
  if W_g = 0:              C_bin          (binary-only profile; W_bin must be > 0 — validation)
  if W_b = 0:              G              (graded-only profile — exactly today's formula)
  if W_b > 0 and W_bin = 0: G             (evidence-only mode; UI renders "checks excluded")
  if both blocks absent / no positive weights: null (invalid profile)

Properties (all verified numerically):
  - Domain: canonical ∈ [1,5] continuously, no clamping, no hidden nonlinearity.
  - Monotone: increasing any s_g or flipping any v_b 0→1 never decreases the canonical.
  - Count-bounded: splitting any binary check into k equal-weight near-duplicates leaves B
    unchanged at fixed W_bin (single-flip cost 1.00× vs A's 3.18× amplification); inconsistent
    judge marking of duplicates still costs a bounded amount (not literally invariant).
  - Dilution-bounded: adding always-passing checks moves the canonical by at most
    4·W_bin·(1−B₀)/(W_g+W_bin) (vs unbounded toward 5.0 under A).
  - Graded span preserved: with binary state fixed, graded 1→5 moves the canonical by
    4·W_g/(W_g+W_bin) ≥ 2.0 whenever W_bin ≤ W_g (vs 0.36 under A for 1g+10b).
  - Systematic binary bound: if every binary check is misjudged, the canonical shifts by at
    most 4·W_bin/(W_g+W_bin).
  - Generalization: W_bin = W_b ⇒ canonical ≡ A (the pending design); W_bin = 0 ⇒ D.
  - Profile-size behavior: adding *graded* criteria dilutes the binary block's share (W_g
    grows) — the same, pre-existing property of today's weighted mean; documented, not new.
```

---

## 17. Worked examples

*(The examples use `W_bin = 1` (or 2) because those are the A-continuity settings that make
arithmetic easy to compare. The parity default is `W_bin = W_b/4` — see §16 — which gives a
single check among six graded (w=1 each) a flip of `4·0.25/6.25 = 0.16`, exactly one graded
level. Authors raise W_bin when checks should count for more.)*

**17.1 The pending spec's own fixture** — graded 4 (w=2); binary true (w=1); binary false (w=1):

| | A (pending) | C (W_bin=1) | C (W_bin=2 = Σw_b ⇒ A) |
|---|---|---|---|
| canonical | (8+5+1)/4 = **3.5** | (2·4 + 1·3)/3 = **3.667** | (8+2·3)/4 = **3.5** |

The author who wants the pending semantics exactly sets W_bin = 2. W_bin=1 treats
the *whole check block* as one unit — the two checks together count as much as one weight-1
criterion.

**17.2 Six graded @4 + one check** (w=1 each): pass → C = (24+5)/7 = **4.143**; fail → (24+1)/7 =
**3.571**. One flip = 0.571 (identical to A — single-check blocks are the continuity point).

**17.3 Two graded + eight checks** (all w=1): all pass → (8+5)/3 = **4.333**; all fail →
(8+1)/3 = **3.000**. Block swing 1.333 (A: 3.2). Graded 5→1 moves C by 4·2/3 = 2.67 (A: 0.80).

**17.4 Decomposition** — one requirement as 1 vs 5 checks (6 graded @4): C: 0.571 gap in both
(A: 0.571 → 1.818).

**17.5 Rank explainability** — "Overall 4.2 · Graded 4.4 · Checks 5/6": the reader sees the
two channels; canonical = (W_g·4.4 + W_bin·(1+4·5/6))/(W_g+W_bin) reconstructible from the
displayed numbers plus the disclosed W_bin.

---

## 18. Post-convergence falsification results

## 18. Post-convergence falsification results

Three independent adversarial loops attacked the preferred design after convergence. Each
loop was instructed to destroy it; revisions below are mandatory adoptions.

### 18.1 Loop 1 — Pathological profiles & weights (verdict: **C survives with 2 material failures, both fixed locally**)

Findings: (CE1) **NaN crash**: pure-binary profile with `W_bin=0` yields `0/0` → `NaN` canonical
→ empty winner set (today's code returns `null`, so C must not regress); (CE2) zero-weight
binary criteria are fine under the positive-weights rule but the "Checks X/Y" display must count
only positive-weight, present results; (CE3) extreme `W_bin` restores A's pathologies — authored
intent, but needs a soft guardrail; (CE4) single-check and all-binary profiles behave sanely
(single-check swing equals what graded authoring can do today; `W_bin` is a dead knob on
pure-binary profiles — document); (CE5) **composition-dependent default**: absolute `W_bin=1.0`
gives a 3–50% check share depending on `W_g` — the strongest non-crash finding, fixed by
rendering the block's live share (like today's % column) and by the parity default (18.2 R1);
(CE6) missing-result renormalization must be pinned (present-only, mirroring today); (CE7) zero
Pareto violations in 2,160 vectors — monotonicity holds; equal-canonical collisions exist
(~0.05% of pairs, all between incomparable vectors) and need a deterministic tiebreak;
(CE8) "count-invariant" must be softened to **count-bounded** (inconsistent judge marking of
duplicates still costs 0.40 under C vs 0.667 under A — bounded, not zero).

### 18.2 Loop 2 — Judge-error scenarios (verdict: **C survives narrowly with R1–R4**)

- **R1 (material)** — sharp one-check leaderboard in binary-heavy profiles: at default
  `W_bin=1`, 2 graded + 8 binary, one-check true gap, T=5, p_g=0.20, p_b=0.10, the failing
  candidate wins **14.6%** of the time (independent re-verification by the root agent; the loop
  reported 18%) vs **4.1%** under A — the default under-weights checks relative to graded noise
  (one check = 1/8 of a graded level). Fix: **parity default** — `W_bin = W_b/4` initialized at
  first binary authoring (one check flip ≡ one graded level flip at the margin; verification:
  reversal drops to ~6%, and `W_bin = W_b/2` → ~4.4%, parity with A). The default is an *initial
  value of the authored constant*: once authored, adding checks does not grow `W_bin`, so
  count-boundedness is preserved (a *live-tracking* default would re-open decomposition, 4.3×).
- **R2 (material)** — `W_bin` is a silent noise dial: raising it for criticality re-imports A's
  worst case (Δ→3.77 at W_bin=100, 6g+1b) and crosses the ≥0.5 materiality line at W_bin=2 in
  the spec profile. Fix: editor discloses per-criterion Δ ("one misread of this check moves the
  score ±X") and a documented cap guidance (`W_bin ≤ W_g` keeps a single-check flip ≤ 2.0;
  `W_bin ≤ W_g/3` keeps it ≤ 1.0).
- **R3 (optional)** — a forced T/F on genuinely in-between evidence is a ~50% coin flip; an
  optional third outcome ("indeterminate", counting 0.5 in B) halves the damage. Listed as an
  open question because it changes the strict boolean contract (I2).
- **R4** — the ≥0.5 same-conclusion comparison (I11) fires on every binary flip in
  single-check profiles at default settings; trigger it on the *graded-only* gap instead (gaps
  fully explained by visible PASS/FAIL need no judge-authored comparison).
- Systematic misjudgment: C's experiment-mean shift ≤ A in every profile shape (ties A at one
  check; 0.42–0.57× when W_b > 1); common-mode errors cancel for any additive mapping; C's
  absolute-scale distortion is 2.4× smaller than A's. No failure.

### 18.3 Loop 3 — Product UX / authoring (verdict: **material failures; C survives only in revised form**)

The strongest loop. Findings: (S1) "binary block weight 1.0" is meaningless without formula
disclosure; (S2) one weight field with two denominators — `Weight 1.0 · 17%` on a binary row
means share-of-block (true overall share 3.3%), the editor lies by formatting; (S3)
"Overall 4.4 · Quality 4.4 · Checks 5/6" shows a count the score barely moved (0.01), and
"Quality" misnames non-quality graded profiles; (S4) W_bin=0 silently kills checks while
"Checks 5/6" still displays, and W_bin=100 makes one check decide the rank — a de facto gate;
(S5) migration: if A shipped first, C's default would re-score history and flip suite winners,
and the fingerprint is blind to W_bin; (S6) A-with-fixes delivers every stated goal with zero
new concepts. **Loop verdict: drop W_bin; adopt A-with-fixes.**

**Reconciliation.** S5's migration objection is moot if C ships from day one (no binary-profile
history exists — the feature is unimplemented); the identity `W_bin = Σw_b ≡ A` is documented
for any future conversion. S1/S2/S3/S4 are fixed by the editor/display revisions below. The
remaining substance of S6 — "nobody asked for the knob" — is weighed in §20 (dissenting case);
the counter is that the product's own plan (Phase 10: "task-specific binary checks") creates the
binary-heavy profiles where A's graded-span collapse (0.36–0.80), 40% winner churn, dilution
inflation, and H_synth fabrication are emergent product behaviors, not exotic attacks.

**Adopted revision set (C-revised):**
1. Parity default `W_bin = W_b/4` at first binary authoring; authored constant thereafter.
2. Block-absence semantics: `null` never `NaN`; validation rejects binary-only profiles with
   `W_bin=0`; `W_bin=0` renders checks as **excluded**, not as a live count.
3. Editor: per-kind weight labels ("importance among checks" vs "share of Overall"), a block
   row with live share ("Checks block 2.0 · 25% of Overall"), per-check Δ disclosure, dominance
   warning when `W_bin > W_g`.
4. Display: "Graded X.X · Checks a/b" labels (not "Quality"); PASS/FAIL native everywhere
   (RankResult, RunDetail, both markdown exporters, Fuse synthesizer prompt); `buildWhyItWon`
   uses score×weight contributions and never quotes a PASS as "(5.0)"; same-conclusion
   comparison triggers on graded-only gaps (R4).
5. Fingerprint whitelist: `binaryBlockWeight` added to `semanticFingerprintInput` + tests.
6. Positive-weights rule for B; "Checks X/Y" counts positive-weight present results; present-only
   renormalization on missing results; deterministic tiebreak (higher C_bin, then higher G, then
   roster order).
7. Wording: "count-bounded" (not "count-invariant"); `W_bin=Σw_b ≡ A` identity and
   `W_bin=0 ≡ D` documented; W_bin dead-knob on pure-binary profiles documented.
8. Future `required` eligibility contract boundary documented (never score math).

Post-convergence falsification was completed in all three loops; the design was revised twice
(parity default; editor/display fixes) and re-checked numerically. The loops did not find any
scenario where a revised-C ranking is both plausible and indefensible under the stated defaults.


## 19. Known weaknesses of the preferred design

1. **One more knob**: W_bin is a new profile-level field; it can be set badly (0 by mistake
   silently disables checks; huge values recreate A's leverage). Mitigation: editor validation
   hints (W_bin=0 is "evidence-only"; W_bin > W_g shows a "checks dominate" warning), defaults
   (1.0), and disclosure in every explanation surface.
2. **Inverse decomposition (merging) is bounded, not dead**: merging 8 checks into 2 with
   preserved weights quadruples per-check influence under C (block total stays bounded, but the
   distribution within the block shifts). Mitigation: within-block weights are visible;
   governance guidance caps per-check weight ratios; the block ceiling bounds the damage.
3. **Single-check profiles still swing ≥0.5** (W_bin=1, W_g=6: 0.571) — one noisy check still
   trips the same-conclusion comparison rule (I11). No scored architecture avoids this without
   either W_bin < W_g/7 or dropping binary from the score (D); it is the disclosed price of
   "checks matter".
4. **Non-identifiability**: many evidence vectors map to one canonical (inherent to any mean);
   C needs the two-channel display to stay auditable.
5. **Always-pass dilution drift is bounded but nonzero** (+0.286 in the tested profile): adding
   passable checks nudges B toward 1.0. Mitigation: audit (checks visible), and the summary
   shows X/Y so dilution is evident.
6. **Graded-decomposition remains possible** (splitting one graded dimension into several
   graded criteria grows W_g and its share) — a pre-existing property of today's product, not
   introduced by C; documented, not fixed.
7. **Two semantics per weight field**: binary weights mean within-block importance; the editor
   must label them or authors will apply A semantics (falsify-3 S2 — material without the
   relabeling).
8. **Sharp one-check leaderboards in binary-heavy profiles**: at the parity default the
   failing candidate still wins ~6% of the time at T=5, p_g=0.20, p_b=0.10 (vs A's ~4%) — the
   price of bounded per-check influence; authors who need more check salience raise W_bin
   (disclosed Δ).
9. **W_bin is a noise dial as well as a criticality dial**: raising it for legitimate
   criticality raises misread exposure 1.7–2× per doubling near the materiality line; the
   editor disclosure and cap guidance (W_bin ≤ W_g) are load-bearing, not decorative.
10. **Migration hazard**: if A-style profiles (binary weights = absolute) ever ship before C,
    the parity default re-scores them (4.20 → 4.07 in the loop's exhibit); ship C from day one,
    document `W_bin = Σw_b ≡ A` for conversion, and whitelist W_bin in the fingerprint so any
    future change is detectable.
11. **Composition-dependent share**: the block's share of Overall moves with W_g (3–50% across
    profiles) — exactly like today's per-criterion shares; the editor must show the live share
    or authors read it as drift.

## 20. Dissenting case — strongest argument against the recommendation

**"A-with-fixes beats C for this product" (post-convergence falsification loop 3's verdict).**
RSemble is a local, single-user, evidence-first tool (PRODUCT.md), not a public benchmark: the
gaming attacks (§9) require an *adversarial author* — in practice the risk is accidental
over-binarization, which A exposes through the same mechanism but which profile guidance can
mitigate. A adds **zero** new concepts: weight means exactly what it means today on every
criterion; the canonical is a weighted mean of visible per-criterion values, explainable in one
sentence; the entire systems surface (persistence, aggregation, Fusion, fingerprint) needs the
smallest possible change; the "binary summary" already planned makes the 5/1 mapping legible;
and there is no migration, no editor relabeling, no per-check Δ disclosure, and no dominance
warnings to ship. C's W_bin is a new concept that must be explained, persisted, fingerprinted,
and threaded into Fusion math — and any author who wants A's behavior must understand the
`W_bin = Σw_b` identity to reproduce it. The loop's exhibits are concrete: `Weight 1.0 · 17%`
on a binary row under C means 3.3% of Overall, not 17% (S2); `Overall 4.4 · Quality 4.4 ·
Checks 5/6` shows a count the score barely moved (S3); one keystroke (W_bin=0) silently kills
the checks dimension while "Checks 5/6" still displays (S4); and if A profiles ever ship first,
C's default re-scores history and can flip suite winners (S5). For a product whose
differentiator is auditability and whose threat model is honest-but-sloppy authors, the simpler
design's predictability may outweigh the robustness C buys. **Counter:** the noise numbers
(§5.2–5.4) show the *accidental* cases — a profile with 10 atomic checks and 1 graded criterion
— are exactly where A breaks (graded span 0.36; ~40% winner churn; dilution toward 5.0), and
those profiles are natural, not adversarial: the product's own plan (Phase 10) mandates
"task-specific binary checks" in the Frontier suite. The team must judge whether "explain in one
sentence" or "survive a natural binary-heavy profile" matters more. **If the team chooses
A-with-fixes**, adopt: PASS/FAIL rendering everywhere, contribution-weighted `buildWhyItWon`,
the disclosed 5/1 mapping at the three decision points, a derived "Checks as a group: X of Y
weight units" summary, and a documented count-sensitivity caveat — and revisit the block design
if binary-heavy profiles emerge.

## 21. Open questions

1. **Default `W_bin`**: parity (`W_b/4` at first binary authoring — recommended, honors the
   pending spec's 1:1 weight semantics and fixes the sharp-reversal regime) vs absolute 1.0
   (maximal count-boundedness, but checks under-weighted in binary-heavy profiles) vs `Σw_b`
   (exact A reproduction — count-sensitivity returns). Team decision; the recommendation is
   parity-with-fixed-constant.
2. Per-check binary weights: keep with within-block semantics (recommended), or drop (all
   checks equal in B, one less attack surface)?
3. The future `required` eligibility contract: plan the flag now (winner-eligibility only,
   like coverage) or defer? Recommended: defer the *flag*, document the boundary in the spec so
   scoring never absorbs gates.
4. `W_bin=0` evidence-only mode: expose in the editor (with the "checks excluded" marker) or
   keep internal?
5. R3's optional third binary outcome ("indeterminate", 0.5 in B): adopt (halves forced
   coin-flip damage) or keep the strict boolean contract (I2)? Recommended: keep boolean-only
   in v1; revisit if boundary misjudgments are observed.
6. Fusion Study per-criterion headroom on binary checks: minimum sample count and labeling
   requirements — product decision.
7. Rank canonical-authority change (§10.4): ship in this feature or a separate plan?

## 22. Confidence level and what evidence would change the recommendation

**Confidence: high** that A-as-pending is gameable and noise-vulnerable in binary-heavy
profiles (all quantitative, reproduced by three independent investigators), **high** that
C-family fixes the identified pathologies while generalizing A, and **high** that the
falsification loops' revisions (parity default, block-absence semantics, editor disclosure,
fingerprint whitelist) remove every material failure found. **Medium** on the product-UI claim
that W_bin is explainable to authors (needs a user test), and **medium** on the parity default
(an author-preference judgment between parity and count-boundedness). **Medium** on the product-UI
claim that W_bin is explainable to authors (needs a user test), and **medium** on whether
single-check binary profiles should keep a ≥0.5 swing (product judgment). Evidence that would
change the recommendation: (1) judge-rejudge agreement data showing p_b ≈ 0 for well-specified
checks (would rehabilitate A's noise profile); (2) observed author behavior showing profiles
rarely exceed ~2 binary checks (would make A's count-sensitivity mostly theoretical); (3) a
user study showing W_bin confuses authors more than A's 5/1 disclosure (would favor A-with-
fixes).

## 23. Specific changes required in the existing spec and implementation plan

If the team adopts C, the pending spec/plan need these changes (this review does not make them):

1. **Spec §9 (canonical scoring)**: replace the single weighted mean with the block blend;
   define G, B, C_bin, W_bin (parity default W_b/4 at first binary authoring, authored constant
   thereafter), block-absence semantics (null, never NaN), missing/zero-weight rules
   (positive-weights only; present-only renormalization), deterministic tiebreak (C_bin, then
   G, then roster); add the `W_bin = Σw_b ⇒ A` continuity note and the `W_bin = 0 ⇒
   evidence-only (checks excluded)` mode.
2. **Spec §5 (domain model)**: add `binaryBlockWeight: number` to the profile (or a profile
   settings object); redefine binary criterion `weight` as within-block importance; validation
   rules for W_bin (finite, ≥0, parity default W_b/4 at first binary authoring).
3. **Spec §13 / plan Phase 6.3 (fingerprint)**: whitelist `binaryBlockWeight` in
   `semanticFingerprintInput` (currently confirmed absent — two profiles differing only in
   W_bin would collide); add regression tests.
4. **Spec §16 / plan Phase 8.1 (experiments)**: `canonicalScoresFromRun` maps results via the
   blend (needs W_bin from snapshot); fixtures for mixed profiles; equal-task math unchanged.
5. **Spec §17 / plan Phase 8.2 (Fusion Study)**: `taskOverall`/headroom must implement the
   blend; per-criterion headroom on binary checks labeled pass-rate imbalance with a minimum
   sample gate; exclude binary criteria from `detectBimodalScores`; H_synth bounded by W_bin.
6. **Spec §15 / plan Phase 7 (UI)**: PASS/FAIL native rendering in RankResult, RunDetail, both
   markdown exporters, and the Fuse synthesizer prompt (`fusion-recipes.ts`); `buildWhyItWon`
   must weight contributions (score×weight) and never quote a binary PASS as "(5.0)"; editor
   shows "Checks block weight" + within-block weight labeling + live block share + per-check Δ
   disclosure + W_bin=0 "checks excluded" marker + dominance warning (W_bin > W_g); labels
   "Graded X.X · Checks a/b" (not "Quality"); "Binary checks X/Y" counts positive-weight
   present results only; same-conclusion comparisons trigger on graded-only gaps (R4).
7. **Plan Phase 6.1 (persistence)**: extend `isEvaluationCriterion`/`isEvaluationProfile` to
   the union FIRST (else binary-profile runs are dropped by the history guard); add
   `binaryBlockWeight` to suite-package profile types; RunRecordV2 stays schemaVersion 2.
8. **Spec §9.4/§18 (summary/export)**: "Binary checks X/Y" defined over positive-weight present
   results; export shows PASS/FAIL plus the two channel means.
9. **Plan Phase 10 (docs)**: PRODUCT.md gains the two-channel scoring sentence and the W_bin
   disclosure; DECISIONS.md entry records the block-blend decision and the `required`-flag
   boundary (score vs eligibility).
10. **Plan Phase 4.2**: single shared `criterionContribution`/`canonicalScore` helper covering
    both channels (one formula, used by aggregation, Fusion, and exports).
