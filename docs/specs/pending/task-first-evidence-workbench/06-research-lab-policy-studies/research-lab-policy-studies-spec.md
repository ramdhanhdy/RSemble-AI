# Research Lab and Policy Studies Specification

**Status:** Pending
**Parent:** [`../task-first-evidence-workbench-spec.md`](../task-first-evidence-workbench-spec.md)
**Order:** 06
**Dependencies:** 01 Rubrics; 02 Canonical Tasks; 03 Task Sets and Evaluations; 04 Observations and Evidence; 05 Contextual Compare Results

---

## 1. User outcome

A user can open a first-class **Research Lab**, run a reproducible **Policy Study** over an exact Task Set Version, compare `best_fixed`, `rank`, `fuse`, and `refine` execution policies, and leave with an inspectable Policy Playbook that says what to run, at what expected policy cost, with what evidence and claim level.

Fusion is repositioned from a Task-Set-owned study into one method tested by Policy Studies. Everyday Compare always preserves a judged Comparison Result first; Fuse and Refine create attributable derived results. A user may explicitly run Compare with a pinned playbook after a live cost preflight, but no playbook silently changes future work.

The Lab establishes a durable internal study substrate for later first-party Routing, Judge, and Workflow study verticals. Only Policy Studies are registered, creatable, routable, and visible in this child. There are no placeholder tabs, enum values, routes, or controls for unimplemented study kinds.

## 2. Why the current positioning changes

Production `FusionStudy` is not solely a fusion experiment:

- it compares `best_fixed`, `rank`, `fuse`, and `refine`;
- “do not fuse” is a valid recommendation;
- its output is a policy playbook over quality, cost, complementarity, recipe sensitivity, and pool adequacy;
- its Task Set/Suite is the frozen workload input, not the owner of recipes, model pools, treatments, or claims;
- `FusionRecipeVersion` and `PoolManifestVersion` are reusable experimental assets;
- Compare’s Fuse action creates an answer, while a study evaluates whether that action is justified.

Therefore current storage location and route nesting are implementation evidence, not target product ownership.

## 3. Target product topology and ownership

```text
Compare
└─ Comparison Result
   ├─ ranked candidates + Judge evidence
   ├─ Fusion Result      (optional derived result)
   └─ Refined Result     (optional derived result)

Evaluations
└─ Task Set Version
   └─ ordinary Evaluation Executions / result matrices / recovery

Research Lab
├─ Policy Studies
│  ├─ pinned Task Set Version
│  ├─ pinned Model Pool Version
│  ├─ pinned Fusion Recipe Versions
│  ├─ trials / attempts / study observations
│  └─ Policy Playbook
├─ Fusion Recipes
└─ Model Pools

Models
└─ qualified evidence about exact Model Configurations

Records
└─ exact operational and experimental records from every owner
```

Ownership rules:

- Task Sets own workload definitions, protocol, and ordinary Evaluation execution context.
- Policy Studies own experimental treatment comparison, study observations, claim level, and playbook.
- Fusion Recipes and Model Pools are reusable versioned Lab assets, not Task Set children.
- Compare owns Comparison Results and derived Fusion/Refined Results.
- Records owns exact secondary retrieval, not product meaning.
- Models may consume only eligible single-model canonical Observations, never policy outputs attributed to contributors.

A Task Set page may offer **Start Policy Study** with an exact version preselected and list referencing studies. This is a contextual handoff/backlink, not ownership.

## 4. Generic first-party study substrate

### 4.1 Registration boundary

The study system uses an internal first-party registry:

```ts
interface StudyTypeRegistration<Definition, TrialPayload, ObservationPayload, ReportPayload> {
  kind: string;
  schemaVersion: number;
  validateDefinition(value: unknown): value is Definition;
  validateTrialPayload(value: unknown): value is TrialPayload;
  validateObservationPayload(value: unknown): value is ObservationPayload;
  validateReportPayload(value: unknown): value is ReportPayload;
  fingerprintDefinition(value: Definition): string;
}
```

At child completion, exactly one registration exists:

```text
kind = "policy"
```

Unknown/unregistered kinds are rejected before persistence, execution, import, or route rendering. This is not a user-authored JSON-schema system or plugin SDK.

### 4.2 Study record

```ts
interface StudyRecord {
  id: string;
  revision: number;
  kind: "policy";
  title: string;
  status: "draft" | "in_progress" | "completed" | "failed" | "archived";
  claimLevel: "exploratory" | "confirmed";
  definitionSchemaVersion: number;
  definitionFingerprint: string;
  definition: PolicyStudyDefinition;
  reportRef: string | null;
  confirmationOf: string | null;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}
```

Draft definitions use CAS revisions. Starting paid execution seals the definition fingerprint and every pinned input/version. Treatment-changing work creates new trials; it does not mutate a sealed treatment. A completed study’s definition, trials, observations, and report are immutable.

Only untouched drafts may be permanently deleted. Any study that started paid execution can be archived but not deleted through normal UI or repository APIs.

### 4.3 Common execution envelopes

```ts
interface StudyTrial {
  id: string;
  studyId: string;
  payloadKind: "policy";
  payloadSchemaVersion: number;
  payloadFingerprint: string;
  payload: PolicyTrialPayload;
  status: "in_progress" | "sealed";
  sampleIndex: number;
  artifactRefs: StudyArtifactRef[];
  observationIds: string[];
  policyCost: TokenCost;
  experimentalCost: TokenCost;
  createdAt: number;
  sealedAt: number | null;
}

interface StudyAttempt {
  id: string;
  studyId: string;
  fromTrialId: string;
  toTrialId: string;
  reason: string;
  createdAt: number;
}

interface StudyObservation {
  id: string;
  studyId: string;
  trialId: string;
  payloadKind: "policy_measurement";
  payloadSchemaVersion: number;
  payload: PolicyMeasurementPayload;
  status: "completed" | "failed";
  sourceRunId: string | null;
  createdAt: number;
  finishedAt: number;
}
```

Common envelopes own identity, lifecycle, lineage, exact costs, artifact references, schema versions, and prohibited-field scanning. Registered type validators own specialized payload semantics. Payloads are discriminated and validated; arbitrary untyped JSON is not accepted.

A measurement-only retry creates another `StudyObservation` against the same sealed artifact. A treatment-changing retry creates a successor `StudyTrial` linked by `StudyAttempt`. Retry storms never create independent samples merely because an evaluator call was repeated.

## 5. Policy Study specialization

```ts
interface PolicyStudyDefinition {
  workload: { taskSetId: string; version: number; manifestDigest: string };
  modelPool: { poolId: string; version: number; digest: string };
  fusionRecipes: Array<{ recipeId: string; version: number; digest: string }>;
  judge1: ExactModelConfigurationRef;
  judge2: ExactModelConfigurationRef;
  rubric: { rubricId: string; version: number };
  protocolFingerprint: string;
  policies: Array<"best_fixed" | "rank" | "fuse" | "refine">;
  stageProtocolVersion: number;
  claimPlan: "exploration" | "confirmation";
}
```

The initial Policy Study preserves the proven staged methodology:

- Stage A eliminates recipe families and never crowns a winner.
- Stage B screens model pairs, measures selection/synthesis headroom, compares policies on blocked holdout tasks, records cost multipliers, and applies the predeclared MPID.
- Stage C performs recipe-sensitivity and synthesizer-cross checks.
- Exploration and confirmation remain visibly distinct claim levels.
- Confirmation uses a fresh pinned Task Set Version and preselected policy/configuration without reselection.
- Pool adequacy, full screened-pair tables, losers, retries, failures, and experimental cost remain visible.
- Blind labels are resolved only after judging and synthesizer inputs remain anonymized.

A Policy Playbook is immutable and contains:

- exact Study and definition fingerprint;
- exact workload, model-pool, recipe, judge, Rubric, and protocol refs;
- policy comparison rows for `best_fixed`, `rank`, `fuse`, and `refine`;
- mean outcomes, paired uncertainty/MPID verdicts, policy cost and experimental cost;
- pool-adequacy qualifier and recipe-sensitivity findings;
- recommendation, including `do_not_fuse`;
- exploratory or confirmed claim level;
- exact supporting Trial/Observation/Record refs;
- created time and report schema version.

A playbook describes evidence for one pinned policy configuration and workload scope. It is not a global automatic rule and not evidence about one contributing model.

## 6. Reusable Lab assets

### 6.1 Fusion Recipes

The user-facing term **Fusion** remains only where synthesis is actually performed: Fuse action, Fusion Result, and Fusion Recipe.

A stable `LabRecipeRecord` owns name, description, archive state, latest version pointer, and kind. Immutable `LabRecipeVersion` values use `kind: "fusion"` and preserve recipe family, prompt version, Judge-analysis mode, Rubric access, verification instructions, exact synthesizer, canonical serialized payload, and digest.

Editing creates a new version. A referenced version cannot be mutated or deleted. Records may be archived; archived versions remain resolvable from studies and results.

### 6.2 Model Pools

A stable `ModelPoolRecord` owns name, purpose, archive state, and latest version pointer. Immutable `ModelPoolVersion` values preserve exact configuration members, core/challenger roles, diversity checklist, rationale, supersession, created time, canonical payload, and digest.

Pools do not merge model evidence, create a synthetic respondent, or imply comparability. They are experimental selection manifests.

## 7. Routes and navigation

Canonical routes:

```text
/lab
/lab/studies/:studyId
/lab/recipes
/lab/recipes/:recipeId/versions/:version
/lab/model-pools
/lab/model-pools/:poolId/versions/:version
```

`/lab` leads with Policy Studies and playbook findings. Fusion Recipes and Model Pools are secondary sections. No Routing/Judge/Workflow tabs or empty cards exist.

The canonical study route expresses study identity, not Task Set ownership. Direct load, refresh, back/forward, unknown ID, archived asset, interrupted study, and exact Record round trips are required.

The old route is intentionally removed after the one-time migration:

```text
/evaluations/:suiteId/fusion/:studyId
```

It does not redirect. No canonical route contains `suiteId`, `taskSetId`, or the old Fusion Study name.

Child 06 makes every Lab route functional. Child 08 adds **Lab** to final primary navigation only after Compare, Evaluations, Lab, and Models are all functional; until then, Task Set backlinks and direct routes provide contextual access without an inert primary destination.

## 8. Compare and playbook integration

Child 05 changes everyday Compare so the judged Comparison Result is always the durable parent. Rank is no longer a peer root mode. Fuse and Refine create derived child results against pinned accepted candidates and Judge evidence.

A user may explicitly choose **Run with playbook**:

1. select one exact Policy Playbook version;
2. verify the current canonical Task Version is the pinned workload member or require explicit compatible Task Set context selection;
3. pin candidate Model Configurations, Judge, Rubric, Fusion Recipe, and policy configuration;
4. compute a live call/cost preflight from current provider pricing;
5. require explicit confirmation before paid calls;
6. run the parent Comparison Result;
7. after successful judging, automatically run the playbook’s recommended derived action;
8. attach the exact playbook ref and compatibility decision to the parent and derived result.

The playbook never silently attaches itself to later Compare work, follows “latest,” or runs without a fresh cost preflight. `do_not_fuse` or `best_fixed` recommendations must not create a Fusion Result.

## 9. Evidence boundaries

`StudyObservation` is Lab-owned policy evidence. It never enters Model Evidence Profiles directly.

Underlying single-model candidate responses may qualify as canonical Task Observations through child 04 only when all ordinary requirements pass:

- exact canonical Task Version and Task Instance resolve;
- response content/artifacts are complete and digest-addressed;
- exact Model Configuration, provider, version, reasoning/tool settings, and protocol are pinned;
- accepted attempt and assessment identities are unambiguous;
- Rubric/verifier/evaluator provenance is complete;
- eligibility rules classify the intended evidence use;
- an existing canonical Observation with the same immutable source identity is reused rather than duplicated.

The eligibility adapter reads underlying candidate Run/attempt evidence, not Policy Study scores. Referencing the same candidate in multiple trials or studies does not create additional samples.

Rank selections, Fusion Results, Refined Results, policy rows, playbook scores, recipe comparisons, and study conclusions remain policy evidence. They are not attributed wholly, fractionally, or collectively to participating model profiles.

## 10. One-time hard migration

### 10.1 Canonical store replacement

Current active stores are replaced, not wrapped or retained as writable authorities:

| Current store/type | Canonical destination |
|---|---|
| `fusionRecipes` / `FusionRecipeVersion` | `labRecipeRecords` + `labRecipeVersions`, `kind: "fusion"` |
| `poolManifests` / `PoolManifestVersion` | `modelPoolRecords` + `modelPoolVersions` |
| `fusionStudies` / `FusionStudy` | `studies` / `StudyRecord(kind: "policy")` |
| `fusionTrials` / `FusionTrial` | `studyTrials` / `StudyTrial(payloadKind: "policy")` |
| `fusionAttempts` / `FusionAttempt` | `studyAttempts` / `StudyAttempt` |
| `fusionObservations` / `EvaluationObservation` | `studyObservations` / `StudyObservation(payloadKind: "policy_measurement")` |
| `fusionPlaybooks` / `FusionPlaybook` | `policyPlaybooks` / `PolicyPlaybook` |

Existing IDs, lineage, Task Set-version meaning, recipe/pool membership, stage results, claim levels, costs, artifacts, and report conclusions are semantically converted. The old payload shape is not retained as a canonical entity.

### 10.2 Transaction protocol

Migration is one-way after commit:

1. detect the exact source schema and acquire exclusive migration ownership;
2. read and validate all seven current stores plus Suite→Task Set crosswalks;
3. construct every destination entity in memory/staging and compute source/destination semantic receipts;
4. verify counts, IDs, refs, digests, treatment lineage, claim levels, costs, stage results, and Task Set Version mapping;
5. abort without writes if any record is unmappable, ambiguous, prohibited, or corrupt;
6. transactionally write all canonical Lab stores and migration receipt;
7. re-read and verify destination records;
8. delete old active stores in the same committed schema transition;
9. mark migration complete only after full verification.

There is no partial “read-only legacy” state, guessed owner, dual write, or latest-version substitution. Until the transaction commits, the source database remains usable. After commit, runtime code cannot read or write old stores.

### 10.3 Deliberate compatibility break

After child 06:

- old Fusion Study routes are unsupported;
- old Fusion-shaped archive collections are unsupported;
- old Fusion payload types are not runtime repository contracts;
- the active product exports only generic Lab entities.

This is intentional and must be called out in release notes and migration preflight. It does not authorize deletion of semantically convertible study content.

## 11. Archive v3

Because old Fusion-shaped archive imports are deliberately unsupported, child 06 introduces **archive v3** rather than changing v2 meaning in place.

Archive v3 includes canonical state from earlier children plus:

- Study records and typed definitions;
- Study Trials, Attempts, Observations, artifact refs, and Policy Playbooks;
- Lab Recipe records/versions;
- Model Pool records/versions;
- study registry/schema versions and fingerprints;
- migration receipt and Task Set reference crosswalks;
- exact underlying Run/Experiment/Comparison evidence referenced by studies.

V3 import validates the complete graph before writes. Non-identical collisions still reject before writes until child 10 adds complete remapping.

V1/v2 archives without old Fusion collections remain importable under their existing contracts. A v2 payload containing any old Fusion collection is rejected as `unsupported_fusion_archive_shape`; it is never partially imported or coerced. The UI names the incompatible collection types without echoing sensitive content.

## 12. Repository, concurrency, recovery, and provenance

Repositories provide contract-parity in-memory and Dexie implementations for:

- study create/update-draft/start/seal/fail/archive/list/get;
- trial create/seal/list and treatment-changing attempt lineage;
- terminal observation append/list;
- report/playbook create/get;
- Lab Recipe and Model Pool record/version CRUD and archive;
- registry/schema validation and canonical fingerprints;
- exact Task Set/Task/Run/Record resolution;
- one-time migration preview/commit/receipt.

All mutable lifecycle transitions use CAS revision or existing unit-of-work semantics. Multi-tab execution ownership, lease renewal, interruption, resume, failed evaluator retry, treatment-changing regeneration, and study-stage recovery retain current reliability. No repository method performs provider calls.

Every paid call pins exact provider/model/configuration, recipe/prompt, Judge, Rubric, protocol, accepted inputs, attempt lineage, timestamps, tokens, costs, errors, and artifact hashes. Secrets and environment/auth snapshots remain prohibited.

## 13. UI, responsive, and accessibility requirements

The reviewed artifact is explanatory authority for positioning and information hierarchy:

[`../../../explorations/future-task-first-ui/rsemble-research-lab-positioning.html`](../../../explorations/future-task-first-ui/rsemble-research-lab-positioning.html)

Production UI must follow repository design authority rather than copy illustrative data.

Required Lab states:

- first use, no studies, no assets;
- draft, in-progress, interrupted, failed, completed, confirmed, and archived studies;
- migration blocked with exact diagnostics;
- Policy Studies default list with active/findings/confirmed summaries;
- secondary Fusion Recipe and Model Pool sections;
- pinned inputs, stages, full policy table, uncertainty/MPID, costs, findings, evidence boundary, and exact Record links;
- explicit New Policy Study and Task Set contextual entry;
- no nonfunctional future study types.

At 1440, 1024, 768, and 390 CSS pixels plus 200% zoom:

- no document-level or element-level accidental overflow;
- wide experimental tables use labeled contained scrolling or responsive row transformation;
- touch targets are at least 44×44 CSS pixels;
- status is not color-only;
- keyboard order follows visual order;
- dialogs trap focus, make the background inert, close with Escape, and restore focus;
- live progress uses restrained `aria-live` updates;
- reduced motion removes nonessential transition/streaming motion;
- direct routes and browser navigation preserve meaningful focus/scroll state.

## 14. Security and data-safety requirements

- Validate all imported, migrated, and registered payloads before writes.
- Reject unknown study kinds/schema versions and prohibited keys recursively.
- Never persist credentials, auth headers, raw environment maps, or provider secrets.
- Render all study/report text as text, never unsanitized HTML.
- Cost preflight reads current pricing but does not persist secret-bearing provider configuration.
- Migration diagnostics identify entity/type/ID safely and never echo sensitive values.
- Archive export scans every free-text/config/error location before finalization.

## 15. Non-goals

- User-authored study schemas or third-party study plugins.
- Functional Routing, Judge, or Workflow studies.
- Placeholder future study navigation.
- Automatic universal policy recommendations across unrelated workloads.
- Automatic playbook application.
- Attributing fused/refined/policy output to one participating model.
- Pooling Model Pool members into a model respondent.
- Treating study attempts/evaluator retries as independent Tasks.
- Restoring old Fusion Study routes, stores, or archive shapes after migration.
- IRT or general workflow benchmarking in this child.

## 16. Implementation sequence

1. Characterize current Fusion repositories/controllers/routes/UI/stores and freeze a complete migration corpus.
2. Define common study envelopes, first-party registry, Policy payload schemas, lifecycle, and fingerprints.
3. Define reusable Lab Recipe and Model Pool record/version repositories.
4. Build the transactional hard migration and semantic verification receipt before switching runtime readers.
5. Adapt current staged Fusion orchestration behind the registered Policy Study adapter.
6. Implement canonical Lab routes, home, asset sections, and complete Policy Study detail/recovery.
7. Extend child 04 eligibility with the underlying single-model candidate adapter and non-inflation tests.
8. Implement explicit Policy Playbook handoff into child 05 Compare with live cost preflight.
9. Introduce archive v3, reject old Fusion-shaped v2 payloads, and prove clean round trip.
10. Remove old route/store/repository/UI authority and update docs/comments.
11. Run responsive/accessibility/security/migration/full gates.

Runtime switching and old-store deletion occur only after the destination repository, migration, and semantic corpus tests are green.

## 17. Validation plan

### Domain and registry

- registered Policy payload round trip and fingerprint permutation invariance;
- unknown kind/schema/prohibited field rejection;
- draft CAS, sealed immutability, archive/delete lifecycle;
- trial/attempt/observation identity and non-inflating retry rules;
- confirmation linkage and claim-level rules.

### Migration and archive

- every current store/type and reference maps to expected canonical entity;
- exploration/confirmation, partial/in-progress, failures, retries, recipe sensitivity, pool adequacy, costs, artifacts, and `do_not_fuse` survive semantically;
- unmappable Task Set Version, corrupt ref, unknown recipe, ID collision, quota, cancellation, and crash fail before destructive commit;
- repeat startup is idempotent;
- old stores absent and canonical stores authoritative after commit;
- old routes fail rather than redirect;
- archive v3 round trip succeeds;
- v1/v2 without Fusion collections imports; v2 with old Fusion collections rejects atomically.

### Evidence

- eligible underlying single-model candidate can create/reuse one canonical Observation;
- same candidate referenced by many trials/studies does not duplicate;
- policy/fusion/refine/rank/playbook outputs never enter Model Evidence Profiles;
- incomplete/ambiguous/protocol-incomparable candidates remain ineligible with reasons.

### UI and browser

- all Lab routes/states/assets/study actions;
- Task Set contextual Start Policy Study and backlinks;
- Compare explicit Run with playbook, cost preflight, no silent persistence, correct derived result;
- 1440/1024/768/390, 200%, keyboard, focus trap/restore, reduced motion, large tables;
- direct load/refresh/back-forward and exact Record round trips;
- no inert future study controls, console errors, credential text, or accidental overflow.

### Commands

```bash
npx vitest run <targeted Lab/domain/migration/Compare files>
npm run typecheck:web
npm run qa:research-lab
npm run check
npm run format:check
git diff --check
```

## 18. Completion criteria

- Research Lab, Policy Studies, Fusion Recipes, and Model Pools are functional and independently owned.
- Policy Studies pin exact workload/assets/protocol and preserve staged experimental rigor.
- Compare owns the base judged result; Fusion/Refine are derived and playbooks are explicit/cost-preflighted.
- Generic study substrate is first-party, validated, and exposes only Policy Studies.
- Existing local study content is semantically converted into one canonical authority; old stores/routes/import shapes are removed.
- Archive v3 round-trips all canonical Lab and referenced exact evidence.
- Eligible single-model candidates may qualify without duplicate counting; policy outputs never inflate Models.
- Recovery, provenance, costs, responsive/accessibility, security, and full repository gates pass.
- `PRODUCT.md`, `DECISIONS.md`, UI authority, archive docs, source comments, and program references describe the new ownership.

## 19. Assumptions and unresolved implementation discoveries

**Locked:** Study identity—not Task Set identity—owns the route and experiment. Policy Study is the only registered type. Fusion remains a method term. Migration is a one-time semantic conversion with no runtime legacy route/store/archive support after commit. Archive v3 marks the intentional break.

**Must verify during implementation:** whether every existing `FusionStudy` has sufficient Suite→Task Set crosswalk data; whether current Run artifacts provide complete candidate provenance for child-04 eligibility; exact Dexie version/transaction mechanics for deleting source stores after destination verification; current route-link prevalence in persisted/user-authored content; and measured large-corpus migration/main-thread budgets.

If any existing record cannot be semantically converted without guessing or loss of paid study meaning, stop before writes and amend this specification. Do not fall back to deletion, a wrapper, or dual authority.