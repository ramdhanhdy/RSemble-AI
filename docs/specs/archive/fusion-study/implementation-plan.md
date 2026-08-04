# Fusion Study Implementation Plan

> Companion to `docs/specs/archive/fusion-study/fusion-study-spec.md` (v2, advisor-reviewed).
> Grounding: the current codebase — `src/lib/evaluations/` (profiles, suites, experiment
> orchestration), `src/lib/persistence/` (RunRecordV2 with immutable attempt records),
> `src/lib/pipeline.ts` (Compare fan-out → Judge → Fuse spine),
> `src/workspaces/evaluations/` (Evaluations UI), `src/studio-data.ts` (JudgeReport with
> criterion-level anchored scores).
> Status: plan for review. No code until approved. Ordered so each stage lands a
> reviewable, test-covered artifact; later stages consume only artifacts sealed by
> earlier ones.

---

## 0. What the codebase already gives us (and what it does not)

**Already present, reused unchanged or lightly extended:**

- **Immutable attempt-level provenance.** `RunRecordV2` carries `CandidateAttemptRecord`,
  `JudgeAttemptRecord`, and `FusionAttemptRecord` with exact rendered messages, token
  counts, blind-label maps, and `candidateAttemptIdsByCandidateId` lineage. The
  Trial/Attempt rule (spec §6.2) maps naturally onto this: the existing attempt records
  *are* the immutable children.
- **Judge retry against retained candidates.** Run recovery already re-runs the Judge
  without regenerating candidates (and slot-level candidate retry resolves by identity,
  reading the current slot model). This is the reuse semantics the blocked-comparison
  design generalizes.
- **Experiment orchestration.** `experiment-engine.ts` drives queued → running → terminal
  task attempts with `BeginExperimentTaskInput` / `CommitExperimentTaskTerminalInput`,
  execution fences, and leases. Fusion Study stages ride this machinery rather than a new
  orchestrator.
- **Criterion-level anchored scores.** `JudgeReport.evaluationsById` →
  `CandidateEvaluation.criterionScores: JudgeCriterionScore[]` plus
  `EvaluationCriterion.weight`. This is exactly what `H_synth` needs — no judge change is
  required to compute it.
- **Blind judging with label resolution.** The Judge stage already anonymizes candidates
  and resolves labels after judging (`blindLabelToCandidateId`). The fusion-blindness
  invariant (spec §5.2) adopts the same discipline.
- **Run sources.** `RunSource` already distinguishes `adhoc` vs `experiment` runs with
  suite version + fingerprint lineage. Fusion Study runs get a new source kind alongside
  these.

**Not present, must be built:**

- No versioned fusion-recipe artifact (fusion prompt is hardcoded in `pipeline.ts`).
- No pool manifest entity.
- No `verification.kind` on tasks.
- No headroom analytics (nothing computes pairwise statistics over per-task scores).
- No holdout-judge concept (Judge 2) as an experiment-level role, and no seal-time
  anti-circularity check.
- No Fusion Study entity, stages, trials, or playbook; no Evaluations UI for any of it.

---

## 1. Workstreams at a glance

| # | Workstream | Produces | Consumed by |
|---|---|---|---|
| A | Domain model + persistence | FusionStudy / Trial / Attempt / Recipe / PoolManifest / verifier types, validation, storage | everything |
| B | Recipe + pipeline | Recipe family prompts, blindness invariant, rubric-access flag, refine-the-winner path, blocked-policy runner | C, D |
| C | Analytics | H_select / H_synth / per-criterion headroom, binary co-failure (verifier-gated), pool adequacy probe, bootstrap stats | D |
| D | Study orchestration | Stage A/B/C drivers on experiment-engine, Trial/Attempt lifecycle, anti-circularity seal check, cost rollup | E |
| E | Evaluations UI + playbook | Fusion Study surface under a suite, screened-pair table, trial views, playbook with claim levels | — |
| F | Authority docs + confirmation lifecycle | PRODUCT/DECISIONS/UI updates, exploratory→confirmed promotion | — |

Dependency spine: **A → B → C → D → E**, with F running alongside D and E. Each stage is
sequenced to be independently reviewable; do not parallelize B/C before A lands, since
their types anchor on A's records.

---

## 2. Stage A — Domain model and persistence

**Goal:** every entity in the spec exists as a validated, immutable, storable record.

1. **Types + validators** in `src/lib/evaluations/fusion-study-types.ts` (new), following
   the `evaluation-types.ts` pattern (interface + `is*` type guards + prohibited-key
   scan):
   - `FusionRecipeVersion` — `id`, `version`, `recipeFamily` (`BlindRaw | AnalysisFed |
     AnalysisScores`), `promptVersion`, `judgeAnalysisMode`, `rubricAccess` (explicit
     boolean), `verification` (boolean), `synthesizer: CriticRef`. *No blindness field —
     it is an invariant, not a variable.*
   - `PoolManifestVersion` — `id`, `version`, `core: ModelSlot[]` (6–8), `challengers:
     ModelSlot[]` (0–2), `diversityChecklist: string[]`, `rationale: string`,
     `supersedesVersion: number | null`, `createdAt`.
   - `VerificationKind` — `none | exact_match | numeric | schema | unit_tests |
     custom_checker`; added to `EvaluationTask` as an optional `verification` field
     (v1: task level only; see Open Questions §14.2 of the spec).
   - `FusionTrial` — spec §6.3 fields: suite snapshot ref, pool manifest ref, candidate
     config, `judge1`/`judge2` refs, recipe ref, stage (`A | B | C`), `sampleIndex`,
     child refs (candidate run id, dev-judge run id, synthesis artifact id, holdout
     attempt ids), cost rollup, `sealedAt`, status (`in_progress | sealed`).
   - `FusionAttempt` / `EvaluationObservation` — distinguishing treatment-changing
     attempts from measurement-only observations per spec §6.2.
   - `FusionStudy` — study id, suite ref, pool ref, judge pair, recipe set, stage
     results, playbook ref, claim level (`exploratory | confirmed`).
2. **Persistence** in `src/lib/persistence/` — new stores alongside the evaluation
   repository, reusing its revision/fence/lease idioms. Trials seal via a dedicated
   `sealTrial` transaction that runs the anti-circularity check (D4) and rejects on
   conflict.
3. **Validation** — mirror `suite-validation.ts`: pool size bounds (core 6–8,
   challengers ≤ 2, total ≤ 10), unique enabled `providerId:slug` keys in pool, judge
   pair well-formedness, recipe required-fields.

**Exit tests:** type-guard round-trips; prohibited-key rejection; seal is final;
child records immutable on creation; pool validation bounds. (Spec required tests 1, 9.)

## 3. Stage B — Recipe artifacts and the blocked-policy pipeline

**Goal:** the fusion step becomes a versioned, blind, rubric-flagged recipe; the pipeline
can run all four policies blocked on shared candidate generations.

1. **Recipe prompt templates** extracted from `pipeline.ts` into
   `src/lib/evaluations/fusion-recipes.ts` (new): one template per family, with
   `judgeAnalysisMode` controlling what the synthesizer receives (none / qualitative
   analysis / analysis + numeric criterion scores), `rubricAccess` gating whether
   criteria + anchors are included, and `verification` toggling the
   verify-arithmetic/flag-unconfirmable instruction.
2. **Blindness invariant.** The synthesis prompt presents candidates as anonymized labels
   reusing the judge stage's `blindLabelToCandidateId` discipline; label resolution
   happens after synthesis. Real model names never reach the synthesizer. (This is a
   behavior change to the existing Compare Fuse path too — see §8, migration.)
3. **Refine-the-winner path** — new finish that takes the Judge-1 winner and revises it
   against the rubric using the other candidates as reference, with the *same*
   `rubricAccess` content as the fusion recipe under test (confound control, spec §7.1).
4. **Blocked-policy runner** in `src/lib/evaluations/policy-runner.ts` (new): for a given
   task + sample index, runs candidates once, Judge 1 once, then derives Rank / Fuse /
   Refine from that shared evidence. Only the finishing step varies. All four policy
   outputs + shared lineage are persisted against the trial.

**Exit tests:** prompt assembly per family (snapshot tests on rendered messages);
blindness invariant (no model slug/provider string appears in synthesizer messages —
asserted, not eyeballed); refine control receives rubric content identical to the fusion
recipe; blocked runner shares candidate/judge attempt ids across policies. (Spec tests
5, 7; acceptance 6 partial.)

## 4. Stage C — Complementarity and statistics

**Goal:** the analytics that decide which pairs are worth fusing, computed from stored
scores.

1. **Headroom metrics** in `src/lib/evaluations/complementarity.ts` (new):
   - `selectionHeadroom(A, B)` over per-task overall scores (spec §5.4).
   - `synthesisHeadroom(A, B)` over criterion scores weighted by `EvaluationCriterion.weight`.
   - Per-criterion headroom breakdown (core shortlisting signal).
   - Consumes `JudgeReport.evaluationsById[*].criterionScores` from stored runs — no new
     judge calls.
2. **Binary co-failure metrics** (Jaccard; φ_adj optional) computed **only** where
   `verification.kind ≠ none` *and* executed verifier output exists. Never from rubric
   scores. Bimodal-score warning surfacing (diagnostic only).
3. **Pool adequacy probe** — implements spec §5.6: detect below-ceiling best model +
   near-zero oracle + no material pair headroom, and flag for outside-pool challenger
   runs; record outcome (`confirmed | unconfirmed`).
4. **Statistics** in `src/lib/evaluations/study-stats.ts` (new): paired task-level deltas
   (repeats averaged within task), wins/ties/losses, bootstrap CI over tasks (task is the
   resample unit), permutation/sign-flip sensitivity check for small N, MPID comparison →
   `adopt | not_justified | inconclusive`.

**Exit tests:** known-answer fixtures — identical-strengths pair → both metrics zero;
the 5/3/4-vs-3/5/4 pair → H_select ≈ 0, H_synth strongly positive; optimism bias shrinks
with repeated samples; verifier gate refuses binary metrics from rubric-only tasks;
bimodal warning fires; bootstrap resamples tasks not generations. (Spec tests 4, 5, 6;
acceptance 4, 5.)

## 5. Stage D — Study orchestration (Stages A/B/C)

**Goal:** drive the three-stage protocol on top of the experiment engine, with the
Trial/Attempt lifecycle and seal-time safety enforced.

1. **Trial/Attempt lifecycle** (`fusion-study-controller.ts`, new): create trial → attach
   immutable children as stages complete → seal. Enforce the spec §6.2 rule
   programmatically:
   - Holdout failure → new `EvaluationObservation` on the same trial (artifact preserved,
     reused).
   - Synthesis rerun / candidate regeneration → new trial attempt (new `sampleIndex`).
   - Recipe change → new trial.
   - Retry storms never inflate sample counts (guard test).
2. **Anti-circularity seal check** — `sealTrial` rejects Judge 2 = Judge 1 or
   Judge 2 = synthesizer, naming the conflict. (Spec test 2, acceptance 2.)
3. **Stage A driver** — stratified pair selection (high / median / near-zero headroom),
   runs the recipe-family ablation + RefineWinner control, **eliminates** dominated or
   unstable families, emits the top two survivors (not a single winner).
4. **Stage B driver** — pool sweep (one generation/model/task), compute headroom for all
   pairs, predeclared shortlist rule, run **both** surviving recipes on the first 2–3
   shortlisted pairs, sequential elimination, blocked holdout evaluation vs the three
   baselines (best-fixed, Rank, Refine).
5. **Stage C driver** — runner-up recipe spot check on best 1–2 pairs (flags
   recipe-sensitive rankings), recipe × synthesizer cross for the top pair within budget.
6. **Cost rollup** — edge-level costs from attempt records rolled to trial observed cost;
   policy cost vs experimental cost reported separately (spec §6.4).

**Exit tests:** Trial/Attempt semantics matrix (all six event types); circularity
rejection; Stage A emits exactly two survivors; Stage B shortlist follows the predeclared
rule and records the full screened-pair table; Stage C flags a recipe-sensitive ranking
in a fixture; cost rollup correctness. (Spec tests 3, 8, 10; acceptance 3, 6, 10.)

## 6. Stage E — Evaluations UI and the playbook

**Goal:** the Fusion Study surface under a suite, per spec §9 — nothing else.

1. **Study shell** under `src/workspaces/evaluations/` (e.g. `FusionStudyRoute.tsx` +
   section components), attached to a suite alongside Tasks / Experiments:
   - **Baseline (Stage A)** — stratified pairs, per-family results, elimination outcome.
   - **Pair shortlist (Stage B)** — the *full* screened-pair table (H_select, H_synth,
     per-criterion, cost), not just winners.
   - **Fusion trials (Stages B–C)** — trial list with stage, status, provenance drill-in,
     per-trial cost.
   - **Playbook** — the policy comparison table.
2. **Playbook rendering** — Policy / Configuration / Score / Lift / Cost / Confidence
   with claim-level badge (`Exploratory` / `Confirmed`), pool-adequacy qualifier, and the
   narrative conclusion line ("Fuse B+C when maximum quality matters; Rank A+C when cost
   matters; do not use fusion for routine runs."). "Do not fuse" rendered as a
   first-class verdict, not an error.
3. **Provenance drill-in** — read-only views of sealed trials exposing the full
   provenance chain (suite snapshot, pool manifest, candidates, both judges, recipe,
   artifacts, holdout, cost).

**Exit tests:** playbook renders all four policies + claim badge + "do not fuse" verdict;
screened-pair table shows losers as well as winners; drill-in renders sealed provenance;
no navigation outside Evaluations is added. (Acceptance 7, 8, 9, 10.)

## 7. Stage F — Authority docs and the confirmation lifecycle

1. **Docs:** `PRODUCT.md` (Fusion Study as an Evaluations experiment type; policy-
   discovery framing; two claim levels; "do not fuse" first-class), `DECISIONS.md`
   (items a–i from spec §13), `UI.md` (placement, playbook, screened-pair table).
2. **Confirmation lifecycle:** a follow-up study on a *new* suite version (fresh tasks)
   that evaluates the preselected configuration **without re-selection**, promoting an
   exploratory recommendation to confirmed (or demoting it). This leans on existing
   immutable suite versioning; the guard is that confirmation studies do not re-run
   shortlisting.

**Exit test:** exploratory → confirmed promotion only via a fresh-task study with no
re-selection (spec test 11).

---

## 8. Migration and coexistence notes

- **Compare surface behavior change.** Making fusion blind and routing it through a
  versioned recipe changes the existing ad-hoc Fuse output (currently non-blind, hardcoded
  prompt). This should be treated as a deliberate, documented behavior change in the same
  release, not a silent side effect — Compare's Fuse mode becomes "run with recipe
  `BlindRaw` v1" (the current behavior preserved as a legacy recipe only if you want
  A/B continuity; recommendation: do not preserve it, since it is the known-weak config).
- **Existing experiment runs are untouched.** Fusion Study adds new record types; no
  migration of `RunRecordV2` history is required. Headroom analytics read historical runs
  where present but do not require them.
- **No new top-level navigation.** All routes live under the existing Evaluations
  workspace, consistent with the three-surface discipline.

## 9. Suggested sequencing and review gates

| Gate | Lands | Review focus |
|---|---|---|
| G1 | Stage A (domain model + persistence) | Record shapes, immutability, pool/recipe validation |
| G2 | Stage B (recipes + blocked runner) | Blindness invariant enforcement, refine confound control |
| G3 | Stage C (analytics) | Headroom math against known-answer fixtures |
| G4 | Stage D (orchestration) | Trial/Attempt rule, anti-circularity seal, stage drivers |
| G5 | Stage E (UI + playbook) | Playbook honesty (claim levels, "do not fuse"), no scope creep |
| G6 | Stage F (docs + confirmation) | Authority updates match shipped behavior |

Each gate is independently reviewable and test-covered; later gates consume only sealed
artifacts from earlier ones. G3 (headroom) and G4 (Trial/Attempt) are the two the advisor
flagged as load-bearing — they should not be compressed.

## 10. Explicitly out of scope for this plan

- Conditional recipe routing ("scores only when criterion complementarity > X") — post-v1.
- Router gate for routine prompts — may be informed by playbooks later; not built here.
- Weight-level / latent-level fusion.
- Cross-suite model rankings or any global analytics surface.
- Per-criterion verifiers (task-level only in v1 — spec Open Question §14.2).

## 11. Test strategy summary

Every stage ships its own fixtures and unit tests (listed per stage above), plus a small
set of integration tests at G4 that drive a synthetic Fusion Study end-to-end against
mock providers: stratified Stage A → headroom shortlist → blocked Stage B → Stage C spot
check → sealed playbook, asserting the Trial/Attempt rule and anti-circularity hold
throughout. The existing pattern of colocated `*.test.ts` files and the
`experiment-engine` / `evaluation-repository` test idioms are the template. No UI
snapshot churn beyond the new components; existing suites must stay green
(`npm run check` = typecheck web + server, full vitest, build).
