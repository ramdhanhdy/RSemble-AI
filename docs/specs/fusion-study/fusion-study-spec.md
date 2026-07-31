# Fusion Study Specification (v2)

> Feature area: turn RSemble's Rank/Fuse spine into an empirical decision engine that
> discovers, per evaluation suite, which execution policy gives the best quality/cost
> tradeoff — best-fixed single model, Rank over a pair, Fuse a pair under a specific
> recipe, or rubric-aware refine-the-winner.
> Authority: subordinate to `PRODUCT.md`, `PROVIDERS.md`, `UI.md`, and `DECISIONS.md`.
> Grounding: `docs/research/llm-fusion-research.md` (esp. §12, Design Revision).
> Status: design for review. v2 incorporates external advisor review (2026-07-31):
> headroom split into selection vs synthesis metrics; blindness as invariant; recipe
> elimination instead of coronation; verifier-derived determinism; Trial vs Attempt
> provenance; blocked policy comparison; exploration vs confirmation claim levels.
> No implementation until approved.

---

## 1. Problem statement

RSemble's Compare surface runs the same fan-out → Judge spine with two finishes: Rank
(judge-based selection) and Fuse (one-shot synthesis over candidate answers). The user
wants to evolve the app toward a discovery capability: given a class of tasks, find the
best way to execute them.

The research review (Design Revision, `llm-fusion-research.md` §12) established that the
naive version of this vision is experimentally unsound, and that the sound version is both
more defensible and a better fit for the existing product. The advisor review refined the
design further. Five problems must be solved before any pair discovery can produce
trustworthy results.

### 1.1 Fusion experiments have no identity or provenance

Today the fusion step is a hardcoded prompt in `pipeline.ts`. A fused output cannot be
traced to the recipe version, synthesizer model, or judge-analysis mode that produced it.
Without versioned identity, two fusion runs are not comparable, and no empirical claim
about "which recipe works" can be made or reproduced. Provenance must also distinguish a
new experimental treatment from a remeasurement of an unchanged artifact, or statistics
will silently overcount retries as independent samples.

### 1.2 The evaluation of fusion is circular and confounded

Any design that scores the fused answer with the same judge that informed its synthesis
creates a preference loop. Any design that adds the fused answer to the original candidate
set and re-judges distorts the judge's relative scoring. And — decisively, per the product
spec — candidates do not receive evaluator-only criteria while Fusion receives them as
synthesis targets, so a fused answer beating its candidates may only demonstrate "it was
allowed to revise against the rubric," not "the pair contained complementary information."

### 1.3 There is no complementarity metric suited to anchored rubric scores

The ensemble literature's pair metrics (Jaccard error overlap, φ_adj) assume binary
correctness. RSemble produces anchored 1–5 criterion-level scores. Binarizing them into
pass/fail to compute Jaccard discards the information the rubric system exists to capture.
Moreover, a simple per-task oracle metric detects only *selection* complementarity (A wins
some tasks, B wins others) and is blind to *synthesis* complementarity (A and B tie
overall on every task but hold different criterion strengths inside each answer — the
pairs Fusion should be best at). Two distinct metrics are needed.

### 1.4 Fusion is compared against the wrong baseline

"Does the fused answer beat the individual candidates?" is the wrong question. The
decision-relevant question is: **for this suite, which execution policy — best-fixed
model, Rank, Fuse under recipe X, or refine-the-winner — gives the best quality/cost
tradeoff?** Fusion must beat Rank and a rubric-aware refine pass, not just solo outputs,
to justify its cost. The honest answer for some suites will be "do not fuse," and that
outcome must be first-class.

### 1.5 Exploration and confirmation must not be conflated

Stages that select winners from observed data (recipe selection, pair shortlisting) are
model-selection procedures. Any confidence interval computed over the same data used to
pick the winner is optimistically biased (winner's curse). With small suites, splitting
into train/test subsets destroys power. The design must make "exploratory recommendation"
and "confirmed recommendation" visibly different claim levels rather than pretending
screening results are confirmatory.

## 2. Goals

1. Make fusion experiments identifiable and reproducible: version the recipe, synthesizer,
   judges, candidate config, pool manifest, and suite snapshot, with a Trial/Attempt
   model separating new treatments from remeasurements.
2. Establish development/holdout judge separation so the judge that informs synthesis
   never evaluates its product.
3. Define two continuous-score complementarity metrics — selection headroom and
   criterion-level synthesis headroom — using the rubric scores RSemble already stores.
   Binary co-failure metrics apply only where a task has a genuine verifier.
4. Calibrate fusion recipes by *elimination* across stratified pairs, carrying two
   survivors briefly into pair discovery instead of hard-freezing one recipe from three
   pairs.
5. Compare policies blocked on the same candidate generations and development evidence,
   so only the finishing policy varies.
6. Produce a per-suite execution playbook with exploratory and confirmed claim levels,
   including "do not fuse" as a first-class recommendation.
7. Place all of this inside the existing Evaluations surface as an experiment type on a
   suite — no new workspace, no global analytics dashboard.

## 3. Non-goals

1. **No skill tags on tasks.** A versioned suite is the controlled workload definition.
   Evidence aggregates within a suite context; no cross-suite global model rankings.
2. **No full pair × recipe Cartesian product.** Recipes are narrowed by elimination, and
   a limited runner-up spot check guards the freeze.
3. **No fourth product surface.** Fusion Study lives in Evaluations. Compare and Runs are
   unchanged.
4. **No routing as a user-facing product concept.** A router gate may later be informed
   by playbooks; out of scope here.
5. **No weight-level or latent-level fusion.** Inference-time, response-level fusion only.
6. **No conditional recipe routing in v1.** Policies of the form "include scores only
   when criterion complementarity exceeds threshold X" are learned decision boundaries
   derived from very little data. First establish whether analysis-fed and score-fed
   synthesis are robustly useful; conditional routing can come later.
7. **No manual "deterministic" toggle.** A user checkbox must never convert subjective
   1–5 judge scores into truth labels.
8. **Blindness is not an experimental variable.** Per the product's methodological
   invariant, blind evaluation applies to Fusion Study unconditionally.

## 4. Current implementation diagnosis

- `fusionMessages` in `src/lib/pipeline.ts` builds a one-shot synthesis prompt: full
  candidate texts labeled by real model name, task, criteria, and a "merge the strongest
  material" instruction. It receives no judge scores, no structured judge analysis, and
  no verification instruction. Fusion is non-blind and single-pass.
- The Judge stage (Rank) already produces criterion-level anchored scores and structured
  explanations. These are currently used only for selection. They are exactly the data
  the synthesis-headroom metric needs — no new judge machinery is required to compute it.
- Run provenance records task, candidates, judge, and outputs, but fusion recipe identity
  does not exist as a versioned field, and there is no Trial/Attempt distinction.
- The existing run-recovery behavior already retries a failed Judge against retained
  candidate outputs without regenerating them — the same reuse semantics this spec
  generalizes to the policy level.
- Evaluations provides versioned suites, profiles, immutable experiments, and per-task
  scored results — the aggregation context this spec builds on, and the natural home for
  the exploration → confirmation lifecycle (a later suite version with fresh tasks is
  the confirmation vehicle).

## 5. Core concepts

### 5.1 Execution policy

An execution policy is a complete, costed way to produce an answer for a suite:

| Policy | What runs | Relative cost |
|---|---|---|
| Best-fixed | One model, one generation | 1× |
| Rank | N candidates + Judge 1 | ~(N+1)× |
| Fuse | N candidates + Judge 1 + synthesizer | ~(N+2)× |
| Refine | 1 candidate + rubric-aware revision pass | ~2× |

Policies are compared **blocked**: for a given task and sample index, all policies share
the same candidate generations and the same development-judge evidence; only the
finishing step varies. This strips stochastic variance for free, reduces token spend,
and matches the existing pipeline's sharing of Judge results between Rank and Fuse.

### 5.2 Fusion recipe

A fusion recipe is a versioned artifact. Its versioned fields:

- `recipeFamily` — one of `BlindRaw`, `AnalysisFed`, `AnalysisScores` (see §7.1).
- `promptVersion` — the synthesis instruction template.
- `judgeAnalysisMode` — what the synthesizer receives: `none` (raw anonymized responses),
  `qualitative` (consensus/contradictions/unique-insights/blind-spots analysis),
  `scores` (qualitative + numeric per-criterion scores).
- `rubricAccess` — explicit boolean declaring whether the synthesizer receives the
  evaluator-only criteria and anchors. This field exists because rubric access is the
  decisive confound variable; it must be declarable, not hidden in prompt text.
- `verification` — whether the prompt includes the verify-arithmetic/flag-unconfirmable
  instruction.
- `synthesizer` — provider + model.

**Blindness is an invariant, not a field.** Candidates are always presented to the
synthesizer as anonymized A/B/C with label mapping resolved after synthesis, consistent
with the product's blind-evaluation invariant and the judge-stage label discipline.

### 5.3 Development and holdout judges

- **Judge 1 (development)** ranks candidates and may inform the synthesis (via
  `judgeAnalysisMode`). It helps make the answer.
- **Judge 2 (holdout)** evaluates the policy outputs — Rank winner, fused output F,
  refine-the-winner output R′ — blind and randomized. It measures whether the answer got
  better.

**Anti-circularity rule:** Judge 2 must differ from Judge 1 and from the synthesizer,
preferably by provider family. Multiple holdout judges on the same artifact are multiple
*observations*, not multiple trials (§6.2).

### 5.4 Two complementarity metrics

RSemble stores criterion-level anchored scores, enabling a distinction most ensemble
tooling cannot make.

**Selection headroom** — "can choosing A versus B per task help?" (the Rank-pair signal):

```
H_select(A,B) = E_t[ max(S_A,t, S_B,t) ] − max( E[S_A], E[S_B] )
```

**Within-task synthesis headroom** — "within the same answer, do A and B hold different
criterion strengths?" (the Fuse-pair signal). With criterion weights w_c and per-criterion
scores S_{·,t,c}:

```
O_AB,t  = Σ_c w_c · max( S_A,t,c , S_B,t,c )
H_synth = E_t[ O_AB,t − max(S_A,t, S_B,t) ]
```

The ladder:

```
Best fixed model
      │
      │  H_select
      ▼
Best member of pair per task
      │
      │  H_synth
      ▼
Best criterion from either model per task   (oracle upper bound)
```

The top rung is an oracle bound, not a promise: criteria can conflict and answers are not
Lego bricks. H_synth tells you latent value exists for a synthesizer to capture, not that
it will.

**Interpretation matrix:**

| H_select | H_synth | Verdict |
|---|---|---|
| high | low | Strong Rank pair |
| low | high | Strong Fuse candidate — the pairs selection-headroom alone would miss |
| high | high | Strong candidate for either policy |
| low | low | Probably redundant pair |

Worked example of why the split matters: if on every task A scores (accuracy 5,
completeness 3, overall 4) and B scores (3, 5, 4), then H_select ≈ 0 — neither model ever
has the better overall answer — while H_synth is strongly positive. This is nearly the
ideal fusion pair, and it is invisible to selection headroom.

Per-criterion headroom (which specific criteria each model rescues) is a **core
shortlisting signal**, reported alongside the two aggregates, not a secondary diagnostic.

**Optimism caveat:** per-task max is positively biased under stochastic sampling.
Shortlisted pairs receive repeated samples and bootstrap CIs (§7.4).

### 5.5 Verifier-derived determinism

Deterministic correctness is not a property of a suite or a profile; it is a property of
whether a task (or criterion) has an external verifier. Represent per task (or
criterion):

```
verification.kind: none | exact_match | numeric | schema | unit_tests | custom_checker
```

Metric derivation follows the evidence that actually exists:

- Verifier present → binary correctness and co-failure metrics (Jaccard; φ_adj optional).
- Rubric criterion scores present → selection + synthesis headroom.
- Mixed suite → each metric computed and reported on its corresponding task/criterion
  subset.

A user override may attach a verifier configuration to a task. It may not reclassify
subjective rubric scores as deterministic. Empirically bimodal score distributions (a
judge that loves 1s and 5s) are a diagnostic warning only — they do not convert a rubric
into a verifier.

### 5.6 Model pool manifest

The pool is a **versioned manifest**, not a calendar-refreshed list:

- **Core pool: 6–8 models**, chosen for failure-mode diversity (independent families,
  scale/cost tiers, post-training strengths), refreshed only on a maximum age or a
  meaningful ecosystem event — a major model generation appears, a model disappears, or
  the pool becomes materially stale. Each manifest version (e.g. "Core Pool v3") is
  frozen for experiments and superseded explicitly, preserving cross-suite comparability
  without arbitrary churn.
- **Suite challengers: 0–2 models**, predeclared per suite as hypotheses (a code
  specialist for a coding suite, a long-context model for document analysis).
- Active pool ≤ 10. Pair count, judging cost, and multiple-comparison noise grow faster
  than incremental value beyond that.
- The pool composition, diversity checklist, and rationale are persisted in the suite
  snapshot. Otherwise "fusion works for coding but not summarization" may actually mean
  "we chose a better pool for coding."

**Pool adequacy probe.** "No complementary pair" is ambiguous between "models genuinely
share the task's failure mode" and "the pool is redundant" — observationally
indistinguishable from inside the pool. Escalation rule: if best-model mean is
meaningfully below ceiling, pool-level oracle headroom is near zero, and no pair has
material headroom, run 1–2 outside-pool challenger models before concluding. If
challengers also fail on the same instances/criteria, the no-fusion conclusion is much
more credible; if one opens headroom, the pool was inadequate.

Report language: *"No pairwise opportunity in the declared pool. Pool adequacy:
confirmed / unconfirmed."*

## 6. Experiment model

### 6.1 Hierarchy

```
FusionStudy                       (experiment type on a suite version)
└── Trial                         (one treatment: immutable spec + artifact refs)
    ├── candidate evaluation      (child: existing Evaluation type)
    ├── development-judge eval    (child: evaluation / immutable analysis artifact)
    ├── synthesis artifact F      (child: immutable text + content hash + recipe/gen settings)
    └── EvaluationAttempts        (holdout observations on unchanged artifacts)
        ├── holdout attempt 1 — failed
        ├── holdout attempt 2 — completed
        └── optional second-judge observation
```

### 6.2 The Trial vs Attempt rule

> **If the generated treatment artifact changes, it is a new trial attempt. If only the
> measurement of an unchanged artifact changes, it is a new evaluation observation on the
> same trial.**

| Event | Result |
|---|---|
| Holdout API timeout | New evaluation attempt, same trial |
| Regrade F with another judge family | New observation, same trial |
| Rerun synthesis with same inputs | New trial attempt (sampling noise is part of the treatment) |
| Regenerate candidate B | New trial attempt |
| Change recipe | New trial (new treatment) |
| Change suite snapshot | New experiment context |

Without this rule, three holdout retries of one artifact can be miscounted as three
independent fusion samples, corrupting every downstream statistic.

### 6.3 Trial record

A sealed trial binds: suite snapshot, pool manifest version, candidate configuration,
Judge 1 version, recipe version, artifact references (with content hashes), sample index,
stage (A | B | C), cost summary, seal timestamp, and lineage links. Child entities are
immutable on creation; the parent is `in_progress` while assembling links and immutable
once sealed. Reuse of unchanged immutable children across trials is allowed and
encouraged (e.g. the same candidate evaluation feeds Rank, Fuse, and Refine policies).

Content-addressing alone is not sufficient for deduplication: identical output text under
different model versions, prompts, or decode settings is not the same experimental
artifact. Full generation provenance is retained.

### 6.4 Cost accounting

Cost is stored at every call/artifact edge and rolled upward:

```
candidate generation + dev judge + synthesis + holdout attempt(s)
= trial observed cost
```

Reports distinguish **policy cost** (what a clean successful execution normally costs)
from **actual experimental cost** (including retries and failures).

## 7. The staged protocol

### 7.1 Stage A — Recipe elimination

Blindness is mandatory. The recipe families under test form a clean ablation over what
the synthesizer receives:

```
Candidates (anonymized)
    │
    ├── BlindRaw        — candidate answers only
    ├── AnalysisFed     — + qualitative development-judge analysis
    └── AnalysisScores  — + analysis + numeric criterion scores

RefineWinner            — rubric-aware revision of the Judge-1 winner (control)
```

Run on **3–4 deliberately stratified pairs**, not three convenient top pairs:

1. A high-headroom pair.
2. A median-positive-headroom pair.
3. A near-zero-headroom, same-family, or strongly asymmetric pair (control).

**Stage A eliminates recipes; it does not crown one.** Any recipe consistently dominated
or unstable across the stratified pairs is dropped. The **top two surviving families
proceed into Stage B**. If the refine-the-winner control matches pair fusion, the second
model is not buying complementary information — the lift is an extra rubric-aware
revision pass. That finding is reported, not suppressed.

### 7.2 Stage B — Pair discovery with sequential recipe elimination

1. Run every pool model individually over the suite (one generation per model per task
   for screening).
2. Compute H_select, H_synth, and per-criterion headroom for all pairs.
3. Shortlist the top-K pairs (K ~ 5–6) by a **predeclared rule** — e.g. positive headroom
   above an uncertainty threshold — not simply the top-K point estimates. Report the
   complete screened-pair table, not only the winners (winner's-curse transparency).
4. For the first 2–3 shortlisted pairs, run **both surviving recipe families**. If one
   remains consistently better, drop the other and use the survivor for the remaining
   pairs. This cheap sequential-elimination design guards the freeze against pair ×
   recipe interaction far better than a hard freeze from Stage A.
5. Holdout-evaluate all policy outputs blocked on shared candidate generations and dev
   evidence.

### 7.3 Stage C — Interaction check

On the best 1–2 pairs from Stage B:

- Run the Stage A **runner-up recipe family** once alongside the frozen family. If the
  runner-up overturns the result, flag the Stage B ranking as **recipe-sensitive** rather
  than silently presenting it as a pair-quality result.
- Cross the top two recipes with two synthesizers for the best pair where budget permits.
  This separates "A + B is a great pair" from "A + B works particularly well when C
  synthesizes them" — pair × synthesizer and pair × recipe are different interactions.

### 7.4 Repeated sampling and statistics

"One model × one task × one generation" is too noisy for pair discovery, but small suites
(10–30 tasks) support screening, not sharp claims by default. Protocol:

- One generation per model for screening; 2–3 repeated generations for shortlisted pairs.
- **Blocked comparison:** all policies for a given task and sample index share the same
  candidate generations and dev evidence. Policy deltas are computed within block.
- **Paired task-level analysis:** for policies P and Q, d_t = mean(S_P,t) − mean(S_Q,t)
  with repeats averaged within task. Bootstrap or permutation-test the vector of N task
  deltas — the task is the generalization unit; 20 tasks × 3 generations is not n = 60.
  (A hierarchical bootstrap — resample tasks, then repetitions within tasks — is an
  acceptable refinement; averaging repeats per task is the defensible v1.)
- **Report per finalist comparison:** mean paired delta, median paired delta,
  wins/ties/losses, CI, cost delta, and a predeclared **MPID** (minimum practically
  important difference — a product decision threshold, e.g. "fusion needs ≥ +0.20 to
  justify ≥ 2× cost"), concluding `adopt` / `not justified` / `inconclusive`.
- **Budget priority:** paired analysis → honest intervals and the inconclusive outcome →
  more representative tasks (toward 30–50) → 2–3 finalist repeats → more repeats only if
  within-task generation variance demonstrably dominates. Thirty tasks × 2 repetitions is
  more informative than 10 tasks × 6, because new tasks reduce workload uncertainty while
  repeats only reduce decoding noise.

Example report line:

> Fuse B+C vs. refine-winner: mean paired delta +0.28, 90% CI [−0.02, +0.55],
> wins/ties/losses 18/3/4, incremental cost +42%. Inconclusive relative to the +0.25 MPID.

### 7.5 Exploration vs confirmation

Stages A and B are selection procedures; any interval computed over the selection data is
optimistic. With small suites, train/test splits destroy power. Instead, Fusion Study
makes two visibly different claim levels:

- **Exploratory recommendation** — "best observed configuration in Suite v4 under this
  pool and protocol."
- **Confirmed recommendation** — "configuration selected on Suite v4 remained better on
  newly added tasks in Suite v5."

The vehicle is RSemble's existing immutable suite versioning: fresh tasks arrive as a new
suite version, and a follow-up Fusion Study on it promotes (or demotes) the prior
recommendation. A confirmation study evaluates the preselected configuration on fresh
tasks only — it does not re-select, or the winner's curse re-enters.

## 8. The playbook artifact

The per-suite deliverable is a policy comparison table with an explicit claim level:

| Policy | Configuration | Score | Lift | Cost | Confidence |
|---|---|---|---|---|---|
| Best single | Model A | 4.18 | baseline | 1× | high |
| Rank | A + C | 4.37 | +0.19 | 2.4× | high |
| Fuse | B + C → Synth X | 4.52 | +0.34 | 3.2× | medium |
| Refine | A → Synth X | 4.45 | +0.27 | 2.1× | high |

Status: **Exploratory** — pending confirmation on fresh tasks.

Whose conclusion takes the form:

> For this suite: Fuse B+C when maximum quality matters; Rank A+C when cost matters; do
> not use fusion for routine runs. Pool adequacy: confirmed. Status: exploratory.

"Do not fuse" is a first-class result, not a failure state.

## 9. Placement and UI discipline

Fusion Study is an experiment type inside Evaluations, attached to a suite:

```
Evaluations
└── <Suite name> v<n>
    ├── Tasks
    ├── Experiments
    └── Fusion Study
        ├── Baseline (Stage A — recipe elimination)
        ├── Pair shortlist (Stage B — with full screened-pair table)
        ├── Fusion trials (Stages B–C)
        └── Playbook (exploratory or confirmed)
```

No new top-level surface. No global analytics dashboard. No cross-suite model rankings.
Consistent with the product's three-surface discipline (Compare, Runs, Evaluations).

## 10. Error handling and safety

- **Judge 2 failure** creates a new evaluation attempt on the same trial; the synthesized
  artifact F and all upstream children are preserved and reused.
- **Anti-circularity violation** (Judge 2 = Judge 1 or synthesizer) blocks trial sealing
  with an explicit error naming the conflict.
- **Partial candidate failure** follows existing run-recovery behavior: retry the slot or
  switch its model without regenerating peers. Because this changes a treatment artifact,
  it begins a new trial attempt; trial provenance records the final candidate config used.
- **Verification-metric mismatch:** if a task has `verification.kind ≠ none` but only
  rubric scores are present (verifier configured but not executed), the pair metrics fall
  back to rubric headroom and a warning is surfaced; binary metrics are never synthesized
  from rubric scores.
- **Cost guardrails:** each stage reports cumulative observed cost before proceeding;
  Stage B's K and Stage C's matrix size are explicit user-confirmed parameters.
- **Multiple-comparison discipline:** the full screened-pair table is always reported;
  strong pair-level claims may not be made solely from the data used to select the pair.

## 11. Acceptance criteria

1. A Fusion Study can be created on a suite version with a pool manifest, two judges
   satisfying the anti-circularity rule, and versioned recipes.
2. A trial seals with full provenance and rejects sealing on Judge-2 circularity.
3. The Trial/Attempt rule is enforced: holdout retries attach to the same trial;
   artifact-changing reruns create new trial attempts; recipe changes create new trials.
4. H_select and H_synth are computed from stored criterion-level scores for every pool
   pair, with per-criterion headroom reported, and the known-answer test (the 5/3/4 vs
   3/5/4 example) yields H_select ≈ 0 and strongly positive H_synth.
5. Binary co-failure metrics are computed only for tasks/criteria with
   `verification.kind ≠ none` and executed verifier output; never from rubric scores.
6. Stage A stratifies its calibration pairs and emits two surviving recipe families;
   Stage B runs both on the first shortlisted pairs and records which survived and why.
7. Policy comparisons are blocked on shared candidate generations and dev evidence, and
   reports include paired deltas, wins/ties/losses, CI, cost delta, MPID, and an
   adopt / not-justified / inconclusive verdict.
8. The playbook renders the policy table with an exploratory or confirmed claim level,
   and can conclude "do not fuse" with a pool-adequacy qualifier.
9. The pool adequacy probe triggers outside-pool challengers under the stated conditions
   and records the outcome.
10. All of the above lives inside Evaluations on a suite; no new surface is added.

## 12. Required tests

1. **Provenance integrity:** sealing serializes all provenance fields; tampering fails
   validation. Content-hash collisions under different generation settings are correctly
   treated as distinct artifacts.
2. **Anti-circularity:** unit tests reject Judge 2 = Judge 1 and Judge 2 = synthesizer.
3. **Trial/Attempt semantics:** holdout timeout → same trial, new attempt; synthesis
   rerun → new trial attempt; recipe change → new trial. Retry storms never inflate
   sample counts.
4. **Headroom math:** known score matrices produce known H_select and H_synth; the
   identical-strengths pair yields zero of both; the 5/3/4 vs 3/5/4 pair yields zero
   H_select and positive H_synth.
5. **Optimism bias:** synthetic noisy scores show both headroom metrics shrinking with
   repeated samples.
6. **Verifier gate:** Jaccard/φ_adj computed only with executed verifier output;
   bimodal rubric distributions trigger a warning, not a metric switch.
7. **Blocked comparison:** policy deltas for a task/sample share identical candidate
   artifact references.
8. **Recipe elimination:** a dominated recipe family is excluded from Stage B; the
   runner-up spot check in Stage C flags a recipe-sensitive ranking correctly.
9. **Immutability:** child records cannot be modified after creation; parent seals are
   final; reuse of children across trials references, never duplicates.
10. **Cost accounting:** edge costs roll up to trial observed cost; policy cost and
    experimental cost are reported separately.
11. **Confirmation lifecycle:** an exploratory recommendation can be promoted only by a
    follow-up study on a new suite version with fresh tasks, evaluating the preselected
    configuration without re-selection.

## 13. Authority-document updates

- `PRODUCT.md` — add Fusion Study as an Evaluations experiment type; state the
  policy-discovery framing, the two claim levels, and "do not fuse" as a first-class
  outcome.
- `DECISIONS.md` — record: (a) development/holdout judge separation and the
  anti-circularity rule; (b) the selection/synthesis headroom split using criterion-level
  scores; (c) recipe-as-versioned-artifact with explicit `rubricAccess` and blindness as
  invariant; (d) refine-the-winner as both control and candidate policy; (e) verifier-
  derived determinism, no manual deterministic toggle; (f) Trial vs Attempt provenance;
  (g) blocked policy comparison; (h) exploration vs confirmation via suite versions;
  (i) retraction of the "Candidate D" design and the "75% synthesis" claim.
- `UI.md` — Fusion Study placement under a suite in Evaluations; the playbook table with
  claim-level badges; the full screened-pair table.

## 14. Open questions for review

1. **Stage A pair count:** are 3–4 stratified pairs enough to eliminate confidently, or
   should elimination require a minimum dominance margin across pairs?
2. **Verifier granularity:** is `verification.kind` per task sufficient, or do real
   suites need per-criterion verifiers (a coding task with unit-test functional
   correctness plus rubric-judged code quality)? Per-criterion is more faithful but
   complicates the metric derivation.
3. **Confirmation economics:** what minimum fresh-task count justifies promoting an
   exploratory recommendation to confirmed, given that confirmation studies forgo
   re-selection and therefore need less data?
4. **Pool manifest governance:** who/what may trigger a core-pool version bump mid-study
   if a flagship model launches between Stage B and Stage C — finish with the frozen
   pool, or restart screening?
