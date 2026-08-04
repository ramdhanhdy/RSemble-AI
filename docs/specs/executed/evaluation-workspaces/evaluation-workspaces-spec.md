# Evaluation Workspaces Specification

> **Feature area:** Evolve RSemble from one focused comparison surface into three explicit workspaces: **Compare**, **Runs**, and **Evaluations**.
>
> **Status:** Proposed implementation-ready behavior contract. This specification records the selected product direction but does not itself override `PRODUCT.md`, `UI.md`, or `DESIGN.md`. Authority changes are Phase 0 of the companion implementation plan.
>
> **Companion roadmap:** `docs/roadmaps/evaluation-workbench-roadmap.md`
>
> **Authority after Phase 0:** `PRODUCT.md` defines product scope; `UI.md` defines interaction behavior; `DESIGN.md` defines visual and responsive constraints; `DECISIONS.md` records the approved expansion.

---

## 1. Decision summary

RSemble will have three top-level workspaces:

```text
Compare | Runs | Evaluations
```

- **Compare** preserves the existing one-task candidate fanout, blind Judge, and Rank/Fuse finishes.
- **Runs** makes previous work searchable and auditable, including task inputs, outputs, Judge evidence, scores, configuration, and failures.
- **Evaluations** groups several tasks into a versioned suite, executes the existing comparison pipeline for each task, and presents an auditable result matrix.

These workspaces are navigation destinations, not pipeline modes. Rank/Fuse remains the finish choice for one task and is shown only where it is relevant.

The feature is local-first and single-user. It does not introduce a hosted backend, accounts, collaboration, public benchmark publishing, or a general workflow canvas.

## 2. Problem statement

### 2.1 Run history is not inspectable

The current `RunHistoryEntry` in `src/lib/run-history.ts` retains only:

- a task excerpt;
- provider-scoped model keys;
- score, latency, and cost summaries;
- winner;
- timestamp.

That record supports recent-run hints and model telemetry, but it cannot reconstruct a completed run. Candidate outputs, Judge evidence, criteria, prompts, errors, and configuration are discarded after the current React state is replaced or the page reloads.

### 2.2 Heterogeneous telemetry is presented as if it were comparable

Current win rates and average scores aggregate unrelated tasks and scoring contexts. Writing, coding, research, and business-decision tasks can contribute to the same model statistic despite different Judge models, instructions, criteria, and candidate fields.

### 2.3 The optional rubric no longer matches the intended evaluation workflow

The current rubric schema uses `goal | metric | gap` and generic response-quality presets. It is also sent to candidate generation and the Judge. Specialized evaluation requires candidate-visible task instructions to be distinct from evaluator-only scoring guidance.

### 2.4 Multiple tasks have no shared execution or result surface

A capability evaluation currently requires manually running tasks one at a time and remembering or externally recording the results. Different tasks may need different Judge instructions, but there is no suite, experiment snapshot, progress view, or per-task result matrix.

## 3. Goals

1. Add explicit, accessible Compare, Runs, and Evaluations navigation.
2. Preserve the existing Compare workflow and Rank/Fuse behavior.
3. Persist complete run evidence in browser-local durable storage.
4. Make every completed, partial, failed, aborted, or interrupted run inspectable.
5. Prevent a later Rank→Fuse action from creating a duplicate historical run.
6. Clearly mark migrated legacy entries whose underlying evidence is unavailable.
7. Replace generic rubric kinds with evaluator-only anchored evaluation criteria.
8. Keep candidate-visible instructions separate from evaluator-only instructions.
9. Create and edit named, versioned evaluation suites containing multiple tasks.
10. Permit each task to use its own evaluation profile while inheriting suite defaults deliberately.
11. Execute one suite task at a time while preserving parallel candidate fanout within that task.
12. Isolate task failures and allow failed task execution to be retried without rerunning successful tasks.
13. Allow an experiment to pause safely between tasks without cancelling the active paid request.
14. Present a model-by-task result matrix with transparent coverage and equal-task aggregation.
15. Link every experiment cell and aggregate back to the underlying run evidence.
16. Remain usable at 390px viewport width and with keyboard-only navigation.
17. Keep provider secrets and credentials out of persisted records and exports.

## 4. Non-goals

| Out of scope | Reason |
|---|---|
| Embedding search, semantic clustering, or “Ask history” | Exploratory roadmap phase; structured history and suites must exist first. |
| Automatic benchmark generation | Suite membership and scoring protocols require review. |
| Multiple Judge models or Judge panels | Reliability phase after one-Judge suite execution is proven. |
| Multiple trials per task | Deferred until the suite workflow is useful with one trial. |
| Confidence intervals, Bradley–Terry, Elo, or other advanced ranking models | Requires enough repeated and overlapping evidence. |
| Boolean, categorical, or hard-gate criteria in v1 | The current Judge pipeline is numeric; v1 uses an anchored 1–5 scale. |
| Arbitrary task weighting in v1 | Equal task weighting is easier to interpret and harder to misuse. |
| Hosted database, user accounts, collaboration, or synchronization | RSemble remains personal and local-first. |
| Public benchmark publishing or sharing portal | JSON/Markdown export is sufficient for this phase. |
| Fine-tuning or training-dataset management | Evaluation evidence is not a training-data pipeline. |
| Running ad hoc Compare and an experiment concurrently | One execution owner avoids provider overload and state races. |
| Replacing Rank/Fuse | Rank/Fuse remains the per-task finish. |
| A permanent left navigation rail | It would consume space from the existing split workspace and recreate rejected platform chrome. |

## 5. Information architecture

### 5.1 Routes

Use URL-addressable client routes so refresh, browser history, and deep links behave predictably:

```text
/#/compare
/#/runs
/#/runs/:runId?candidate=:candidateId&attempt=:judgeAttemptId
/#/evaluations
/#/evaluations/profiles
/#/evaluations/profiles/:profileId
/#/evaluations/:suiteId
/#/evaluations/:suiteId/tasks/:taskId
/#/experiments/:experimentId
```

The application root redirects to `/#/compare`. Unknown routes show a compact not-found state with a **Return to Compare** action. Mobile task routes and candidate-evidence query parameters are stable deep links, not transient component state. Browser Back restores the activating list/task row, scroll position, and keyboard focus when that element still exists.

### 5.2 Desktop navigation

At `>=768px`, render a primary navigation group inside the existing app header, after product identity and before status/actions. The header has an explicit breakpoint budget rather than relying on incidental flex shrink:

```text
RSemble AI   Compare   Runs   Evaluations                 status · actions
```

Requirements:

- use `<nav aria-label="Primary">` and real links;
- the active link has `aria-current="page"`;
- active state uses the existing cyan accent sparingly;
- inactive links use secondary text and surface hover;
- every target is at least 44px high;
- focus rings remain visible;
- workspace navigation remains available during execution;
- navigating away does not abort an active run;
- global running status remains visible from every workspace;
- at `>=1024px`, identity, full workspace labels, live status, connection label, palette/help labels, workspace actions, and Compare-only Rank/Fuse may render at full width;
- at `768–1023px`, preserve identity, all three visible workspace labels, live execution status, and Compare-only Rank/Fuse; demote palette and help to icon-only controls with accessible names/tooltips, then compact connections to a status dot/icon with accessible name and tooltip;
- the sacrifice order is fixed: palette/help visible text, then connection visible text, then nonessential status detail. Never hide workspace destinations, Rank/Fuse on Compare, identity, or execution ownership;
- at a 768 CSS-pixel viewport the tablet header remains one row with no clipping or wrapping; at 200% zoom, allow the normal responsive breakpoint to select mobile navigation, with no lost controls or horizontal overflow.

The Rank/Fuse toggle is visible only in Compare. It is not part of primary navigation.

### 5.3 Mobile navigation

Below 768px, the header cannot safely hold identity, command drawer, connection status, workspace links, and Rank/Fuse at 390px. Use a fixed three-item bottom navigation:

```text
Compare | Runs | Evaluations
```

Requirements:

- each item includes an icon and visible text;
- each item is at least 44px high and equally reachable;
- the active item is exposed with `aria-current="page"`;
- account for safe-area insets;
- workspace content reserves bottom padding so controls are not obscured;
- the existing mobile command drawer button appears only in Compare;
- Rank/Fuse remains in the Compare header;
- no horizontal overflow at 390px.

### 5.4 Global execution ownership

The app shell owns one global execution status. Exactly one of these may be active:

- an ad hoc Compare run;
- one evaluation experiment task.

Starting another execution while one is active is disabled with truthful helper text. A paused experiment with remaining queued work retains execution ownership until resumed, completed, or aborted. Workspace navigation remains enabled. Returning to the originating workspace shows live progress and current state.

### 5.5 Global execution strip

While execution is active, paused, interrupted by storage failure, or owned by another tab, render one cross-workspace awareness strip directly below the app header except on the exact owning route when that route already shows `PipelineRail` or `ExperimentProgress`. The owning progress surface must carry the same status and recovery information; suppression never hides a storage failure.

The strip reuses `PipelineRail` visual grammar: one 32–36px line, stage/status glyph, mono caption such as **Evaluation · Task 2/6 · Candidate fanout**, tabular elapsed time, and one **View progress** link. It is not a card, never grows to a second line, and truncates only the middle caption with full accessible text. On mobile it remains in normal layout above content, not fixed over bottom navigation or the software keyboard.

Use one polite `aria-live` region for meaningful stage transitions only; do not announce streamed tokens or every candidate delta. Abort and persistence failures may use an assertive announcement once. The strip never duplicates the full progress controller.

### 5.6 Cross-tab execution lease

All durable paid execution and startup recovery require one browser-tab owner. The sole unfenced exception is the explicitly confirmed ephemeral Compare path defined below for unavailable storage initialization. The app coordinates a random tab owner ID, lease expiry, and heartbeat through an atomic IndexedDB `storageMeta` lease transaction. `BroadcastChannel` distributes fast ownership/status notifications but is not the source of truth. A secondary live tab remains usable for browsing and editing. Suite/profile saves still use revision checks and surface conflicts, while Run, Resume, Retry, and experiment-start controls are disabled with **Execution is active in another tab**.

The lease carries a monotonically increasing fencing token. Before every durable paid entry point—initial Run, candidate retry, Judge retry, Rank→Fuse, Re-fuse, experiment start, Resume, and Retry incomplete tasks—the controller transactionally verifies the current unexpired `{ ownerId, fence }`. Every mutation to a running run or active/paused experiment includes `{ ownerId, fence }`; the repository verifies the current unexpired lease and fence in the same transaction as the write. A superseded tab therefore cannot commit even if its BroadcastChannel notification was delayed.

A post-run paid command reacquires ownership, and its attempt-start transaction records the new fence without regressing an accepted overall run status to `running`. Ownership releases only after the full command chain and its terminal persistence finish.

The owner renews its lease while execution is active or an experiment is paused with queued work. A tab may take ownership only after the prior lease expires. Startup recovery may mark runs interrupted only after lease acquisition and expiry verification. Closing or crashing the owner does not silently resume work elsewhere. This is a coordination mechanism, not a promise to continue paid calls in the background.

If and only if IndexedDB initialization is unavailable before a Compare run starts, the user may explicitly confirm **Run without history**. That one ephemeral command uses the same executor with an in-memory event sink but performs no lease/fence operation because the authoritative store is unavailable. Confirmation states that history, crash recovery, and cross-tab exclusion are unavailable and another tab could execute concurrently. The exception never applies to experiments, never applies after a durable run has begun, never auto-backfills, and must be reconfirmed for each command.

## 6. Visual and interaction language

Compare and suite/profile editors are working surfaces: they contain authoring controls, forms, and disclosures. Runs and experiment results are audit surfaces: they prioritize filtering, evidence, provenance, tables, and deep links. This working-versus-audit distinction governs local hierarchy without creating more top-level destinations.

The new workspaces extend the existing industrial/utilitarian system. They do not adopt generic analytics-dashboard styling.

Use:

- existing Geist and Geist Mono typography;
- near-black canvas, panel luminance steps, and subtle borders;
- cyan only for current selection and primary actions;
- semantic green, amber, and rose only for status and outcome;
- compact rows, tables, and disclosures;
- 4–8px radii already defined by `DESIGN.md`;
- tabular numerals for scores, counts, latency, and timestamps;
- restrained motion at 50–150ms;
- real data density instead of decorative cards.

Avoid:

- oversized KPI cards;
- gradients, glowing chart chrome, or decorative illustrations;
- a left product-navigation sidebar;
- a three-column card grid for workspaces;
- hiding evidence behind unexplained overall scores;
- tiny table text below the existing 13px body minimum;
- red-to-green score heatmaps or score-magnitude coloring in result matrices;
- illustrated hero empty states or animated row reordering during filtering.

### 6.1 Status tokens

Status is always text plus a non-color cue. Use one shared mapping in Compare, Runs, Evaluations, compact rows, progress surfaces, and exports rendered as UI:

| Status | Color | Icon/shape cue |
|---|---|---|
| `draft` | zinc muted | `FilePenLine` |
| `queued` | zinc muted | hollow circle |
| `running` | cyan | `Loader2`; rotation only when reduced motion is off |
| `paused` | zinc neutral | `Pause` |
| `completed` | emerald | `Check` |
| `completed_with_failures` | amber | `AlertTriangle`; label remains explicit |
| `partial` | amber | `CircleDashed` / half-state |
| `failed` | rose | `XCircle` |
| `aborted` | zinc neutral | `Square`; user intent is not an error |
| `interrupted` | amber | `Unplug` plus dashed/stippled treatment |

`partial` and `interrupted` may share amber only because their icon and border treatment differ. Stage statuses reuse the closest token rather than inventing another palette.

### 6.2 Compact model identity

Use one provider-scoped model-label formatter in ModelList, run rows/details, leaderboards, suite rosters, and result matrices. The visual form is a short provider chip plus a bounded slug using middle ellipsis while preserving the distinguishing tail, for example `google · gemini-3…pro-preview`. The full opaque `providerId:modelSlug` remains available in accessible text and in a focusable/clickable detail disclosure; a hover-only `title` is supplementary, never the only full identity.

### 6.3 Shared compact record rows

Runs rows, Compare recent-run rows, suite experiment-history rows, and task-attempt rows use one `RecordRow` component family with list-density and table-cell variants. Slots cover status token, primary title, exact/relative timestamp, winner or score summary, model count, provenance, and trailing action. The shared family standardizes scanning without forcing unrelated records into one data type.

## 7. Run History v2 data contract

### 7.1 Storage

Use IndexedDB through Dexie for full history. Keep command preferences in localStorage. Do not store full candidate output or Judge evidence in localStorage.

Use separate summary and detail tables so listing runs does not deserialize every candidate output.

```ts
export type RunStatus =
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "aborted"
  | "interrupted";

export interface FullRunSummaryV2 {
  kind: "full";
  schemaVersion: 2;
  id: string;
  revision: number;
  createdAt: number;
  completedAt: number | null;
  status: RunStatus;
  mode: "rank" | "fuse";
  source:
    | { kind: "adhoc" }
    | {
        kind: "experiment";
        experimentId: string;
        suiteId: string;
        suiteVersion: number;
        protocolFingerprint: string;
        taskId: string;
        experimentTaskAttemptId: string;
        trial: number;
      };
  taskTitle: string;
  taskExcerpt: string;
  modelKeys: string[];
  winnerKeys: string[];
  scoresByModelKey: Record<string, number>;
  judgeModelKey: string | null;
  evaluationProfileId: string | null;
  evaluationProfileVersion: number | null;
  detailAvailable: true;
  searchText: string;
}

export interface LegacyRunSummary {
  kind: "legacy";
  schemaVersion: "1-import";
  id: string;
  createdAt: number;
  taskExcerpt: string;
  modelKeys: string[];
  winnerKeys: string[];
  scoresByModelKey: Record<string, number>;
  detailAvailable: false;
  searchText: string;
}

export type RunSummary = FullRunSummaryV2 | LegacyRunSummary;
```

Legacy summaries deliberately have no status, mode, source, Judge identity, profile identity, or completion timestamp. UI and query code must discriminate on `kind` rather than inventing those fields.

```ts
export interface RunRecordV2 {
  schemaVersion: 2;
  id: string;
  revision: number;
  execution: { ownerId: string; fence: number };
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  status: RunStatus;
  mode: "rank" | "fuse";
  source: FullRunSummaryV2["source"];
  task: {
    title: string;
    prompt: string;
    systemPrompt: string;
    temperature: number;
  };
  evaluation: {
    profile: EvaluationProfileSnapshot | null;
    candidateMessages: ChatMessage[];
  };
  candidates: PersistedCandidate[];
  judge: {
    status: StageStatus;
    acceptedAttemptId: string | null;
    report: JudgeReport | null;
    consensus: ConsensusBreakdown | null;
    attempts: JudgeAttemptRecord[];
  };
  fusion: {
    status: StageStatus;
    acceptedAttemptId: string | null;
    attempts: FusionAttemptRecord[];
  };
  winnerKeys: string[];
}
```

Every recorded `RunRequest`, including Compare, requires unique enabled opaque `modelKey` values before any provider call; duplicates produce a field-level validation error. `PersistedCandidate` has immutable run-local `candidateId`, snapshot `slotId`, opaque `modelKey`, provider/model identity, `acceptedAttemptId`, and append-only `CandidateAttemptRecord[]`. Each candidate attempt stores immutable attempt ID, exact rendered messages, timestamps, status, output/tokens only when available, and bounded sanitized error. Initial fanout creates one running attempt per candidate before calls. Candidate retry appends a running attempt before its call and finalizes that same attempt; failure preserves any prior accepted output and stops that retry chain. Success moves `acceptedAttemptId`, then automatically opens a new Judge attempt over exact candidate-attempt IDs and, in Fuse mode after accepted Judge success, a new Fusion attempt, preserving current Compare behavior. `candidateId` is generated before fanout and is the only candidate deep-link key. It never contains API keys, authorization headers, credential paths, raw provider request headers, or environment values.

Each `JudgeAttemptRecord` retains its own immutable attempt ID, Judge provider/model, Judge instruction, exact rendered messages, `blindLabelToCandidateId`, `candidateAttemptIdsByCandidateId`, timestamps, terminal status, and bounded sanitized error. The second map freezes the exact output attempt evaluated for every stable candidate. A successful strict parse sets `acceptedAttemptId` and stores the accepted report/consensus. A Judge started after candidate retry may replace that pointer only on success; if it fails, the prior accepted Judge and its exact candidate-attempt references remain authoritative. Failed attempts remain append-only and never expose malformed partial Judge output. `FullRunSummaryV2.judgeModelKey` identifies the accepted attempt when one exists, otherwise the latest terminal attempt.

Each `FusionAttemptRecord` likewise stores model identity, exact rendered messages, source `judgeAttemptId`, exact `candidateAttemptIdsByCandidateId`, timestamps, status, bounded sanitized error, and result text only on success. Successful **Re-fuse** remains supported: it appends an attempt and moves `acceptedAttemptId` to the newest successful result. A failed re-fuse never destroys an earlier accepted fusion.

### 7.2 Stable run identity

Generate one run ID at fanout start. The same ID follows:

```text
fanout → Judge → optional Fusion → history detail
```

Switching an already judged Rank run to Fuse updates only the same run's Fusion attempt collection and summary mode. It must not append a second historical run.

Candidate outputs and accepted Judge evidence are immutable after acceptance. Judge-only recovery is available only after a failed Judge stage; it appends a new attempt with its own configuration. A successful strict parse becomes the accepted attempt, while failed attempts remain represented as metadata without exposing malformed partial output. Fusion and successful Re-fuse always append attempts; only the accepted Fusion pointer may move.

### 7.3 Lifecycle persistence

Persist the run at meaningful stage boundaries, not on every streamed token:

1. Create a `running` record at fanout start.
2. Initial fanout candidate attempts already exist as `running`; save their terminal results after fanout settles. Candidate retry appends and awaits a new running attempt before its provider call, then finalizes the same attempt.
3. Before a Judge provider call, append and await a `running` `JudgeAttemptRecord` containing immutable attempt ID, model/configuration, rendered messages, blind mapping, and start timestamp.
4. Finalize that same Judge attempt as `completed`, `failed`, or `aborted`; never create a second terminal attempt record.
5. Before a Fusion/Re-fuse provider call, append and await an equivalent `running` `FusionAttemptRecord`.
6. Finalize that same Fusion attempt as `completed`, `failed`, or `aborted`.
7. Mark explicit abort as `aborted`, including any active running attempt.
8. On startup, only the tab holding the execution-recovery lease may change stale `running` records and running attempts with an expired owner lease to `interrupted`.

A start-attempt write failure makes zero calls to that provider. Attempt status is exactly `running | completed | failed | aborted | interrupted`.

Streaming text remains in React state until a candidate reaches a terminal state. This avoids excessive IndexedDB writes.

### 7.4 Canonical scores and outcomes

For holistic judgment, the accepted Judge `overallScore` is the canonical model-task score.

For a scored evaluation profile, the canonical model-task score is computed locally from the complete accepted criterion vector:

```text
canonical score = Σ(criterion score × criterion weight) / Σ(criterion weight)
```

All criterion scores must be present and within `1..5`; otherwise strict parsing fails and no accepted Judge report is created. A Judge-reported overall score may be retained as diagnostic provenance but never overrides the deterministic weighted score. Zero total weight is invalid.

`winnerKeys` contains every model whose canonical score is within `1e-9` of the maximum. An empty array means there is no accepted winner. UI must not collapse a tie to the first stable-sort entry.

### 7.5 Run-status derivation

| Condition | Durable run status |
|---|---|
| Provider calls are active and no terminal owner action occurred | `running` |
| Accepted Judge result and every enabled candidate produced usable output; requested Fusion has an accepted result or was not requested | `completed` |
| Accepted Judge result with one or more failed candidates | `partial` |
| Accepted Judge result but requested Fusion has no accepted result | `partial` |
| A later Re-fuse fails while an older accepted Fusion exists | Preserve `completed` or `partial` from the accepted evidence; show the failed attempt separately |
| Fewer than two usable candidates, or Judge ends without an accepted report | `failed` |
| User abort wins the legal transition race | `aborted` |
| Startup recovery finds `running` with an expired execution lease | `interrupted` |
| Persistence fails after a prior durable write | Preserve the last durable revision, stop further paid stages, and show a storage error; do not fabricate a newer status |

`aborted`, `interrupted`, and any terminal accepted-evidence state may not regress to `running`. Stage-specific attempt statuses remain visible even when the overall run status preserves earlier accepted evidence.

### 7.6 Legacy migration

The existing `rsemble.runHistory.v1` localStorage array is imported once as summary-only entries:

- generate stable migration IDs;
- map only known v1 fields into `LegacyRunSummary`;
- preserve timestamp, task excerpt, model keys, scores, and winner;
- omit status, mode, source, Judge, and evaluation fields rather than inventing them;
- set `detailAvailable = false`;
- label the record `Legacy summary` in the UI;
- do not fabricate prompts, outputs, Judge reports, or configuration;
- retain the original v1 key until import verification succeeds;
- record an IndexedDB migration marker so refresh does not duplicate entries.

### 7.7 Repository contract

All storage access goes through an injected repository interface:

```ts
export interface RunRepository {
  create(record: RunRecordV2, summary: FullRunSummaryV2): Promise<void>;
  update(
    record: RunRecordV2,
    summary: FullRunSummaryV2,
    expectedRevision: number,
  ): Promise<number>;
  importLegacySummary(summary: LegacyRunSummary): Promise<"created" | "skipped">;
  get(id: string): Promise<RunRecordV2 | null>;
  list(query: RunListQuery): Promise<RunSummary[]>;
  subscribe(listener: () => void): () => void;
  exportAll(): Promise<RunArchiveV1>;
  importArchive(archive: RunArchiveV1): Promise<RunImportResult>;
}
```

`create` atomically writes a full summary and detail. `importLegacySummary` atomically writes a summary only. `update` is compare-and-swap: the repository rejects stale revisions and illegal terminal-state regressions inside the transaction. The recorder serializes writes per run ID, but repository revision checks remain the final race barrier. Controller tests inject an in-memory repository. UI components subscribe through the repository interface and never import Dexie directly.

## 8. Runs workspace

### 8.1 Desktop layout

At `>=1024px`, use a list/detail split:

```text
┌─────────────────────────────┬──────────────────────────────────┐
│ Runs                        │ Selected run                     │
│ search · filters · count    │ task · scores · evidence         │
│                             │                                  │
│ run row                     │ candidate outputs                │
│ run row                     │ Judge explanations               │
│ run row                     │ configuration                    │
└─────────────────────────────┴──────────────────────────────────┘
```

The list is 320–420px wide. Reuse the existing `useResizableSplit` hook and the same divider semantics, keyboard behavior, and visual treatment as Compare, with workspace-specific min/max constraints. If that hook cannot satisfy the constraints, ship a fixed responsive width in v1. Do not implement a second divider behavior.

At `<1024px`, use route-based list then detail. The split is allowed only when the Runs workspace container is at least 960px wide, with a list pane of at least 320px and a detail pane of at least 600px; otherwise route-based detail wins regardless of viewport width.

### 8.2 Run list

Each row uses the shared `RecordRow` family and shows:

- task title or excerpt;
- completion time;
- status;
- winner and top score when available;
- participating-model count;
- experiment/suite source when applicable;
- `Legacy summary` when details are unavailable.

Initial filters:

- text search over task title/excerpt and model IDs;
- model;
- status;
- mode;
- source: ad hoc, experiment, or legacy.

Legacy summaries participate in text/model searches and the explicit legacy source filter. Because their status and mode are unknown, any active status or mode filter excludes them rather than inferring a value.

Filters are combinable and have a visible **Clear filters** action. At 390px, keep search visible and move model/status/mode/source into one **Filters** sheet with an applied-filter count. Empty search, no-history, no-match, loading, and storage-error states are distinct. Filtering is applied to the complete matching repository query before pagination; the app never filters only the first page.

### 8.3 Run detail

A full record renders vertically in this order:

1. Header: title, exact localized timestamp with timezone, relative time as secondary text, status, source, Rank/Fuse, export action.
2. Provenance trail when experiment-sourced: **Experiment · Suite v3 · Task: Pricing · Attempt 2**, with links where records remain available.
3. Outcome: all winners, model scores, coverage, and failures. Ties render every winner; no single-winner ring may hide another tied winner.
4. Candidate evidence selector: compact candidate rows show model/provider, status, canonical score, and blind label; one candidate is expanded at a time, defaulting to the top result or first available candidate.
5. Selected candidate output: full output, timing, token counts, criterion evidence, and Judge explanation. Repeat the explicit mapping **Candidate B during judging → Gemini · model-slug** inside this panel.
6. Judge evidence: accepted attempt, rationale, comparisons, and collapsed prior failed attempts. Repeat the same blind-label mapping and explain that identity was hidden from the Judge.
7. Fused result when present.
8. Task and configuration: complete prompt/system instruction, model roster, temperature, evaluation-profile snapshot, and provider/model/instruction/messages for each Judge and Fusion attempt.

Task/configuration, full prompt messages, prior failed attempts, and secondary provenance detail are collapsed by default. The outcome, candidate selector, selected candidate score, and its one-line explanation remain visible. A deep link with `candidate` expands that candidate and scrolls/focuses its evidence heading; a valid `attempt` expands the matching Judge attempt. Missing candidate/attempt IDs render a non-blocking **Requested evidence is unavailable** notice and fall back to the run overview.

A legacy summary detail renders only known fields and an explicit explanation that full evidence was not captured by the older history format.

### 8.4 Recent-run integration

The current recent-run rows in `OutputPane` become real links:

- **View all runs** opens `/#/runs`;
- selecting a row opens `/#/runs/:runId`;
- no row advertises unavailable configuration reload;
- legacy rows open their summary-only detail.

### 8.5 History telemetry

Global model telemetry is labeled **All ad hoc history** and excludes experiment runs by default. Experiment statistics are scoped to suite ID, suite version, and protocol fingerprint.

Do not present one global “best model” across unrelated suites. Model rows may show ad hoc activity telemetry, but it must not be styled as benchmark authority.

## 9. Evaluation profiles

### 9.1 V1 profile shape

```ts
export interface EvaluationProfile {
  id: string;
  version: number;
  name: string;
  description: string;
  judgeInstruction: string;
  criteria: EvaluationCriterion[];
  createdAt: number;
  updatedAt: number;
}

export interface ProfileRecord {
  id: string;
  revision: number;
  latestVersion: number;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface EvaluationProfileRef {
  id: string;
  version: number;
}

export type EvaluationSelection =
  | { kind: "holistic" }
  | { kind: "profile"; profile: EvaluationProfileRef };

export type TaskEvaluationSelection =
  | { kind: "inherit" }
  | EvaluationSelection;

export interface EvaluationCriterion {
  id: string;
  name: string;
  description: string;
  weight: number;
  anchors: {
    one: string;
    three: string;
    five: string;
  };
}
```

Rules:

- criteria use the existing numeric 1–5 Judge scale;
- weights are non-negative and normalized only for calculation/display;
- at least one criterion with positive weight is required for a non-holistic profile;
- names are not required to be globally unique, but IDs are stable;
- every criterion requires concrete 1, 3, and 5 anchors;
- profile snapshots are embedded into runs and experiments;
- saving a semantic profile edit creates a new immutable version;
- earlier profile versions remain retrievable;
- existing suites remain pinned to their referenced profile version until the user explicitly adopts a newer version;
- adopting a newer profile version is a suite edit and increments the suite version;
- historical snapshots are never rewritten.

### 9.2 Profile library

Evaluations has a local secondary navigation with **Suites** and **Profiles**. It is a compact segmented route control using the local ModeToggle grammar, but contains real links with `aria-current`; it is visually subordinate to the primary header and never spans the full shell width like a second global nav. Profiles are not a fourth top-level workspace.

`/#/evaluations/profiles` lists the latest revision of each profile with name, version, criterion count, updated timestamp, and active/archived state. Primary actions are **New profile** and open. Row overflow contains **Duplicate** and **Archive**; destructive permanent deletion is not in v1.

`/#/evaluations/profiles/:profileId` opens the latest revision and provides:

- read-only version history selector;
- **Edit as new version**;
- **Duplicate** into a new profile identity;
- **Archive** or **Restore**;
- a list of current suites pinned to each version.

Saving an edit creates a new immutable revision. Dirty profile edits use the same Save/Discard/Stay guard on browser Back, workspace/profile navigation, and reload/close. Existing suites and Compare drafts stay pinned. Archived profiles remain readable and executable from already-pinned suites but are excluded from new-selection menus unless **Show archived** is enabled. A one-off Compare profile remains run-local until **Save as profile** is invoked; that action opens a named draft and does not silently mutate Compare.

### 9.3 Compare behavior

Replace the current Rubric disclosure with **Evaluation**:

```text
Evaluation
├── Holistic judgment
├── Saved profile…
└── Custom criteria
```

For holistic judgment, the Judge receives no explicit criteria and uses the existing strict overall evaluation contract.

A saved-profile selection pins an exact profile version for the run. If a newer version exists, Compare may offer an explicit **Use newer version** action but never follows it silently. Custom criteria create a one-off snapshot; **Save as profile** is a separate deliberate action.

For saved or custom criteria:

- the criteria and anchors are sent to evaluation stages only;
- candidate generation receives the task and candidate-visible system prompt, not evaluator-only criteria;
- the Judge output remains blind and requires structured criterion explanations;
- changing criteria after fanout does not mutate the frozen run profile used by Judge retry.

In Fuse mode, Fusion may receive criterion descriptions and anchors as synthesis quality targets. It does not receive Judge procedural instructions or blind-label material.

The `goal | metric | gap` kinds and generic preset chips are removed. Existing in-memory or preference data using the old shape is adapted only for the current session; it does not become a reusable profile automatically.

## 10. Evaluations workspace

### 10.1 Suite list

`/#/evaluations` shows:

- suite name and current version;
- task count;
- most recent experiment status and date;
- selected model count for the saved suite configuration;
- create, open, duplicate, and archive actions.

Archived suites are hidden by default and recoverable through a filter. Permanent deletion is out of scope for v1.

### 10.2 Suite model

```ts
export interface EvaluationSuite {
  id: string;
  revision: number;
  version: number;
  name: string;
  description: string;
  tasks: EvaluationTask[];
  modelSlots: ModelSlot[];
  defaultJudge: CriticRef;
  defaultEvaluation: EvaluationSelection;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface EvaluationTask {
  id: string;
  title: string;
  prompt: string;
  systemPrompt: string;
  evaluation: TaskEvaluationSelection;
  judgeInstructionOverride: string;
  order: number;
}
```

V1 requirements:

- suite name is required;
- at least two enabled candidate models are required to run;
- enabled candidate models must have unique opaque `providerId:modelSlug` keys; duplicate suite slots are rejected before any provider call;
- at least one valid task is required;
- every task requires title and non-empty prompt;
- every task resolves through an explicit tagged choice: inherit the suite default, use holistic judgment, or use a pinned profile version;
- `null` is never used to guess evaluation semantics;
- task order is user-controlled and stable;
- suites persist in IndexedDB;
- suites pin exact profile versions rather than following “latest” implicitly;
- `revision` is concurrency metadata; a semantic suite edit increments `version` once on explicit save, while archive/restore increments only `revision`;
- an experiment snapshots the full suite, model roster, task order, profiles, and Judge configuration.

### 10.3 Suite editor layout

Desktop uses two panes, not a three-panel inspector:

```text
┌──────────────────────────┬──────────────────────────────────────┐
│ Task list                │ Selected task                        │
│ + Add task               │ Candidate instructions              │
│                          │ How this task is judged              │
│ Pricing                  │ Evaluation profile / Judge override  │
│ KPI diagnosis            │                                      │
│ Market entry             │                                      │
└──────────────────────────┴──────────────────────────────────────┘
```

The page header contains suite name, persisted version, dirty/save state, suite settings, and **Run evaluation**. Suite settings opens an in-page disclosure or modal for model roster, default Judge, and default profile; it does not create a permanent third pane.

**Save** and **Run evaluation** remain distinct. While dirty, the header says **Unsaved changes · next version vN+1**, and Run is disabled with **Save this suite before running**. Save validates the full suite and creates exactly one new version when semantic content changed. After save, Run states **Run vN** and snapshots that exact persisted version; it never auto-saves or runs a draft.

Dirty-state protection applies to task switching, task deletion, browser Back, workspace links, mobile bottom navigation, reload/close, and suite switching. Internal navigation uses a Save / Discard / Stay checkpoint; reload/close uses the browser unload warning where available. Discard restores the last persisted suite version.

At `<1024px`, task list and task editor are separate route states: `/#/evaluations/:suiteId` and `/#/evaluations/:suiteId/tasks/:taskId`. Opening an editor focuses its heading; Back restores task-list scroll and focus to the activating row. At 390px, sticky Save/Run controls move with the visual viewport or collapse into normal flow while the software keyboard is open, so focused fields and validation messages are never covered by those controls or bottom navigation.

### 10.4 Experiment history

Suite detail includes a compact **Experiments** section below suite metadata, not a global analytics dashboard. Rows use the shared `RecordRow` family. Each row shows start time, status, suite version, completed/total task coverage, participating model count, and **View results**. It lists all experiments for the suite newest first, including interrupted and failed attempts, with pagination after 20 rows. The latest experiment may be emphasized but is never the only discoverable one.

Secondary suite-row actions such as Duplicate and Archive live in an overflow menu at 390px; open and create remain directly visible.

### 10.5 Evaluation-profile authoring UX

The profile editor emphasizes definitions rather than weight controls:

- profile name and purpose;
- base Judge instruction;
- criterion name;
- criterion description;
- anchored examples for scores 1, 3, and 5;
- weight as a secondary numeric control;
- normalized weight preview;
- validation messages beside the affected field.

Render criteria as a one-open-at-a-time accordion. A collapsed header shows criterion name, raw weight, and live normalized share such as **Weight 2 · 33%**. Validate individual anchor/weight fields on blur and again on Save; never defer all feedback to Save. Keep a sticky or in-flow-visible page summary of total raw weight and normalization state without covering fields at 390px.

When viewing a non-latest immutable version, show an unmistakable read-only banner such as **v2 · latest v4 · read-only** with **Edit as new version**. Inputs are not silently editable until that action creates a latest-based draft.

Do not lead with generic preset chips. Future templates may create a draft profile, but the user must review every criterion and anchor before running it.

## 11. Experiment execution

### 11.1 Snapshot

Starting an experiment creates an immutable snapshot containing:

- suite ID and version;
- task definitions and order;
- evaluation-profile snapshots;
- candidate model/provider roster;
- Judge model/provider;
- deterministic protocol fingerprint over ordered tasks, pinned profile versions, Judge configuration, and aggregation policy;
- one trial per task;
- equal-task aggregation policy;
- creation timestamp.

Later suite edits do not mutate an existing experiment.

```ts
export interface ExperimentTaskState {
  taskId: string;
  selectedAttemptId: string | null;
  attempts: ExperimentTaskAttempt[];
}

export interface ExperimentTaskAttempt {
  id: string;
  runId: string | null;
  trial: number;
  status: "queued" | "running" | "completed" | "partial" | "failed" | "aborted" | "interrupted";
  startedAt: number | null;
  finishedAt: number | null;
  error: PersistedError | null;
}

export interface ExperimentRecord {
  id: string;
  revision: number;
  suiteId: string;
  suiteVersion: number;
  protocolFingerprint: string;
  status: "draft" | "queued" | "running" | "paused" | "completed" | "completed_with_failures" | "aborted" | "interrupted";
  execution: { ownerId: string; fence: number } | null;
  snapshot: ExperimentSnapshot;
  tasks: ExperimentTaskState[];
  createdAt: number;
  updatedAt: number;
}
```

Attempt IDs never change. `beginExperimentTask` transitions one queued attempt to running, assigns its run ID, and creates that run atomically. Terminal commit updates that same attempt and run, then recomputes `selectedAttemptId` under the documented selector, in one transaction. Retries append attempts rather than mutating prior terminal attempts.

The protocol fingerprint is `sha256:<lowercase hex>` over UTF-8 canonical JSON. Object keys are recursively sorted; semantically ordered arrays such as tasks and criteria retain order. Include task candidate instructions, generation parameters, pinned profile snapshots/versions, Judge model/instruction, and aggregation policy. Exclude experiment IDs, timestamps, execution status, outputs, and display-only metadata. Equivalent snapshots with different object insertion order must hash identically; any included semantic edit must change the fingerprint.

### 11.2 Execution order

V1 runs one task at a time in suite order:

```text
Task 1: candidate fanout in parallel → blind Judge → persist run
Task 2: candidate fanout in parallel → blind Judge → persist run
...
```

Fusion is not executed during a suite experiment. Experiments evaluate candidate capability; they do not need a fused deliverable. The underlying task run is stored in Rank mode.

Exactly one experiment task is active at a time. This limits provider bursts and reuses the existing run controller invariants.

### 11.3 Progress and control

The experiment view shows:

- completed tasks / total tasks;
- current task;
- per-task status: queued, running, completed, partial, failed, aborted;
- candidate progress for the active task;
- elapsed time;
- **Pause after current task** while a task is active, or **Pause** between tasks;
- **Resume** when paused;
- **Abort experiment** for immediate cancellation;
- **Retry incomplete tasks** after the active queue stops.

Pause never aborts an in-flight task. A pause request takes effect only after the current task reaches a persisted terminal state, before the next task begins. Resume is always explicit.

A terminal task failure always continues to the next queued task in v1 unless Pause was already requested or the user aborts. There is no hidden stop/continue policy setting.

An experiment failure does not delete successful task runs. Before fanout, `beginExperimentTask` atomically appends/starts the immutable task-attempt ID and creates its linked run. At task terminal, `commitExperimentTaskTerminal` atomically finalizes the run and the same experiment attempt in one Dexie transaction. Both operations are idempotent for the same IDs/payload and reject conflicting reuse, so a retry cannot repay for an already committed terminal run. **Retry incomplete tasks** is available for failed, partial, interrupted, or aborted task attempts after the active queue stops. A retry runs the complete task again with a new run ID; it never fills missing models by splicing evidence across attempts.

Each task has one `selectedAttemptId` for aggregation. The default selector chooses the newest full-coverage accepted attempt, otherwise the newest accepted partial attempt, otherwise none. A retry may replace that pointer only under this rule; prior attempts remain inspectable. V1 does not let users compose an aggregate from per-model attempts.

Browser reload during an active experiment marks the active attempt interrupted. Completed tasks remain. The user may continue remaining tasks explicitly; execution never resumes invisibly on page load.

### 11.4 State and abort rules

- use one experiment epoch and one active task run epoch;
- pause preserves epochs and prevents queue advancement only at task boundaries;
- abort increments both ownership epochs and aborts active provider requests;
- stale candidate, Judge, or persistence completions cannot advance the queue;
- experiment and run updates use serialized writes plus revision compare-and-swap, so abort or pause transitions cannot be overwritten by delayed stage writes;
- no history record is silently lost because of one storage failure;
- a persistence failure stops advancement and shows a recoverable error before more paid calls occur;
- ad hoc Compare execution controls are disabled while an experiment task is active;
- experiment start is disabled while Compare is running.

## 12. Experiment results

### 12.1 Accessible result matrix

Render an actual table with:

- rows as tasks;
- columns as provider-scoped models;
- cell value as that model's accepted Judge score for that task;
- status/error indicator when no accepted score exists;
- row link to the underlying task run;
- cell action that opens `/#/runs/:runId?candidate=:candidateId&attempt=:judgeAttemptId`; run detail expands the immutable candidate, the exact candidate attempt referenced by the named Judge attempt, and the Judge attempt, then reveals its blind label through `blindLabelToCandidateId`. Without an `attempt` query, labels and scores come from the accepted Judge attempt; with one, the UI clearly labels the selected historical attempt and does not overwrite accepted summary semantics.

Use sticky headers on desktop. Model column headers use the shared provider chip plus bounded middle-ellipsis slug; full identity is available through accessible text and a non-hover detail path. Matrix cells are monochrome neutral tabular numerals. Never apply score-magnitude heatmaps or red→green scales. Missing/error cells show explicit text plus the shared status icon, never bare `—`. Complete-coverage winner columns receive a restrained emerald marker/ring; every tied winner receives it.

On mobile, provide a model selector and task rows rather than forcing the full matrix to horizontal-scroll beyond usability. A limited table scroll is acceptable at tablet widths if headers remain associated. The scroll region is keyboard focusable, has a persistent visible focus outline, and never causes page-level horizontal scroll.

### 12.2 Aggregation

V1 aggregation follows:

```text
model-task score = canonical score from that task’s `selectedAttemptId`
model overall score = arithmetic mean of that model's available task scores
coverage = scored tasks / total suite tasks
```

Rules:

- every task has equal weight;
- task criteria may have normalized internal weights;
- missing results are missing, never silently zero;
- averages display coverage beside the value;
- only models with complete task coverage are eligible for the experiment winner;
- if no model has complete coverage, show no overall winner;
- per-task scores display one decimal and aggregate means display two decimals;
- ranking uses unrounded values;
- models are tied only when their raw aggregate difference is within a documented numeric epsilon of `1e-9`;
- every aggregate links to constituent task scores;
- list rows, outcome summaries, and matrix winner treatment render every tied winner rather than selecting the first.

### 12.3 Result summary

Show:

- experiment name, suite version, date, and status;
- eligible winner or `No complete-coverage winner`;
- per-model mean and coverage;
- task matrix;
- failed, partial, interrupted, or aborted task-attempt summary;
- Judge and profile snapshot summary;
- JSON and Markdown export.

Do not show standard deviation, confidence intervals, or Judge agreement in v1 because there is one trial and one Judge per task.

## 13. Persistence for suites and experiments

Dexie contains separate tables for:

Database name: `RSembleEvaluationDB`. Initial Dexie schema version: `1`.

```text
runSummaries
runDetails
profiles
profileVersions
suites
experiments
storageMeta
```

Dexie upgrades are versioned, transactional, and tested from the prior schema. On `blocked` or `versionchange`, stop new writes, show **Close other RSemble tabs to finish the storage upgrade**, and provide Retry. Never continue paid execution against a blocked upgrade.

UI components use repository interfaces:

```ts
interface EvaluationRepository {
  listSuites(includeArchived?: boolean): Promise<EvaluationSuite[]>;
  getSuite(id: string): Promise<EvaluationSuite | null>;
  saveSuite(suite: EvaluationSuite, expectedRevision: number): Promise<number>;
  archiveSuite(id: string): Promise<void>;
  listProfiles(includeArchived?: boolean): Promise<ProfileRecord[]>;
  getProfileRecord(id: string): Promise<ProfileRecord | null>;
  getProfile(id: string, version: number): Promise<EvaluationProfile | null>;
  createProfile(record: ProfileRecord, profile: EvaluationProfile): Promise<void>;
  appendProfileVersion(record: ProfileRecord, profile: EvaluationProfile, expectedRevision: number): Promise<number>;
  setProfileArchived(id: string, archived: boolean, expectedRevision: number): Promise<number>;
  createExperiment(experiment: ExperimentRecord): Promise<void>;
  updateExperiment(experiment: ExperimentRecord, expectedRevision: number): Promise<number>;
  getExperiment(id: string): Promise<ExperimentRecord | null>;
  listExperiments(suiteId?: string): Promise<ExperimentRecord[]>;
  beginExperimentTask(input: BeginExperimentTaskInput): Promise<{ runRevision: number; experimentRevision: number }>;
  commitExperimentTaskTerminal(input: CommitExperimentTaskTerminalInput): Promise<{ runRevision: number; experimentRevision: number }>;
}
```

Suite, profile-identity, and experiment records carry monotonic concurrency revisions separate from semantic versions. Write their snapshots transactionally with compare-and-swap and legal transition checks, just like runs. `listProfiles()` joins mutable `ProfileRecord` identity/archive metadata to its latest immutable version, while `getProfile(id, version)` retrieves an exact immutable revision. `createProfile` atomically creates identity metadata and version 1. `appendProfileVersion` atomically inserts a new `[id+version]` row and advances `ProfileRecord.latestVersion`; archive/restore updates only profile identity metadata and never mutates or creates a semantic profile version. Invalid imported archives are rejected before any table mutation. Import reports created, skipped, and conflicting IDs.

## 14. Loading, empty, error, and destructive states

Every workspace distinguishes:

- initial loading;
- no data yet;
- no filter matches;
- recoverable storage error;
- malformed imported archive;
- missing deep-linked record;
- legacy summary-only record;
- running, partial, failed, aborted, and interrupted execution.

Rules:

- empty states remain compact one- or two-line instrument copy, never illustrated heroes; the Runs zero-state links to Compare rather than presenting a fake local Run action;
- no inert buttons or advertised actions that do nothing;
- errors include the failed operation and a next action;
- import and archive actions require confirmation when data could be hidden or overwritten;
- if IndexedDB initialization fails, Compare remains operational through an explicit **Run without history** fallback; each ephemeral run requires confirmation that outputs/evidence will be lost on refresh and that other tabs cannot be coordinated;
- degraded Compare runs remain in memory only, may be exported through existing human-readable export while mounted, never auto-backfill later, and stop before the next paid stage if storage fails after a normally recorded run has begun;
- Runs and Evaluations show a blocking local-persistence error with Retry storage and never offer ephemeral experiments;
- provider errors never expose credentials or raw authorization headers.

## 15. Accessibility

1. Primary navigation uses semantic links and `aria-current`.
2. Mobile bottom navigation has visible labels and safe-area padding.
3. Run list selection and route changes move focus to the new detail heading.
4. Suite task reordering is operable without drag-and-drop; provide Move up/down controls.
5. Drag-and-drop, if added later, is an enhancement rather than the only interaction.
6. Result matrices use `<table>`, `<caption>`, `<th scope="row">`, and `<th scope="col">`.
7. Score color is never the only indicator of value or status.
8. One restrained `aria-live` region announces meaningful stage transitions; streamed tokens and per-candidate deltas are not announced.
9. Loading skeletons are hidden from assistive technology and paired with text status.
10. All interactive targets meet 44×44px minimums.
11. Focus is never trapped except in true modal dialogs.
12. Keyboard shortcuts are workspace-aware and do not trigger hidden Compare actions from Runs or Evaluations.
13. Reduced-motion preference disables pulsing/marching animations that are not essential.
14. Status always combines text with the shared icon/shape cue; `partial`, `interrupted`, and `aborted` remain distinguishable without color.
15. Tablet matrix scroll regions are focusable and show an unmistakable focus outline.
16. Full model identity is available without hover.

## 16. Responsive requirements

### Desktop, `>=1024px`

- Compare retains the resizable split.
- Runs uses list/detail split.
- Suite editor uses task-list/editor split.
- Experiment results use the full matrix.

### Tablet, `768–1023px`

- primary navigation remains in the one-row header; palette/help labels collapse first, then connection text, according to §5.2;
- Compare follows existing stacked-pane behavior;
- Runs and suite editor use route-based detail; split layouts require a workspace container of at least 960px and therefore begin at desktop width;
- result matrix may scroll within its own region, never at page level.

### Mobile, `<768px`

- fixed bottom workspace navigation;
- one primary surface at a time;
- Compare retains output-first + command drawer;
- Runs list and detail are separate route states;
- suite task list and task editor are separate route states;
- matrix becomes model-selectable task rows;
- no page-level horizontal overflow at 390px;
- sticky actions do not overlap bottom navigation.

## 17. Performance constraints

- Do not write streamed token deltas to IndexedDB.
- Run-list queries read summaries, not full details.
- Full details load only for the selected run.
- Cache one selected record and invalidate it after repository updates.
- Debounce text search by 150–250ms.
- Re-filtering or sorting rows never uses positional/layout animation; content may cross-fade only when reduced motion permits.
- Initial run list renders at most 50 summaries and loads more explicitly or on controlled pagination.
- Do not virtualize lists in v1 unless browser QA demonstrates a real issue.
- Experiment execution remains sequential by task.
- Storage and route transitions must not reset an active Compare controller.

## 18. Security and privacy

Persist only information already visible to the local user or required to reproduce evaluation semantics. Construct stored errors through a bounded allowlist: provider/model ID, normalized error category, redacted human message, stage, and timestamp. Cap persisted error text at 4 KiB UTF-8 and redact authorization fragments plus exact configured credential values of six or more characters before writing. Raw provider bodies are never persisted.

Never persist or export:

- API keys;
- bearer tokens;
- request authorization headers;
- Codex credential contents or paths;
- environment-variable dumps;
- provider probe payloads containing secrets;
- hidden chain-of-thought.

Judge rationale remains concise decision evidence under the existing contract. Exports are constructed from an allowlisted archive schema rather than scanning ordinary prompt/output prose for suspicious words. V1 import limits are centralized constants: 256 MiB archive bytes; 25,000 run summaries; 25,000 run details; 5,000 profile identities; 10,000 profile revisions; 5,000 suites; 25,000 experiments; 8 MiB per string; nesting depth 32; and IDs of 1–128 characters matching `[A-Za-z0-9._:-]+`. Validate file bytes before JSON parsing and validate all remaining limits before any mutation. Imported text is rendered through existing safe Markdown handling and never executed as HTML.

## 19. Acceptance criteria

### 19.1 Navigation and shell

- [ ] Compare, Runs, and Evaluations are separately addressable and browser back/forward works.
- [ ] Desktop navigation uses semantic links with one active item; at 768px the one-row header follows the fixed label-compaction budget without hiding primary destinations.
- [ ] Mobile navigation remains usable at 390px without header clipping or page overflow.
- [ ] Rank/Fuse is shown only in Compare.
- [ ] Compare state and an active run survive navigation to another workspace.
- [ ] The 32–36px execution strip appears only off the exact owning progress route and never duplicates visible progress.
- [ ] The old shell test that forbids primary navigation is replaced with tests for the approved navigation.

### 19.2 History

- [ ] One fanout creates one stable run ID.
- [ ] Rank→Fuse updates the same run rather than adding a duplicate.
- [ ] Every status uses the shared text/color/icon treatment; partial, interrupted, and neutral aborted remain distinguishable without color.
- [ ] Outcome and every tied winner precede evidence; full task/configuration stays collapsed below it, and experiment provenance plus blind mappings are visible where evidence is interpreted.
- [ ] Legacy v1 entries import once as discriminated summary-only records without fabricated v2 fields.
- [ ] Run listing does not load every full output record.
- [ ] Filters and no-match state work together; compact record rows and model labels are shared across audit surfaces without row-layout animation.
- [ ] History export/import round-trips without credentials.

### 19.3 Evaluation profiles

- [ ] Candidate generation no longer receives evaluator-only criteria.
- [ ] Compare can choose holistic judgment, a pinned saved profile, or one-off custom criteria.
- [ ] Custom criteria require descriptions and 1/3/5 anchors.
- [ ] Criterion weights deterministically produce canonical scores without mutating stored weights.
- [ ] Tied winners remain explicit rather than collapsing to the first model.
- [ ] Historical profile snapshots are unchanged after profile edits.
- [ ] Existing suites remain pinned to their selected profile version until explicitly updated.
- [ ] Judge retry uses the frozen profile snapshot.
- [ ] `goal | metric | gap` and generic preset chips are absent from the new authoring UI.
- [ ] Criteria use a one-open accordion with blur validation, normalized header preview, and visible total-weight state.
- [ ] Non-latest profile versions are unmistakably read-only and offer Edit as new version.

### 19.4 Suites

- [ ] Profiles can be listed, versioned, duplicated, archived, restored, and reopened within Evaluations.
- [ ] A suite can be created, edited, duplicated, archived, and reopened.
- [ ] Tasks preserve user-defined order.
- [ ] Different tasks can resolve to different Judge instructions/profiles.
- [ ] Dirty suites cannot run; Save creates the displayed version and Run snapshots that exact persisted version.
- [ ] Suite experiment history reopens every prior experiment, not only the latest.
- [ ] Invalid suites cannot start and show field-specific errors.
- [ ] The experiment snapshot remains unchanged after suite edits.

### 19.5 Experiment execution and results

- [ ] Tasks execute sequentially; candidates within one task fan out in parallel.
- [ ] One task failure does not discard completed task runs.
- [ ] Pause waits for the active task to persist, prevents the next task, and resumes only explicitly.
- [ ] Abort prevents stale completions from advancing the queue.
- [ ] Reload marks active work interrupted and never silently resumes paid calls.
- [ ] Failed, partial, interrupted, or aborted tasks can be retried without rerunning successful tasks.
- [ ] Aggregation selects one whole task attempt and never splices model evidence across attempts.
- [ ] Every result cell opens underlying evidence.
- [ ] Matrix scores stay monochrome; missing/error cells use text plus icon, compact headers preserve model tails, and every tied winner is marked.
- [ ] Tablet matrix scrolling is local, keyboard-focusable, visibly outlined, and never page-level.
- [ ] Missing results are not converted to zero.
- [ ] Only complete-coverage models are eligible for overall winner.
- [ ] Mobile results remain inspectable without unusable horizontal overflow.

### 19.6 Regression and quality

- [ ] Existing provider adapters and provider-specific validation remain unchanged.
- [ ] Blind-label mapping and strict Judge parsing remain intact.
- [ ] Judge-only retry still makes zero candidate-generation calls.
- [ ] Existing Rank/Fuse behavior remains green.
- [ ] Web and server typechecks, complete tests, build, `git diff --check`, and audit pass.
- [ ] Browser QA covers 1440px, 1024px, 768px portrait, and 390px layouts with keyboard navigation, 200% zoom, compact empty states, and reduced motion.

## 20. Failure modes and rollback

| Failure | Required behavior |
|---|---|
| IndexedDB unavailable or blocked | Compare offers Retry storage and confirmed Run without history; Runs/Evaluations show a blocking persistence message and no false save confirmation. |
| v1 migration fails | Leave localStorage source untouched, record no migration marker, and permit retry. |
| Summary write succeeds but detail write fails | Transaction rolls back; stop before another paid task begins. |
| Page reloads during run | Persisted running record becomes interrupted on next startup. |
| Suite task fails | Mark the task attempt failed and retain earlier runs. Continue automatically after the terminal attempt persists unless Pause was already requested, Abort occurs, or persistence failure prevents advancement. |
| Experiment persistence fails | Stop queue advancement and surface retry/export options. |
| Deep link targets missing record | Show not-found detail with route back to list. |
| Imported archive conflicts | Skip identical records, reject incompatible same-ID records, report counts before completion. |
| Navigation during execution | Keep controller and state alive; do not abort. |
| Authority docs are not updated | Stop implementation after documentation phase; do not ship a silent scope violation. |

Rollback is additive:

- keep the existing Compare pipeline operational throughout extraction;
- feature commits are phase-scoped;
- IndexedDB schema upgrades never delete v1 localStorage automatically;
- if Runs/Evaluations must be disabled, Compare can remain the default route while stored records stay intact.

## 21. Required authority changes

Before feature code ships:

1. `PRODUCT.md`
   - add Runs and Evaluations to scope;
   - remove datasets/benchmarks from blanket out-of-scope language;
   - preserve local-first and Rank/Fuse per-task spine;
   - replace the standalone-scorecard prohibition with a prohibition on unscoped global rankings.
2. `UI.md`
   - define workspace navigation and routes;
   - preserve detailed Compare interactions;
   - add Runs, suite editor, experiment progress, and results behavior;
   - replace rubric behavior with Evaluation behavior.
3. `DESIGN.md`
   - define header navigation, mobile bottom navigation, list/detail, task editor, and matrix constraints.
4. `DECISIONS.md`
   - record the approved expansion from a single comparison surface to a local evaluation workbench.
5. `CLAUDE.md`
   - update the authority summary and execution guardrails without weakening provider-agnostic pipeline rules.

## 22. Resolved design decisions

- Top-level architecture is three separate workspaces.
- Desktop uses header navigation; mobile uses bottom navigation.
- Routes are URL-addressable.
- The existing Compare workspace remains recognizable.
- Runs is implemented before evaluation suites.
- Full history uses IndexedDB rather than expanding localStorage.
- Mature lightweight libraries are preferred over custom routing/storage abstractions.
- Suite v1 uses one Judge, one trial, numeric anchored criteria, and equal task weighting.
- Experiment tasks run sequentially; candidate fanout remains parallel.
- Fusion is excluded from suite execution.
- Semantic retrieval and clustering remain outside this specification.
- No open product question is delegated to the implementer.
