# Contextual Compare Results and Task Promotion Specification

**Status:** Pending
**Parent:** [`../task-first-evidence-workbench-spec.md`](../task-first-evidence-workbench-spec.md)
**Order:** 05
**Dependencies:** 02 Canonical Tasks; 04 Observations and Evidence

---

## 1. User outcome

A user can give models an ordinary ad hoc task, receive a durable Rank or Fuse result, revisit it inside Compare, understand its evidence status, recover/retry it, and optionally promote or link it to a canonical Task. Compare history becomes meaningful result history rather than requiring a trip to a raw run ledger.

The workflow remains lightweight: canonical benchmark design is not required before the first comparison.

## 2. Current foundation

Current Compare already provides:

- shared task input/context and candidate roster;
- Rank/Fuse execution, streaming, retry, re-judge, re-fuse, abort, and persistence;
- exact `RunRecordV2` with selected attempts, judge/fusion evidence, costs, errors, and messages;
- output surfaces for recommendation, leaderboard, breakdown, fused document, and exact evidence disclosure;
- `Open in Compare` configuration preload that intentionally does not fabricate prior outputs;
- existing run-ID preservation and compatibility tests.

This child adds semantic result ownership, routes, task linkage, and evidence receipts without replacing the run controller.

## 3. Comparison Result identity

For current and migrated full Compare records:

```text
comparisonId == runId
```

Add a lightweight index:

```ts
interface ComparisonResultIndex {
  id: string;
  runId: string;
  createdAt: number;
  updatedAt: number;
  status: RunStatus;
  mode: "rank" | "fuse";
  title: string;
  taskBinding: ComparisonTaskBinding;
  taskInstanceId: string | null;
  activeObservationIds: string[];
  evidenceReceiptRevision: number;
  lineage: ComparisonLineage;
  revision: number;
}

type ComparisonTaskBinding =
  | { kind: "ad_hoc"; inputSnapshotRef: string }
  | { kind: "canonical"; taskId: string; taskVersion: number };
```

The index never copies candidate outputs or judge rationale. RunRecordV2 remains exact result authority.

## 4. Routes and ownership

Canonical routes:

```text
/compare
/compare/results/:comparisonId
```

Compare workspace owns:

- New comparison;
- Previous comparisons;
- result detail;
- retry/re-judge/re-fuse;
- task promotion/linking;
- evidence receipt;
- exact Record drilldown.

`/runs/:runId` remains an exact-record route and links back to `/compare/results/:comparisonId` when source is Compare.

## 5. Input snapshot and pre-paid-call persistence

Before any provider call:

1. validate candidate roster, judge/Rubric, context, and mode;
2. create the RunRecordV2 through the existing atomic recorder;
3. create or update the Comparison Result index with immutable input snapshot reference;
4. if canonically bound, resolve Task Version and create/get Task Instance;
5. persist the linkage atomically or abort before paid execution;
6. acquire existing execution ownership/lease and continue current pipeline.

Ad hoc input snapshots preserve the normalized task/context required for later promotion without claiming canonical identity.

## 6. New and previous comparisons

### 6.1 Compare rail/panel

The Compare context provides:

- **New comparison**;
- **Previous comparisons** sorted newest first;
- compact status, task title, mode, candidate count, coverage/evidence state, time, and cost;
- search/filter by title, model, status, mode, Task binding, and date;
- pagination or virtualization using existing list patterns;
- interrupted/recoverable states with the owning action.

Rows are semantic result links, not inert entities or disguised buttons.

### 6.2 Result detail

A result route reconstructs the current Rank/Fuse output from exact persisted state and shows:

- task/version or Ad hoc label;
- result recommendation/fused output;
- candidate and judge evidence;
- coverage, failures, costs, protocol/Rubric, timestamps;
- retry/re-judge/re-fuse as currently allowed;
- Evidence receipt;
- Open exact Record;
- Task promotion/link action when ad hoc.

Reload must not require in-memory reducer state.

## 7. Canonical Task workflows

### 7.1 Start from a Task

The task control supports:

- search/select canonical Task and exact version;
- latest version by default with visible pin;
- open Task detail;
- clear binding and continue ad hoc.

Selecting a Task populates its candidate-visible definition and context manifest. The binding is explicit.

### 7.2 Editing a bound Task

Editing task-defining content marks the comparison as **new Task version draft**. Before run, the user chooses:

- **Create Task vN+1 and run**, committing the version/linkage before paid calls; or
- **Run as ad hoc**, preserving the canonical version unchanged.

There is no silent mutation of a canonical version and no automatic unlinking.

### 7.3 Promote an ad hoc comparison

After or before execution, **Save as Task**:

1. previews title, objective, instruction, context manifest, response contract, family, and facets;
2. suggests exact-content matches as choices but never merges automatically;
3. supports **Create new Task** or **Link to existing Task Version**;
4. validates that existing Task Version executable content matches the stored comparison input before linking;
5. creates/reconstructs a Task Instance;
6. updates the Comparison Result binding via CAS;
7. triggers evidence reindex under child 04 rules.

If required historical input content is missing, linking may be recorded for navigation but evidence remains limited with explicit `instance_input_incomplete` reason.

### 7.4 Similarity and duplicates

Only exact normalized matches can be offered as exact matches. Semantic similarity may be a search aid later but never creates identity. A user may intentionally create two similar Tasks.

## 8. Evidence receipt

Each result shows:

- durable exact record status;
- canonical Task/Version/Instance status;
- evidence class and allowed uses per model observation;
- complete/incomplete roster coverage;
- Rubric/protocol/evaluator/verifier;
- retries, reused evidence, unknown model versions, and failures;
- reasoned “Why it counts / does not count” list;
- exact observation and Record links.

Ad hoc results say plainly:

> Preserved as exploratory evidence. Save or link this work to a canonical Task before it can contribute to a model evidence profile.

A result never claims “evidence eligible” from completion alone.

## 9. Retry, recovery, and lineage

- Existing retry/re-judge/re-fuse semantics remain inside Compare.
- Recovery appends attempts and updates the same Comparison Result lineage.
- A deliberate **Run again as new comparison** creates a new Comparison Result and source run, linked as `repeatedFrom` but not declared an independent replicate unless a protocol explicitly says so.
- `Open in Compare` from a Record restores configuration only and displays its existing honesty notice; it never injects historical outputs into a new draft.
- A result route may load accepted outputs from its own exact persisted record because it is the historical result, not a new draft.
- Execution lease, status timeline, errors, and storage recovery remain unchanged.

## 10. Legacy migration

For every current full Compare RunRecordV2:

- create an idempotent Comparison Result index with `id == runId`;
- derive title/status/mode/time/cost from existing summary/detail;
- preserve existing run ID and route;
- set Task binding to `ad_hoc` unless an explicit trustworthy existing source link is present;
- retain exploratory evidence limitation until user promotion/linking;
- do not create Tasks by prompt hash;
- keep legacy summary-only records as Records only if no full result can be reconstructed.

Repeated migration startup produces no duplicate indexes.

## 11. Repository/query changes

Add a Comparison repository or read-model repository over RunRepository plus index storage:

```text
listComparisonResults(query)
getComparisonResult(id)
createComparisonEnvelope(...)
bindComparisonToTask(..., expectedRevision)
recordComparisonLineage(...)
rebuildComparisonIndex(runId)
```

List filters run over the complete result set before pagination. Source record and index revision mismatches produce a repairable warning, not a fabricated merged state.

## 12. UI/accessibility/responsive requirements

- Compare command/output split remains usable on desktop.
- On 390px, new/history/result are route- or panel-based with no crushed titles or hidden primary action.
- Keyboard flow covers new, select Task, create version/ad hoc choice, run, history, result actions, promotion dialog, and exact Record.
- Result status and evidence do not rely on color.
- Long prompts, model slugs, reason lists, and task titles wrap without element-level overflow.
- Loading, empty, storage-unavailable, interrupted, partial, unknown-result, and migration-error states are explicit.
- All controls are functional; no future Models/Attention controls are introduced here.

## 13. Archive compatibility

This child extends archive v2 with Comparison Result indexes, lineages, canonical/ad-hoc Task bindings, immutable input-snapshot metadata/artifact references, and migration limitations. Exact RunRecordV2 remains the source payload and is not duplicated. Earlier v2 and v1 imports remain readable; non-identical collisions abort before writes until child 09.

## 14. Non-goals

- model evidence profile aggregation;
- Models navigation;
- Task Set editor changes;
- Records demotion or final global shell;
- semantic deduplication;
- automatic evidence inclusion for unlinked ad hoc tasks;
- declared replicate authoring UI;
- final cross-entity archive collision remapping/large-import hardening or global cross-entity search. This child still extends the existing archive v2 round trip with Comparison Result indexes and Task/input linkage.

## 15. Implementation sequence

1. Define Comparison Result index, binding, lineage, and runtime validators.
2. Implement read-model repository and idempotent legacy indexing.
3. Persist comparison envelope/input snapshot and canonical Task Instance before paid calls.
4. Build Previous comparisons and result routes from persisted state.
5. Add Task select/new-version/ad-hoc execution choices.
6. Add post-result Save/Link Task workflow with CAS and exact-match validation.
7. Integrate Observation reindex and Evidence receipt.
8. Preserve and regression-test retry/re-judge/re-fuse/Open-in-Compare behavior.
9. Add responsive/accessibility/browser QA and authority updates.

## 16. Validation plan

### Domain/repository

- idempotent index from RunRecordV2;
- comparison ID/run ID equality;
- source/index revision mismatch repair;
- atomic pre-call linkage;
- canonical edit requires new version or ad hoc;
- exact-link validation and collision handling;
- repeatedFrom does not set replicate status.

### Execution regression

- no paid call before durable source/index/task linkage;
- stream/retry/re-judge/re-fuse/abort behavior unchanged;
- storage failure and lease loss preserve recoverability;
- dynamic judge-label roster mocks remain valid;
- no credentials enter snapshot, index, UI, or log.

### Component/route

- history filters and pagination across complete set;
- direct-load result reconstructs Rank/Fuse output;
- ad hoc versus canonical labels;
- promotion create/link/cancel/conflict/missing-input flows;
- Evidence receipt reason rendering;
- exact Record and owning-context backlinks;
- Open in Compare restores config without results/lineage fabrication.

### Browser

New → run → reload result → promote/link → evidence receipt → exact Record → return, plus interrupted recovery and mobile/zoom/keyboard/reduced-motion/overflow states.

### Commands

```bash
npx vitest run src/lib/persistence src/lib/evidence src/ui src/workspaces/compare
npm run typecheck:web
npm run check
```

## 17. Completion criteria

- Compare owns navigable, reload-safe durable result history;
- every current full Compare run has one compatible result index;
- ad hoc work remains frictionless and honestly exploratory;
- canonical Task selection/versioning/promotion/linking never mutates or auto-merges identity;
- evidence receipts are grounded in child 04 decisions;
- retry/recovery/re-judge/re-fuse and exact Records remain intact;
- archive v2 extends with Comparison Result indexes and Task/input linkage while v1/earlier-v2 remain readable and RunRecordV2 payloads are not duplicated;
- no raw Runs workspace is required for ordinary comparison history;
- all automated, route, responsive, accessibility, and browser gates pass.

## 18. Assumptions and unresolved implementation discoveries

**Locked assumption:** current full RunRecordV2 contains enough persisted result state to reconstruct historical Rank/Fuse result routes; unavailable optional UI-only state must degrade explicitly rather than be invented.

**No product decision remains unresolved.** If exact Task linkage cannot be proved from stored inputs, the comparison stays ad hoc/exploratory.
