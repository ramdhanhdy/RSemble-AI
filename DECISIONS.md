# DECISIONS.md — RSemble AI Architectural Decisions

This document records architectural decisions made for RSemble AI.

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
