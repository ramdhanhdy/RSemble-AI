# Fused Architecture: Three-Type Criteria, Dual Channels, Capped-Penalty Rank Score

## 1. Final recommendation

RSemble should adopt a **three-type criterion model with dual-channel aggregation and one derived, bounded Rank Score**:

1. **Graded criteria** (anchored 1–5) aggregate into a **Quality Score** $Q$ on the native 1–5 scale. Nothing else ever enters this number.
2. **Ordinary binary checks** live inside **Requirement Groups** (a first-class authoring primitive, default singleton). Groups aggregate into a **Compliance Score** $C \in [0,1]$, displayed as a percentage.
3. **Hard gates** are unweighted, non-negotiable eligibility conditions evaluated before any scoring. Failure makes a candidate ineligible to win, full stop.
4. A single **derived Rank Score** $R = \operatorname{clamp}\big(Q - \lambda(1 - C),\ 1,\ 5\big)$, with $\lambda \in [0,1]$ defaulting to $1.0$, provides the deterministic leaderboard scalar. It is always displayed next to its components and never replaces them.

The core commitments: binary evidence is never disguised as graded evidence; the *only* exchange rate between the two channels is one explicit, visible, capped policy parameter; total binary influence is **composition-invariant** (no amount of criterion-splitting can push it past $\lambda$); and mandatory requirements are a separate semantic type, not a big weight.

## 2. What was fused

**The four competing architectures, reconstructed:**

|       | Core mechanism                                               | Binary role                                     | Fatal/decisive flaw                                                                                                                                                                                                                |
| ----- | ------------------------------------------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | Dual channel + ε-tieband + AND-clusters + optional composite | Tiebreak within ε band                          | ε-comparator is non-transitive and discontinuous; composite contradicts its own anti-conversion principle; heavy parameter surface                                                                                                 |
| **B** | Quadratic penalty $G - D^2(G-1)W\_{b\_norm}$                 | Numeric penalty via pooled cross-channel weight | Decomposition inflates $W\_{b\_norm}$ (1 check → 0.167, 5 identical checks → 0.5); penalty scales with $(G-1)$ without justification; pools $w\_b$ and $w\_g$ in one denominator, contradicting its own channel-local weight claim |
| **C** | Dual channel + capped penalty $R = Q - \lambda(1-C)$ + gates | Bounded penalty                                 | $\lambda$ is an arbitrary exchange rate; singleton binary swings a full point; grouping treated as an afterthought                                                                                                                 |
| **D** | Dual channel, pure lexicographic $H \to Q \to S$             | Tiebreak at $10^{-6}$                           | Ordinary checks are nearly powerless; no semantic middle category between gate and decoration                                                                                                                                      |

**Taken from C (the backbone):** the three-way semantic split (quality / compliance / eligibility), the capped-penalty bridge $R = Q - \lambda(1-C)$, deterministic monotonic ranking, empty-channel handling, multi-task rules, and the error-parity analysis (one binary error ≈ one one-anchor graded error at equal weights).

**From A:** requirement grouping — promoted from C's tentative "eventually support" to a **first-class, default authoring primitive** with ALL/MEAN modes (the Judge correctly flagged this as the best idea outside the winner); gate governance (elevated/consensus judging, anti-overuse nudges); channel-independent experiment aggregation; and the pivotality insight (an erroneous bit matters only when it's the sole determinant of a group's status).

**From D:** the presentation model (three visible numbers, one derived rank scalar); the "gates are eligibility, not tradeoff" framing; and the insistence on a deterministic ordering rather than fuzzy comparators.

**From B:** only the discipline of quantitative sensitivity analysis ("one erroneous bit changes the leaderboard by at most X"). The formula itself is rejected wholesale — the Judge's fatal-flaw analysis is correct and I endorse it independently.

**Rejected despite model support or Judge sympathy:**
- **A's ε-tieband and composite** — the ε-relation is non-transitive (A≈B, B≈C, A≉C) and discontinuous at the band edge; no bucketing patch is worth the complexity. The composite reintroduces the exact categorical-to-quality exchange rate A argues against.
- **A/D's "no canonical scalar" stance** — this was a 2–2 split (C/B yes, A/D no), not consensus. I side with C deliberately: leaderboards, model selection, and experiment aggregation need a deterministic scalar. Honesty is preserved not by refusing the scalar but by making it *derived, labeled, bounded, and displayed alongside its components*.
- **B's entire mechanism** (quadratic penalty, pooled weight normalization) — see §15.

## 3. Criterion model

Three criterion types, one container type:

| Type | Result | Weight | Semantics |
|---|---|---|---|
| `GradedCriterion` | $s_i \in \{1,2,3,4,5\}$ | $w_i > 0$ (default 1) | Anchored degree-of-quality judgment |
| `BinaryCheck` | $b_k \in \{0,1\}$ | none (weight lives on its group) | Atomic pass/fail observation, desirable but not disqualifying |
| `HardGate` | $h_k \in \{0,1\}$ | none (ever) | Non-negotiable eligibility condition |
| `RequirementGroup` (container) | $c_g \in [0,1]$ derived | $v_g > 0$ (default 1) | One semantic requirement; holds ≥1 `BinaryCheck`; mode `ALL` (default) or `MEAN` |

Rules: every `BinaryCheck` belongs to exactly one `RequirementGroup` (an ungrouped check is a singleton group). Groups contain ordinary binaries only — never gates. `MEAN` mode supports optional member weights $u_k$ (default 1). A binary check is elevated to `HardGate` only by explicit authoring action, never by weight-tuning.

**Persisted per-run evidence** (immutable, criterion-level, native):

```text
GradedResult(criterion_id, score∈1..5, rationale, judge_meta)
BinaryResult(check_id, bool, rationale, judge_meta, replication_votes?)
GateResult(gate_id, bool, rationale, replication_votes, adjudication)
```

## 4. Scoring and ranking algorithm

**Channel aggregation (per candidate, per task):**

$$Q = \frac{\sum_i w_i\, s_i}{\sum_i w_i} \quad \text{(undefined if no graded criteria)}$$

Group satisfaction, mode-dependent:

$$c_g = \min_{k \in g} b_k \;\; \text{[ALL]} \qquad\qquad c_g = \frac{\sum_{k \in g} u_k\, b_k}{\sum_{k \in g} u_k} \;\; \text{[MEAN]}$$

$$C = \frac{\sum_g v_g\, c_g}{\sum_g v_g} \quad \text{(if no groups exist, } C := 1 \text{ and the channel displays "—")}$$

**Eligibility:**

$$M = \bigwedge_k h_k \quad \text{(empty gate set} \Rightarrow \text{PASS)}$$

**Derived Rank Score** ($\lambda$ is a profile parameter, $\lambda \in [0,1]$, default $1.0$):

$$R = \operatorname{clamp}\big(Q - \lambda(1 - C),\ 1,\ 5\big) \quad \text{when } M = \text{PASS}$$

If $M = \text{FAIL}$: status `HARD_GATE_FAILED`; $Q$ and $C$ are still computed and displayed as diagnostics; a legacy numeric mapping $R := 1$ (flagged as a status code, not a quality judgment) is available only for single-scalar consumers.

**Ranking (single task), deterministic sort key, descending except id:**

```text
1. M          (PASS above FAIL)
2. R          desc
3. C          desc   (tiebreak)
4. Q          desc   (tiebreak)
5. candidate_id asc  (stable tiebreak; otherwise a true tie)
```

**Closeness band:** if $|R_A - R_B| \le \delta$ (profile parameter, default $\delta = 0.10$), the UI badges the pair "too close to call." The band is **display-only and never reorders** — this captures A's legitimate "practical tie" intuition without its non-transitive comparator.

**Absent channels:**
- *No graded criteria* → compliance profile. No $Q$, no $R$. Ranking key: $(M \text{ desc},\ C \text{ desc},\ \text{id})$. Exports $C$ as a labeled 0–100 compliance score — never dressed up as a 1–5 number.
- *No binary checks* → $C := 1$, so $R = Q$. Bit-for-bit compatible with pre-binary behavior.
- *No gates* → everyone passes.

## 5. Weight semantics

Weights are **channel-local**; no formula ever sums graded and binary weights in one denominator (the explicit anti-B rule).

- **Graded weight $w_i$:** share of the quality channel. A one-anchor change on criterion $i$ moves $Q$ by exactly $\dfrac{w_i}{\sum_j w_j}$. All graded criteria share units (authored anchors at every point), so the arithmetic mean is semantically licensed *within this channel only*.
- **Group weight $v_g$:** share of the compliance channel. Flipping group $g$ from unsatisfied to satisfied moves $C$ by $\dfrac{v_g}{\sum_h v_h}$ and moves $R$ by $\lambda \cdot \dfrac{v_g}{\sum_h v_h}$.
- **Gate:** weight N/A. Eligibility is not a tradeoff quantity.
- **$\lambda$:** the *only* cross-channel quantity in the system, and it is a visible policy dial, not a hidden encoding: "all ordinary binary failures together may cost at most $\lambda$ quality points." Default 1.0 = one anchor level — the largest interpretable unit on the graded scale.

**"Why did Model A outrank Model B?"** always has a one-sentence answer: *"A passed the same gates and scored higher on $R$, because its quality advantage was $X$ and its compliance disadvantage cost it $Y \le \lambda$."*

## 6. Binary semantics

A `true`/`false` result is a categorical fact, persisted and displayed as a boolean with its rationale forever. Binaries influence evaluation through exactly two sanctioned paths:

1. **Ordinary checks →** group satisfaction → $C$ → a penalty on $R$ bounded in total by $\lambda$. Never into $Q$.
2. **Hard gates →** the eligibility stratum $M$.

There is no third path, and no numeric encoding of a boolean onto the 1–5 scale anywhere in the system. The 4-point phantom swing of the initial proposal is eliminated by construction; the maximum total swing from *all* ordinary binaries combined is $\lambda \le 1$ quality point.

## 7. Mandatory requirement semantics

Hard gates exist as a distinct type and behave as a **pre-scoring lexicographic filter**:

- Evaluated before scoring; unweighted; no contribution to $Q$, $C$, or $R$.
- Any single gate failure → `HARD_GATE_FAILED`; the candidate ranks below every passing candidate regardless of quality. This is true lexicographic dominance — which no finite weight can guarantee, which is precisely why gates must be a type rather than "a big weight."
- Diagnostics retained: $Q$, $C$, and all criterion-level evidence remain visible for triage.
- **Governance (adopted from A, because a gate bit is the one place a single Judge error retains full leverage):**
  - *Scarcity lint:* the authoring UI warns if gates exceed ~20% of a profile's binary criteria ("gates everywhere = fragile lexicographic ranking on noisy bits").
  - *Elevated scrutiny:* gates are judged with consensus (e.g., 2-of-3 replicated Judge votes) or a higher-confidence Judge configuration; ordinary checks are single-pass by default.
  - *Human override:* gate verdicts are overridable with an audit trail.

## 8. Decomposition protection

Three layers, from semantics to backstop:

**Layer 1 — Requirement Groups (semantic fix).** One semantic requirement occupies exactly one weight slot, however many subchecks it contains. Under `ALL` mode, decomposing a requirement can only make it *harder* to satisfy, never easier — killing the inflation incentive at the source.

**Layer 2 — the $\lambda$ cap (mathematical backstop).** Total ordinary-binary influence on $R$ is $\le \lambda$ **regardless of check count or grouping choices**. Decomposition can redistribute shares *within* the compliance channel; it can never grow the channel's power. This is the decisive structural difference from B, where splitting one weight-1 check into five moved $W_{b\_norm}$ from 0.167 to 0.5 — tripling real influence.

**Layer 3 — detection tooling (governance).** The system flags checks with near-duplicate phrasing or high historical correlation in Judge outputs and suggests merging into one group; profile diffs surface weight-share changes on edit.

**Worked comparison** (requirement X, total existing group weight $\sum v = W$):

| Encoding | X's share of $C$ | Model fails one subcheck |
|---|---|---|
| 1 singleton check, $v=1$ | $\dfrac{1}{W}$ | $c = 0$ → penalty $\lambda/W$ |
| 5 subchecks, one `ALL` group, $v=1$ | $\dfrac{1}{W}$ — **identical** | $c = 0$ → penalty $\lambda/W$ — **identical** |
| 5 ungrouped checks, $v=1$ each | $\dfrac{5}{W+4}$ — inflated within channel | $c$ partial → penalty diluted, but total channel penalty still $\le \lambda$ |

Grouping makes correct semantics the default; the cap bounds the damage when an author refuses to group; the lint catches the rest. Residual ungrouped duplication is a governance problem with a hard ceiling, not a mathematical vulnerability.

## 9. Judge-noise behavior

**Ordinary binary error.** One erroneous flip inside group $g$:

$$\Delta R \;\le\; \lambda \cdot \frac{v_g}{\sum_h v_h}$$

Under `ALL` mode the error is additionally **pivotal-gated**: it moves anything only if the flipped check was the sole determinant of $c_g$ (if another subcheck already failed, the error is inconsequential).

**Designed parity.** With six equal-weight singleton groups and $\lambda = 1$: $\Delta R \le \tfrac{1}{6} \approx 0.167$. A one-anchor graded disagreement on one of six equal-weight graded criteria moves $Q$ by exactly $\tfrac{1}{6} \approx 0.167$. The two channels have **identical worst-case, weight-proportional sensitivity** — versus the initial proposal, where one bit-flip was worth *four* anchor levels (4× a graded Judge's worst single-level error).

**Singleton-channel caveat.** One ordinary check alone ($\sum v = v_g$) swings up to $\lambda = 1.0$ on one error — structurally identical to a single-graded-criterion profile, but worth surfacing: the UI warns on any single-criterion channel and offers replicated judging for high-leverage checks.

**Gate error.** Unbounded by design (an eligibility bit can flip the outcome) — that is what "non-negotiable" means. This is the correct place to spend reliability budget: consensus judging, human review, scarcity. See §7.

**Close-ranking noise.** Differences within $\delta = 0.10$ are badged, not hidden and not reordered.

## 10. Worked examples (mandatory stress tests)

**Test A — quality vs. one failed check.** Equal weights, six singleton groups, $\lambda = 1$, no gates.
Model A: $Q = 4.7$, $C = \tfrac{5}{6} \Rightarrow R = 4.7 - \tfrac{1}{6} \approx 4.533$. Model B: $Q = 4.0$, $C = 1 \Rightarrow R = 4.0$.
**A wins by 0.53.** A genuine 0.7-point quality advantage is not erased by one ordinary miss; the miss costs its authored share (0.167) and no more. If that missed check were a gate, B wins outright (Test E).

**Test B — decomposition.** Fully worked in §8: grouped encoding reproduces the single-check profile's influence *exactly*; ungrouped duplication can only redistribute within the channel and is capped by $\lambda$ globally.

**Test C — Judge error.** One wrong binary classification: $\Delta R \le \lambda v_g / \sum_h v_h$ (e.g., 0.167 with six equal groups at $\lambda=1$), pivotal-gated under `ALL`, parity with graded noise by construction. Quantified in §9.

**Test D — profile composition.**
- *6 graded + 1 binary:* $C \in \{0,1\}$; the check can cost up to $\lambda = 1.0$ — visible, authored, and linted (singleton-channel warning; lower $\lambda$, accept, or promote to gate).
- *2 graded + 8 binary:* one graded anchor step moves $Q$ by $\tfrac{1}{2}$; each group moves $R$ by $\tfrac{\lambda}{8} = 0.125$; all eight together $\le 1.0$.
- *3 graded + 3 binary:* symmetric shares $\tfrac{1}{3}$ per unit each channel.

Semantics are **stable across compositions**: channel-local shares never change units, and total binary power is composition-invariant at $\le \lambda$ — the opposite of the initial mixed mean, where adding binary checks silently shifted influence.

**Test E — mandatory violation.** Model X: $Q = 4.9$, fails gate "no policy-prohibited recommendation." Model Y: $Q = 3.5$, all gates pass. $M_X = \text{FAIL} \Rightarrow$ **Y wins; X cannot win against any passer at any quality level.** X's $Q$ and $C$ remain visible as diagnostics. This is guaranteed lexicographic dominance, not a leaky large-weight approximation.

**Test F — close candidates.** Model A: $Q = 4.05$, $C = \tfrac{5}{6} \Rightarrow R \approx 3.883$. Model B: $Q = 4.00$, $C = 1 \Rightarrow R = 4.000$. **B wins by 0.117.** The flip reverses the ranking only because the quality gap (0.05) was smaller than the check's authored share (0.167) — bounded, interpretable, and not badged ($0.117 > \delta$). Had the gap been $\le 0.10$, both would carry a "too close to call" badge while the deterministic order stands.

## 11. Product presentation

Primary per-candidate view — components first, derived scalar last and labeled:

```text
Quality           4.4 / 5            (5 graded criteria)
Requirements      5 / 6 passed (83%) (6 requirement groups)
Mandatory gates   3 / 3 passed
─────────────────────────────────────
Rank score        4.23   (derived: 4.40 − 1.0 × 0.167)
```

Failed-gate view:

```text
Mandatory gates   2 / 3 passed   ✗ policy-prohibition FAILED
Status            INELIGIBLE — hard gate failed
Quality           4.7 / 5        (diagnostic only)
Requirements      6 / 6 passed   (diagnostic only)
```

Drill-down: every group expandable to raw booleans, graded scores, and rationales. Leaderboard rows show the triple $(M, R, C)$ with the closeness badge where $|R_i - R_j| \le \delta$.

<details>
<summary>Optional analytics: λ-stability indicator</summary>

Because $\lambda$ is a single bounded scalar, the UI can cheaply compute and display the interval of $\lambda$ values over which the current leaderboard order is unchanged (e.g., "ranking stable for $\lambda \in [0.3, 1.0]$"). This converts the architecture's one arbitrary parameter from a silent assumption into an inspectable sensitivity statement.
</details>

## 12. Experiment implications

Aggregate channels independently across tasks $t$ with task weights $\omega_t > 0$ (default 1); never re-derive channel scores from $R$:

$$F = \sum_t \omega_t\, \mathbb{1}[M_t = \text{FAIL}] \qquad \bar{R} = \frac{\sum_t \omega_t R_t}{\sum_t \omega_t} \qquad \bar{Q},\ \bar{C} \text{ likewise}$$

Experiment ranking key: $(F \text{ asc},\ \bar{R} \text{ desc},\ \bar{C} \text{ desc},\ \bar{Q} \text{ desc},\ \text{id})$, with failed tasks contributing the flagged $R = 1$ mapping to $\bar{R}$ (harmless, since $F$ sorts first). Optional **strict mode**: any $F > 0$ removes the candidate from eligibility. Gate pass-rate is reported alongside. Compliance-only profiles use $(F \text{ asc},\ \bar{C} \text{ desc},\ \text{id})$.

## 13. Fusion-analysis implications

The evidence layer is lossless. Persisted per task: every graded score and rationale, every raw boolean and rationale, group membership and modes, gate verdicts with replication votes and adjudication, Judge metadata, and the derived $Q$, $C$, $M$, $R$. Downstream analysis therefore retains: per-criterion complementary-strength comparison (model A strong on criterion X, weak on Y), headroom per criterion ($5 - s_i$; $1 - b_k$), correlation mining across Judge outputs (which also feeds the §8 merge suggestions), gate audit trails, and $\lambda$-sensitivity of any leaderboard. Only the *ranking view* is compressed; nothing downstream ever needs to reverse-engineer a numeric artifact to recover a boolean.

## 14. Migration / compatibility

- **Graded-only legacy profiles:** zero drift. $R = Q$ exactly reproduces historical behavior.
- **Legacy 1/5 (and 1/3/5) encoded binaries:** detection heuristic — criteria whose historical scores are extreme-bimodal (only 1s and 5s) or whose anchor text is pass/fail — are flagged as suspected legacy binaries with one-click re-typing to `BinaryCheck` (singleton `ALL` group) or `HardGate`. Ternary 1/3/5 criteria where 3 is genuinely used stay graded.
- **Historical runs are immutable.** Where raw per-criterion evidence was stored (scores and booleans preserved), v2 aggregates $Q$, $C$, $R$ are recomputed deterministically and labeled "recalculated under v2." The old mixed-mean scalar is retained read-only as `legacy_score`.
- **Weights carry over** (defaults of 1 become group weights of 1). API exposes both the deprecated legacy scalar and the new fields for one deprecation cycle.

## 15. Designs explicitly rejected

1. **Initial proposal (false→1 / true→5 mixed mean):** invents a 4-point equivalence between a categorical fact and the full graded range; amplifies Judge error 4×; rewards decomposition; disguises booleans as graded scores.
2. **Narrower mappings (2/4, etc.):** a smaller arbitrary number is still an arbitrary number; pseudo-anchors violate the rubric's semantics.
3. **B's quadratic pooled penalty:** decomposition inflates the pooled channel weight (fatal); penalty scales with $(G-1)$ under an unstated utility theory; sums cross-channel weights, contradicting its own channel-local claim; mentally unpredictable deduction per failure.
4. **D's pure lexicographic ($10^{-6}$ tiebreak):** ordinary checks are powerless in practice; no middle category between gate and decoration; binary weights become misleading.
5. **A's ε-tieband + composite:** non-transitive, discontinuous comparator; composite contradicts A's own anti-conversion principle; parameter sprawl (ε, β, cluster modes, composite).
6. **Uncapped penalties / huge-weight pseudo-gates:** no finite weight guarantees dominance; penalty magnitudes are unprincipled and can swallow the quality channel.
7. **Pure multi-dimensional, no scalar (A/D primary):** honest but operationally incomplete — leaderboards, selection, and experiment aggregation need a deterministic order. We keep the scalar *derived and labeled* instead of refusing it.

## 16. Strongest unresolved weakness

$\lambda$ is still an exchange rate. The architecture does not *eliminate* the arbitrariness of relating compliance to quality — it **relocates** it from a hidden encoding (false = 1, true = 5) into one visible, bounded, configurable, sensitivity-reportable parameter. A critic is right that $\lambda = 1.0$ is a normative product judgment, not a derived constant, and that some profiles (e.g., compliance-heavy 2-graded + 8-binary) may find the cap too weak — though the type system absorbs that pressure (more influence ⇒ gate or graded criterion, by design). Secondary weaknesses: grouping is enforced partly by tooling and governance rather than purely by math; singleton-channel noise is inherent; and the system is genuinely more complex than one weighted mean — three types, groups, $\lambda$, $\delta$.

## 17. Final adversarial challenge

**Main attempt — the decisive-single-check profile.** 1 graded criterion + 1 ordinary binary, $\lambda = 1$. Model X: $Q = 5.0$, fails the check → $R = 4.0$. Model Y: $Q = 4.1$, passes → $R = 4.1$. **Y wins.** Is this unreasonable? The author declared, via defaults, "this check is worth up to one anchor level," and X lost by exactly 0.1 under that declaration. If the author considers the outcome wrong, the architecture forces the correction into the open: the check was a **gate** (if must-pass) or $\lambda$ was set too high (if minor). Unlike the initial proposal, the semantics that produced the outcome are explicit and authored — the system cannot silently manufacture them.

<details>
<summary>Further attempts (2–4) and why they don't break the core</summary>

**Attempt 2 — ungrouped duplication.** 5 overlapping checks authored as 5 separate groups to dodge grouping: within-channel share inflates (§8) but total penalty stays $\le \lambda$; the direction of distortion is *dilution* of partial failure, never amplification beyond the cap; merge lint flags it. Governance-bounded, ceiling intact.

**Attempt 3 — λ-sensitivity flip.** A pair whose order flips between $\lambda = 0.4$ and $\lambda = 0.8$: real, and disclosed by the stability indicator (§11); the alternative is hiding the same sensitivity inside an encoding constant.

**Attempt 4 — gate proliferation.** 8 of 10 binaries marked gates: ranking degenerates toward fragile lexicographic-on-noisy-bits; scarcity lint + consensus judging are the mitigation; residual risk is an authored governance choice, not a mathematical artifact.

</details>

**Conclusion:** no revision to the core. The guardrails surfaced by these attempts (singleton-channel leverage warning, gate-fraction lint, duplication detection, λ-stability display) are already embedded in §7–§11.

## 18. Decision block

```text
Final architecture: Three-type criteria (Graded / Binary-in-Requirement-Groups /
  Hard Gates); dual-channel aggregation (Quality Q, Compliance C); derived capped
  Rank Score R = clamp(Q − λ(1−C), 1, 5), λ ∈ [0,1] default 1.0; deterministic
  ranking; display-only closeness band δ = 0.10
Criterion types: GradedCriterion (anchored 1–5, weighted w_i); BinaryCheck (bool,
  inside weighted RequirementGroup v_g, mode ALL|MEAN, default singleton ALL);
  HardGate (bool, unweighted, eligibility-only)
Canonical scalar score: YES — derived Rank Score, always displayed alongside Q, C,
  and gate status; channels preserved and first-class
Binary direct numeric contribution: NO into Quality; bounded influence on Rank
  Score only, total ≤ λ regardless of check count
Hard-gate concept: YES — pre-scoring lexicographic eligibility stratum;
  consensus-judged; scarcity-linted; human-overridable
Decomposition protection: Requirement Groups (one weight per semantic
  requirement, ALL default) + λ cap making total binary influence
  composition-invariant + duplication/correlation lint
Primary ranking rule: GateStatus (PASS > FAIL) → R desc → C desc → Q desc →
  stable id; |ΔR| ≤ δ badged "too close," never reordered
Most important tradeoff: One explicit, bounded, sensitivity-reportable exchange
  rate (λ) replaces hidden numeric equivalences — inspectable arbitrariness in
  exchange for a deterministic scalar; grouping enforcement relies partly on
  tooling/governance rather than pure math
Confidence: 85
```
