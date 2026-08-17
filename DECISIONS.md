# DECISIONS.md — RSemble AI Architectural Decisions

This document records architectural decisions made for RSemble AI.

> **Reconciliation note (Plan 006, 2026-08-07):** `UI.md`, `DESIGN.md`, and
> `TODOS.md` referenced inside historical decisions are no longer shipped in
> this repository. Those references are preserved for provenance; the current
> product/UI authority is `PRODUCT.md` plus this file.
>
> **Terminology note (Child 01, 2026-08-12):** Scoring objects previously called
> "Profiles" or "evaluation profiles" are now "Rubrics" in all user-facing
> surfaces, domain code, and routes (spec: `docs/specs/archive/
> 01-rubric-terminology/`). Historical decisions
> below preserve the original "Profile" terminology for provenance; the
> scoring contracts they define (versioning, immutability, criteria validation,
> `Q − λ(1−C)` ranking) are unchanged. Legacy IndexedDB stores and frozen
> serialized field names (`evaluationProfileId`, `evaluationProfileVersion`)
> remain physical implementation details behind canonical Rubric adapters.
> The word "profile" is reserved for the future model evidence profile.
>
> **Reconciliation note (Child 02, 2026-08-14):** Canonical Tasks, immutable
> Task Versions, concrete Task Instances, Task Families, versioned Facet
> annotations, conservative legacy-suite migration, and the extensible archive v2
> envelope are shipped (spec: `docs/specs/archive/02-canonical-tasks/`). Tasks are
> a secondary `/tasks` catalog, not a fourth primary workspace. Historical
> decisions below remain authoritative; nothing in this child rewrites Run,
> Experiment, or Fusion Study evidence. Task Set editor migration, comparison
> task promotion, observations, and model evidence profiles remain future
> children. See Decision #13 for the load-bearing contract.
>
> **Reconciliation note (Child 03, 2026-08-16):** Canonical Task Sets are
> shipped (spec: `docs/specs/pending/task-first-evidence-workbench/
> 03-task-sets-and-evaluations/task-sets-and-evaluations-spec.md`). A Task Set
> owns versioned task membership: `TaskSetRecord` (mutable administrative state
> via compare-and-swap), immutable `TaskSetVersion` / WorkloadManifest (members
> pin exact canonical Task Versions), immutable `TaskSetMaterializationRecord`
> execution snapshots, and the `taskSetOwnershipCrosswalk` store resolving
> legacy owner coordinates (suite-manifest, experiment-owner, fusion-owner) to
> exact Task Set Versions. The archive v2 envelope gains an optional `taskSets`
> payload (records/versions/materializations/ownership crosswalks) with exact
> counts, deterministic ordering, reference-graph validation, prohibited-content
> scanning, and collision-abort-before-write import; earlier-v2 envelopes
> without the key remain readable and the seven Fusion collections stay
> separately typed and unconverted (format version stays 2).
> Historical decisions below use "suite" language to describe the pre-Task-Set
> evaluation model. The reconciliation for the flagged sentences is:
> - **Decision #7** ("Local Suites", "versioned local suites", "suites pin to
>   profile versions", "multi-task suites"): the versioned membership and
>   rubric pinning those sentences describe are now owned by Task Sets; the
>   legacy Evaluation Suite remains the physical compatibility row migrated
>   conservatively into `legacy-suite` Task Sets.
> - **Decision #9** ("Policy Discovery on Suites", "suite versions", "versioned
>   suites"): Fusion Study remains a Task-Set-owned experimental record; the
>   "suite version" a study attaches to is a Task Set Version today. The
>   exploration/confirmation and blocked-comparison contracts are unchanged.
> - **Decision #10** item 6 ("persisted on suites/snapshots", "strict suite
>   parity"): reasoning-effort provenance and the protocol-fingerprint parity
>   contract are now carried by Task Set Versions/materializations; the parity
>   contract itself is unchanged.
> - **Decision #13** context ("Evaluation Suite tasks had stable IDs only
>   inside an embedded suite document") and item (d) (conservative migration):
>   those sentences describe the Child 02 canonical Task migration, which is
>   unchanged; Child 03 adds the Task Set layer above it.

> **Reconciliation note (Child 04, 2026-08-17):** Canonical Task Observations,
> immutable Eligibility Decisions, exact Model Configuration snapshots,
> evidence rule/version metadata, and the archive v2 optional `evidence` payload
> extension are shipped (spec: `docs/specs/pending/task-first-evidence-workbench/
> 04-observations-and-evidence/observations-and-evidence-spec.md`). Observations
> are immutable references/indexes over exact evidence without duplicating
> candidate output or full rationale. Operational retries and reused outputs
> never inflate sample counts. Decision revisions append deterministically.
> The archive v2 envelope gains an optional `evidence` payload
> (modelConfigurations, observations, evidenceDecisions, evidenceIndexJobs,
> verifierOutcomes) with exact counts, deterministic ordering, reference-graph
> validation, prohibited-content scanning, and collision-abort-before-write
> import; earlier-v2 envelopes without the key remain readable, and Fusion Study
> observations stay strictly isolated without conversion or ID collision.
> See Decision #14 for the load-bearing contract.
>
---

## Decision #1: Focused Direction (Split Workspace / Variation B)
- **Date:** 2026-06-17
- **Context:** Orcha Studio was a 3-panel layout with a node-based canvas, reactive inspector drawer, and complex profile routing. It added unnecessary complexity for a personal model comparison tool.
- **Decision:** Replaced the 3-panel studio layout with a clean two-pane Split Workspace (Variation B):
  - Top header containing identity, run status, and the sole Rank/Fuse toggle.
  - Left pane: Command (Task input, toggleable model list, collapsed rubric, Run button).
  - Right pane: Output (Rank leaderboard or Fuse merged document).
- **Rationale:** Focuses on the single core capability: running N candidates in parallel, judging them against a rubric, and offering Rank or Fuse finishes.

---

## Decision #2: Technical Instrument Aesthetic
- **Date:** 2026-06-16
- **Context:** Choosing a visual design system for an AI model comparison tool.
- **Decision:** Adopt an industrial/utilitarian dark mode theme (`bg-zinc-950`), Geist + Geist Mono typography, compact density, and minimal cyan (`#00e5ff`) accents for active states and primary actions. Avoid generic AI SaaS tropes (gradients, SVG blobs, bubbly corners).

---

## Decision #3: Brand Identity — RSemble AI
- **Date:** 2026-06-19
- **Context:** Renaming product from Adaptive Fusion to RSemble AI.
- **Decision:** Update brand display text across title, header, and X-Title headers to RSemble AI. Retain the exact visual design system and single pipeline spine (Rank/Fuse).

---

## Decision #4: Multi-Provider Support & Localhost Codex Bridge
- **Date:** 2026-07-22
- **Context:** RSemble AI was bound exclusively to OpenRouter (`src/lib/openrouter.ts`). Users need to access models via ChatGPT subscriptions (via Codex CLI login) and direct Google AI Studio API keys (Gemini), alongside OpenRouter.
- **Decision:**
  1. Introduce a provider adapter registry (`src/lib/providers/`) supporting `openrouter`, `chatgpt-codex`, and `gemini`.
  2. Keep the pipeline (`pipeline.ts`) strictly provider-agnostic.
  3. Build a lightweight localhost Node server (`server/codex-bridge/`) bound exclusively to `127.0.0.1`. The bridge reads `~/.codex/auth.json` (or `%USERPROFILE%\.codex\auth.json`) and handles token refreshes to proxy Codex responses for personal local ChatGPT subscription access.
  4. Anthropic and other non-listed vendors are strictly out of scope.
  5. The bridge is an infrastructure detail for personal local auth, NOT a multi-user hosted backend (which remains strictly OUT per PRODUCT.md §5).

---

## Decision #5: 9Router Provider Support
- **Date:** 2026-07-29
- **Context:** A user wants to compare models already configured in 9Router (aliases, combos, account fallbacks) without duplicating provider credentials in RSemble. 9Router exposes a standard OpenAI-compatible API.
- **Decision:**
  1. Register `9router` as a first-class `ProviderId` using the OpenAI-compatible adapter factory.
  2. Route browser traffic through RSemble's localhost bridge to avoid CORS and keep the 9Router endpoint server-configured.
  3. The bridge forwards only `GET /v1/models` and `POST /v1/chat/completions` to a fixed upstream (`RSEMBLE_9ROUTER_URL`, default `http://127.0.0.1:20128`). No request parameter can alter the upstream host — this prevents SSRF.
  4. RSemble consumes but does not reproduce 9Router's control plane (fallback, account rotation, aliases, combos, quota tracking, pricing). One requested model ID produces one candidate.
  5. A blank API key is valid when 9Router's `requireApiKey` setting is disabled; readiness is established by a model-catalog probe, not key length.
  6. Upstream redirects are rejected (`redirect: "manual"`) to prevent credential forwarding to a different origin.
- **Rationale:** 9Router is an external routing provider. RSemble's single pipeline spine (fanout → Judge → Rank/Fuse) is unchanged; a `9router` slot delegates one completion to 9Router, which owns all internal routing decisions.

---

## Decision #6: Blind Judging with Post-Judgment Identity Reveal
- **Date:** 2026-07-29
- **Context:** The judge prompt embedded candidate model names (`### Candidate A — GLM 5.2`), so scores could be biased by model/provider reputation. The response schema also permitted a per-score rationale that `parseJudge` discarded, leaving the UI unable to explain why two same-conclusion answers scored differently.
- **Decision:**
  1. Judge input is blind to RSemble metadata: candidates are shuffled, labelled `Candidate A/B/C…`, and rendered without model names, provider names, slugs, order, latency, tokens, or cost. (Blindness covers RSemble-supplied metadata only; a model naming itself inside its own answer is not altered.)
  2. The label→candidate mapping is retained for the current run and revealed in the UI and Markdown export only after judging completes. Labels describe judge-time identity and are never reassigned by score sorting.
  3. Every accepted score requires a structured explanation (position, concise rationale, strengths, severity-labelled deductions, missed requirements, criterion scores when a rubric is enabled). Malformed or unexplained output fails through the visible `JUDGE_FAILED` path — no opaque rankings.
  4. The judge must explain material score gaps (≥0.5) between candidates with materially similar conclusions via same-conclusion comparisons.
  5. The rationale is concise decision evidence, explicitly not hidden chain-of-thought; no private reasoning traces are requested or displayed.
- **Rationale:** Scores become inspectable rather than asserted, while model anonymity at judge time keeps the comparison honest. The audit trail (blind key + explanations + comparisons) ships in both the Rank UI and Markdown export without adding a new top-level mode or dashboard.

---

## Decision #7: Evaluation Workbench — Three Workspaces, Durable History, Local Suites
- **Date:** 2026-07-30
- **Context:** RSemble had a single comparison surface and an in-memory `RunHistoryEntry` that could not reconstruct a completed run after reload. Heterogeneous telemetry was aggregated as if comparable, the rubric schema (`goal | metric | gap`) did not match specialized evaluation needs, and multi-task evaluation required manual external record-keeping.
- **Decision:** Expand RSemble from one surface into three top-level workspaces:
  1. **Compare** — preserves the existing one-task fanout → blind Judge → Rank/Fuse pipeline unchanged.
  2. **Runs** — durable, searchable, auditable run history persisted in browser-local IndexedDB: complete snapshots (task, candidates, Judge evidence, scores, config, failures) keyed by one stable run ID.
  3. **Evaluations** — versioned local suites of multiple tasks, each executed one at a time through the existing comparison pipeline, with a model-by-task result matrix, transparent coverage, equal-task aggregation, and provenance links to underlying run evidence.
- **Constraints:** Local-first and single-user. No hosted backend, accounts, collaboration, or public benchmark publishing. Rank/Fuse remains the sole per-task finish switch, shown only in Compare. The provider-agnostic pipeline (`pipeline.ts`) is unchanged. Profiles are versioned and immutable; suites pin to profile versions. Out of scope for this plan: embeddings, clustering, multiple Judges, multiple trials, arbitrary task weights, confidence intervals, and pairwise ranking.
- **Authority changes:** `PRODUCT.md`, `UI.md` (§6A), and `DESIGN.md` (§Workspace Navigation) amended to authorize three-workspace navigation, cross-workspace execution awareness, shared audit grammar (status tokens, model labels, record rows, split panes, monochrome matrices), and the working-surface versus audit-surface rule.
- **Rationale:** Structured, inspectable run history and multi-task suites are prerequisites for any later semantic-history intelligence. Separating working surfaces (Compare + editors) from audit surfaces (Runs + results) keeps each workspace focused and lets the existing pipeline engine serve both one-off and suite execution without branching.

---

## Decision #8: react-router-dom 7.18.2 — Audit Exemption for RSC-Only Advisory
- **Date:** 2026-07-30
- **Context:** Phase 0 of the evaluation workbench plan requires `npm install react-router-dom` and zero high-severity `npm audit` findings. `react-router-dom@7.18.2` reports 2 high findings from GHSA-qwww-vcr4-c8h2 (RSC-mode CSRF bypass). The advisory states: "This only affects your application if you are using the unstable RSC APIs."
- **Decision:** Accept `react-router-dom@7.18.2` with a documented exemption for GHSA-qwww-vcr4-c8h2. RSemble is a client-side HashRouter SPA with no server, no SSR, no RSC, and no server actions — the vulnerable code path is structurally unreachable. Downgrading to 7.11.0 (the only other React-18-compatible option below the advisory range) introduces 14 real vulnerabilities including XSS, RCE (turbo-stream deserialization), and DoS, making it strictly worse. React Router 8.3.0 (the fully patched version) requires React 19, which is incompatible with RSemble's React 18 stack.
- **Exemption scope:** This exemption applies only to GHSA-qwww-vcr4-c8h2. All other react-router advisories are cleared by 7.18.2. If RSemble ever adopts server-side rendering or RSC, this exemption must be revoked and the dependency upgraded.
- **Rationale:** 7.18.2 is the safest React-18-compatible version. The advisory's own note confirms RSC-only impact. Blocking Phase 0 on a structurally inapplicable vulnerability would delay the entire evaluation workbench indefinitely while accepting worse real-world risk by downgrading.

---

## Decision #9: Fusion Study — Empirical Policy Discovery on Suites
- **Date:** 2026-07-31
- **Context:** The Compare surface runs the fanout → Judge spine with two finishes (Rank, Fuse), but fusion had no versioned identity, its evaluation was circular and confounded (the same judge informed and scored the synthesis; candidates never saw the rubric the synthesizer revised against), no complementarity metric suited anchored rubric scores existed, fusion was compared against the wrong baseline (solo outputs instead of Rank and refine), and exploration was conflated with confirmation. Spec: `docs/specs/archive/fusion-study/fusion-study-spec.md` (v2); plan: `docs/specs/archive/fusion-study/implementation-plan.md`.
- **Decision:** Adopt Fusion Study as an Evaluations experiment type with the following load-bearing choices:
  - **(a) Development/holdout judge separation.** Judge 1 ranks candidates and may inform synthesis; Judge 2 evaluates policy outputs blind and randomized. The anti-circularity rule — Judge 2 must differ from Judge 1 and from the synthesizer — is enforced in the `sealTrial` transaction, which rejects with an error naming the conflict.
  - **(b) Selection/synthesis headroom split.** Two continuous metrics computed from stored criterion-level scores (no new judge calls): `H_select` (per-task best-overall minus best-mean) and `H_synth` (criterion-weighted best-criterion oracle minus per-task best). Per-criterion headroom is a first-class shortlisting signal. The 5/3/4-vs-3/5/4 known-answer fixture yields H_select ≈ 0 and strongly positive H_synth.
  - **(c) Recipe-as-versioned-artifact.** Fusion recipes carry `recipeFamily` (BlindRaw / AnalysisFed / AnalysisScores — the ablation over judge-analysis mode), `promptVersion`, explicit `rubricAccess` and `verification` booleans, and a synthesizer ref. **Blindness is an invariant, not a field** — candidates always reach the synthesizer anonymized; the old non-blind hardcoded Compare Fuse prompt is deliberately not preserved (Compare Fuse is now BlindRaw v1).
  - **(d) Refine-the-winner as both control and candidate policy.** The refine finish receives rubric content byte-identical to the fusion recipe under test, so "refine beats fuse" can only mean the second model bought no complementary information — reported, never suppressed.
  - **(e) Verifier-derived determinism.** Deterministic correctness comes only from executed external verifiers (`verification.kind` per task in v1). Binary co-failure metrics (Jaccard, φ_adj) are gated on executed verifier output and never synthesized from rubric scores; bimodal score distributions are a diagnostic warning only. No manual "deterministic" toggle.
  - **(f) Trial vs Attempt provenance.** Treatment-changing reruns (synthesis rerun, candidate regeneration) create a new trial with `sampleIndex + 1` linked by an immutable attempt record; measurement-only retries (holdout failure, second judge) attach as observations on the same trial — retry storms never inflate sample counts. Recipe changes create new trials. Child records are immutable on creation; seals are final.
  - **(g) Blocked policy comparison.** For a given task and sample index, all four policies (best-fixed, Rank, Fuse, Refine) share the same candidate generations and development-judge evidence; only the finishing step varies. Reports carry paired task-level deltas (repeats averaged within task; the task is the bootstrap resample unit), wins/ties/losses, CI, cost delta, a predeclared MPID, and an adopt / not-justified / inconclusive verdict.
  - **(h) Exploration vs confirmation via suite versions.** Screening results are always **Exploratory**. A **Confirmed** claim requires a follow-up confirmation study on a new suite version that evaluates the preselected configuration (frozen recipe, frozen pair, frozen best-fixed baseline) without re-selection — no Stage A, no screening, no shortlist. Promotion that reproduces the recommendation moves the claim level; otherwise it demotes.
  - **(i) Retractions.** The "Candidate D" design and the "75% synthesis" claim from the earlier research thread are retracted; they do not survive the advisor-reviewed protocol above.
- **Rationale:** The naive pair-discovery design is experimentally unsound; the staged elimination + blocked comparison + two-claim-level design is the sound version and maps directly onto existing infrastructure (immutable attempt records, blind judging with label resolution, versioned suites).

---

## Decision #10: Evaluation Integrity & Workbench Fixes (2026-08-05)
- **Date:** 2026-08-05
- **Context:** A repair flow showed the progress banner naming a historical roster-extension model (Umans) while the executor truthfully called DeepSeek; lifecycle-cancelled catalog probes could paint `Catalog probe issue` over healthy runs; numbered experiment attempts implied unsupported trial semantics; Compare-only Rank/Fuse shifted global navigation; run detail hid completion time; pricing was a five-entry substring table; and reasoning effort was never requested, fingerprinted, or persisted.
- **Decision:**
  1. **Truthful operation scope.** Progress copy derives from the persisted active attempt plan (`repair.kind` + requested keys), never from `rosterExtensions` history. Roster extensions remain append-only history on terminal Results.
  2. **Cycle-level probe cancellation.** `ProviderProbeCoordinator.run` returns `completed | cancelled`; a lifecycle-cancelled cycle commits no readiness/catalog/error state. Timeouts while idle stay diagnosable.
  3. **No user-facing numbered attempts.** Attempt ordinals, the Attempt column, `Attempts (N)`, and terminal Attempt history are removed from experiment UI. Internal `ExperimentTaskAttempt[]` persistence, selection, recovery, and run-source provenance are unchanged; failed-task evidence stays reachable via run links and `Error details`.
  4. **Route-invariant header.** The global header is a fixed three-zone grid (identity · centered primary navigation · global actions). Rank/Fuse moved into a Compare-only toolbar above the split panes; the radiogroup semantics are unchanged. Supersedes earlier header-placement statements in PRODUCT.md, UI.md, and DESIGN.md.
  5. **Explicit run completion.** Run detail shows start and terminal times, relative terminal age, duration, and timezone via semantic `<time>` elements; legacy null `completedAt` degrades to start-only copy.
  6. **Reasoning effort provenance.** A shared `ReasoningEffort` policy (candidates + judge) is forwarded through every adapter using provider-documented or catalog-exact mappings, persisted on suites/snapshots/run records, included in the protocol fingerprint, and never silently remapped under strict suite parity. Unknown gateways expose `provider-default` only.
  7. **Honest cost accounting.** Pricing comes from exact `(providerId, modelId)` catalog snapshots captured at fetch time; attempts persist Reported / Estimated / Unknown cost provenance; reused outputs carry zero incremental cost and are never double-charged; the run forecast includes one Judge and, in Fuse mode, one Fusion call and labels partial totals.
- **Rationale:** Execution truth must come from the persisted plan, cancellation must be a first-class outcome, and evaluation fairness/cost claims require immutable request and usage provenance. The numbered attempt concept was internal bookkeeping, not a product trial; keeping it in the UI overstated statistical semantics.


---

## Decision #11: Hardening Program Contract Lock — Credentials, Cardinality, Bridge Auth, Limits, Timeouts, Ordering

- **Date:** 2026-08-06
- **Context:** The 2026-08-06 repository assessment found the implementation contradicting the product specification: `PRODUCT.md` said credentials are never persisted while `PROVIDERS.md` and `ConnectionsModal` automatically persisted UI-entered keys to `localStorage`; Compare's UI gate allowed one enabled candidate while the Judge/Fuse contract requires two usable candidates; `RSEMBLE_BRIDGE_SECRET` was documented but never enforced; the Umans/ClinePass bridge proxies accepted broad path prefixes; the 48 MiB bridge body cap could reject a UI-admitted 40 MiB attachment set; and provider calls had no deadline model. The hardening program (Plans 002–008, `plans/README.md`) needs these contracts locked before implementation.
- **Decision (Plan 002 decisions D1–D6):**

  1. **Credential persistence (D1).** Environment variables remain the preferred persistent credential source and are read-only in the UI. Keys entered in Connections are **session-only by default** (memory until tab/process exit). Persistent browser storage is an **explicit per-key opt-in** labeled **Remember on this device**, stored under versioned keys, with an explicit same-origin JavaScript/XSS disclosure. Credentials, authorization headers, bridge secrets, and environment contents never enter run records, experiment records, logs, archives, exports, screenshots, or test fixtures. All provider adapters resolve credentials through one shared `CredentialStore` contract; adapters must not read browser storage directly. Legacy `rsemble.key.<provider>` values are migrated deliberately and idempotently, never logged. OS-keychain integration is deferred.
  2. **Compare candidate cardinality (D2).** Compare requires **at least two enabled candidate slots** before a paid run starts. A single-model baseline remains valid only inside evaluation experiments where the policy explicitly defines it; there is no general single-model Compare mode. Required copy: zero candidates → "Enable at least two candidate models."; one candidate → "Add or enable one more candidate to compare."; provider failures → identify the exact unavailable slot/provider.
  3. **Bridge authentication (D3).** `RSEMBLE_BRIDGE_SECRET` is optional configuration but **enforced when set**: `/health` is public; `/auth/status` is public metadata (no raw tokens); all credential-bearing endpoints (Codex `/v1/models`, `/v1/chat/completions`, `/v1/responses` if retained, and all Umans/ClinePass/9Router proxy routes) require `X-RSemble-Bridge-Secret`; comparison avoids early-exit string comparison; failures are `401 bridge_auth_required` / `401 bridge_auth_invalid`; the secret is never echoed. Loopback binding and CORS are defense-in-depth, not substitutes. The browser sources the secret from `VITE_RSEMBLE_BRIDGE_SECRET` (a Vite-embedded mirror of the server variable); if that transport is rejected, an alternative must be recorded in this file rather than leaving a documented-but-unimplemented variable.
  4. **Attachment size authority (D4).** One product-level raw limit (40 MiB aggregate, 10 files × 20 MiB) and one transport-level encoded body limit (64 MiB bridge ceiling). The UI must not admit a request the selected transport cannot carry; bridge-routed requests run an encoded-size preflight; provider-specific lower limits surface before execution.
  5. **Timeout semantics (D5).** Distinct clocks: connect/header deadline, stream inactivity deadline, optional total execution ceiling, and explicit user abort. A single short wall-clock timeout is rejected because reasoning models may stay healthy while running long.
  6. **Program ordering (D6).** Hardening executes in mandatory order 002 → 008 (boundary hardening → run integrity/preflight → execution reliability → quality gate/docs → maintainability extraction → measured optimization/protocol compatibility). No feature expansion enters the same pull requests unless required to preserve existing behavior.

- **Rationale:** Locking these contracts in one decision removes the documented contradictions, gives Plans 003–008 stable normative references, preserves the local-first convenience (explicit remember opt-in) instead of silently removing it, and ensures security behavior is enforceable rather than aspirational. Later phases may be refined against live code but may not reverse D1–D6 without updating this file, `PRODUCT.md`/`PROVIDERS.md`, and every affected plan first.


## Decision #12: Hybrid Evaluation Criteria — Hybrid Scoring & Ranking Contract
- **Date:** 2026-08-08
- **Context:** Evaluation profiles previously supported only sparse 1/3/5 anchored criteria with a numeric weighted mean. Atomic requirements (ITT denominator, injection rejection, exact schema) were forced into continuous quality dimensions, and binary evidence could only be persisted by encoding it as a fake 1/5 score. An adversarial design investigation and a scoring-reconciliation decision (`docs/specs/pending/hybrid-evaluation-criteria/`) reconciled the Prime-blend and Fusion penalty formulations.
- **Decision:**
  - **Criterion domain:** explicit **graded** criteria (kind `"graded"`, authored Score 1–5 anchors, integer Judge result 1–5) and **binary** checks (kind `"binary"`, authored `trueWhen`/`falseWhen`, native JSON boolean Judge result). Legacy 1/3/5 profiles (kind undefined) remain readable and never rewritten.
  - **Requirement Groups:** every binary check belongs to exactly one **ALL-mode** group (`c_g = min(member booleans)`); ungrouped checks get a materialized singleton at save; group weight `v_g > 0` is the sole binary-channel weight. No MEAN, no member weights, no zero-weight groups.
  - **Compliance influence:** profile field `complianceInfluence` (λ) in `[0,1]`, default `1.0` — the maximum ranking points failing all ordinary compliance requirements may cost.
  - **Ranking contract:** `Q = Σ(w_i s_i)/Σw_i`, `C = Σ(v_g c_g)/Σv_g`, **`rankValue = Q − λ(1−C)`** is the sole ranking authority (ordering, winners, ties, experiment task-level ranking). **`rankScore = max(1, rankValue)`** is the bounded 1–5 presentation value only; **`floored = rankValue < 1`** requires explicit floor disclosure. Binary booleans are never encoded as `false→1 / true→5`. Pure-graded profiles are bit-identical to the old weighted mean.
  - **Compliance-only exception (spec §16.3):** a profile with **no graded criteria** has no `Q` and therefore derives **no `rankValue`/`rankScore`**; it ranks on the weighted compliance share `C` in the 0–1 / 0–100% compliance domain. Display and export render such values as C-labeled percentages — never as a floored `1.0*` rank score with a `/5` suffix. Historical records remain authoritative snapshots and are never re-scored or retyped.
- **Deferred (not shipped v1):** binary 1/5 pseudo-scoring, `W_bin` as author control, MEAN groups, member weights, Hard Gates / gate eligibility / consensus gate judging, `δ=0.10` closeness band, min-cost "binary-decided" heuristic, "Compliance changed the winner" badge, duplication lint, automatic historical binary detection, and historical re-scoring. `kind:"gate"` is rejected by validation with an actionable message.
- **Rationale:** rankValue is the single authoritative ranking quantity derived from a validated criterion vector (`Q − λ(1−C)`); rankScore prevents the display floor from causing false ties (a floored 0.8 must outrank a floored 0.4). Requirement Groups pin a requirement's influence to its group weight, so decomposition (1 check vs 5 subchecks) does not inflate influence, and λ bounds total binary influence.

---

## Decision #13: Canonical Tasks, Immutable Versions, and Archive v2 Base
- **Date:** 2026-08-14
- **Context:** Evaluation Suite tasks had stable IDs only inside an embedded suite document. Experiment snapshots preserved task definitions and run records preserved exact messages, but there was no global Task identity, immutable Task Version repository, concrete Task Instance repository, family registry, or versioned facet annotation. Repeated attempts and near-duplicate prompts could masquerade as broad task coverage, and the archive format had no envelope for canonical Task/Rubric entities. Spec: `docs/specs/archive/02-canonical-tasks/canonical-tasks-spec.md`; plan: `docs/specs/archive/02-canonical-tasks/implementation-plan.md`.
- **Decision:** Ship canonical Tasks as a secondary surface with the following load-bearing choices:
  - **(a) Opaque identity, immutable versions.** A Task has opaque identity; digests do not define semantic identity. Versions are positive, contiguous, and append-only. A change to candidate-visible instruction, task-defining context, expected response contract, or correctness contract creates the next version; metadata, family, and facet edits never mutate a version. A referenced version cannot be deleted.
  - **(b) Concrete instances with digest-gated reuse.** A Task Instance captures concrete normalized input and is reused only under the same Task Version and exact complete input/context/artifact digest, with byte-equality verification. Metadata-only historical attachments are never upgraded to complete without real bytes; migration never fabricates an artifact.
  - **(c) Explicit families and facets, no inference.** A Task has at most one primary family at a time through a versioned assignment; typed cross-family relations may express overlap without a universal tree. Facets are orthogonal authored dimensions; suggestions never become accepted annotations without explicit user confirmation. No automatic semantic deduplication or taxonomy inference.
  - **(d) Conservative legacy migration.** Migration inspects latest embedded suite tasks and immutable historical ExperimentRecord snapshots, creates one canonical Task per deterministic `(legacySuiteId, legacyTaskId)` scope with origin `legacy-task-set`, appends a version only when the executable-definition digest changes, and writes a crosswalk. It is deterministic and idempotent across repeated startup, never merges across suite scopes, and never modifies RunRecordV2, ExperimentRecord snapshots, selected attempt IDs, protocol fingerprints, costs, judge evidence, or failures.
  - **(e) Secondary surface, not primary nav.** Tasks live on `/tasks`, `/tasks/new`, `/tasks/:taskId`, and `/tasks/:taskId/versions/:version`, reachable through the command palette and contextual links. Tasks are not a primary workspace; primary navigation remains Compare · Runs · Evaluations.
  - **(f) Archive v2 base.** The extensible v2 envelope round-trips exact current Run and Experiment evidence, all seven Fusion Study stores, and canonical Rubrics, Tasks, Task Versions, Task Artifacts, Task Instances, families/facets, annotations, and migration crosswalks; disposable indexes are omitted. Archive v1 remains importable. V2 import validates the complete payload and referenced artifacts before writes; until a later child adds full collision remapping, a non-identical ID collision is reported in preview and aborts without mutation — it never overwrites or partially imports. Artifact bytes are scanned for prohibited credential/auth content before export; an unsafe export is blocked without echoing the value.
- **Authority changes:** `PRODUCT.md` and this file amended to describe canonical Tasks, immutable versions, instances, families/facets, conservative migration, and archive v2 as shipped. Existing Run/Experiment/Fusion evidence and the fanout → Judge → Rank/Fuse spine are unchanged.
- **Rationale:** Global, immutable task identity is the prerequisite for Task Set ownership (next child), observations, contextual Compare results, and model evidence profiles. Pinning opaque identity, digest-gated instance reuse, conservative no-rewrite migration, and a collision-aborting v2 envelope now prevents later children from accidentally merging across scopes, inflating coverage with near-duplicates, or overwriting evidence on import.

---

## Decision #14: Observations, Eligibility Decisions, Model Configuration Snapshots, and Archive v2 Evidence Extension
- **Date:** 2026-08-17
- **Context:** Evaluation runs produced exact candidate and judge/verifier evidence, but there was no immutable Task Observation index, canonical model configuration identity, automatic evidence eligibility classification, comparability cohort fingerprinting, or evidence receipt disclosure. Repeated attempts, operational retries, and roster extensions risked inflating sample counts or masking execution variability. Spec: `docs/specs/pending/task-first-evidence-workbench/04-observations-and-evidence/observations-and-evidence-spec.md`; plan: `docs/specs/pending/task-first-evidence-workbench/04-observations-and-evidence/implementation-plan.md`.
- **Decision:** Ship canonical Task Observations and evidence provenance with the following load-bearing choices:
  - **(a) Reference-only indexing, no raw content duplication.** An Observation is an immutable reference/index over exact RunRecordV2 / ExperimentRecord evidence. It never embeds candidate messages, candidate output text, full judge rationale, or streaming buffers. Prohibited field paths are rejected by runtime guards.
  - **(b) Canonical Model Configuration identity.** Snapshots resolve only stored facts (providerId, requestedModel, resolvedModel, resolvedVersion, reasoning settings, tool scaffolds, sanitized runtime settings). Unknown resolved versions remain unknown; no speculative version rollup. Content collisions on duplicate IDs abort with corruption errors.
  - **(c) Invariant counting and active selection.** Operational retries, repeated judging, missing-cell repair, and roster extension reuse never inflate sample counts: one active observation per execution lineage/task/model cell. Unique Task coverage counts Task identity once regardless of versions, instances, or attempts. Reused outputs retain original candidateAttemptId.
  - **(d) Pure eligibility classification and explanation.** Evidence classes (`exploratory`, `comparable`, `verified`, `benchmark_anchor`) and allowed uses (`task_descriptive`, `within_model_profile`, `paired_model_comparison`, `task_set_standing`, `benchmark_anchor_analysis`) are purely derived from stored facts. Explanations compile from constant dictionaries without embedding raw source text. Decisions are keyed by `[observationId + ruleVersion]` allowing deterministic append-only re-evaluation.
  - **(e) Post-commit derivation and isolated reindex.** Derivation runs after source transaction commit; derivation failures create recoverable indexing markers without mutating or corrupting exact source records. Reindex is resumable, deterministic, and isolated from paid execution.
  - **(f) Fusion isolation.** Fusion Study `fusionObservations` remain distinct study-owned entities with disjoint ID namespaces (`obs:<hash>` vs `obs-N`). They are neither converted nor counted as canonical Task Observations.
  - **(g) Archive v2 evidence payload extension.** The archive v2 envelope gains an optional `evidence` payload (`modelConfigurations`, `observations`, `evidenceDecisions`, `evidenceIndexJobs`, `verifierOutcomes`) with deterministic ordering, exact counts, reference-graph validation, prohibited-content scanning, and collision-abort-before-write import. Format version stays 2; earlier-v2 envelopes without evidence validate and import as no-ops; v1 imports write zero evidence rows.
- **Authority changes:** `PRODUCT.md` and this file amended to describe canonical Task Observations, Eligibility Decisions, Model Configurations, and archive v2 evidence extension as shipped.
- **Rationale:** Separating immutable evidence records from derived observations prevents raw text bloat, guarantees deterministic re-evaluation without provider calls, enforces statistical honesty (no retry/reuse sample inflation), and allows safe local export/import without credential leakage.
