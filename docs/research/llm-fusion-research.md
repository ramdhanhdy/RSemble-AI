# LLM Answer Fusion: A Research Report on Model Pairing, Synthesis Mechanisms, and Optimal Configuration Discovery

**Prepared for:** RSemble AI development roadmap
**Date:** July 31, 2026
**Purpose:** Ground the evolution of RSemble's Fusion mode in the literature and production landscape, and define a research-backed path toward discovering which model pairs fuse best for particular task classes.

---

## Executive Summary

LLM answer fusion, the practice of generating responses from multiple models and synthesizing them into one output, has moved from academic curiosity to production feature in under two years. OpenRouter's Fusion API, Nous Research's Hermes MoA 2.0, and a wave of open-source self-hostable alternatives (fusionHarness, openfusion, chorus, fusion-engine) all implement the same core pipeline: fan out a prompt to a panel of models in parallel, have a judge analyze their responses structurally, then have a synthesizer write a final answer grounded in that analysis.

The evidence is bifurcated. On one hand, fusion consistently produces outputs that beat individual panelists on instruction-following and deep-research benchmarks. OpenRouter reports that a budget panel of Gemini 3 Flash, Kimi K2.6, and DeepSeek V4 Pro beats solo GPT-5.5 and solo Opus 4.8 outright, landing within 1% of Claude Fable 5 at half the cost. On the other hand, rigorous academic studies find that one-shot synthesis over final answers loses to judge-based selection 82% of the time, that mixing different models often drags quality down compared to sampling one strong model repeatedly, and that on open-ended tasks the best models increasingly fail alike, capping the gains any combination can deliver.

A frequently-cited claim deserves correction here. OpenRouter reports that Opus 4.8 self-fusion (Opus 4.8 paired with a second copy of itself) scored 65.5% versus 58.8% solo — a +6.7 point improvement — and says this suggests "a meaningful chunk" of Fusion's lift comes from the synthesis step rather than model-architecture diversity. Some secondary coverage inflates this into "roughly three-quarters of the lift comes from synthesis." The primary source does not support that figure, and the ablation itself does not cleanly isolate synthesis: self-fusion changes the number of generations, reasoning paths, tool calls, source selections, and stochastic sampling, all at once. The defensible working conclusion is narrower and more useful: **aggregation/synthesizer quality appears to be a major variable, and strong gains can exist even without heterogeneous models — but its contribution should be measured directly in RSemble rather than assumed.**

The revised path to the pair-discovery vision therefore runs through: continuous-score complementarity analysis (which pairs have latent headroom because each rescues the other's weak cases), quality-matched selection (avoiding weak-model drag), task-typed evaluation (different task types reward different policies), and — critically — comparing fusion against Rank and rubric-aware refine-the-winner as competing execution policies per task class, not against solo models alone. See the **Design Revision** section at the end of this document for the corrected experimental design.

---

## Table of Contents

1. [What Fusion Is and How It Works](#1-what-fusion-is-and-how-it-works)
2. [The Academic Landscape](#2-the-academic-landscape)
3. [Production Fusion Systems](#3-production-fusion-systems)
4. [When Fusion Helps and When It Hurts](#4-when-fusion-helps-and-when-it-hurts)
5. [The Pair Selection Problem](#5-the-pair-selection-problem)
6. [Failure Modes and Quality Risks](#6-failure-modes-and-quality-risks)
7. [Evaluation Methodology](#7-evaluation-methodology)
8. [Task-Dependent Fusion](#8-task-dependent-fusion)
9. [Implications for RSemble AI](#9-implications-for-rsemble-ai)
10. [Recommended Research Program (Superseded)](#10-recommended-research-program-superseded)
11. [References](#11-references)
12. [Design Revision (Post-Review)](#12-design-revision-post-review-july-31-2026) — **supersedes conflicting earlier recommendations**

---

## 1. What Fusion Is and How It Works

### 1.1 Definition and Taxonomy

LLM answer fusion is the process of combining outputs from multiple language models into a single response that aims to be better than any individual input. It exists at three levels of abstraction:

**Response-level fusion (inference-time).** Multiple models generate answers to the same prompt independently, then an aggregator combines them. This is the most common production approach and the one RSemble implements. No model weights change. Variants include:

- **Mixture of Agents (MoA):** Layered architecture where each layer's agents see the previous layer's outputs. The original MoA uses 3 layers of 6 proposers with a final aggregator.
- **Self-MoA:** Sample one strong model multiple times instead of mixing different models. Often beats heterogeneous MoA.
- **Rank-then-fuse:** A ranker scores candidates pairwise, then a fuser merges the top-K. LLM-Blender's PairRanker + GenFuser.
- **Judge-then-synthesize:** A judge extracts structured analysis (consensus, contradictions, unique insights, blind spots), then a synthesizer writes the final answer from that analysis. This is OpenRouter Fusion's architecture.
- **Selection (not fusion):** A judge picks the best candidate without synthesizing. Empirically the strongest aggregator in diverse-team settings.

**Weight-level fusion (training-time).** Merge model weights or probability distributions into a single model. FuseLLM and FuseChat transfer knowledge from multiple source LLMs into one target through continual training on their probability distributions. ProFuser extends this with a progressive inference-to-training curriculum. These are not inference-time fusion and are out of scope for RSemble, but they inform the taxonomy.

**Latent-level fusion.** Mixture of Thoughts (MoT) projects hidden states from heterogeneous experts into a shared latent space where a primary expert cross-attends to its peers. Single-pass, routing-like efficiency, but requires training interaction layers. Also out of scope for RSemble but relevant to understanding the design space.

### 1.2 The Core Pipeline

Every production fusion system implements a variant of this pipeline:

```
Prompt
  │
  ▼
Fan-out (panel) ──► Model A ──┐
                ──► Model B ──┤  (parallel, each optionally tool-enabled)
                ──► Model C ──┘
                               │
                               ▼
                    Judge / Analyst
                    (structured analysis: consensus, contradictions,
                     partial coverage, unique insights, blind spots)
                               │
                               ▼
                    Synthesizer
                    (writes final answer grounded in analysis)
                               │
                               ▼
                    Final answer + cost/latency metadata
```

Key design decisions at each stage:

| Stage | Decision | Options |
|-------|----------|---------|
| Fan-out | Panel composition | Diverse models vs same model sampled N times |
| Fan-out | Temperature | Same for all vs spread (diversity jitter) |
| Fan-out | Tools | Panelists get web search/fetch or not |
| Judge | Analysis format | Structured JSON (consensus/contradictions) vs free-form |
| Judge | Blindness | Anonymized sources or model-attributed |
| Synthesize | Model | Same as judge, separate, or panel member |
| Synthesize | Grounding | From structured analysis vs from raw responses |
| Router | When to fuse | Always vs model-decides vs heuristic gate |

---

## 2. The Academic Landscape

### 2.1 Foundational Papers

**Mixture-of-Agents (Wang et al., 2024).** The original MoA paper. Layered architecture: 3 layers, 6 proposers per layer (Qwen1.5-110B, Qwen1.5-72B, WizardLM-8x22B, LLaMA-3-70B, Mixtral-8x22B, dbrx-instruct), Qwen1.5-110B as final aggregator. Achieved 65.1% on AlpacaEval 2.0 vs GPT-4o's 57.5% using only open-source models. Key insight: models exhibit "collaborativeness" where an aggregator produces better responses when given access to other models' outputs, even inferior ones. MoA outperformed an LLM-ranker baseline, suggesting the aggregator does more than select, it performs sophisticated aggregation.

**Self-MoA (Li et al., 2025, arXiv 2502.00674).** The critical rebuttal. Sampling one top-performing model multiple times and aggregating those samples outperforms mixing different models in most scenarios. Self-MoA beat standard MoA by 6.6 points on AlpacaEval 2.0. The mechanism: MoA is very sensitive to proposer quality, and mixing different models often lowers the average quality of the proposer pool. The quality-diversity trade-off is real: diversity helps only when models are of similar quality. When quality varies, the weaker models drag the result down.

**Selection Bottleneck / When Agents Disagree (arXiv 2603.20324, 2026).** The strongest finding against synthesis. Across 42 tasks in 7 categories, judge-based selection beat MoA-style synthesis every single time. Synthesis lost to a single-model baseline 82% of the time (BT-WR 0.179). The mechanism: "synthesis averages, selection picks." A diverse team's value lies in the variance of its candidate pool, the probability that at least one candidate is excellent. Selection captures this value by preserving the best candidate. Synthesis destroys it by blending all candidates into a compromise output that can be worse than any individual.

**Trace-Level Synthesis / Beyond Consensus (arXiv 2605.29116, 2026).** The counterexample showing when synthesis does win. When the aggregator reads full reasoning traces (intermediate steps, calculations, assumptions) rather than just final answers, it can assemble solutions no individual chain produced. The "aggregation paradox": trace-level synthesis improves accuracy even at unanimous consensus, exceeding the voting ceiling. The mechanism is trace-level complementarity: different chains contain different correct intermediate steps, and the aggregator assembles them. This requires verification and trace access, not just final-answer blending.

**Co-Failure Ceiling (arXiv 2606.27288, 2026).** The fundamental limit. Across 67 frontier models, accuracy is capped by the rate at which all models fail simultaneously (beta). On open-ended math, beta is 0.052; on execution-graded code, 0.079. Pairwise error correlation (rho) underprices this joint failure tail by 2.5 to 8.3 times. No selection policy can exceed the ceiling 1 minus beta. The operative question is not "how correlated are the models" but "which regime is this workload in," and pairwise rho cannot answer that. Co-failure tracks open-endedness, not subject matter: the same GPQA-Diamond questions flip from beta approximately 0 (multiple-choice) to beta 0.127 (free-response) when only the answer format changes.

**LLM-Blender (Jiang et al., 2023).** The rank-then-fuse ancestor. PairRanker jointly encodes input + candidate pairs using cross-attention (RoBERTa), producing a ranking matrix. GenFuser then merges the top-K using a seq2seq model. Outperforms individual LLMs on MixInstruct across BERTScore, BARTScore, and BLEURT. The key structural difference from MoA: ranking is a separate trained model, not an LLM prompt.

**Balancing Diversity and Consistency (ICLR 2025).** Introduces DMoA (Dynamic Mixture of Agents). Three key findings: (1) aggregation and synthesis outperform LLM-based ranking and self-consistency on open-ended tasks, (2) higher semantic diversity degrades performance across reasoning tasks (some consistency is necessary), (3) task-specific skills reside in different subspaces, so mixtures optimized for one task type underperform on others. DMoA achieves SOTA on Big Bench Hard by dynamically selecting models based on required skills.

### 2.2 The Quality-Diversity Trade-off

The central tension in fusion, confirmed across multiple papers:

- **Quality matters more than diversity.** Self-MoA (one strong model sampled N times) beats Mixed-MoA (diverse models) when quality varies. MoA performance is "rather sensitive to the quality" and "mixing different LLMs often lowers the average quality."
- **Diversity helps only at matched quality.** At matched quality, low-correlation heterogeneous ensembles beat high-correlation Self-MoA. The gain averages +0.027 at k=3, positive in all 60 resamplings, but small and partition-sensitive.
- **Naive diversity is a liability.** On 455 three-model triplets, the mean majority-vote gain over the best member is negative (-0.10 hard, -0.02 saturated). "More diverse implies better fusion" is refuted.
- **Error correlation is the right metric, not diversity.** More accurate models are more correlated. Diversity metrics are substantially entangled with capability. After capability control, the stable remainder is a modest pairwise co-failure association: more shared error, lower gain.

### 2.3 When Mixing Different Models Actually Helps

The Self-MoA paper identifies the narrow regime where heterogeneous mixing wins:

1. **Specialized models on specialized tasks.** When each model excels at a different subtask (e.g., Qwen2-Math for math, DeepSeek-Coder for code, Qwen2-7B for commonsense), mixed MoA can outperform Self-MoA. But even in a constructed mixture task, only 2 of 13 mixed configurations slightly outperformed Self-MoA (by 0.17% and 0.35%).
2. **Similar-quality models.** When all panelists are approximately equally strong, their different error modes complement each other.
3. **Open-ended, subjective tasks.** Deep research, multi-domain critique, and "compare and contrast" prompts benefit from genuinely different perspectives. Verifiable tasks (math, code) are better served by selection or self-consistency.

---

## 3. Production Fusion Systems

### 3.1 OpenRouter Fusion

The most mature production fusion feature. Launched 2025, benchmarked on the DRACO deep research benchmark (100 tasks across 10 domains, graded against ~39 weighted criteria per task).

**Architecture:**
1. Prompt dispatched to a panel of 1-8 models in parallel, each with `web_search` and `web_fetch` enabled.
2. An analyst model reads all panel responses and produces structured analysis JSON: consensus points, contradictions, partial coverage, unique insights, blind spots.
3. The calling model receives the structured analysis and writes the final answer.

**Critical design choices:**
- The analyst **compares** responses, it does not merge them.
- The outer model writes the final answer from the analysis, not from the raw responses.
- Panel and analyst models get `web_search` and `web_fetch`; the synthesizer does not (to stay anchored in the deliberation).
- Recursion is blocked: panel and analyst models cannot invoke fusion again (`x-openrouter-fusion-depth` header).

**Benchmark results (DRACO, 100 deep research tasks):**

| Configuration | Score |
|---|---|
| Fable 5 + GPT-5.5 synthesized by Opus 4.8 | 69.0% |
| Opus 4.8 + GPT-5.5 + Gemini 3.1 Pro synthesized by Opus 4.8 | 68.3% |
| Opus 4.8 + GPT-5.5 synthesized by Opus 4.8 | 67.6% |
| Opus 4.8 + Opus 4.8 synthesized by Opus 4.8 (self-fusion) | 65.5% |
| Solo Claude Fable 5 | 65.3% |
| Gemini 3 Flash + Kimi K2.6 + DeepSeek V4 Pro synthesized by Opus 4.8 | 64.7% |
| Solo DeepSeek V4 Pro | 60.3% |
| Solo GPT-5.5 | 60.0% |
| Solo Claude Opus 4.8 | 58.8% |
| Solo Kimi K2.6 | 53.7% |
| Solo Gemini 3.1 Pro | 45.4% |
| Solo Gemini 3 Flash | 43.1% |

**Key ablation finding:** Running Opus 4.8 paired with itself (no diversity) lifted its score from 58.8% to 65.5%, a 6.7-point jump. OpenRouter describes this as evidence that "a meaningful chunk" of the lift comes from the synthesis step itself, not just from combining different model architectures. Note this ablation does not isolate synthesis alone — self-fusion also changes generation count, reasoning paths, tool calls, and sampling. Treat it as evidence that aggregation quality matters, not as a quantified attribution.

**Presets:**
- `general-high`: Strongest panel (Claude Opus, GPT, Gemini Pro) + frontier analyst.
- `general-budget`: Cheaper panel + frontier analyst for strong synthesis at lower cost.
- `general-fast`: Latency-homogeneous panel (similar TTFT so no single model gates the fan-out).

### 3.2 Hermes MoA 2.0 (Nous Research)

Released June 19, 2025 as a core feature of Hermes Agent v0.17.0, refined in the July 1 "Judgment Release" v0.18.0.

**Architecture:**
- User configures a preset: several "reference models" plus a single "aggregator."
- Reference models each analyze the request independently.
- The aggregator reads all outputs, synthesizes a final answer, and handles tool calls.
- Presets appear as selectable "virtual models" in the model picker alongside regular models.
- `/moa [prompt]` command for one-shot use.

**Design choices:**
- Prompt caching preserved by appending reference outputs to the end of the latest user turn, not inserting mid-history.
- Nested MoA is banned: an aggregator cannot itself be another preset (blocks recursive cost).
- Full tool access is reserved for the aggregator; reference models receive simplified context to cut cost and avoid provider-level refusals.
- Each reference model's full output is displayed as a labeled block for auditability.

**Reported benchmark (HermesBench, not yet public):**
- GPT-5.5 + DeepSeek as reference models, Claude Opus 4.8 as aggregator: 0.8202.
- Opus 4.8 alone: 0.7607 (~8% below the ensemble).
- GPT-5.5 alone: 0.7412 (~11% below the ensemble).
- Cost: each call multiplies token usage by roughly the number of reference models. Nous recommends reserving MoA for "the 10% of tasks that most need quality."

### 3.3 Open-Source Self-Hostable Alternatives

A cluster of open-source projects now replicate the OpenRouter Fusion pipeline as self-hostable services:

**fusionHarness (jackulau/fusionHarness).** OpenAI-compatible MoA server. Panel fan-out, judge extracts structure, synthesizer writes grounded answer. Ships budget (Gemini 3 Flash, Kimi K2.6, DeepSeek V4 Pro) and frontier (Opus 4.8, GPT-5.5, Gemini 3.1 Pro) presets. Quality knobs: `refine` (self-critique pass), `layers` (multi-layer MoA), `samples` (self-consistency per proposer), `diversity` (temperature spread). Graceful degradation: if judge fails, synthesis runs from raw responses; if synthesizer fails, best panelist answer is returned.

**openfusion (shrdgn/openfusion).** FastAPI proxy with a React playground UI. Supports strategies beyond standard fusion: `self_fusion` (one model N times), `panel` (diverse panel), `debate` (revision rounds before judge), `pipeline` (sequential chain: research, critique, synthesize). Aggregators: `judge` (synthesis), `vote` (majority vote, cheaper, for verifiable tasks), `ranked` (judge picks best). Includes a per-prompt Auto Router that fuses only hard prompts and routes easy ones to a single model.

**chorus (paperclipinc/chorus).** Rust-based MoA gateway. Distinguishes itself with "hardened aggregation": source anonymization, length normalization, mandatory critical dissent, and a cap on any single source dominating the synthesis. Router gate fuses only hard queries. Self-MoA mode when one model clearly dominates. Single-layer default (deeper layers multiply cost and propagate bad-proposer influence).

**fusion-engine (luckeyfaraday/fusion-engine).** Python framework. Panel configs in JSON, judge prompt templates in Markdown. Ships specialized judge templates: `default`, `deep_research`, `code_review`, `creative`, `tool_synthesis`. Eval harness runs `fusion` vs `single` (each panel member alone) vs `judge_alone` on GSM8K, HumanEval, MMLU, GPQA.

### 3.4 Together AI MoA

The original production MoA implementation from the paper authors. Open-source reference code at `togethercomputer/Moa`. 65.1% on AlpacaEval 2.0 with 3 layers, 6 proposers, Qwen1.5-110B aggregator. Also available as a Python library (`mixture-llm`) with pre-built pipeline stages: `Propose`, `Synthesize`, `Aggregate`, `Rank`, `Vote`, `Shuffle`, `Dropout`. Together AI also ships Conditional Workflows (LLM-based router classifies input and routes to specialized models) and hosts MoE models, but those are single-model MoE architectures, not multi-model fusion.

### 3.5 OpenPipe MoA

OpenPipe ships productized MoA models as drop-in GPT-4 replacements: `moa-gpt-4-v1`, `moa-gpt-4-turbo-v1`, `moa-gpt-4o-v1`. OpenAI-compatible Chat Completions endpoint, base-model-agnostic. Performance: 84.8 on Arena Hard Auto, 68.4 LC on AlpacaEval 2.0, MoA outputs preferred over GPT-4 59.5% of the time (Claude 3 Opus judge). Primary use case: synthetic training data generation. Fine-tuned Llama 3 8B on MoA data outperforms GPT-4 on 3/4 tasks at 1/25th cost.

### 3.6 Other Provider Activity

- **9Router:** Local/remote routing gateway with 3-tier fallback routing (subscription, cheap, free). Not a fusion system — it selects one model per request. But relevant as a routing layer that RSemble already integrates with. Includes RTK token compression (20-40% reduction) and Caveman Mode (up to 65% reduction).
- **RouteLLM (LMSYS):** Open-source routing framework. 85% cost reduction on MT-Bench at 95% GPT-4 quality. >40% cheaper than commercial routers. 5,200+ GitHub stars.
- **NotDiamond:** Pre-trained model routing API. Powers OpenRouter's `openrouter/auto` model selection. Supports custom router training on user data. Two pre-trained routers: Chat (general) and Code (coding-agent cost optimization).
- **Smoothie:** Label-free routing using latent variable graphical models. Correctly identifies the optimal model on 9/14 tasks, outperforms baselines by up to 10 points. Relevant as the "when NOT to fuse" gate.
- **Anthropic parallel test-time compute (research):** Claude 3.7 Sonnet achieved 84.8% on GPQA using 256 independent samples + learned scoring model + 64k token thinking budget. This IS an internal ensemble technique (multi-sample + selection), but Anthropic notes it "isn't available in our newly-deployed model" — research, not fully productized.
- **OpenAI o-series:** NOT multi-model ensemble. Single model trained with large-scale RL on chain-of-thought reasoning. OpenAI recommends using o-series as "the planner" + GPT models as "the doer" — a two-model orchestration pattern, but this is user-side composition, not internal fusion.
- **Sakana AI:** Evolutionary weight merging (weight-level fusion, not inference-time). Produced SOTA Japanese LLM/VLM from merging. Research + open models, not a productized fusion API.
- **Distilabel (Argilla):** Open-source reference implementation of MoA paper. Configurable proposers + aggregator + rounds. Library, not a service.

---

## 4. When Fusion Helps and When It Hurts

### 4.1 Fusion Helps When

- **The task is open-ended and subjective.** Deep research, multi-domain critique, expert consultation, "compare and contrast" prompts. The DRACO benchmark (deep research) shows consistent fusion gains.
- **Panelists are individually strong and approximately quality-matched.** Diversity helps at matched quality; the gain is real but modest (+0.027 at k=3).
- **The synthesizer model is strong.** Three-quarters of the lift comes from synthesis. A frontier analyst with a budget panel beats a budget analyst with a frontier panel.
- **The task benefits from structured analysis before synthesis.** The judge-then-synthesize pipeline (consensus, contradictions, blind spots) produces better outputs than raw-response blending.
- **Panelists have access to tools (web search).** Panel-level tool access lets each model research independently, producing genuinely different inputs to the synthesis.
- **Problems are hard enough to justify the cost.** Fusion costs 4-5x a single completion. Easy prompts should be routed, not fused.

### 4.2 Fusion Hurts When

- **The task is verifiable (math, code).** Selection or self-consistency with a verifier outperforms synthesis. On verifiable tasks, the best model usually subsumes weaker ones, and blending introduces incoherence.
- **Panelists vary widely in quality.** Weak models drag the synthesis down. Self-MoA (one strong model sampled N times) beats mixed MoA when quality varies.
- **The synthesizer is weak or the synthesis prompt is shallow.** "Merge the strongest material" without verification, without scores, and without trace access produces stylistic remixes, not genuine synthesis.
- **Models are highly correlated.** On open-ended tasks, frontier models increasingly fail alike (co-failure tail beta > 0). No combination can exceed 1 minus beta. The lever is failure-mode dispersion, not model count.
- **The task is easy.** Fusion's cost (4-5x) is not justified. Route to a single model.
- **The output needs to be an independent answer, not a committee edit.** Synthesis produces compromise outputs that can lose the distinctive strengths of individual candidates.

### 4.3 The Format Effect

A finding with direct implications for RSemble: co-failure tracks answer format, not subject matter. The same GPQA-Diamond questions have beta approximately 0 when asked as multiple-choice but beta 0.127 when asked as free-response. Mean accuracy falls from 0.66 to 0.51 just by stripping the options. This means:

- **Open-ended tasks have a co-failure ceiling** that caps fusion gains.
- **Multiple-choice or structured-output tasks have near-zero co-failure** and high oracle gain, but that gain is resolvable disagreement a router could capture, not fusion headroom.
- RSemble's tasks (open-ended candidate answers judged against criteria) are in the ceiling-bound regime. Fusion gains will be limited by co-failure, not by panel composition.

---

## 5. The Pair Selection Problem

The user's core question: which model pairs fuse best for a particular task class? The literature offers several signals, none sufficient alone.

### 5.1 Error-Overlap Analysis (Jaccard Similarity)

The most directly applicable method. For each model pair, compute the Jaccard similarity of their error sets (instances where both models fail). Low-overlap pairs are candidates for routing or ensembling; high-overlap pairs indicate redundant coverage.

**Findings from the literature:**
- Error-overlap values vary substantially across model pairs and scenarios.
- Within a model family (OLMo variants), overlap ranges from 56% to 62% on GPQA. Even architecturally related models exhibit some diversity.
- Cross-family pairs show lower overlap, but the operational significance remains to be validated.
- Error overlap is descriptive: it does not establish causality nor guarantee that low-overlap pairs yield superior ensemble performance without empirical testing.
- **Agreement-when-both-wrong (Kim et al., 2025):** Across 350+ LLMs, when two models both err on a 10-choice MCQ, they pick the *same wrong answer* 42% of the time (HuggingFace) and 60% (Helm) — 2-5× the random baseline of ~11%. More accurate models have *more* correlated errors, even with different architectures and providers. Shared provider, shared base architecture, and similar size all increase error correlation. Regression features explain 34-62% of variation in error agreement.

**For RSemble:** Run each candidate model on a task suite, record per-instance success/failure, compute pairwise Jaccard. Pairs with low overlap AND high individual quality are the best fusion candidates. This is exactly the kind of analysis RSemble's evaluation suite can automate.

### 5.2 Accuracy-Adjusted Correlation (φ_adj)

Raw correctness correlation (φ) has almost no predictive power for ensemble lift (R² ≤ 0.09). But **accuracy-adjusted φ (φ_adj)** is markedly superior (R² = 0.67 on SuperGPQA). A compact heuristic combining φ_adj + accuracy gap + collective accuracy predicts ensemble lift with Spearman ρ = 0.84 on a calibration set, and transfers with frozen coefficients (ρ = 0.51 on GPQA Diamond, 0.84 on forensic tasks). The key decomposition: ensemble lift = rescue mass (correct answers gained) minus damage mass (correct answers lost).

**For RSemble:** Use φ_adj, not raw φ, as the correlation metric. The heuristic (φ_adj + accuracy gap + collective accuracy) can be computed from a small calibration set and then applied to predict which pairs will lift, without running full fusion on every candidate pair.

### 5.3 Complementary-MoA: Greedy Selection Algorithms

Complementary-MoA (arXiv 2605.24048) reframes proposer selection as feature selection with a black-box objective. Three algorithms spanning the accuracy-efficiency tradeoff:

1. **Model-first greedy:** Keeps the summarizer in the loop; selects the model with highest average marginal gain across prompt variants. Highest accuracy, ~16,000 summarizer calls.
2. **Truth-prediction greedy:** Uses label-level statistics; trains a lightweight ML model to predict ground truth from proposer labels. Zero summarizer calls. Consistently robust.
3. **Oracle-surrogate greedy:** Fits a simple surrogate (maps count of correct inputs → expected summarizer accuracy). ~1,200 calls. Sample-efficient.

Key finding: the most complementary proposer is **sometimes weak on its own**. Optimal teams cannot be inferred from individual performance alone. This directly supports including a seemingly weaker model in the panel if it brings complementary coverage.

### 5.4 The EU Reversal

A counterintuitive finding: the naive intuition "more disagreement → more epistemic utility" is **wrong**. Epistemic uncertainty (EU) correlates +0.72 with redundancy and -0.72 with complementarity. More disagreement between models predicts *less* ensemble value, not more. The operative signal is **pairwise co-failure** (do they fail on the same instances?), not pairwise disagreement (do they produce different outputs?).

### 5.5 Quality-Matched Pool Selection

From the co-failure ceiling paper: at matched quality, low-correlation heterogeneous ensembles beat high-correlation Self-MoA. The gain is +0.027 at k=3, positive in all 60 resamplings, but small. The practical rule:

1. Filter models to a quality band (e.g., all scoring 70-80% on the task suite).
2. Within that band, prefer pairs with low error correlation.
3. Avoid mixing models from different quality tiers.

### 5.3 Task-Skill Matching (DMoA)

Dynamic Mixture of Agents identifies required skills per query, then selects models predicted to perform well on those skills. Key findings:

- Mixtures optimized for one task type (e.g., arithmetic) underperform on others (e.g., instruction following).
- Task-specific skills reside in different subspaces.
- Removing a model from an optimized ensemble degrades performance (specialized knowledge matters).

**For RSemble:** Tag each task in the evaluation suite with its required skills (reasoning, factual recall, creative synthesis, structured analysis, etc.). Build a lookup: which model pairs perform best on each skill tag. This is the task-class routing layer.

### 5.4 DPP-Inspired Diversity (CORE)

CORE (Collaborative Reasoning via Cross Teaching) uses a Determinantal Point Process (DPP) approximation to explicitly reduce error overlap between collaborators. The cross-model complementarity reward discourages both models from converging to the same reasoning mode. Results: removing the cross-model term consistently harms performance on MATH, AIME, and GPQA, where correlated failure dominates.

**For RSemble:** DPP-lite is a training-time method, but the principle applies at inference time. When selecting panel composition, penalize pairs whose outputs are semantically too similar (high cosine similarity of embeddings). The goal is not maximum diversity (which degrades performance) but optimal diversity at matched quality.

### 5.5 The Vendi Score

Self-MoA uses the Vendi Score to measure diversity among proposer outputs. The finding: MoA performance has a positive correlation with both quality and diversity, but is "quite sensitive to the quality" with optimal performance in "regions characterized by high quality and relatively low diversity." The Vendi Score can be computed at inference time over candidate outputs to decide whether to fuse (high quality, moderate diversity) or select (high quality, low diversity or high diversity but low quality).

### 5.6 Smoothie: Label-Free Routing

Smoothie constructs a latent variable graphical model over embedding representations of LLM outputs and unknown "true" outputs. It estimates sample-dependent quality scores without labeled data and routes each sample to the highest-scoring LLM. Correlates with true model quality at rho 0.72, correctly identifies the optimal model on 9/14 tasks.

**For RSemble:** Smoothie's approach could inform the "when not to fuse" gate. If one model's output embedding is clearly closer to the estimated true output, route to it. If multiple models are comparably close, fuse.

### 5.7 Practical Pair Selection Heuristic

Synthesizing the literature into a decision procedure for RSemble:

1. **Establish a task class.** Define the evaluation suite (e.g., "strategic business analysis with quantitative elements").
2. **Run each candidate model individually.** Record per-instance correctness and quality scores.
3. **Compute pairwise error overlap (Jaccard).** Identify low-overlap pairs.
4. **Filter to quality-matched pairs.** Drop pairs where one model is significantly weaker.
5. **Compute semantic diversity (Vendi Score or cosine distance).** Prefer pairs with moderate diversity (not maximum).
6. **Run fusion on the top-K pairs.** Score the fused output with an independent judge.
7. **Compare fused score vs best single-model score.** If fusion does not beat selection, recommend selection (Rank mode) for that task class.
8. **Record the optimal pair + synthesizer + judge configuration per task class.** This is the deliverable: a lookup table from task class to fusion recipe.

---

## 6. Failure Modes and Quality Risks

### 6.1 Stylistic Remix (Copy-Paste Synthesis)

The user's observed failure: the fused answer is a polished remix of candidate phrases, not an independent synthesis. The judge detects "contamination" and "copying" because the fused output reproduces distinctive language from multiple candidates and may confabulate authority.

**Mechanism:** One-shot synthesis over final answers, with no scores, no traces, and no verification instruction, takes the lowest-energy path: pick the best-sounding sentences from each candidate, stitch them, smooth transitions. The model is performing synthesis it was not equipped to do.

**Evidence:** The Selection Bottleneck paper finds synthesis loses to single-model baseline 82% of the time. The synthesis win rate of 0.179 is "consistent with s_synth approximately 0 under our model," meaning synthesis has approximately zero selection capacity.

**Mitigation:**
- Pass judge scores and explanations into the fusion prompt so the synthesizer weights candidates by judged quality.
- Instruct verification of arithmetic, claims, and logic rather than blending.
- Use the judge-then-synthesize pipeline (structured analysis before synthesis) rather than raw-response blending.
- Consider refine-the-winner (take the judge's top candidate and improve it against the rubric) instead of blend-all.

### 6.2 Confabulation and Phantom Citations

The fused answer invents citations to justify the blend ("As Meituan's framework notes," "Gemma calls this the Golden Handcuff fallacy"). These are confabulations: the model generates plausible but nonexistent references to sound synthesized.

**Evidence:** A 2026 study audited 111 million references across 2.5 million papers and found approximately 146,932 hallucinated citations in 2025 alone, concentrated in fields with rapid AI uptake and manuscripts with linguistic signatures of AI-assisted writing. Four types: fully synthetic, real author with fake work, hybrid (elements from different real papers combined), and distorted metadata.

**Mechanism in fusion:** When asked to synthesize without being given a synthesis method, the model confabulates authority to justify the blend. This is amplified when the synthesizer sees model names (non-blind fusion) and tries to attribute insights to specific sources.

**Mitigation:**
- Make fusion blind (candidates as A/B/C, no model names) to prevent source-attribution confabulation.
- Instruct the synthesizer to "resolve contradictions sensibly" rather than "cite frameworks."
- Do not give the synthesizer permission to reference external authorities it cannot verify.

### 6.3 Incoherence and Diluted Arguments

Blending candidates with different framing, assumptions, or conclusions produces an output that contains conflicting perspectives no individual candidate exhibited. The synthesis is "not the average of the candidates' qualities but something potentially worse."

**Mechanism:** Synthesis introduces incoherence when it tries to incorporate material from contradictory candidates without resolving the contradiction. The judge-then-synthesize pipeline mitigates this by surfacing contradictions explicitly, but the synthesizer must still resolve them.

**Mitigation:**
- Use the structured analysis (contradictions, blind spots) to instruct the synthesizer on which position to take.
- Weight candidates by judge scores so the synthesizer favors the stronger position.
- Consider debate-style fusion (revision rounds before synthesis) to let models resolve contradictions before the synthesizer acts.

### 6.4 Weak-Model Drag

Including a weak model in the panel drags the synthesis down because the synthesizer incorporates its material. Self-MoA (one strong model sampled N times) outperforms mixed MoA when quality varies.

**Mitigation:**
- Filter panel to quality-matched models.
- Use a router gate to exclude weak models from the panel for tasks where they are not specialized.
- Weight the synthesis prompt by judge scores so weak-candidate material is deprioritized.

### 6.5 Social and Herding Bias

Naive MoA can be worse than a single model because of social and herding biases: the synthesizer tends to agree with the majority even when the majority is wrong, and a dominant source can overpower the synthesis.

**Mitigation (from chorus):**
- Source anonymization (blind fusion).
- Length normalization (verbose answers do not dominate).
- Mandatory critical dissent (the synthesizer must identify at least one weakness in each candidate).
- Cap on any single source dominating the synthesis.

---

## 7. Evaluation Methodology

### 7.1 The Independent Judge Approach

The user's planned approach (score the fused answer with an independent judge and compare to candidate scores) is well-supported by the literature. The Selection Bottleneck paper used a decoupled evaluation pass with independent judges (GPT-4o-mini, Gemini 2.0 Flash, GLM-5) and confirmed all directional findings (Spearman rho 0.90 with the original panel).

**Best practices:**
- Use a different model family for the independent judge than for the candidates or the synthesizer.
- Blind the judge to which output is the fused answer vs a single-model answer.
- Use pairwise comparison (Bradley-Terry scoring) rather than absolute scores when possible.
- Use multiple judges and report inter-judge agreement (kappa).

### 7.2 Contamination Detection

The user's observation that the judge "can notice that the fused answer is just a copy paste" is a documented signal. The independent judge should be explicitly instructed to check for:
- Distinctive phrases reproduced verbatim from multiple candidates.
- Confabulated citations or authority references.
- Internally inconsistent positions (indicating unresolved contradiction blending).
- Arithmetic or factual errors introduced by blending (e.g., the candidate C arithmetic error in the user's example).

### 7.3 Multi-Agent Debate for Judges

A 2025 NeurIPS paper introduces a multi-agent debate framework for LLM judges where multiple LLMs collaboratively reason and iteratively refine judgments. It outperforms majority voting on complex tasks, with an ensemble size of 7 providing the best balance between accuracy and cost. Adaptive stopping via a Beta-Binomial mixture model with Kolmogorov-Smirnov testing halts the debate when consensus stabilizes.

**For RSemble:** Consider a multi-judge panel for high-stakes fusion evaluation. The current single-judge approach is sufficient for development, but a debate-style judge panel would be more robust for the final "does fusion beat selection" verdict.

### 7.4 Task-Aware Metrics

Generic lexical metrics (BERTScore, BLEURT) are poorly aligned with task semantics for instruction-following and mathematical reasoning. Task-aware measures (compliance scoring for instruction-following, numeric equivalence for mathematics) reveal ranking reversals that headline scores obscure.

**For RSemble:** Use the evaluation profile criteria (the rubric) as the task-aware metric, not generic text similarity. The existing judge-explainability spec already does this, but the independent second judge should also use the same rubric for consistency.

### 7.5 Benchmark Evidence: Fusion vs Selection vs Routing

Three large-scale benchmarks provide empirical context:

**LLMRouterBench (ACL 2026 Findings).** 400K+ instances, 21 datasets, 33 models, ~1.8B tokens. Top routing methods achieve up to 4% accuracy gain over Best Single model and 31.7% cost reduction while matching Best Single performance. Critical caveat: "Several recent approaches, including commercial routers, fail to reliably outperform a simple baseline." OpenRouter specifically showed negative -24.7% performance improvement vs Best Single (though its model pool differs and isn't user-configurable). Avengers-Pro dominates the Pareto frontier. Model-recall failures (when only 1-3 models answer correctly, routers often miss them) drive the persistent gap to Oracle.

**LLMFusionBench / FusionFactory (2025).** 14 tasks, 5 domains, 20 OSS LLMs (8B-671B), 103M tokens. Three fusion levels tested: query-level (routing), thought-level (retrieved reasoning templates), model-level (distillation). Query-level fusion (RouterMLP, RouterKNN, RouterSVM) surpasses best single LLM by 2-16%. GraphRouter achieves strongest consistent performance (>10% relative reward gains). Thought-level fusion achieves best overall performance; model-level fusion performs worst (overfitting).

**RouterEval (EMNLP 2025 Findings).** 200M+ performance records, 8,500+ LLMs, 12 benchmarks. Even "all-weak" groups (individual performance ≤ 0.3) can reach oracle performance of 0.95 with m=10 on MMLU. Performance grows most rapidly at m ∈ {2, 3, 5} — small pools are most cost-effective. Model-level scaling up: routing performance improves as candidate pool grows, especially with capable routers.

---

## 8. Task-Dependent Fusion

### 8.1 Task Type Determines Optimal Strategy

Different task types reward different aggregation strategies:

| Task Type | Best Strategy | Evidence |
|---|---|---|
| Verifiable (math, code) | Selection or self-consistency | Selection bottleneck: synthesis loses 82% of the time; MoA shows limited advantage over self-agent scaling on math |
| Open-ended research | Judge-then-synthesize | OpenRouter Fusion: 69% on DRACO deep research, beating all solo models |
| Instruction following | Aggregation and synthesis | DMoA: AS outperforms ranking and self-consistency on open-ended tasks |
| Commonsense reasoning | Consensus protocols | Voting or consensus: consensus improves 2.8% on knowledge tasks |
| Strategic reasoning | Voting protocols | Voting improves 13.2% on reasoning tasks |
| Safety reasoning | Diverse debate | MAD with diverse agents reduces attack success rate |
| Factual accuracy | Multi-model refinement | MAMM-Refine: G+C (GPT + Claude) is significantly more effective for error detection than same-model copies |

### 8.2 The Pareto-Optimal MoA Configuration

A 2026 ACL paper finds that MoA dominates the Pareto front across benchmarks on compute-accuracy trade-offs. At comparable compute budgets, MoA gains +2.7 points over self-consistency. The design guideline: **MoA is most efficient when the number of parallel generations exceeds the number of sequential aggregations by one.** Gains persist on harder tasks (+9 pp for 15-20x CoT budget) but diminish on easy tasks.

### 8.3 Debate vs Vote vs Synthesis

A 2025 Findings-ACL paper systematically compares decision protocols:
- **Voting** improves performance by 13.2% on reasoning tasks.
- **Consensus** improves performance by 2.8% on knowledge tasks.
- More agents improves performance; more discussion rounds before voting reduces it.
- All-Agents Drafting (independent solutions before interaction) improves by 3.3%.
- Collective Improvement (structured refinement) improves by 7.4%.

**For RSemble:** The current Rank/Fuse toggle maps to selection vs synthesis. A third option, "Debate" (revision rounds before synthesis), could be valuable for task classes where contradictions need resolution before synthesis. But this is a larger scope change.

### 8.4 Multi-Agent Search (MOSA)

Mixture-of-Search-Agents uses multiple LLMs to propose and aggregate search directions in MCTS-style reasoning. Consistently outperforms single-LLM search by 1.71% average across four reasoning benchmarks. The key mechanism: different models propose diverse sub-questions, and a neural aggregator refines candidate sub-answers.

---

## 9. Implications for RSemble AI

### 9.1 Current State Assessment

RSemble's current Fusion mode (`fusionMessages` in `pipeline.ts`) implements the simplest form of response-level fusion: one-shot synthesis over final answers with no scores, no traces, and no verification instruction. The synthesizer sees full candidate text labeled by model name and is told to "merge the strongest material."

This is exactly the configuration the literature identifies as weakest:
- No judge scores fed to the synthesizer (equal weighting of strong and weak candidates).
- No verification instruction (confabulation risk).
- Non-blind fusion (source-attribution confabulation).
- One-shot, not iterative (no contradiction resolution before synthesis).

### 9.2 The Rank/Fuse Spine

The evidence strongly supports RSemble's Rank mode (judge-based selection). Selection is the empirically winning move in diverse-team settings. The Fusion mode needs redesign to justify its cost.

### 9.3 The User's Vision: Policy Discovery Per Task Class

The user's vision has been refined through design review. It is not merely "which two models look complementary" but rather: **for this task class, what execution policy gives the best quality/cost tradeoff — one model, Rank over a pair, or Fuse a pair under a particular recipe?** This is more defensible and fits the product's existing architecture, where Rank and Fuse are two finishes over the same fan-out → Judge spine.

RSemble's evaluation suite infrastructure (versioned profiles, per-task results, provenance) is well-suited for this:

1. **Define a task class** as an evaluation suite (no skill tags needed; the versioned suite is the controlled workload definition).
2. **Run all candidate models** individually on the suite.
3. **Compute continuous-score complementarity headroom** from per-task anchored scores (see the Design Revision section — pairwise Jaccard over binarized pass/fail labels is demoted to a secondary signal because it discards the rich 1–5 criteria scores the rubric system exists to capture).
4. **Run fusion** only on pairs with meaningful headroom and reasonable quality.
5. **Score fused outputs** with an independent holdout judge, blind and randomized, separate from the development judge that informed the synthesis.
6. **Compare** fused score against three baselines: best-fixed single model, Rank winner, and rubric-aware refine-the-winner (which receives the same rubric information Fusion gets, controlling for the "revision against the rubric" confound).
7. **Record** the optimal execution policy per task class with cost and confidence.

A first-class outcome of this program is the honest negative: for some task classes the answer will be "do not fuse — Rank or refine-the-winner wins" or even "fusion is not worth its 4-5x cost here." That is a more valuable deliverable than a marginal pair recommendation.

### 9.4 Candidate Fusion Recipe Improvements (to be calibrated, not assumed)

The following recipe changes are supported by the evidence above, but per the Design Revision their individual contributions should be **measured in RSemble's own staged calibration rather than adopted on faith**. In priority order of hypothesis strength:

**1. Feed judge scores into the fusion prompt.** The synthesizer would know which candidates scored highest and why. Score-aware synthesis is hypothesized to beat score-blind synthesis, but this must be tested (Stage A of the calibrated design) — and it introduces a measurement constraint: any judge whose scores inform the synthesis cannot then evaluate the result (see the holdout-judge design).

**2. Make fusion blind.** Candidates as A/B/C, no model names. This prevents source-attribution confabulation and herding bias toward model identity. The label mapping is resolved after synthesis, same as the judge stage.

**3. Use the judge-then-synthesize pipeline.** Instead of handing raw responses to the synthesizer, first produce structured analysis (consensus, contradictions, unique insights, blind spots), then have the synthesizer write from that analysis. This is what OpenRouter Fusion does and what the user's current architecture partially supports (the judge stage already produces this analysis for Rank mode).

**4. Add a verification instruction.** The synthesizer should be told to verify arithmetic, check claims against the candidate texts, and flag any reasoning it cannot confirm. This addresses the "polished-but-false" failure mode.

**5. Treat refine-the-winner as both control and candidate policy.** Take the judge's top-ranked candidate and improve it against the rubric, using the other candidates as reference material. As a control, it isolates whether fusion's lift comes from complementary information or merely from an extra rubric-aware revision pass. As a policy, it is commercially interesting in its own right: a single-model recipe with no pair dependency, at roughly half the cost of pair fusion. If it matches fusion on a suite, the playbook recommendation is "one strong model + rubric revision" — a better answer for the user than a marginal pair.

**6. Add a router gate.** Not all prompts need fusion. Simple or factual prompts should be routed to a single model. The fusion cost (4-5x) should be reserved for prompts that benefit from multiple perspectives.

---

## 10. Recommended Research Program (Superseded)

> **Superseded by the Design Review.** The six-phase program below assumed (a) the "Candidate D" evaluation design, (b) Jaccard error overlap as the primary pair metric, and (c) adoption of score-aware fusion without calibration. All three assumptions were revised. The corrected, staged program is specified in the **Design Revision** section and in the companion Fusion Study specification (`docs/specs/executed/fusion-study/`). The phases below are retained for historical traceability of how the design evolved.

### Phase 1: Baseline Validation (Existing Infrastructure) *(superseded)*

Run the user's planned experiment: score fused outputs vs candidate outputs with an independent judge across a representative task suite. Confirm whether the current fusion produces outputs at or below the best candidate. This establishes the baseline.

**Deliverable:** Empirical evidence of current fusion quality vs selection quality on the user's task class.

### Phase 2: Error-Overlap Mapping

For each task in the evaluation suite, record per-instance success/failure for every candidate model. Compute pairwise Jaccard similarity of error sets. Produce a heatmap of model-pair error overlap per task class.

**Deliverable:** Error-overlap matrix identifying complementary vs redundant model pairs per task class.

### Phase 3: Score-Aware Fusion

Implement the highest-leverage fusion improvement: feed judge scores and explanations into the fusion prompt. Re-run the Phase 1 experiment with score-aware fusion. Compare to score-blind fusion and to selection.

**Deliverable:** Empirical evidence of score-aware fusion vs score-blind fusion vs selection.

### Phase 4: Blind Fusion + Judge-Then-Synthesize

Make fusion blind (candidates as A/B/C) and use the judge's structured analysis as the synthesis input instead of raw responses. Re-run experiments.

**Deliverable:** Empirical evidence of structured-analysis fusion vs raw-response fusion.

### Phase 5: Pair Discovery

Using the error-overlap matrix from Phase 2 and the best fusion configuration from Phases 3-4, run fusion on quality-matched, low-overlap pairs across the task suite. Score each pair's fused output with the independent judge. Produce a ranked list of best fusion pairs per task class.

**Deliverable:** A lookup table from task class to optimal fusion pair + synthesizer + judge configuration.

### Phase 6: Refine-the-Winner Comparison

Implement refine-the-winner as an alternative to blend-all. Compare its quality to fusion and selection on the same task suite.

**Deliverable:** Empirical comparison of three finish modes: Rank (selection), Fuse (blend-all), Refine (improve-the-winner).

---

## 11. References

### Academic Papers

1. Wang, J. et al. "Mixture-of-Agents Enhances Large Language Model Capabilities." arXiv:2406.04692, 2024. (Original MoA)
2. Li, Z. et al. "Rethinking Mixture-of-Agents: Is Mixing Different Large Language Models Beneficial?" arXiv:2502.00674, 2025. (Self-MoA)
3. "When Agents Disagree: The Selection Bottleneck in Multi-Agent LLM Pipelines." arXiv:2603.20324, 2026. (Selection vs synthesis)
4. "Beyond Consensus: Trace-Level Synthesis in Mixture of Agents." arXiv:2605.29116, 2026. (Trace-level synthesis, aggregation paradox)
5. "When Does Combining Language Models Help? A Co-Failure Ceiling on Routing, Voting, and Mixture-of-Agents Across 67 Frontier Models." arXiv:2606.27288, 2026. (Co-failure ceiling)
6. Jiang, D. et al. "LLM-Blender: Ensembling Large Language Models with Pairwise Ranking and Generative Fusion." ACL 2023. (Rank-then-fuse)
7. "Balancing Diversity and Consistency in Large Language Model Ensembles." ICLR 2025. (DMoA, EigenDivergence)
8. Wan, F. et al. "Knowledge Fusion of Large Language Models." ICLR 2024. (FuseLLM, weight-level fusion)
9. Shi, T. et al. "ProFuser: Progressive Fusion of Large Language Models." AAAI 2026. (Progressive fusion)
10. "Mixture of Thoughts." arXiv:2509.21164, 2025. (Latent-level fusion)
11. "Task-Aware Evaluation and Error-Overlap Analysis for Large Language Models." ACL 2025 CHoMPS. (Jaccard error overlap, complementarity)
12. "Are Diversity Metrics Measuring Diversity?" arXiv:2607.20768, 2026. (Diversity-capability entanglement)
13. "State-dependent error correlations shape voting thresholds in committees of AI agents." arXiv:2607.23931, 2026. (Committee voting thresholds)
14. "How Much of the Routing Gap Is Real?" arXiv:2607.03436, 2026. (Router-to-oracle gap decomposition)
15. "CORE: Collaborative Reasoning via Cross Teaching." arXiv:2601.21600, 2026. (DPP diversity, cross-model complementarity)
16. "Adaptive Heterogeneous Multi-Agent Debate." Springer 2025. (A-HMAD, role-diverse debate)
17. "Multi-Agent Debate for LLM Judges with Adaptive Stability Detection." NeurIPS 2025. (Debate judges, Beta-Binomial stopping)
18. "Voting or Consensus? Decision-Making in Multi-Agent Debate." Findings ACL 2025. (Protocol comparison)
19. "MAMM-Refine: A Recipe for Improving Faithfulness in Generation with Multi-Agent Collaboration." arXiv:2503.15272, 2025. (Multi-model refinement)
20. "Multi-LLM Collaborative Search for Complex Problem Solving." Findings ACL 2026. (MOSA)
21. "ModeX: Evaluator-Free Best-of-N Selection for Open-Ended Generation." ACL 2026. (Spectral clustering selection)
22. "Collective Test-Time Scaling." arXiv:2508.03333, 2025. (CTTS-MM, multi-agent multi-reward)
23. "Multi-Agent Reasoning Improves Compute Efficiency: Pareto-Optimal Test-Time Scaling." ACL 2026 SRW. (Pareto-optimal MoA)
24. "Smoothie: Label-Free LLM Routing." arXiv:2412.04692, 2024. (Unsupervised routing)
25. "LLM hallucinations in the wild: Large-scale evidence from non-existent citations." arXiv:2605.07723, 2026. (Phantom citations at scale)
26. Kim, S. et al. "Correlated Errors in LLMs." arXiv:2506.07962, 2025. (Agreement-when-both-wrong, error correlation drivers)
27. "Predictive Law of Ensemble Lift." arXiv:2607.17384, 2026. (φ_adj, rescue mass vs damage mass)
28. "Complementary-MoA." arXiv:2605.24048, 2026. (Greedy proposer selection algorithms)
29. "Efficient Ensemble Selection for Compound LLM Systems." arXiv:2605.09588, 2026. (Multiwinner voting, failure-conditioned greedy)
30. "LLMRouterBench." ACL 2026 Findings. (Largest routing benchmark, 400K+ instances)
31. "LLMFusionBench / FusionFactory." 2025. (Three fusion levels, thought-level wins)
32. "RouterEval." EMNLP 2025 Findings. (8,500+ LLMs, model-level scaling)
33. Friedman, B. & Dieng, A. "The Vendi Score: A Diversity Measure for Machine Learning." arXiv:2210.02410, 2023.

### Production Systems

26. OpenRouter. "Fusion | Multi-model AI Analysis." Documentation and blog, 2025-2026.
27. Nous Research. "Hermes Mixture of Agents 2.0." Hermes Agent v0.17.0-v0.18.0, June-July 2025.
28. Together AI. "Together Mixture-Of-Agents." GitHub: togethercomputer/MoA.
29. fusionHarness. GitHub: jackulau/fusionHarness.
30. openfusion. GitHub: shrdgn/openfusion.
31. chorus. GitHub: paperclipinc/chorus.
32. fusion-engine. GitHub: luckeyfaraday/fusion-engine.
33. mixture-llm. PyPI: mixture-llm v0.1.5.
34. OpenPipe. "Mixture of Agents Models." Documentation, 2025.
35. RouteLLM (LMSYS). GitHub: lm-sys/RouteLLM.
36. NotDiamond. "AI Model Routing API." Documentation, 2025.
37. Sakana AI. "Evolutionary Model Merge." Research and open models, 2024-2025.
38. Distilabel (Argilla). "MixtureOfAgentsLLM." Documentation, 2025.

---

## 12. Design Revision (Post-Review, July 31, 2026)

This section records corrections made after the research report was reviewed against the current product and UI specifications. The review accepted the product thesis (fusion research is a sound foundation for RSemble's evolution) but changed the experimental design in four significant ways. The companion specification for the revised design lives at `docs/specs/executed/fusion-study/`.

### 12.1 The research question changed: from pair discovery to policy discovery

The original framing asked "which two models look complementary?" The revised framing asks: **for this task class, what execution policy gives the best quality/cost tradeoff — one model (best-fixed), Rank over a pair, Fuse a pair under a specific recipe, or rubric-aware refine-the-winner?** This is more defensible because Rank and Fuse already exist as competing finishes over the same fan-out → Judge spine, and the Selection Bottleneck result (selection beats synthesis on all 42 tested tasks) makes "is fusion even worth it here?" a legitimate and likely outcome per task class. The deliverable is a per-suite execution playbook, not a pair leaderboard.

### 12.2 Retracted: the "Candidate D" evaluation design

The original proposal scored the fused answer by adding it to the candidate set and re-running the same judge over A/B/C/D. This is experimentally invalid for three independent reasons:

1. **Circularity.** If the synthesis is informed by the judge's scores or analysis (score-aware or judge-guided fusion), then having that same judge evaluate the downstream product creates a preference loop: the synthesis was optimized toward what that judge just said it liked.
2. **Scale distortion.** Adding a fourth candidate changes an LLM judge's relative scoring behavior, so the A/B/C scores in the second evaluation are not comparable to the first.
3. **The rubric confound (decisive).** Per the product spec, candidate models do not receive evaluator-only criteria, while Fusion receives criteria and anchors as synthesis targets. If the fused answer beats A and B, the improvement might simply be "it was allowed to revise against the rubric," not "A and B contained complementary information." This confound is fatal to the pair-discovery question.

**Replacement: development/holdout judge separation.** Judge 1 (development) ranks candidates and may inform the synthesis. Judge 2 (holdout) evaluates the Rank winner, the fused output F, and the refine-the-winner control R', blind and randomized. Judge 1 helps make the answer; Judge 2 measures whether it actually got better. Judge 2 must differ from both Judge 1 and the synthesizer, preferably by provider family, to avoid correlated blind spots. A fusion trial is therefore an experiment-level construct spanning two judged evaluations, with provenance binding (suite snapshot, candidate config, Judge 1 version, recipe version, F artifact, Judge 2 version, holdout result) into one sealed unit.

### 12.3 Demoted: Jaccard error overlap as the primary pair metric

The ensemble literature's error-overlap metrics assume binary correctness outcomes. RSemble's evaluations produce rich, anchored 1–5 criteria scores. Binarizing those scores into pass/fail to compute Jaccard discards exactly the information the rubric system exists to capture. The primary complementarity metric for open-ended suites is instead **continuous-score headroom**:

- PairOracle(A, B) = mean over tasks of max(score_A, score_B)
- BestFixed(A, B) = max(mean score_A, mean score_B)
- **ComplementarityHeadroom = PairOracle − BestFixed**

Intuition: how much latent value exists because A is better on some tasks and B on others? If they succeed and fail together, headroom approaches zero; if each rescues the other's weak cases, it grows. Headroom does not prove synthesis will capture the value — it tells you which pairs are worth spending fusion tokens on.

Two caveats. First, the oracle is an *optimistic* estimator: max(A, B) per task is positively biased under stochastic sampling, so single-generation headroom is inflated by noise and shrinks on replication. Shortlisted pairs therefore get repeated samples (2–3 generations), bootstrap confidence intervals across tasks, and a win rate, not a single mean. Second, binary co-failure metrics (Jaccard, φ_adj) remain appropriate for suites with deterministic correctness (math, unit tests, exact JSON validity), and φ_adj is a useful optional signal there — but it is not the core of the pair engine for open-ended generative evaluation.

### 12.4 Retracted: the "three-quarters of lift comes from synthesis" claim

As corrected in the Executive Summary and §3.1: OpenRouter's primary source does not quantify a synthesis/diversity split, and the self-fusion ablation does not isolate synthesis. The working conclusion is that aggregation quality is a major variable whose contribution RSemble should **measure directly** through staged recipe calibration rather than assume.

### 12.5 The staged experimental design (replaces the six-phase program)

- **Stage A — Recipe calibration.** On 2–3 representative pairs, test recipe variants: current raw synthesis, blind raw synthesis, raw responses + qualitative judge analysis, analysis + numeric scores, and refine-the-winner. The refine-the-winner control receives the same rubric information Fusion gets; if it performs as well as pair fusion, the second model is not buying much — the lift is an extra revision pass. All variants are evaluated by the holdout judge.
- **Stage B — Pair discovery.** Freeze the best-performing recipe and synthesizer temporarily. Run the model pool individually over the suite, compute complementarity headroom, and fuse only the top-K pairs.
- **Stage C — Interaction check.** Take the best 2–3 pairs and repeat them with 2–3 synthesizers/recipes to distinguish "A + B is a great pair" from "A + B works particularly well when C synthesizes them."

### 12.6 Placement and report format

No fourth "Discovery" workspace. The Fusion Study lives inside Evaluations as an experiment type on a suite, consistent with the product's three-surface discipline (Compare, Runs, Evaluations) and its prohibition on unscoped global analytics. The final report is a policy comparison table — Policy / Configuration / Score / Lift / Cost / Confidence — whose conclusion takes the form: "For this suite: Fuse B+C when maximum quality matters; Rank A+C when cost matters; do not use fusion for routine runs."

### 12.7 What this makes RSemble

Not "a tool that finds good model pairs" but an **empirical decision engine for multi-model inference**: given a workload, it discovers whether collaboration is worthwhile at all, which models provide complementary capability, how to combine them, and whether the extra quality justifies the additional inference cost. That is a stronger evolution of the existing Rank/Fuse idea than adding a generic MoA feature.

---

*This document was prepared as a research foundation for RSemble AI's Fusion mode evolution. All claims are grounded in the cited literature and production system documentation. Section 12 supersedes earlier experimental-design recommendations where they conflict.*
