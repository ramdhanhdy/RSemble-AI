# PRODUCT.md — RSemble AI Product Specification

> Status: Implemented (three workspaces, hardening contracts D1–D6 live, Rubric terminology shipped, canonical Tasks shipped, canonical Task Sets + ownership crosswalks shipped)
> Last reconciled: 2026-08-16 at commit `36a5a3b` (Child 03 — Task Sets)
>
> **Terminology note (Child 01, 2026-08-12):** Scoring objects previously called
> "Profiles" are now "Rubrics" in all user-facing surfaces, domain code, routes,
> and this document. Legacy IndexedDB stores (`profiles`, `profileVersions`),
> frozen `RunRecordV2`/`ExperimentRecord` fields (`evaluationProfileId`,
> `evaluationProfileVersion`), and v1 archive payloads keep their physical names
> as implementation details; canonical Rubric adapters expose Rubric language
> above those boundaries. Historical decisions in `DECISIONS.md` preserve the
> original "Profile" terminology for provenance. The word "profile" is reserved
> for the future model evidence profile (Child 06).
>
> **Reconciliation note (Child 02, 2026-08-14):** Canonical Tasks now exist
> independently of any comparison or Task Set. A Task has opaque identity, an
> append-only sequence of immutable Task Versions (a candidate-visible
> instruction/context/contract change creates the next version), concrete Task
> Instances deduplicated by exact normalized input digest, explicit Task Families
> with a primary assignment, and a versioned Facet taxonomy with authored and
> suggested annotations. A conservative, idempotent legacy-suite migration
> creates `legacy-task-set` Tasks through deterministic crosswalks without
> rewriting Run/Experiment/Fusion source evidence. Tasks live on a secondary
> `/tasks` catalog reachable via the command palette and contextual links — not
> as a fourth primary workspace. This child also introduces the extensible
> archive v2 envelope, which round-trips exact current Run, Experiment, and all
> seven Fusion Study stores plus canonical Rubrics and Task entities; archive v1
> remains importable, and a non-identical ID collision is reported in preview and
> aborts before any write. Task Set editor migration, comparison task promotion,
> observations, and model evidence profiles remain future children (spec:
> `docs/specs/archive/02-canonical-tasks/`).

> **Reconciliation note (Child 03, 2026-08-16):** Canonical Task Sets are
> shipped (spec: `docs/specs/pending/task-first-evidence-workbench/
> 03-task-sets-and-evaluations/task-sets-and-evaluations-spec.md`). A Task Set
> now owns versioned task membership: `TaskSetRecord` (mutable administrative
> state via compare-and-swap), immutable `TaskSetVersion` / WorkloadManifest
> (members pin exact canonical Task Versions), immutable
> `TaskSetMaterializationRecord` execution snapshots, and the
> `taskSetOwnershipCrosswalk` store resolving legacy owner coordinates
> (suite-manifest, experiment-owner, fusion-owner) to exact Task Set Versions.
> The conservative legacy migration reconstructs `legacy-suite` Task Sets
> without rewriting Run/Experiment/Fusion evidence. The archive v2 envelope
> gains an optional `taskSets` payload (records/versions/materializations/
> ownership crosswalks): exported deterministically with exact counts, fully
> validated (ordering, duplicates, reference graph), scanned for prohibited
> content, and imported with collision-abort-before-write; earlier-v2 envelopes
> without the key remain readable and Fusion payloads are untouched. In this
> document, "suite" language describing shipped behavior means Task Set
> ownership; the legacy Evaluation Suite remains a compatibility surface.

> **The source of truth for what RSemble AI is and is not.**
> Authority: PRODUCT.md defines *what the product is*. `PROVIDERS.md` defines *how models are reached*.
> If implementation or provider details conflict with PRODUCT.md's spine (fanout → Judge → Rank/Fuse), PRODUCT.md wins.

---

## 1. Executive Summary

RSemble AI is a focused, personal local tool (React + Vite SPA) for comparing and synthesizing multiple LLM candidate outputs on a task, inspecting past runs, and executing small local evaluation Task Sets.
One pipeline, two finish modes:
- **Rank**: Which candidate model performed best.
- **Fuse**: One merged answer synthesized from the strongest candidates.

The product has three top-level workspaces:
- **Compare** — the working surface for one-off fanout → Judge → Rank/Fuse work.
- **Runs** — an audit surface making previous work searchable: task inputs, outputs, Judge evidence, scores, configuration, and failures.
- **Evaluations** — an audit surface grouping several tasks into a versioned local Task Set, executing the same comparison pipeline per task, and presenting a model-by-task result matrix.

These are navigation destinations, not pipeline modes. Rank/Fuse remains the per-task finish choice and is shown only where it is relevant (Compare). The evaluation feature is local-first and single-user: it introduces no hosted backend, accounts, collaboration, public benchmark publishing, or general workflow canvas.

Canonical Tasks — versioned, immutable task definitions with concrete instances, families, and facets — exist as a secondary catalog (`/tasks`) independent of any one comparison or Task Set, reachable through the command palette rather than primary navigation.

---

## 2. Core Spine (§3)

```
Task → Evaluation → Compare (N models in parallel) → Judge
                                                       │
                                    ┌─────────────────┴──────────────────┐
                                  RANK                               FUSE
                          "Use this model."                "Here's the merged answer."
```

1. **Command**: User describes task + optional evaluation criteria (holistic judgment, a pinned saved rubric, or one-off custom criteria).
2. **Fanout**: N enabled candidate slots stream responses in parallel. Candidate generation never receives evaluator-only criteria.
3. **Judge**: Single judge model scores candidates against the evaluation and breaks down consensus and contradictions. Judging is **blind**: candidates reach the judge only as `Candidate A/B/C…` in randomized order — never with RSemble-supplied model/provider identity — and every accepted score carries a structured explanation (position, rationale, strengths, deductions, missed requirements, criterion scores). A score without an explanation is rejected as a visible judge failure, never an opaque ranking.
4. **Finish**:
   - **Rank**: Leaderboard with recommendation callout, tier scores, and candidate prose. After judging completes, the blind-label mapping is revealed (Candidate A → model) and each ranked entry shows its judge explanation; materially similar positions with score gaps get a comparative explanation. The recommendation line quotes the judge's actual winner rationale.
   - **Fuse**: Single merged document synthesized from candidate strengths.

---

## 3. Scope Fence (§5)

### IN Scope
- **Multi-model comparison & parallel fanout**: Run N candidate models on the same task simultaneously. Compare requires **at least two enabled candidate slots** before a paid run starts; a single-model baseline is valid only inside evaluation experiments where the policy explicitly defines it (Plan 002 decision D2, `DECISIONS.md` #11).
- **Pluggable provider adapters**:
  - OpenRouter (`openrouter`)
  - ChatGPT subscription via local Codex bridge (`chatgpt-codex`)
  - Gemini AI Studio (`gemini`)
  - CommandCode (`commandcode`)
  - ClinePass (`clinepass`)
  - Umans (`umans`)
  - 9Router (`9router`) — a local/remote routing gateway with 9Router-managed models and fallback; one requested model ID produces one candidate, regardless of internal fallback
- **Localhost Node Codex bridge**: Lightweight 127.0.0.1 process that also serves as an allowlisted proxy for compatible providers (e.g. 9Router). The bridge forwards only approved method/path pairs to server-configured upstreams; it is not a general-purpose proxy. When `RSEMBLE_BRIDGE_SECRET` is configured it **must** be presented as `X-RSemble-Bridge-Secret` on every credential-bearing endpoint; `/health` stays unauthenticated (Plan 002 decision D3, `DECISIONS.md` #11).
- **Evaluation-driven blind judging**: Configurable judge model evaluates anonymized candidates against holistic judgment or a versioned evaluation rubric. Rubrics support explicit **graded criteria** (authored 1–5 anchors, integer scoring) and **binary checks** (true/false) organized into ALL-mode **Requirement Groups**, plus legacy 1/3/5 rubrics. Scoring derives the authoritative **rank value** `Q − λ·(1−C)` (Q = graded weighted mean, C = weighted group pass share, λ = compliance influence in [0,1], default 1.0) with a bounded `max(1, rankValue)` presentation score and explicit floor disclosure. **Compliance-only rubrics** (no graded criteria) have no Q and no rankValue/rankScore: they rank on C in the 0–100% compliance domain and display C-labeled per…
- **Rank & Fuse finishes**: The single mode toggle lives in the Compare workspace toolbar (immediately above the split panes) and switches between Rank and Fuse. It is the sole per-task finish switch, shown only in Compare; the global header is route-invariant and never carries it.
- **Three workspaces — Compare, Runs, Evaluations**: Navigation destinations, not pipeline modes. Compare is the one-off working surface; Runs and Evaluations are audit surfaces. Rubric and Task Set editors are working surfaces nested inside Evaluations.
- **Durable run history**: Browser-local (IndexedDB) persistence of complete run evidence — task inputs, candidate outputs, Judge evidence, scores, configuration, and failures — so completed, partial, failed, aborted, and interrupted runs are inspectable after reload.
- **Local evaluation Task Sets**: Versioned Task Sets of multiple tasks, each executed one at a time through the existing comparison pipeline, with a model-by-task result matrix, transparent coverage, equal-task aggregation, and provenance links to underlying run evidence. Rubrics are versioned and immutable; Task Sets pin to rubric versions. Task Set executions produce immutable experiment snapshots with per-task results, coverage, and provenance — experiment history is auditable but not semantic-searchable in this phase. Task Sets and rubrics can also be **authored or shared as Task Set package files** and imported as new entities (distinct from whole-workbench archive backup/restore).
- **Reasoning-effort policy**: Task Sets and Compare can request a shared candidate and Judge reasoning effort (Provider default / Minimal / Low / Medium / High / X-high / Max). Effort is part of the immutable experiment snapshot and protocol fingerprint; each run records requested and effective levels. A shared name is a controlled request — it does not prove model families spend equal compute or tokens.
- **Auditable cost provenance**: Every paid stage (candidate, Judge, Fusion) persists provider-reported usage/cost when the provider exposes it, a clearly labeled catalog estimate when only exact pricing is known, or Unknown otherwise. Costs render from the pricing snapshot captured at execution time, never today's catalog. Reused evidence is never double-charged.
- **Fusion Study (policy discovery on a Task Set)**: An Evaluations experiment type attached to a Task Set version that discovers, empirically, which execution policy — best-fixed single model, Rank over a pair, Fuse under a versioned recipe, or rubric-aware refine-the-winner — gives the best quality/cost tradeoff for that Task Set. Policies are compared **blocked** on shared candidate generations and development-judge evidence; a separate holdout judge evaluates policy outputs blind (development/holdout separation is mandatory). Fusion recipes are versioned artifacts with explicit `rubricAccess` and verification flags; candidates always reach the synthesizer anonymized — blindness is an invariant, never an experimental variable. Studies proceed by elimination (recipes) and a predeclared shortlist rule (pairs), report the complete screened-pair table, and produce a per-Task Set **playbook** with two visibly different claim levels — **Exploratory** (best observed configuration under this pool and protocol) and **Confirmed** (the preselected configuration held on a fresh Task Set version without re-selection). **"Do not fuse" is a first-class playbook verdict**, not a failure state.
- **Structured workspaces vs. exploratory semantic intelligence**: The three workspaces (Compare, Runs, Evaluations) are committed, structured audit and working surfaces with explicit data contracts. Embedding search, semantic clustering, "Ask history," and automatic benchmark generation remain exploratory roadmap phases that require the structured history to exist first; they are not part of the current approved scope and must not be implied by the workspace UI.
- **Canonical Tasks (independent task identity)**: Tasks exist independently of any comparison or Task Set with opaque identity, append-only immutable Task Versions (candidate-visible instruction/context/contract changes create the next version), concrete Task Instances deduplicated by exact normalized input digest, explicit Task Families with a primary assignment, and a versioned Facet taxonomy with authored/suggested annotations and provenance. A conservative, idempotent legacy-suite migration creates `legacy-task-set` Tasks through deterministic crosswalks without rewriting Run/Experiment/Fusion source evidence. Tasks are a secondary `/tasks` catalog reachable via the command palette and contextual links — not a fourth primary workspace. The extensible archive v2 envelope round-trips exact current Run, Experiment, and all seven Fusion Study stores plus canonical Rubrics and Task entities; archive v1 remains importable, and a non-identical ID collision aborts in preview before any write (full collision remapping is deferred to a later child).

### OUT Scope (§5 Scope Fence)
- **Python backend / SQLite / public REST API**: Out of scope.
- **Datasets, benchmarks, fine-tuning**: Out of scope, *except* the constrained local evaluation Task Set contract above (versioned local Task Sets of tasks executed through the existing comparison pipeline with a model-by-task result matrix). No hosted benchmarks, public benchmark publishing, fine-tuning, or training-data management.
- **Multi-user SaaS / hosted authentication / public proxying**: Personal local tool only.
- **Anthropic or unrequested provider adapters**: Out of scope for planned providers v1.
- **Replacing Rank/Fuse with provider-specific UX**: The sole switch remains Rank/Fuse.
- **Node-based canvas, connected execution blocks**: Out of scope.
- **Reactive inspector drawer / config tabs**: Out of scope.
- **Frankenstein manual snippet pickers**: Out of scope.
- **Routing profiles / model routing strategies**: Out of scope as pipeline concepts. (Evaluations' local Task Sets | Rubrics navigation is in scope — see IN scope above.)
- **Task-preset library**: Out of scope.
- **Strategy variants (pragmatic/rigorous/creative)**: Out of scope (every run is a plain multi-model fanout).
- **Model roles (draft/critic/verifier/synthesizer as user-facing concepts)**: Out of scope.
- **Unscoped global rankings**: Out of scope. Scores stay attached to their task, run, or Task-Set-owned experiment context; no cross-task leaderboard, global model ranking, or analytics dashboard aggregates evidence beyond the approved per-run Rank view and the per-experiment result matrix.

---

## 4. Single-User / Local First (§7)

RSemble AI is designed for personal local use by a single developer on their own machine.
Build-time `VITE_*` keys are client-embedded for local execution.
The local Codex bridge runs on `127.0.0.1` solely to allow the builder to use their ChatGPT subscription via Codex credentials without hosting a proxy for third parties.
Durable run history and evaluation Task Sets persist in browser-local IndexedDB.

### 4.1 Credential policy (Plan 002, decision D1)

- Environment variables remain the **preferred persistent credential source** and are read-only in the UI.
- Keys entered in Connections are **session-only by default** (memory until the tab/process exits).
- Persistent browser storage is an **explicit per-key opt-in** labeled **Remember on this device**, and the UI **must** disclose that same-origin JavaScript can read it.
- Credentials, authorization headers, bridge secrets, and environment contents **must never** enter run records, experiment records, logs, archives, exports, screenshots, or test fixtures.
- Every provider adapter resolves credentials through the shared `CredentialStore` contract; adapters **must not** read browser storage directly.

### 4.2 Security model (Plan 002)

- **Single-user localhost deployment**: the app and bridge are built for one user on one machine; the bridge binds to `127.0.0.1` only.
- **Same-origin script / XSS risk**: remembered credentials are readable by any same-origin script; they are a convenience for this personal local application, not a secure vault. OS-keychain storage is not claimed and is out of scope for the current hardening program.
- **Untrusted local processes**: any local process can address `127.0.0.1`; loopback binding and CORS are defense-in-depth, not substitutes for the configured bridge secret.
- **Exports and persisted evidence**: run records, archives, and Markdown exports contain evidence only; credentials and authorization material are rejected at the persistence boundary.
- **Upstream provider error bodies**: provider failures are reduced to bounded, sanitized errors; raw upstream bodies never enter logs or persisted evidence.
