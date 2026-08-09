«Status: Exploratory — non-authoritative. Does not modify current product authority or authorize implementation.»

# Runs Information Architecture — Phase 1 Evidence

**Repository:** `/opt/data/projects/RSemble-AI` · **Branch:** master · **HEAD:** `0b01e69`
**Date:** 2026-08-09
**Method:** Three parallel read-only investigators; evidence consolidated by Builder.
**Labeling:** `[RF]` = Repository fact (directly observed at cited location) · `[DSI]` = Derived structural inference (reasoned from facts, including absence of evidence)

---

## A. Run Lifecycle Inventory

### A0. Layered state model

| Layer | Types | Location |
|---|---|---|
| Live pipeline state (in-memory, Compare only) | `StudioState` — `running`, `judgeStatus/fusionStatus: StageStatus`, `insufficient`, `aborted`, `executionConflict`, `runContext` | `studio-engine.ts:78-134` |
| Persisted run record (single schema for ALL runs) | `RunRecordV2` — `status: RunStatus`, per-stage blocks, `candidates[]`, `source: RunSource` | `run-types.ts:249-280` |
| Experiment record (suite-run container) | `ExperimentRecord.status`: draft/queued/running/paused/completed/completed_with_failures/aborted/interrupted | `evaluation-types.ts:254-261` |

- `RunStatus = "running" | "completed" | "partial" | "failed" | "aborted" | "interrupted"` `[RF — run-types.ts:44]`
- `AttemptStatus = "running" | "completed" | "failed" | "aborted" | "interrupted"` `[RF — run-types.ts:46]`
- `CandidateStatus = "pending" | "done" | "error"` (live fanout only) `[RF — studio-data.ts:20]`
- `StageStatus = "idle" | "running" | "done" | "error"` (judge/fusion, live + persisted) `[RF — studio-engine.ts:43, run-types.ts:65]`

### A0.1 Run creation paths

| Path | How created | Evidence |
|---|---|---|
| Ad-hoc Compare run | `requestRun` (owner id `cmp-${ts}-${rand}`) → `runFanout` → `recorder.begin` → `repo.create` (Dexie `runDetails` + `runSummaries`, status `running`) | `rsemble.tsx:336-351`; `run-controller.ts:279-342`; `run-recorder.ts:183-189` |
| Experiment child run | `executeTask` → `uow.beginTask` atomically writes run detail + run summary + experiment attempt link in ONE Dexie transaction | `experiment-controller.ts:471-530`; `experiment-unit-of-work.ts:114-188` |

`[RF]` **Same record type, same tables.** Experiment runs are `RunRecordV2` written into identical `runDetails`/`runSummaries` collections as ad-hoc runs, discriminated only by `source.kind` (`adhoc` vs `experiment`) plus indexed columns `sourceKind`/`sourceProtocolFingerprint`/`sourceExperimentTaskAttemptId`.

### A1. State-by-state lifecycle

#### 1) `running` (non-terminal)
- **Created:** At fanout start. `[RF — run-record-builder.ts:236]`
- **Terminal:** No.
- **Actions:** Abort; experiment path: Pause/Abort. Continuations (Rank→Fuse, judge/candidate retry) gated on `!state.running`.
- **Surfaced:** OutputPane, PipelineRail, StageBanner, GlobalExecutionStrip, Runs list (status filter "Running"), RunDetail header.
- **Recovery:** Cross-tab lease (TTL 10s, heartbeat 3s). Lease takeover → in-memory `aborted` (ad-hoc) or persisted `interrupted` (experiment).
- **Reached later:** `[DSI]` Runs list shows stale `running` rows indefinitely — no boot-time reconciliation or writer marks an orphaned ad-hoc run terminal after tab close/reload. `markAborted` is called only from user abort; `applyInterrupted` only from the experiment controller; no boot effect found in rsemble.tsx or repository-context.

#### 2) `completed` (terminal)
- **Created:** Derived: accepted judge + all candidates usable + fusion accepted when `mode==="fuse"`. `[RF — run-record-builder.ts:695-713]`
- **Actions still possible:** Rank→Fuse (same runId), Re-fuse, candidate retry if any failed (that outcome is `partial`, not `completed`). Retries append to SAME record.
- **Surfaced:** RankResult/FuseResult in Compare; RunList + StatusMark "Completed"; RunDetail header + Outcome section.
- **Reached later:** `/runs/:runId` deep link; Runs list; Compare empty-state "Recent runs"; ResultMatrix evidence links; experiment ledger "View run". `[DSI]` No direct link from the live RankResult/FuseResult to its persisted record — only via Runs workspace or empty-state RecentRuns.

#### 3) `partial` (terminal)
- **Created:** Accepted judge + ≥1 candidate failed, or fuse mode without accepted fusion. `[RF — run-record-builder.ts:701-714]`
- **Actions:** Per-candidate retry (frozen roster, same runId); judge retry blocked; Re-fuse if eligible.
- **Surfaced:** RunList status filter "Partial"; StatusMark "Partial".
- **Recovered:** Retry failed candidate → attempt appended, status re-derived (can return to `completed`).

#### 4) `failed` (terminal)
- **Created:** Judge attempt failed → `failed`; OR settled fanout with <2 usable candidates → `failed`. `[RF — run-record-builder.ts:717-719, 731-734]`
- **Actions:** Judge-only retry (`retryJudge`) when eligible; per-candidate retry in InsufficientState; full re-run from command pane.
- **Surfaced:** ErrorState (with "Retry Judge" button); InsufficientState; StatusMark "Failed"; timeout guidance from `PersistedError.timeoutKind`.
- **Recovered:** retryJudge / retryCandidate / relaunch. Failed attempt retained as evidence.

#### 5) `aborted` (terminal)
- **Created:** User abort: `ABORT_RUN` dispatch (in-memory: `running:false, aborted:true`) → `recorder.markAborted` → record `aborted`, `completedAt` stamped, running attempts → `aborted`. Lease-lost also lands here via `LEASE_LOST` (in-memory only, no persistence write for ad-hoc). `[RF — studio-engine.ts:666-679; run-recorder.ts:316-324; run-record-builder.ts:582-608]`
- **Actions:** None on the record itself; relaunch only.
- **Surfaced:** AbortedState; StatusMark "Aborted"; Runs filter.
- **Recovered:** Manual relaunch; partial outputs preserved.

#### 6) `interrupted` (terminal, experiment-only)
- **Created:** `[RF]` Experiment path only: `abortInternal` (lease lost / internal abort) → `applyInterrupted` → record `interrupted`, running attempts → `interrupted`. Ad-hoc Compare runs have NO persistence write for `interrupted` — `applyInterrupted`/`markAborted` call sites are experiment-controller and run-controller (user abort) only.
- **Actions (experiment level):** Recovery dialog / "retry incomplete" — experiment set `interrupted` with `execution:null`, new run must be initiated.
- **Surfaced:** StatusMark "Interrupted"; ResultMatrix cell state "Evidence unavailable"; GlobalExecutionStrip; Runs filter.
- **Recovered:** New attempt per task (compound repair seeds a NEW run from base run, `reusedFrom` provenance).

#### 7) Candidate-level states (within any run)
- `pending` → `done` | `error` (live). Persisted: attempt `running` → `completed`/`failed`/`aborted`/`interrupted`. "done-but-empty" treated as unusable (not failed). Partial candidate failure within successful judge = run `partial`.

#### 8) Distinct-state checklist
| State | Distinct type? | Evidence |
|---|---|---|
| Completed compare run | YES — `completed` | `run-types.ts:44; run-record-builder.ts:709-710` |
| Evaluation child run | NO distinct type — same `RunRecordV2`/`RunStatus`, discriminated by `source.kind==="experiment"` | `run-types.ts:103-118; experiment-unit-of-work.ts:184-186` |
| Failed run | YES — `failed` | `run-record-builder.ts:717-719, 731-734` |
| Interrupted/aborted run | YES — distinct `aborted` vs `interrupted`, but `interrupted` only produced on experiment branch | `run-types.ts:44; experiment-controller.ts:1015` |
| Partial candidate failure | YES — `partial` | `run-record-builder.ts:701-714` |

---

## B. Provenance / Relationship Inventory

### B1. Compare → Run
- `[RF]` Compare acquires an in-tab execution owner with id `cmp-${ts}-${rand}`; the PERSISTED run gets a different id `run-${now()}-${rand}`. Two disjoint ID namespaces: `cmp-*` (ephemeral owner/lease gating) vs `run-*` (durable record).
- `[DSI]` The Compare UI never stores the persisted runId in `StudioState` — held only in controller `runIdRef`. No field in `studio-engine.ts:78-134` stores runId.
- `[RF]` One Compare session maps to exactly one persisted run record; a new fanout creates a new run. Retries/re-fuse continue the same run.

### B2. Experiment / Evaluation → task result → Run
- `[RF]` Bidirectional link, both persisted:
  - `ExperimentTaskAttempt.runId` → the child run (`experiment-unit-of-work.ts:160-168`)
  - `RunRecordV2.source = {kind:"experiment", experimentId, suiteId, suiteVersion, protocolFingerprint, taskId, experimentTaskAttemptId, trial, repair?}` (`run-types.ts:103-118`)
- `[RF]` Atomicity: run creation + attempt link + experiment revision bump in one transaction (`uow.beginTask`).
- `[RF]` Attempt selection per task: newest completed > best-coverage partial > newest partial > none.
- `[RF]` UI surfaces: ExperimentTaskLedger "View run" → `/runs/${attempt.runId}`; ResultMatrix evidence cells → `/runs/${runId}?candidate=…&attempt=…`; RunDetail "Provenance" section links back to `/experiments/${experimentId}` and `/evaluations/${suiteId}`.

### B3. Run → Judge evidence
- `[RF]` `record.judge = {status, acceptedAttemptId, report, consensus, attempts[]}`. Each `JudgeAttemptRecord` carries providerId, model, instruction, exact messages, blindLabelToCandidateId, candidateAttemptIdsByCandidateId, timing, status, error, report, consensus, usage/cost.
- `[RF]` Retries append judge attempts to the same run; `?attempt=` deep link highlights any attempt.
- `[RF]` Fusion references judge: `FusionAttemptRecord.sourceJudgeAttemptId`; re-fuse blocked without accepted judge attempt.

### B4. Run → candidate evidence
- `[RF]` `record.candidates[]: PersistedCandidate {candidateId, slotId, modelKey, providerId, model, slug, acceptedAttemptId, attempts[]}`. Each `CandidateAttemptRecord` carries exact messages, timing, status, output, token usage, cost, error, `reusedFrom?`.
- `[RF]` ID scheme: `cand-<slotId>` shared between executor and judge blind labels — "evidence always joins."
- `[RF]` `candidateAttemptIdsByCandidateId` links judge/fusion attempts to exact candidate attempts scored.

### B5. Run → configuration / protocol evidence
- `[RF]` Frozen task: `record.task {title, prompt, systemPrompt, temperature}`
- `[RF]` Evaluation protocol: `record.evaluation {profile: EvaluationProfileSnapshot|null, candidateMessages}` — profile pinned by id+version
- `[RF]` Reasoning effort provenance: `record.reasoning: RunReasoningProvenance` (requested vs effective per candidate + judge)
- `[RF]` Attachment metadata only (name/kind/bytes; never bytes/text in record)
- `[RF]` Mode: `record.mode: "rank" | "fuse"`; score domain (`rank`|`compliance`)
- `[RF]` Execution fence: `record.execution {ownerId, fence, leaseId?}` — every paid write is fenced
- `[RF]` In-memory frozen snapshot: `RunEvaluationContext` captured at FANOUT_START, deep-copied, drives all retries
- `[RF]` Experiment protocol fingerprint: `source.protocolFingerprint` + suite version

### B6. Run-to-run lineage

| Edge | Mechanism | Evidence |
|---|---|---|
| Repair/compound → source run | `CandidateAttemptRecord.reusedFrom {sourceRunId, sourceCandidateId, sourceAttemptId}`; "View source run" link in RunDetail | `run-types.ts:193-197; run-record-builder.ts:287-387; RunDetail.tsx:345-358` |
| Repair plan on run source | `RunSource.experiment.repair: ExperimentTaskExecutionPlan` (missing-cells / roster-extension) | `run-types.ts:114-117; experiment-controller.ts:487, 1359-1377` |
| Retry continuation (same run) | Candidate/judge/fusion retries append attempts to SAME runId; fence rebound | `run-recorder.ts:306-314; run-controller.ts:658-660, 750-753, 820-823` |
| Fusion → judge → candidates | `sourceJudgeAttemptId` + `candidateAttemptIdsByCandidateId` chains | `run-types.ts:235-236; run-controller.ts:828-851` |
| Experiment attempt ↔ run | `attempt.runId` (forward), `source.experimentTaskAttemptId` (reverse) | `evaluation-types.ts:176-185; run-types.ts:112` |

---

## C. Entry-Point Inventory

### C.1 Route table

| Route | Renders | Where defined |
|---|---|---|
| `/` → redirects to `/compare` | — | `app-router.tsx:79` |
| `/compare` | Compare workspace (inline in RSemble shell) | `app-router.tsx:80` |
| `/runs` | RunsWorkspace (list; desktop split w/ empty detail pane) | `app-router.tsx:81` |
| `/runs/:runId` | RunsWorkspace (detail selected; mobile = detail-only w/ back link) | `app-router.tsx:82` |
| `/evaluations` (index) | EvaluationsWorkspace → SuiteList | `app-router.tsx:87-88` |
| `/evaluations/profiles` | ProfileList | `app-router.tsx:89` |
| `/evaluations/profiles/:profileId` | ProfileDetail | `app-router.tsx:90` |
| `/evaluations/:suiteId` | SuiteEditor | `app-router.tsx:91` |
| `/evaluations/:suiteId/tasks/:taskId` | SuiteTaskEditorRoute (mobile deep-link) | `app-router.tsx:92-95` |
| `/evaluations/:suiteId/fusion/:studyId` | FusionStudyView | `app-router.tsx:96-99` |
| `/experiments/:experimentId` | ExperimentRoute → ExperimentProgress or ExperimentResults (top-level, outside Evaluations nav) | `app-router.tsx:104-109` |
| `*` | NotFound ("Return to Compare" link) | `app-router.tsx:111, 160-173` |

`[RF]` Router is a HashRouter in production (`main.tsx:12-20`); all routes are hash-based (`#/runs/…`). `[DSI]` Three nav workspaces, but four top-level route families; the experiment route is deliberately outside the nav triad.

### C.2 Ways to reach the Runs collection

| # | Entry point | Mechanism | Citation |
|---|---|---|---|
| 1 | Primary nav (desktop) — "Runs" item | `NavLink to="/runs"` in header WorkspaceNav | `WorkspaceNav.tsx:17-21, 27-39; Header.tsx:113-115` |
| 2 | Mobile bottom nav (<768px) — "Runs" item | Fixed 3-item `NavLink` bar | `MobileWorkspaceNav.tsx:17-21, 31-46` |
| 3 | Command palette — "Go to Runs" | `onNavigate("/runs")` | `CommandPalette.tsx:90-96; rsemble.tsx:616` |
| 4 | Compare empty state — "View all runs" + Recent runs rows | Links to `/runs` and `/runs/:id` | `OutputPane.tsx:550-578` |
| 5 | Direct URL / deep link | `/runs` route | `app-router.tsx:81` |

`[RF]` No keyboard shortcut navigates to Runs — all shortcuts are Compare-gated.

### C.3 Ways to reach Run Detail

| # | From | UI element | Citation |
|---|---|---|---|
| 1 | Runs list | Row link | `RunList.tsx:127-148; RecordRow.tsx:135-143` |
| 2 | Compare empty state | Recent-runs rows | `OutputPane.tsx:570-578` |
| 3 | Evaluation result — coverage issues | "View run" per issue | `ExperimentResults.tsx:798-816` |
| 4 | Evaluation progress — task ledger | "View run" per attempt | `ExperimentTaskLedger.tsx:230-236` |
| 5 | Result matrix — task row header | Task title link | `ResultMatrix.tsx:336-342` |
| 6 | Result matrix — scored cell | Deep link with focus params | `ResultMatrix.tsx:74-84, 174-179` |
| 7 | Run Detail → another run | "View source run" (reusedFrom) | `RunDetail.tsx:345-358` |
| 8 | Direct URL / deep link | `#/runs/:runId?candidate=X&attempt=Y` | `RunsWorkspace.tsx:45-48; RunDetail.tsx:30-41` |

### C.4 Ways to reach a related Evaluation/Experiment

Multiple distinct entry points documented across Run Detail provenance trail, Evaluations workspace, Suite editor, Experiment results/progress, Profile detail, GlobalExecutionStrip, and Command palette. Key ones: RunDetail → `/experiments/${experimentId}` (experiment-sourced runs only); SuiteEditor → latest experiment; ResultMatrix cells → run detail; GlobalExecutionStrip → experiment progress; Command palette → "View experiment." `[RF — see full inventory above]` Note: FusionStudyView/FusionStudyPanel do NOT link to `/runs/` (see B7).

### C.5 Related Compare context from Run Detail

| Question | Finding | Citation |
|---|---|---|
| Can you go back from Run Detail to the Compare that created it? | **No.** Ad-hoc run's `source` is `{kind:"adhoc"}` with zero fields — no reference to the Compare session. | `run-types.ts:103-118; run-controller.ts:288-295` |
| Is there any "Open in Compare" action in Runs UI? | **No.** No Compare-reload affordance in RunList/RunDetail/RecordRow. | `RunDetail.tsx:118-197; RunList.tsx:120-153` |
| `[DSI]` | Compare is an ephemeral working surface: full configuration is captured *inside* the run record at execution time, but the app never reconstructs a Compare session from a run record. | — |

### C.6 Deep-link / share support

| Capability | Finding | Citation |
|---|---|---|
| Deep-linkable URLs | Yes — HashRouter makes them copy-paste shareable | `app-router.tsx:78-112; main.tsx:12` |
| Run-level focus params | `?candidate=` and `?attempt=` consumed in RunsWorkspace/RunDetail | `RunsWorkspace.tsx:45-48; RunDetail.tsx:59-77` |
| Share/copy-link UI | **None found** — no share buttons or "copy link" affordance | grep returned 0 matches |
| Query-param state on Runs list | **No** — filters are component state, not URL params | `RunFilters.tsx:30, 49-51` |

---

## D. Grain Analysis

### D.1 Storage model

| Question | Finding | Citation |
|---|---|---|
| One runs table/collection? | **Yes** — one shared pair of tables (`runSummaries` + `runDetails`) for ALL runs | `database.ts:184-200, 207-218` |
| Separate storage for compare vs evaluation? | **No.** Separate tables exist for evaluation entities (`experiments`, `suites`, `profiles`) and 7 fusion-study tables (`fusionRecipes`, `fusionStudies`, `fusionTrials`, `fusionAttempts`, `fusionObservations`, `fusionPlaybooks` at `database.ts:192-199`); none of these are run records. The experiment record is NOT a run | `database.ts:185-199` |
| What distinguishes a run's grain? | `RunRecordV2.source: RunSource` — discriminated union `{kind:"adhoc"}` vs `{kind:"experiment",...}`; plus `kind:"legacy"` for imported v1 summaries | `run-types.ts:103-118, 132-170; database.ts:211` |
| Parent reference? | No `parentId`. Parent expressed as experiment branch fields on `source`; reverse link on `ExperimentTaskAttempt.runId` | `run-types.ts:105-118; experiment-unit-of-work.ts:160-168` |

### D.2 Structural quantification: 10 tasks × 5 models

**Produces 1 experiment record + 10 runs** (one per task attempt, all 5 models embedded as candidates per run), NOT 50.

`[RF]` Task loop executes tasks one at a time; within a task the executor fans out across the whole roster (`slots: suite.modelSlots`) in parallel. One run per task attempt. Model results are embedded as `candidates[]`.

`[DSI]` Retries multiply runs: each queued retry/recovery attempt gets a new runId → +1 run per retried attempt; `trial` increments.

### D.3 Does the Runs UI treat grains differently?

| Aspect | Finding | Citation |
|---|---|---|
| Default listing | **Mixed by default** — flat, ungrouped chronological feed (createdAt desc) of ad-hoc + experiment + legacy rows | `RunFilters.tsx:20-26; run-repository.ts:306` |
| Source filter | Explicit dropdown: All sources / Ad hoc / Experiment / Legacy | `RunFilters.tsx:136-151` |
| Row labeling | Uppercase source label per row ("experiment", "ad hoc", "legacy") | `run-view-model.ts:75-113; RecordRow.tsx:88-91` |
| Detail rendering | Experiment runs get extra "Provenance" section; ad-hoc runs don't; legacy runs get different component with no evidence | `run-view-model.ts:197-208; RunDetail.tsx:199-235` |
| Grouping / count badges | **None** — no grouping by source, no per-source counts, no "experiment" container concept in the list | `RunList.tsx:120-153` `[RF — absent]` |

### D.4 Grain-relationship summary

| Concept | Storage | Grain unit | Parent link | Appears in Runs list? |
|---|---|---|---|---|
| Compare run | `runSummaries`+`runDetails` | 1 record = 1 pipeline pass (N candidates + judge + optional fusion) | none (`source.kind:"adhoc"`) | Yes |
| Experiment record | `experiments` table | 1 record = 1 suite execution (tasks × attempts × trials, aggregation) | suiteId, suiteVersion | **No** — separate table/route |
| Experiment task run | `runSummaries`+`runDetails` (shared) | 1 record = 1 task attempt (all roster models as candidates) | `source.kind:"experiment"` → experimentId/suiteId/taskId/attemptId | **Yes** — mixed with ad-hoc runs |
| Retry/repair run | same tables | 1 record per additional attempt | same, `trial` incremented, optional `repair` plan | Yes |
| Legacy run | `runSummaries` only | summary-only, no detail | none | Yes (no detail) |

---

## E. Product-Authority Inventory

### E.1 Three top-level workspaces

- `[RF]` **PRODUCT.md §1, lines 19–24:** "The product has three top-level workspaces: **Compare** — the working surface for one-off fanout → Judge → Rank/Fuse work. **Runs** — an audit surface making previous work searchable… **Evaluations** — an audit surface grouping several tasks into a versioned local suite… These are navigation destinations, not pipeline modes."
- `[RF]` **DECISIONS.md #7, lines 76–85:** "Expand RSemble from one surface into three top-level workspaces… Rank/Fuse remains the sole per-task finish switch, shown only in Compare." Rationale: "Separating working surfaces (Compare + editors) from audit surfaces (Runs + results) keeps each workspace focused."
- `[RF]` **CLAUDE.md, principle 7:** "Three workspaces are approved scope… Do not reject primary navigation, durable run history, local evaluation suites, or the result matrix as out-of-scope."
- `[RF]` **Archived spec** `evaluation-workspaces-spec.md` line 189: "Compare and suite/profile editors are working surfaces… Runs and experiment results are audit surfaces: they prioritize filtering, evidence, provenance, tables, and deep links. This working-versus-audit distinction governs local hierarchy without creating more top-level destinations."
- **Would need explicit reconsideration if Runs IA redesigned:** renaming, merging, or demoting Runs would contradict PRODUCT.md §1 and DECISIONS.md #7.

### E.2 Runs as an audit surface

- `[RF]` **PRODUCT.md §1 line 21:** "Runs — an audit surface making previous work searchable: task inputs, outputs, Judge evidence, scores, configuration, and failures."
- `[RF]` **PRODUCT.md §3 IN Scope, line 63:** "Durable run history: Browser-local (IndexedDB) persistence of complete run evidence… so completed, partial, failed, aborted, and interrupted runs are inspectable after reload."
- `[RF]` **DECISIONS.md #7 line 81:** "Runs — durable, searchable, auditable run history… keyed by one stable run ID."

### E.3 Evaluations provenance

- `[RF]` **PRODUCT.md §3 IN Scope, line 64:** "Local evaluation suites… with provenance links to underlying run evidence. Profiles are versioned and immutable; suites pin to profile versions. Suite executions produce immutable experiment snapshots with per-task results, coverage, and provenance."
- `[RF]` **DECISIONS.md #10.3:** "Internal ExperimentTaskAttempt[] persistence, selection, recovery, and run-source provenance are unchanged."
- `[RF]` **Roadmap** `evaluation-workbench-roadmap.md` §2.2: "Every aggregate must remain traceable to: the task and candidate outputs; model and provider configuration; Judge model and exact evaluation protocol; criterion-level scores and explanations; failures, exclusions, and missing coverage."

### E.4 Route-invariant header

- `[RF]` **DECISIONS.md #10.4:** "Route-invariant header. The global header is a fixed three-zone grid (identity · centered primary navigation · global actions). Rank/Fuse moved into a Compare-only toolbar above the split panes; the radiogroup semantics are unchanged. **Supersedes earlier header-placement statements in PRODUCT.md, UI.md, and DESIGN.md.**"
- `[RF]` **PRODUCT.md §3 IN Scope, line 61:** "the global header is route-invariant and never carries it [Rank/Fuse]."
- **Would need explicit reconsideration:** adding nav items or route-dependent header content would require amending #10.4.

### E.5 Scope fences

- `[RF]` **PRODUCT.md §3 OUT list, line 83:** "Unscoped global rankings: Out of scope. Scores stay attached to their task, run, or suite-experiment context; no cross-task leaderboard, global model ranking, or analytics dashboard."
- `[RF]` **PRODUCT.md §3 IN list, line 68:** "Embedding search, semantic clustering, 'Ask history,' and automatic benchmark generation remain exploratory roadmap phases… not part of the current approved scope."
- `[RF]` **DECISIONS.md #7 line 83:** "Out of scope for this plan: embeddings, clustering, multiple Judges, multiple trials, arbitrary task weights, confidence intervals, and pairwise ranking."
- `[RF]` **DECISIONS.md #11 D2:** "Compare requires at least two enabled candidate slots before a paid run starts."
- `[RF]` **Archived spec** `evaluations-identity-ux-spec.md` §4: "No new top-level workspace, no route changes, no restructure of the /evaluations segmented nav beyond labels and sublabels."

### E.6 Rank/Fuse as sole per-task finish switch

- `[RF]` Stated in 4 documents: PRODUCT.md §3 line 61, DECISIONS.md #7 line 83, CLAUDE.md line 13, PROVIDERS.md §10.5 lines 712–715.
- `[RF]` Code enforces: `ModeToggle` renders only in Compare toolbar (`rsemble.tsx:476-487`); `useActionShortcuts` gates Compare-only shortcuts by workspace.
- **Would need explicit reconsideration:** any finish/re-run control introduced on Runs or Evaluations surfaces would conflict.

### E.7 Run lifecycle, retention, corpus management

- `[RF]` PRODUCT.md line 63: durable history persists all terminal states — "inspectable after reload" — no expiry.
- `[RF]` DECISIONS.md #10.5: run detail shows timestamps and duration — the only lifecycle-related UI contract found.
- `[DSI — gap]` **No authoritative decision exists on run retention, pruning, deletion, or corpus management.** Searches for `retention|prune|purge|evict|delete run|clear history|expire|housekeep` across docs/ and src/ found only attachment-text truncation, test fixtures, and archive import limits. **No `deleteRun`/`removeRun` API exists in src** (search returned 0 matches). The only corpus-level operation is whole-workbench archive export/import. Any future retention policy would be new authority, not a revision.
- `[RF]` **No per-run operations exist in RunDetail** — no export, rename, star, or delete action. The only export affordance is Compare-surface Markdown export (`rsemble.tsx:398`). RunDetail is a read-only evidence surface.

### E.8 Provenance-only / historical remnants

- `[RF]` DECISIONS.md lines 5–8: "UI.md, DESIGN.md, and TODOS.md referenced inside historical decisions are no longer shipped. Those references are preserved for provenance; the current product/UI authority is PRODUCT.md plus this file."
- `[RF]` `git ls-files` confirms no `UI.md`, `DESIGN.md`, or `TODOS.md` in the tree.
- `[RF]` `ui-redesign-spec.md` is stale (audit 2026-08-04) — its header proposal is superseded by #10.4.
- `[RF]` Two code comments are stale relative to #10.4: `Header.tsx` lines 3–5 and `studio-engine.ts` lines 5–6 (reference header toggle placement that no longer exists).

---

## B7. Fusion Study → Run relationship

- `[RF]` `FusionArtifactRef` (`fusion-study-types.ts:126-130`) carries `runId: string` — a content-addressed synthesis artifact with full generation provenance.
- `[RF]` `FusionTrialChildren` (`fusion-study-types.ts:133-137`) has `candidateRunId: string | null` and `devJudgeRunId: string | null` — immutable child links assembled while the trial is in_progress.
- `[RF]` `EvaluationObservation` (`fusion-study-types.ts:221-236`) has `runId: string | null` — "The holdout evaluation run record, when one was persisted."
- `[RF]` `synthesisArtifactRef(runId, fusionAttemptId, contentHash)` builds the artifact ref (`fusion-study-controller.ts:372-378`).
- `[DSI]` **All `candidateRunId`, `devJudgeRunId`, and `synthesisArtifact` fields are initialized to `null` and never set to non-null in the controller** (3 trial-creation paths at lines 238, 300, 336 all set `null`; no assignment path found). The `runId` on `EvaluationObservation` is similarly a nullable placeholder. These are schema-defined provenance slots reserved for future use — the fusion-study controller does NOT create RunRecordV2 entries in the shared `runSummaries`/`runDetails` tables. Fusion studies live in their own 7 tables (`database.ts:192-199`: `fusionRecipes`, `fusionStudies`, `fusionTrials`, `fusionAttempts`, `fusionObservations`, `fusionPlaybooks`) and never write to the run tables.
- `[RF]` No `/runs/` links exist in `FusionStudyView.tsx` or `FusionStudyPanel.tsx` — the fusion study UI does not link to Run Detail.

### Fusion-study tables (correction to D.1)

`[RF]` The database has 7 fusion-study-specific tables in addition to the run and evaluation entity tables (`database.ts:192-199`): `fusionRecipes`, `fusionStudies`, `fusionTrials`, `fusionAttempts`, `fusionObservations`, `fusionPlaybooks`. These are separate from `runSummaries`/`runDetails` and from `experiments`/`suites`/`profiles`.

---

## A0.2 "Run without history" (empty-state path)

- `[RF]` The RunList "no-history" state (`RunList.test.tsx:231`) is the **empty-collection state** when zero runs exist in the repository — it shows "Go to Compare" link and no fake local Run action. It is NOT a distinct execution mode that skips persistence. `[DSI]` The "run without history" concept referenced in the archived spec (`evaluation-workspaces-spec.md:185`) describes a design intention for a no-persistence mode, but no corresponding code path exists in the current implementation — all ad-hoc runs persist via `recorder.begin`.
- `[RF]` The export affordance is Compare-surface Markdown export only (`rsemble.tsx:398`: `exportResult` calls `buildExportMarkdown` + `downloadMarkdown`). No per-run export, rename, star, or delete action exists in RunDetail.

---

## Key Evidence Gaps Surfaced

1. **No boot-time reconciliation of stale `running` ad-hoc runs** `[DSI]` — orphaned `running` records persist indefinitely in the Runs list after tab close/reload.
2. **No link from live Compare result to its persisted record** `[DSI]` — the only way to reach the persisted record for the run you just completed is via the Runs workspace or empty-state RecentRuns.
3. **No run retention/deletion/corpus management policy** `[DSI — gap]` — no `deleteRun` API exists; the corpus grows unbounded.
4. **No Run Detail → Compare backtracking** `[RF]` — ad-hoc source carries no session reference; no "open in Compare" affordance.
5. **No share/copy-link UI** `[RF]` — deep links work but there's no UI to produce them.
6. **Runs list filters are not URL params** `[RF]` — filter state is lost on navigation/reload.
7. **Runs list has no grouping or count badges** `[RF]` — mixed grains appear in a flat chronological feed with only a source filter to distinguish them.
