# Fused Architecture: Three-Type Criteria, Dual Channels, Capped-Penalty Rank Score

> **Source note:** This file preserves the Fusion result text that was shared in the project conversation. The shared text ended mid-sentence during the “Taken from A” section; no missing content has been reconstructed or invented.

## 1. Final recommendation

RSemble should adopt a **three-type criterion model with dual-channel aggregation and one derived, bounded Rank Score**:

1. **Graded criteria** (anchored 1–5) aggregate into a **Quality Score** $Q$ on the native 1–5 scale. Nothing else ever enters this number.
2. **Ordinary binary checks** live inside **Requirement Groups** (a first-class authoring primitive, default singleton). Groups aggregate into a **Compliance Score** $C \in [0,1]$, displayed as a percentage.
3. **Hard gates** are unweighted, non-negotiable eligibility conditions evaluated before any scoring. Failure makes a candidate ineligible to win, full stop.
4. A single **derived Rank Score** $R = \operatorname{clamp}\big(Q - \lambda(1 - C),\ 1,\ 5\big)$, with $\lambda \in [0,1]$ defaulting to $1.0$, provides the deterministic leaderboard scalar. It is always displayed next to its components and never replaces them.

The core commitments: binary evidence is never disguised as graded evidence; the *only* exchange rate between the two channels is one explicit, visible, capped policy parameter; total binary influence is **composition-invariant** (no amount of criterion-splitting can push it past $\lambda$); and mandatory requirements are a separate semantic type, not a big weight.

## 2. What was fused

**The four competing architectures, reconstructed:**

|       | Core mechanism                                               | Binary role                                     | Fatal/decisive flaw |
| ----- | ------------------------------------------------------------ | ----------------------------------------------- | ------------------- |
| **A** | Dual channel + ε-tieband + AND-clusters + optional composite | Tiebreak within ε band                          | ε-comparator is non-transitive and discontinuous; composite contradicts its own anti-conversion principle; heavy parameter surface |
| **B** | Quadratic penalty $G - D^2(G-1)W_{b\_norm}$                 | Numeric penalty via pooled cross-channel weight | Decomposition inflates $W_{b\_norm}$ (1 check → 0.167, 5 identical checks → 0.5); penalty scales with $(G-1)$ without justification; pools $w_b$ and $w_g$ in one denominator, contradicting its own channel-local weight claim |
| **C** | Dual channel + capped penalty $R = Q - \lambda(1-C)$ + gates | Bounded penalty                                 | $\lambda$ is an arbitrary exchange rate; singleton binary swings a full point; grouping treated as an afterthought |
| **D** | Dual channel, pure lexicographic $H \to Q \to S$             | Tiebreak at $10^{-6}$                           | Ordinary checks are nearly powerless; no semantic middle category between gate and decoration |

**Taken from C (the backbone):** the three-way semantic split (quality / compliance / eligibility), the capped-penalty bridge $R = Q - \lambda(1-C)$, deterministic monotonic ranking, empty-channel handling, multi-task rules, and the error-parity analysis (one binary error ≈ one one-anchor graded error at equal weights).

**From A:** requirement grouping — promoted from C's tentative "eventually support" to a **first-class, default authoring primitive** with ALL/MEAN modes (the Judge explicitly flagged this as the best idea outside the winner); gate governance (elevated/consensus judging

---

**Truncation point:** the source text shared in chat ended here.
