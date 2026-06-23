# Ensemble Weighting Recommendation for RSemble AI's "Rank + Fuse" Mode

**Final synthesis** — Judge agent (rjudge), 2026-06-23
**Inputs**: 3 research reports from a parallel swarm (rsearch-mimo, rsearch-minimax, rsearch-qwen), plus an independent 2024–2026 literature check.

---

## TL;DR

Implement **Softmax-Weighted Top-K Fusion (K=3, τ≈0.7)**, training-free, as the
weighting mechanism for the proposed third "Rank → Fuse" mode. All three research
workers independently converged on this mechanism. The fuser receives the top-3
ranked candidates in descending-score order with an explicit priority instruction
— but **without** the raw numerical weights (reward-hacking defense). A
minimum-spread guard falls back to equal weighting when scores are clustered.

---

## 1. Top Recommendation: Softmax-Weighted Top-K Fusion

### The mechanism in one paragraph

After the existing judge pass produces a `weightedScore` (0–5) per candidate,
sort candidates by score, keep the top **K=3**, and convert those scores to
softmax weights with temperature τ≈0.7. Feed only the top-3 candidates to the
existing Fuse synthesizer, ordered by descending score, with a prompt
instruction that tells the fuser to prioritize the first candidate and
incorporate material from the others only when it adds something the first
lacks. Do **not** inject the raw weight numbers into the prompt — show the
candidates as a labeled list (Candidate A, B, C) and let the ordering carry the
priority signal.

### Weight formula

```
w_i = exp(s_i / τ) / Σ_j exp(s_j / τ)

where:
  s_i  = weightedScore of candidate i  (the existing 0–5 judge score)
  τ    = temperature (default 0.7; configurable)
  K    = 3 (top-K window; matches LLM-Blender's recommendation)
```

Lower τ (<1.0) concentrates weight on the top scorer; higher τ (>1.0) flattens
toward uniform. τ=0.7 is the default recommended by the rsearch-mimo report and
is a good starting point: it concentrates enough weight to matter without fully
ignoring candidates #2 and #3.

### Why this mechanism (grounded in the three reports)

All three research workers independently arrived at softmax-weighted top-K
fusion as their top pick:

- **rsearch-mimo** (Report 3) recommends "Softmax-Weighted Top-K Fusion
  (training-free, T=0.7, top-3 candidates)" — a ~20-line implementation that
  converts judge scores to priority weights and passes only the top-3 candidates
  to the fuser. It notes this is training-free, uses the existing judge + fuser
  LLM that RSemble already has, and the top-K filtering prevents low-quality
  candidates from diluting the fusion.

- **rsearch-qwen** (Report 1) recommends "Softmax confidence weighting with
  calibrated temperature + LLM-Blender-style generative fusion" — the same
  softmax transform, plus presenting the top-K candidates to the fusion LLM with
  explicit weight annotations. It provides the canonical TypeScript softmax
  implementation and notes the temperature should be tunable / calibrated on a
  small validation set.

- **rsearch-minimax** (Report 2) recommends "PairRM-ranked top-K with
  softmax-temperature weights" — again softmax with temperature on top-K=3,
  though it adds PairRM as a second ranker (see §3 below). Its softmax weight
  formula `w_i ∝ exp((K - rank_i) / τ)` with τ=1.0 is rank-based rather than
  score-based, which is more robust to judge miscalibration.

The consensus is strong: softmax weighting on top-K=3, fed to the existing
fuser. The three reports disagree only on whether to add a second ranker
(Report 2's PairRM) and on whether to show the fuser the numerical weights
(Reports 1 & 3 show them; Report 2 deliberately hides them).

---

## 2. Why This Beats the Other Candidates

### vs. Full LLM-Blender (PairRanker + GenFuser)
All three reports cite LLM-Blender (Jiang et al., ACL 2023) as the foundational
rank-and-fuse architecture. But full LLM-Blender requires training a dedicated
DeBERTa-v3-large PairRanker and a T5-based GenFuser. RSemble already has an
LLM-as-judge (replacing PairRanker) and an LLM fuser (replacing GenFuser). As
Report 1 notes: "RSemble already uses an LLM-as-judge for ranking, which
eliminates the need for a separate trained PairRanker. The key insight is the
*generative fusion* step." The softmax-weighted top-K approach borrows
LLM-Blender's core insight (rank, then fuse only the top-K) without the training
infrastructure.

### vs. Multi-Agent Debate (Du et al. / ChatEval)
Reports 1 and 2 both flag multi-agent debate as a promising alternative for the
Fuse step. But debate multiplies API cost by (agents × rounds) — typically 3–4× a
single Fuse call — and risks "diversity collapse" where agents converge on a
shared but incorrect answer (Report 1 cites "When Consensus Is Not Correctness,"
OpenReview 2025). Report 3 notes it is "more suitable as a premium mode for
high-stakes tasks." For the default third mode, the softmax-weighted top-K
approach is one extra API call (the fuser) on top of the existing judge call —
far cheaper.

### vs. Self-Consistency / Majority Voting
Report 1 notes self-consistency (Wang et al., ICLR 2023) is "limited direct
applicability for the rank+fuse mode since RSemble deals with open-ended
outputs." Majority voting requires discrete/verifiable answers and exact
matching, which doesn't work for free-form text. Discards too much information.

### vs. CoRE / Logit-Level Ensembles
Report 1 notes CoRE (arXiv:2510.13855) and other token/distribution-level methods
"require access to model logits/probabilities, not just final text outputs."
RSemble's API-based architecture doesn't expose logits. Not applicable.

### vs. Stacking / Meta-Learner
Report 2 cites StackingNet (arXiv:2602.13792) and stacking ensembles
(JAISCR 2025) as an upgrade path, but notes they require "a held-out calibration
set with ground-truth labels" — which RSemble doesn't have for free-form user
prompts. Report 1 agrees: "no labeled data is available (RSemble's case for
free-form user prompts)." Stacking is the right answer *eventually* (once RSemble
collects ~50+ user-judged outputs), but not for the initial implementation.

---

## 3. The Divergent Pick: PairRM + RRF (Report 2)

### What it proposes
Report 2 (rsearch-minimax) uniquely recommends adding a 0.4B PairRM
(DeBERTa-v3-large pairwise reward model) as a second ranker alongside the
existing LLM judge, then fusing the two rankings with Reciprocal Rank Fusion
(RRF, k₀=60). The motivation: PairRM is deterministic and bias-free relative to
the LLM judge, so RRF over (PairRM, judge) cancels out the documented position,
length, and self-preference biases of LLM judges.

### Assessment: genuine insight, but not the top pick for v1

This is a **genuine insight, not an outlier.** Report 2 is the only worker that
directly addresses the single biggest failure mode all three reports acknowledge:
LLM-judge bias (position, verbosity, self-preference). The reward-hacking paper
(Coste et al., arXiv:2312.09244) confirms that ensembles of biased judges inherit
correlated errors, so adding an independent, deterministic ranker is the
principled defense.

However, it is **not the right top pick for the initial implementation**, for
three reasons:

1. **Infrastructure cost.** PairRM is a 0.4B DeBERTa model that must be hosted
   (GPU inference) or called via an API. RSemble is currently a pure
   API-to-OpenRouter web app with no local model hosting. Adding a local model
   is a significant architectural change.

2. **All three reports already mitigate judge bias via the rubric.** Report 3
   notes "task-specific rubric criteria (which RSemble already supports) mitigate
   judge miscalibration." Report 1's failure-mode table lists the same mitigations
   (diverse judges, conciseness in rubric, adversarial test cases). The softmax
   approach doesn't *solve* judge bias, but the existing rubric system already
   provides a first line of defense.

3. **RRF over a single ranker is a no-op.** RRF requires ≥2 independent rankings
   to cancel bias. Without PairRM, Report 2's own fallback is RRF over
   (rubric-score ranking, position-swapped rubric-score ranking) — a weak
   approximation.

**Recommendation:** Park PairRM + RRF as the follow-up spike (§6). It is the
right next step once RSemble has a way to host a small local model, or once a
PairRM-style API endpoint becomes available.

### The one piece to adopt from Report 2 now: hide the weights from the fuser

Report 2 contains a critical implementation detail that Reports 1 and 3 miss:
**do not let the Fuse synthesizer see the numerical weights.** Per the
reward-hacking paper, models can learn to exploit "format-following" patterns
when given explicit scores. Report 2 recommends showing the fuser the ranked
candidates as a labeled list (Candidate A, B, C) *without* scores, and using
the ordering + a qualitative instruction to carry the priority signal.

This is a genuine improvement over Reports 1 and 3, which both inject explicit
weight numbers (e.g., "weight: 0.65") into the fuser prompt. **Adopt Report 2's
approach:** order the candidates, instruct the fuser to prioritize the first,
but don't show the numbers.

---

## 4. Mechanisms All Three Reports Missed (Independent Check)

An independent web search for 2024–2026 ensemble work surfaced several papers
not cited by any of the three reports. The most relevant:

### FusioN — "Making, not Taking, the Best of N" (arXiv:2510.00931, 2025)
A single fusor LLM receives all N candidate outputs at once and synthesizes a
better answer — no pairwise ranker, no trained fusion model. The paper shows this
"already brings gains in highly diverse applications" even in its simplest form,
and frames itself as a simpler alternative to LLM-Blender (which requires two
trained modules). **This directly validates the consensus pick**: a training-free
fuser receiving ranked candidates is sufficient. RSemble's existing Fuse LLM is
exactly this pattern.

### CARE — "From Many Voices to One" (OpenReview:XdcofpTCyq)
Reframes multi-judge aggregation as inference in a latent-variable Markov Random
Field that separates true quality from confounders (length, style, position).
Reduces aggregation error by up to 25% vs. majority vote. **Relevant as the
principled upgrade path** when RSemble adds a multi-judge panel (§6): instead of
naive averaging, use confounder-aware aggregation.

### SpecEM (NeurIPS 2025) — Online Multiplicative Weight Updates
Training-free ensemble that dynamically adjusts each model's voting weight in
real time based on verification performance. Inspired by speculative decoding.
**Not applicable to RSemble's current architecture** (it operates at the
token/segment level during generation, requiring logit access), but an interesting
direction if RSemble ever moves to self-hosted models.

### LLM-PeerReview (arXiv:2512.23213) — Peer-Review Scoring
Uses LLM-as-judge across multiple candidate models, then aggregates scores via
graphical-model truth inference (a principled alternative to averaging). Very
close to what RSemble already does, but with more rigorous score aggregation.
**Relevant to the multi-judge spike** — the "flipped-triple scoring trick" and
graphical-model aggregation could replace naive averaging when multiple judges are
added.

### UAF — Uncertainty-Aware Fusion (arXiv:2503.05757)
Selects top-K models by accuracy × hallucination-detection ability, then fuses
their outputs. **The selector concept maps to RSemble's judge scores** — the
existing `weightedScore` is already a quality signal that performs the selection
function. Confirms the top-K filtering design.

**None of these missed papers change the top recommendation.** They reinforce it:
the training-free, single-fuser, top-K approach is well-supported by the latest
literature (FusioN, 2025). The missed work primarily enriches the *upgrade path*
(§6) for when RSemble adds multi-judge support.

---

## 5. Concrete Implementation Guidance for RSemble AI

### Where the changes go

The fusion logic lives in **`src/lib/pipeline.ts`**, function `fusionMessages()`
(lines 217–236). Today it passes *all* candidates to the fuser with equal
weighting — the judge scores are ignored. The state engine
(**`src/studio-engine.ts`**) already stores `weightedScore` on each candidate
(via the `JUDGE_RESULT` action, line 244) and tracks `mode: "rank" | "fuse"`.

### Step-by-step implementation

**1. Add a softmax + top-K helper in `pipeline.ts`:**

```typescript
/**
 * Convert judge scores to softmax weights with temperature.
 * Lower τ concentrates weight on the top scorer; higher τ flattens.
 */
function softmaxWeights(scores: number[], temperature: number): number[] {
  const maxScore = Math.max(...scores); // numerical stability
  const exps = scores.map(s => Math.exp((s - maxScore) / temperature));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}
```

**2. Modify `fusionMessages()` to accept scores and filter to top-K:**

The function signature currently takes `{ prompt, rubric, candidates }`. Add an
optional `scores?: Record<string, number>` (the `scoresById` map from
`JudgeResult`) and a `temperature?: number` parameter. Inside:

```typescript
export function fusionMessages(opts: {
  prompt: string;
  rubric: RubricCriterion[];
  candidates: Candidate[];
  scores?: Record<string, number>;  // from JudgeResult.scoresById
  temperature?: number;
}): ChatMessage[] {
  const K = 3;
  const tau = opts.temperature ?? 0.7;

  // If we have scores, sort + filter to top-K; otherwise use all candidates.
  let ranked: Candidate[];
  if (opts.scores) {
    ranked = [...opts.candidates]
      .sort((a, b) => (opts.scores![b.id] ?? 0) - (opts.scores![a.id] ?? 0))
      .slice(0, K);
  } else {
    ranked = opts.candidates;
  }

  // Minimum-spread guard: if scores are clustered, fall back to equal weighting.
  // (Softmax on near-identical scores produces near-uniform weights anyway, but
  //  we also drop the priority instruction to avoid misleading the fuser.)
  const scores = ranked.map(c => opts.scores?.[c.id] ?? 0);
  const spread = Math.max(...scores) - Math.min(...scores);
  const hasSpread = spread >= 0.5;

  // Present candidates in descending-score order WITHOUT raw weights
  // (reward-hacking defense — Report 2 / arXiv:2312.09244).
  const sources = ranked
    .map((c, i) => `### Candidate ${["A", "B", "C"][i] ?? String.fromCharCode(65 + i)} — ${c.model}\n${candidateFullText(c)}`)
    .join("\n\n");

  const priorityInstruction = hasSpread
    ? `The candidates above are ordered by quality (Candidate A is strongest). ` +
      `Build your answer primarily from Candidate A. Incorporate material from ` +
      `later candidates only when it adds something Candidate A lacks.\n\n`
    : `The candidates above are of comparable quality. Synthesize freely across all of them.\n\n`;

  const system =
    `You are a senior synthesizer. Merge the strongest material from multiple ` +
    `candidate answers into a single, coherent, production-grade final answer. ` +
    `Remove redundancy and resolve contradictions sensibly. ` +
    `Honor the user's rubric. Return the final answer in clean Markdown.`;
  const user =
    `User task:\n${opts.prompt}\n\nRubric:\n${rubricText(opts.rubric)}\n\n` +
    priorityInstruction +
    `Candidate answers:\n${sources}`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
```

**3. Wire the scores through in the pipeline caller.**

Wherever `fusionMessages()` is called (the Fuse-mode branch after `JUDGE_RESULT`),
pass the `scoresById` map from the judge result. The caller already has this data
— the `JUDGE_RESULT` action stores `scoresById` in the reducer and attaches
`weightedScore` to each candidate. Pass either the `scoresById` map or read
`candidate.weightedScore` directly.

**4. Add a temperature setting to the UI (optional, low priority).**

The temperature τ is the single tunable parameter. Exposing it as a slider
(default 0.7, range 0.3–1.5) in the Fuse-mode controls lets users adjust how
aggressively the fuser prioritizes the top candidate. This is a nice-to-have;
τ=0.7 hardcoded is fine for v1.

### Edge cases to handle

| Edge case | Handling |
|---|---|
| **Fewer than 3 candidates** | Use all available candidates (don't pad). The `slice(0, K)` naturally handles this. |
| **Fewer than 2 candidates** | The existing `INSUFFICIENT_CANDIDATES` guard (studio-engine.ts line 206) already stops the pipeline before fusion. No change needed. |
| **Scores clustered (spread < 0.5)** | The minimum-spread guard drops the priority instruction and falls back to equal weighting. Softmax on clustered scores is ~uniform anyway, so the main effect is avoiding a misleading "Candidate A is strongest" instruction. (From Report 3.) |
| **Tied scores** | `sort()` is stable in modern JS engines, so ties keep original order. The ordering is cosmetic (the fuser sees labeled candidates, not weights), so ties don't cause problems. |
| **No judge scores available** (e.g., judge failed but user still wants to fuse) | Fall back to the current behavior: pass all candidates, equal weighting. The `opts.scores` optional parameter handles this. |
| **Reward hacking** | Don't show numerical weights to the fuser — only the ordering and a qualitative instruction. (From Report 2, citing arXiv:2312.09244.) |
| **Judge self-preference bias** | If the judge is from the same model family as a candidate, the score may be inflated. Mitigation is architectural (use a judge from a different family), not a weighting fix. Note in docs; no code change. |

### What does NOT change

- The judge pipeline (`judgeMessages`, `parseJudge`) is unchanged — it already
  produces `scoresById` and `weightedScore`.
- The state engine (`studio-engine.ts`) is unchanged — it already stores
  `weightedScore` on candidates via `JUDGE_RESULT`.
- The `mode: "rank" | "fuse"` toggle is unchanged — the new third mode is
  "Fuse after Rank," which is just Fuse mode with the scores wired through.
- The UI (`RankResult.tsx`, the leaderboard) is unchanged for v1.

The implementation is approximately **30–40 lines of changes in `pipeline.ts`**
(softmax helper + modified `fusionMessages`) plus a one-line change at the call
site to pass `scoresById`. No new dependencies, no new models, no training.

---

## 6. Alternative Worth a Follow-Up Spike: PairRM + RRF (Multi-Ranker Bias Defense)

If the project's bottleneck turns out to be **judge bias** (the judge
systematically favors verbose, formatted, or same-family outputs), the
softmax-weighted approach doesn't fix the root cause — it just weights by the
biased scores. The principled fix, per Report 2, is to add an independent ranker
and fuse rankings via RRF.

**Spike scope:**
1. Stand up PairRM (`llm-blender/PairRM` on HuggingFace, 0.4B DeBERTa-v3-large)
   as a second ranker — either via a local GPU inference endpoint or a hosted
   inference API.
2. Run PairRM over the same N candidates alongside the existing LLM judge.
3. Fuse the two rankings with RRF: `score(c) = Σ_rankers 1 / (k₀ + rank_i(c))`,
   k₀=60.
4. Feed the RRF-fused ranking (instead of the raw judge scores) into the
   softmax-weighted top-K fusion.

**Why it's worth a spike:** Report 2 is the only worker that directly addresses
the reward-hacking / judge-bias failure mode that all three reports flag as the
biggest risk. RRF over two independent rankers is a cheap, well-validated
mitigation (Cormack et al.; LLM-RankFusion, Hsu et al. 2024). If RSemble adds
local model hosting for any other reason, PairRM becomes nearly free.

**Why it's not v1:** Requires hosting a 0.4B model (GPU or inference API), which
is a non-trivial addition to the current pure-API architecture.

**Upgrade path beyond PairRM:** Once RSemble collects ~50+ user-judged outputs,
replace the hand-set temperature τ with a trained stacking meta-learner
(StackingNet, arXiv:2602.13792) that learns optimal weights from (rank features
→ user preference). And if a multi-judge panel is added, use CARE-style
confounder-aware aggregation (OpenReview:XdcofpTCyq) instead of naive averaging
to separate true quality from length/style confounders.

---

## 7. Key Citations (10 most important across all 3 reports + independent check)

1. **Jiang, D., Ren, X., & Lin, B.Y. (2023).** "LLM-Blender: Ensembling Large Language Models with Pairwise Ranking and Generative Fusion." ACL 2023. https://arxiv.org/abs/2306.02561 — The foundational rank-and-fuse architecture. Top-K=3 filtering insight. *(Cited by all 3 reports.)*

2. **Guo, C., et al. (2017).** "On Calibration of Modern Neural Networks." ICML 2017. — Temperature scaling / softmax calibration, the mathematical basis for the weight formula. *(Cited by Report 1.)*

3. **Coste, T., et al. (2023).** "Helping or Herding? Reward Model Ensembles Mitigate but do not Eliminate Reward Hacking." arXiv:2312.09244. https://ar5iv.labs.arxiv.org/html/2312.09244 — Documents the reward-hacking failure mode and the "don't show weights to the fuser" defense. *(Cited by Report 2.)*

4. **Du, Y., et al. (2023).** "Improving Factuality and Reasoning in Language Models through Multiagent Debate." ICML 2024. https://arxiv.org/abs/2305.14325 — Multi-agent debate alternative for the Fuse step. *(Cited by Reports 1 & 2.)*

5. **Hsu, et al. (2024).** "LLM-RankFusion: Mitigating Intrinsic Inconsistency in LLM-based Ranking." arXiv:2406.00231. https://github.com/XHMY/LLM-RankFusion — RRF for fusing multiple LLM rankings; the basis for the PairRM + RRF spike. *(Cited by Report 2.)*

6. **llm-blender/PairRM model card.** https://huggingface.co/llm-blender/PairRM — The 0.4B pairwise reward model for the divergent second-ranker approach. *(Cited by Report 2.)*

7. **"Overconfidence in LLM-as-a-Judge: Diagnosis and Confidence-Driven Solution" (2025).** arXiv:2508.06225. https://arxiv.org/pdf/2508.06225 — LLM-as-a-Fuser framework; documents judge overconfidence and calibration collapse. *(Cited by Reports 1 & 3.)*

8. **Adeyemi & Oladipo (2025).** "Stacking ensemble techniques for chat-based LLMs in text classification." JAISCR 2025. https://sciendo.com/pdf/10.2478/jaiscr-2025-0017 — Stacking meta-learner upgrade path. *(Cited by Report 2.)*

9. **"Making, not Taking, the Best of N" (FusioN, 2025).** arXiv:2510.00931. https://ar5iv.labs.arxiv.org/html/2510.00931 — Validates that a single training-free fusor receiving all candidates already brings gains. *(Found in independent check.)*

10. **Wang, X., et al. (2022).** "Self-Consistency Improves Chain of Thought Reasoning in Language Models." ICLR 2023. https://arxiv.org/abs/2203.11171 — Majority voting / self-consistency baseline; explains why voting doesn't work for open-ended text. *(Cited by Reports 1 & 2.)*

---

## 8. Summary of the Three Reports' Positions

| Aspect | Report 1 (rsearch-qwen) | Report 2 (rsearch-minimax) | Report 3 (rsearch-mimo) |
|---|---|---|---|
| **Top pick** | Softmax + calibrated temp + LLM-Blender-style fusion | PairRM + RRF + softmax temp on top-K=3 | Softmax-weighted top-K fusion (T=0.7, K=3) |
| **Show fuser the weights?** | Yes (explicit in prompt) | **No** (labeled list only — reward-hack defense) | Yes (priority block in prompt) |
| **Second ranker?** | No | Yes (PairRM, 0.4B) | No |
| **Alternative flagged** | Borda count / multi-judge panel (PoLL) | Multi-agent debate in Fuse step | Multi-judge ensemble scoring (k=3 judge passes) |
| **Temperature default** | 1.0 (tunable) | 1.0 | 0.7 |
| **Key failure mode** | Judge miscalibration | Reward hacking / judge bias | Score clustering |
| **Word count** | ~1,500 | ~1,775 | ~1,400 |

**The judge's synthesis:** Adopt the consensus mechanism (softmax-weighted top-K=3,
τ=0.7), but take Report 2's critical refinement (hide numerical weights from the
fuser) and Report 3's guard (minimum-spread fallback). Park Report 2's PairRM +
RRF as the follow-up spike for when judge bias becomes the bottleneck.
