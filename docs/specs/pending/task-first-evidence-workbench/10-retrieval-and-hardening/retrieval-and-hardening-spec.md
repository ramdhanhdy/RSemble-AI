# Cross-Entity Retrieval, Archive, Migration, and Authority Hardening Specification

**Status:** Pending
**Parent:** [`../task-first-evidence-workbench-spec.md`](../task-first-evidence-workbench-spec.md)
**Order:** 09
**Dependencies:** Children 01–08 complete

---

## 1. User outcome

The completed workbench is safe and practical at real local-history scale. A user can find any Task, Task Set, Evaluation Result, Fusion Study, Comparison Result, Model configuration/evidence view, Observation, or exact Record; export and restore the complete corpus; diagnose and repair partial migrations/indexes; and trust that documentation, routes, storage, and UI all describe the shipped product consistently.

This child is the integration and production gate. It does not invent new evidence semantics.

## 2. Cross-entity search

### 2.1 Searchable types

```ts
type SearchHit =
  | TaskSearchHit
  | TaskSetSearchHit
  | RubricSearchHit
  | ComparisonSearchHit
  | EvaluationSearchHit
  | FusionStudySearchHit
  | ModelConfigurationSearchHit
  | ModelRollupSearchHit
  | ObservationSearchHit
  | RecordSearchHit;
```

Every hit includes type, stable ID, title/label, safe subtitle, owner route, matching fields, and updated/observed time.

### 2.2 Indexed fields

Index only bounded safe metadata:

- IDs and exact prefixes;
- Task title/objective, family, accepted facets;
- Task Set name/description and member Task titles;
- Rubric name/criterion labels;
- comparison/evaluation title, status, source, model labels, Task refs;
- Fusion Study title/status/kind/claim level plus safe Task Set, recipe-family, and pool labels;
- model provider/slug/version/config labels;
- Model Rollup name, pinned version, and safe exact-member labels;
- Observation Task/model/source/protocol labels;
- Record safe summary fields already used by current Runs search.

Do not index credentials, provider headers, raw candidate output, full judge rationale, unsanitized errors, attachment contents, or secret-bearing context.

### 2.3 Search behavior

- local-only lexical/token-prefix search; no remote calls or embeddings;
- exact ID matches first, then title/name prefix, then token matches;
- type groups remain visible;
- keyboard navigation and type labels;
- selecting opens owning context or exact evidence;
- queries and selected filters are preserved in route state where useful;
- no result type is silently coerced into another.

Canonical route:

```text
/search?q=...
```

The command palette provides the fast overlay; View all opens the route.

### 2.4 Index consistency

A search document records source type/ID/revision and index schema version. Repository commits enqueue local reindex. Full rebuild is resumable and idempotent. A stale hit re-resolves source before navigation and repairs/removes itself without deleting source data.

## 3. Archive v2 completion and collision-safe import

### 3.1 Goals

This child consolidates and completes the archive v2 envelope introduced in child 02 and extended by schema-owning children. Final v2 exports all canonical entities and exact legacy evidence without credentials:

```text
manifest
rubrics + rubric versions
Tasks + Task Versions + Task Artifacts + Task Instances
Task Families + facet taxonomy/annotations
Task Sets + versions/manifests
Evaluation Executions
Fusion Study recipes + pool manifests + studies + trials + attempts + experimental observations + playbooks
Comparison indexes/input snapshots
Run summaries/details and legacy records
Model configurations + Model Rollup records/versions
Observations + eligibility decisions
typed Record references/crosswalks when persisted
migration crosswalks and schema/rule versions
```

Derived caches and search documents are omitted. Exact source evidence, canonical entities, and required crosswalks are included.

### 3.2 Manifest

```ts
interface ArchiveManifestV2 {
  format: "rsemble-archive";
  schemaVersion: 2;
  exportedAt: number;
  appVersion: string;
  entityCounts: Record<string, number>;
  storageSchemaVersion: number;
  observationRuleVersions: number[];
  aggregationRuleVersions: number[];
  uncertaintyRuleVersions: number[];
  contentDigests: Record<string, string>;
  localScopeNotice: string;
}
```

Digests verify integrity, not semantic identity.

### 3.3 Secret safety

Before download/import preview:

- traverse all free-text/config/error fields through existing and expanded secret detectors;
- omit credentials and provider auth stores entirely;
- block export on unresolved secret-shaped content with entity/type location but never echo the secret;
- sanitize logs/errors according to current rules;
- test no known credential patterns appear in archive bytes.

### 3.4 Import strategy

Import is previewed before commit:

- validate manifest, digests, runtime schemas, references, and prohibited keys;
- show entity counts, conflicts, unsupported versions, and expected ID remaps;
- default is merge with collision-safe remapping;
- identical exact entities may be reused only after canonical deep equality;
- non-identical ID collisions receive new IDs and a complete reference crosswalk;
- commit in bounded atomic phases with import transaction journal;
- failure rolls back the current phase and resumes safely;
- post-import rebuilds disposable indexes/caches and verifies counts/references.

Existing archive v1 imports remain supported through canonical adapters. Import never makes provider calls.

## 4. Migration orchestration and repair

### 4.1 Registry

All child migrations register:

```ts
interface MigrationStep {
  id: string;
  version: number;
  dependencies: string[];
  inspect(): Promise<MigrationInspection>;
  apply(cursor: MigrationCursor): Promise<MigrationProgress>;
  verify(): Promise<MigrationVerification>;
}
```

Ordered dependencies cover Rubric adapters, canonical Tasks, Task Sets, Observation backfill, Compare indexes, model identities, Record references, Attention (no data step), and search/archive indexes.

### 4.2 Startup behavior

- lightweight inspection at startup;
- blocking schema steps complete before affected routes/paid execution;
- heavy rebuild/backfill runs resumably with progress and cancellation where safe;
- Compare may remain operational only when durable result preservation is safe;
- no migration marker is written before verification;
- concurrent tabs coordinate one migration owner and display read-only progress.

### 4.3 Diagnostics/repair

A local diagnostics surface at `/records/diagnostics`, reached from the secondary Records/archive utility, reports:

- storage schema and migration versions;
- source/index counts;
- unresolved crosswalks and orphan refs;
- Observation/search/cache rebuild status;
- corrupted entities with safe IDs/types;
- **Verify**, **Resume migration**, and **Rebuild derived indexes** actions.

It never offers destructive delete/reset as a casual repair. Exact source records remain protected.

## 5. Authority and documentation reconciliation

Update all current-state authorities after implementation:

- `PRODUCT.md`: task-first thesis, topology, ownership, local-first limits, evidence/profile honesty;
- `DECISIONS.md`: parent decisions and completed migration/compatibility contracts;
- `CLAUDE.md`: remove frozen three-workspace/Profile assumptions and reference shipped terminology/gates;
- provider docs: clarify exact configuration/version capture without adding providers;
- source comments: routes/workspaces/domain names match current code;
- `docs/specs/README.md`: this program and all children move to `archive/` with evidence pointers;
- QA index: automated/browser/performance/archive/migration evidence locations.

Historical docs remain historical; do not rewrite old decisions as if they always used new terms.

## 6. Cross-child invariant harness

Create a deterministic fixture corpus covering:

- new ad hoc and canonical comparisons;
- retries, failed judge, re-judge, re-fuse;
- Task versions/instances/families/facets;
- Task Set versions, incomplete evaluation, repair, recovery, roster extension with reused outputs;
- Fusion recipes/pools, exploration and confirmation studies, trials, regeneration/rerun attempts, experimental observations, playbooks, artifacts, canonical and legacy owner routes, and an unresolved owner crosswalk;
- exact/rolling/partial model identities;
- compatible and incompatible protocol/Rubric cohorts;
- verified pass/fail and judge-only evidence;
- legacy runs, suites, profiles, experiments, v1 archive;
- partial migrations and ID collisions.

The harness proves:

1. exact Run, Experiment, and Fusion Study evidence remains unchanged and reachable;
2. all migrations/rebuilds are idempotent;
3. retry/reuse/assessment counts do not inflate samples;
4. incomplete evidence never creates complete standings/paired claims;
5. profile claims disclose and drill down correctly;
6. Search/Records/Attention preserve type and ownership;
7. Records/Attention cannot execute;
8. every legacy route/archive remains valid and Fusion Study owner adapters preserve exact Task Set/version ownership;
9. experimental Fusion observations never enter canonical Task Observation/profile counts;
10. no universal score/index appears;
11. no credential-shaped text appears in UI, logs, exports, or search documents.

## 7. Performance budgets

Budgets use deterministic local fixtures and are reported with corpus size/hardware rather than claimed as universal:

- command-palette search returns first 20 grouped hits from 10,000 indexed entities within 150ms at p95 in the project QA environment;
- full Search route paginates without rendering more than 100 result rows at once;
- Records first page over 10,000 summaries within 200ms at p95;
- Attention recompute over 10,000 summaries within 150ms at p95 and no paid-execution interference;
- model evidence query over 50,000 Observations returns cached result within 100ms and uncached result within 1s at p95, using a Worker if main-thread budget would be exceeded;
- startup lightweight migration inspection within 100ms for a verified current database;
- heavy rebuild yields progress and does not block UI longer than one animation frame chunk target;
- archive export/import reports progress for large corpora and remains cancellable before commit boundaries.

If the QA hardware cannot meet a number, implementation records measured baseline and amends the budget before hiding or weakening behavior.

## 8. Responsive/accessibility/robustness matrix

Validate every primary and secondary route at:

```text
1440px
1024px
768px
390px
200% zoom
reduced motion
keyboard only
screen-reader semantics
```

Include large/empty/error/loading/partial/migrating/offline/storage-full/corrupt/unknown-version states. Probe element rectangles, not only document scroll width. Confirm focus return, landmarks, real tables, non-color states, touch targets, and no inert controls.

## 9. Security and privacy

- all data remains local/device-scoped unless current provider calls require transmission;
- Search and profiles do not introduce remote indexing or analytics;
- archives exclude credentials and expose local-scope notice;
- copied links remain device-local;
- imported HTML/Markdown/text remains escaped/sanitized under existing rules;
- runtime validators reject prototype pollution/prohibited keys;
- no new dependency is added without license/security/size review;
- no real provider call occurs in automated/browser QA.

## 10. Non-goals

- cross-device synchronization, cloud backup, or public sharing;
- retention/delete policy;
- semantic/embedding search;
- universal score, IRT, workflow benchmarking, or new evidence inference;
- new providers/model catalog expansion;
- product analytics/telemetry upload;
- destructive reset as migration repair;
- calendar estimates.

## 11. Implementation sequence

1. Build typed cross-entity search documents/query/ranking with secret-safe fields.
2. Integrate incremental indexing and command-palette/full-route UI.
3. Consolidate/finalize archive v2 manifest/entities/validators/digests, preserve earlier-v2 collections, and retain v1 adapters.
4. Implement preview, collision crosswalk, phased import journal, export/import progress, and round-trip tests.
5. Consolidate migration registry, startup inspection, ownership, resume, verify, and derived-index rebuild.
6. Build non-destructive diagnostics/repair surface.
7. Build cross-child fixture/invariant harness.
8. Enforce/report performance budgets and move heavy computation off main thread as needed.
9. Run full responsive/accessibility/security/archive/migration/browser matrix.
10. Reconcile all authority docs/comments/spec status and archive the complete program.

## 12. Validation plan

### Search

Exact ID/type/title/token ranking, type grouping, stale document repair, incremental/full rebuild idempotency, pagination/virtualization, owner routes, keyboard flow, prohibited-field and secret tests.

### Archive

V2 clean round trip; v1 import; partial/large archive; digest failure; malformed/prohibited keys; ID collisions with full remap; identical entity reuse; phase rollback/resume; cross-reference verification; no credentials in bytes; unknown future version refusal.

### Migration

Fresh DB, every supported historical fixture, each partial child migration, corrupt crosswalk, orphan index, multi-tab owner loss, restart/resume, storage quota/unavailable, and N repeated startups. Verify exact source semantic equality before/after.

### Integration/invariants

Run the cross-child corpus through Compare, ordinary Evaluation, Fusion Study retrieval/owner routes, recovery, roster extension, canonical Observation derivation, Models, shell, Records, Attention, Search, export/import, rebuild, and legacy routes.

### Browser/visual

Scripted deterministic CDP matrix over all routes/states/viewports plus screenshots and structured results. Check console/network errors, focus, overflow, secrets, reduced motion, local-link copy, and no inert controls.

### Commands

```bash
npx vitest run
npm run typecheck:web
npm run qa:suite-reliability
npm run qa:design-motion
npm run qa:evaluations-identity
npm run check
```

Add dedicated commands for task-first migration/archive/search/profile QA and document them in `package.json`/QA index.

## 13. Completion criteria

- typed Search finds every canonical entity and opens the correct owner/evidence;
- archive v2 safely round-trips the complete corpus and v1 remains importable;
- every migration is ordered, resumable, idempotent, verifiable, and non-destructive;
- diagnostics repair derived state without deleting source evidence;
- cross-child invariants pass on comprehensive fixtures;
- performance budgets are measured and met or explicitly amended with evidence;
- all responsive/accessibility/security/browser gates pass;
- current authority documents and source comments describe the shipped task-first product;
- all nine child specs and parent move to `docs/specs/archive/` with valid references and QA evidence;
- no universal score, IRT, workflow benchmarking, remote search/sync, retention scope, or unrequested provider work appears.

## 14. Assumptions and unresolved implementation discoveries

**Locked assumption:** every derived index/cache can be rebuilt from canonical entities and exact source evidence; only canonical crosswalks and exact records require preservation.

**No product decision remains unresolved.** Any newly discovered incompatible historical schema is added as an explicit validated import/migration adapter or rejected safely; it is never coerced silently.
