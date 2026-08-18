# Research Lab and Policy Studies Implementation Plan

> **For Hermes:** Implement task-by-task with strict RED → GREEN → REFACTOR. Load `rsemble-ai-development`, `test-driven-development`, `subagent-driven-development`, and `browser-guided-artifact-workflow` before execution.

**Goal:** Replace Task-Set-scoped Fusion Studies with a first-class Research Lab, generic first-party study substrate, complete Policy Studies, reusable Fusion Recipes/Model Pools, explicit playbook-driven Compare execution, and one canonical generic persistence model.

**Architecture:** Preserve the current staged research methodology while moving ownership into registered generic study envelopes. Convert all existing local Fusion content transactionally into generic Lab stores, remove old active stores/routes/import shapes, and introduce archive v3. Extend child-04 Observation eligibility only for qualifying underlying single-model candidates; keep all policy outputs Lab-owned.

**Tech stack:** TypeScript, React, React Router, Dexie/IndexedDB, Vitest/property tests, happy-dom, existing execution owner/leases/unit-of-work, CDP browser QA.

**Specification:** [`research-lab-policy-studies-spec.md`](./research-lab-policy-studies-spec.md)
**Reviewed positioning artifact:** [`../../../explorations/future-task-first-ui/rsemble-research-lab-positioning.html`](../../../explorations/future-task-first-ui/rsemble-research-lab-positioning.html)
**Execution authorization:** Explicit approval required; local commits only; no push.

---

## Milestone map

| Milestone | Result | Gate |
|---|---|---|
| A | Generic study/asset contracts | Domain and repository contract suites green |
| B | Hard migration + archive v3 | Full semantic corpus converts or fails before writes |
| C | Complete Policy Study execution | Current staged methodology/recovery tests green behind generic adapter |
| D | Lab UI + playbook Compare handoff | Route/component/browser matrix green |
| E | Evidence/security/authority/full gate | Non-inflation, archive, accessibility, and `npm run check` green |

## Task 0: Dependency, drift, and destructive-migration gate

**Files:**
- Read parent plus children 01–05 completion evidence.
- Read `src/lib/evaluations/fusion-study-types.ts` and every `fusion-*` module/test.
- Read `src/lib/persistence/fusion-study-repository.ts`, `database.ts`, `archive.ts`, repository/archive tests.
- Read `src/app-router.tsx`, `src/workspaces/evaluations/FusionStudyPanel.tsx`, `FusionStudyView.tsx`, `SuiteEditor.tsx` and tests.
- Read child-04 Observation repository/rules and child-05 Compare Result/derived-result implementation.

**Steps:**

1. Verify children 01–05 are complete/archived and their schema/route hashes match referenced authority.
2. Capture `git status --short --branch`, baseline commit, Dexie schema version, archive versions, and every active route/store/type.
3. Build a source inventory for all seven current Fusion stores, repository methods, controller methods, route branches, and UI actions.
4. Build a comprehensive migration fixture containing exploration/confirmation, every policy/recipe family/stage, in-progress/completed, retries, failures, costs, artifacts, pool adequacy, recipe sensitivity, `do_not_fuse`, and unresolved references.
5. **STOP** if Suite→Task Set crosswalks cannot map every study exactly; source artifacts cannot reconstruct required provenance; current concurrent work overlaps in-scope files; or the baseline cannot pass characterization tests.

Commit: `test(lab): characterize fusion corpus before migration`.

## Task 1: Define common study envelopes and first-party registry

**Files:**
- Create `src/lib/studies/study-types.ts` + tests.
- Create `src/lib/studies/study-registry.ts` + tests.
- Create `src/lib/studies/study-fingerprint.ts` + property tests.
- Create `src/lib/studies/policy/policy-study-types.ts` + tests.

**RED:**

- `StudyRecord`, typed definition, Trial, Attempt, Observation, artifact, report envelopes;
- exactly one registered kind (`policy`);
- unknown kind/schema/version, malformed discriminant, arbitrary JSON, and recursive prohibited fields rejected;
- canonical serialization/fingerprint stable under key/order permutations and changed by every material field;
- draft CAS, start sealing, completed immutability, archive rules, delete-only-untouched-draft;
- treatment-changing Trial/Attempt versus measurement-only Observation behavior;
- exploration/confirmation linkage and no claim promotion by mutation.

**GREEN:** Implement pure validators/serializers/registry only. No persistence/provider/UI.

**REFACTOR:** Keep common envelopes minimal; do not encode future Routing/Judge/Workflow payloads or enum placeholders.

Commit: `feat(lab): define registered study substrate`.

## Task 2: Define reusable Lab Recipe and Model Pool assets

**Files:**
- Create `src/lib/studies/lab-recipe-types.ts` + tests.
- Create `src/lib/studies/model-pool-types.ts` + tests.
- Create `src/lib/persistence/lab-asset-repository.ts` + contract/in-memory/Dexie parity tests.
- Modify `src/lib/persistence/database.ts` in the next schema version.

**RED:**

- stable record plus immutable version for each asset;
- Lab Recipe `kind: "fusion"` preserves recipe family/prompt/Judge analysis/Rubric access/verification/exact synthesizer;
- Model Pool preserves exact configurations/core/challenger roles/diversity/rationale/supersession;
- version collision allows byte-equivalent idempotency only;
- editing appends version, referenced version immutable, record archive does not break refs;
- no Model Pool aggregation or synthetic respondent semantics;
- contract parity and prohibited-field rejection.

**GREEN:** Add `labRecipeRecords`, `labRecipeVersions`, `modelPoolRecords`, and `modelPoolVersions` repositories/stores. Do not switch old Fusion readers yet.

Commit: `feat(lab): persist versioned recipes and model pools`.

## Task 3: Implement generic Study repository and lifecycle

**Files:**
- Create `src/lib/persistence/study-repository.ts` + contract tests.
- Create `src/lib/persistence/in-memory-study-repository.ts` only if repository conventions require a separate file; otherwise export it from `study-repository.ts`.
- Modify `src/lib/persistence/database.ts`.
- Create `src/lib/studies/study-unit-of-work.ts` + tests if existing unit-of-work cannot cover cross-store CAS.

**RED:**

- create/update draft/start/seal/fail/archive/list/get;
- Trial create/seal, treatment-changing Attempt linkage, terminal Observation append;
- Policy Playbook create/get immutable;
- CAS conflict, duplicate event, multi-tab owner, interrupted transition, missing refs, partial child append;
- repository cannot invoke providers;
- archive-only after any paid execution; no ordinary delete API for started evidence.

**GREEN:** Add `studies`, `studyTrials`, `studyAttempts`, `studyObservations`, and `policyPlaybooks` stores with common typed envelopes and registered payload validation.

Commit: `feat(lab): persist generic study lifecycle`.

## Task 4: Build hard-migration preview and semantic receipt

**Files:**
- Create `src/lib/migrations/fusion-to-research-lab.ts` + fixture/property tests.
- Create `src/lib/migrations/fusion-to-research-lab-receipt.ts` + tests.
- Modify `src/lib/persistence/database.ts` only after RED fixtures exist.
- Reuse/extend exact Suite→Task Set resolution from child 03.

**RED:**

- classifies every Fusion record as lossless-convert or discard with a stable reason code;
- an all-discard preview is valid: converted destination graph may be empty;
- receipt is deterministic: source counts, converted counts (may be 0), discarded counts, per-id reason codes; never invents Lab fields;
- no destination write or source deletion on preview;
- repeated preview identical and side-effect free;
- crash/cancel during preview leaves Fusion stores untouched.

**GREEN:** Emit the preview/receipt in memory. Do not delete source stores yet. Do not loosen Lab validators to make Fusion fit.

Commit: `feat(lab): preview fusion hard migration`.

## Task 5: Commit one-authority migration and remove old stores

**Files:**
- Modify `src/lib/persistence/database.ts` Dexie upgrade.
- Modify migration module/tests from Task 4.
- Modify persistence startup/migration orchestration and tests.
- Remove runtime dependence on old Fusion repository after destination adapters are ready.

**RED:**

- exclusive ownership; clean, populated, partial, interrupted-before-commit, interrupted-after-commit, repeat startup;
- destination re-read verification before marker;
- source stores unavailable after committed upgrade;
- no dual writes/read fallback;
- failed transaction leaves source schema/content usable;
- marker without full destination graph rejected and repaired by deterministic retry/diagnostic.

**GREEN:** Transactionally persist the receipt (including all-discard), keep Lab v12 stores as the only live study/asset authority, delete the seven Fusion stores in the same Dexie v13 commit. Runtime startup uses only Lab stores. An empty migrated study graph is success.

**STOP:** If Dexie cannot prove the required atomic transition across upgrade boundaries, amend the specification before using a destructive multi-step fallback.

Commit: `feat(lab): replace fusion stores with canonical study stores`.

## Task 6: Adapt staged policy execution behind the registry

**Files:**
- Move/adapt `src/lib/evaluations/fusion-study-*` into `src/lib/studies/policy/` with history-preserving filesystem moves where tracked.
- Move/adapt `src/lib/evaluations/fusion-recipes.ts`, `fusion-confirmation.ts`, `fusion-live-executor.ts`, `fusion-playbook.ts` and tests.
- Create `src/lib/studies/policy/policy-study-adapter.ts` + tests.
- Modify controller/orchestration repository dependencies to generic Study/asset contracts.

**RED:**

- all current recipe-family, stage A/B/C, pair-screening, MPID, holdout, pool-adequacy, recipe-sensitivity, confirmation, cost, retry/recovery, blindness, and playbook characterization tests run against generic entities;
- `best_fixed`, `rank`, `fuse`, and `refine` all remain treatments;
- `do_not_fuse` remains valid;
- unknown registered payload/version blocked before provider call;
- provider failure, interruption, lease recovery, measurement retry, treatment-changing regeneration preserve lineage.

**GREEN:** Implement one `policy` registration/adapter and reuse proven pure/current methodology. Remove Fusion Study ownership language from comments/types without weakening method-specific Fusion Recipe/Result vocabulary.

Commit: `refactor(lab): run policy studies through generic substrate`.

## Task 7: Extend canonical Observation eligibility for study candidates

**Files:**
- Modify child-04 Observation source inventory/derivation/rules and tests.
- Create `src/lib/evidence/policy-study-candidate-adapter.ts` + tests if a separate adapter seam exists.
- Modify source-to-Observation reindex wiring.

**RED:**

- complete exact single-model candidate qualifies under ordinary Task/protocol/configuration/assessment rules;
- same candidate Run/attempt referenced by multiple trials/studies yields one immutable source Observation identity;
- incomplete/ambiguous/unresolved/protocol-incomparable candidates are ineligible with explicit reasons;
- StudyObservation, rank selection, Fusion Result, Refined Result, playbook row, policy score, and report never become Model Evidence Profile inputs;
- no attempt/trial/study-weighted inflation.

**GREEN:** Derive/reuse Observations from underlying candidate evidence only. Keep policy measurements Lab-owned.

Commit: `feat(evidence): qualify lab candidate observations without inflation`.

## Task 8: Build functional Lab routes and home

**Files:**
- Create `src/workspaces/lab/LabWorkspace.tsx` + tests.
- Create `PolicyStudyList.tsx`, `LabRecipeList.tsx`, `ModelPoolList.tsx` + tests.
- Create asset create/version/archive forms and tests.
- Modify `src/app-router.tsx` for `/lab` and asset routes.
- Modify command palette/search registration only for functional routes.

**RED:**

- first use, empty, active/findings/confirmed summaries, filters, large list, archive/error;
- Studies default; Recipes/Pools secondary and fully functional;
- no Routing/Judge/Workflow routes/cards/buttons/labels;
- create Policy Study from Lab and contextual Task Set action with exact version prefilled;
- direct load/refresh/back-forward, unknown/archived IDs, safe text rendering;
- current `/evaluations/:suiteId/fusion/:studyId` does not redirect or resolve.

**GREEN:** Implement the reviewed hierarchy. Do not add primary Lab navigation yet; child 08 switches final primary navigation after all destinations work.

Commit: `feat(lab): add research lab and reusable assets`.

## Task 9: Build Policy Study detail, execution, and recovery UI

**Files:**
- Move/replace `src/workspaces/evaluations/FusionStudyPanel.tsx` and `FusionStudyView.tsx` with `src/workspaces/lab/PolicyStudyEditor.tsx`, `PolicyStudyView.tsx`, and tests.
- Add pinned-input/protocol, stage progress, pair table, policy results, costs, claim/report, recovery, and exact Record components/tests.
- Modify Task Set detail/editor contextual links and tests.

**RED:**

- draft/start/preflight; in-progress/interrupted/failed/recoverable/completed/confirmed/archived;
- exact Task Set/Pool/Recipe/Judge/Rubric/protocol pins;
- full screened table including losers, controlled wide-table scrolling at 390/200%;
- policy vs experimental cost; uncertainty/MPID; pool adequacy; recipe sensitivity; claim level;
- report/playbook evidence links and no model-attribution copy;
- create confirmation with fresh pinned workload and no reselection;
- no mutation of sealed inputs/treatments.

**GREEN:** Implement complete first-class Policy Study experience under `/lab/studies/:studyId`.

Commit: `feat(lab): operate policy studies in research lab`.

## Task 10: Implement explicit Run with playbook handoff

**Files:**
- Modify child-05 Compare workspace/result/index/controller/types/tests.
- Add `src/lib/studies/policy/playbook-compatibility.ts` + tests.
- Add playbook picker/preflight components/tests.
- Modify provider-pricing/cost-estimation integration only through existing safe APIs.

**RED:**

- explicit playbook version selection; no latest/follow semantics;
- exact Task compatibility or explicit compatible Task Set context decision;
- pinned candidate configs/Judge/Rubric/recipe/policy/protocol;
- live current-price call/cost estimate and mandatory confirmation;
- parent Comparison Result always persists first;
- recommended derived action runs only after successful judging;
- `best_fixed`/`do_not_fuse` creates no Fusion Result;
- cancellation, price change, incompatible task, missing model/credential, Judge failure, Fusion failure, retry/re-fuse;
- playbook ref/compatibility receipt in parent and derived result;
- ordinary Compare remains playbook-free afterward.

**GREEN:** Add explicit Run with playbook and accessible preflight dialog. Never silently attach playbooks.

Commit: `feat(compare): run explicit policy playbooks`.

## Task 11: Introduce archive v3 and reject old Fusion shapes

**Files:**
- Create/extend `src/lib/persistence/archive-v3-types.ts`, validators, exporter/importer, and tests.
- Modify `src/lib/persistence/archive.ts` dispatch/preview/UI copy.
- Modify `src/ui/DataArchiveActions.tsx` and tests.
- Update `scripts/validate-archive-fixture.ts` or add repository-consistent v3 validator coverage.

**RED:**

- full children 01–06 canonical corpus including generic Lab graph and referenced exact evidence;
- deterministic manifests/counts/digests, prohibited-content scan, cancel/progress, collision abort;
- v1/v2 without old Fusion collections remains importable;
- any v2 old Fusion collection rejects as `unsupported_fusion_archive_shape` before writes;
- no partial import of otherwise-valid non-Fusion entities when rejected;
- v3 never emits old store names/payloads/routes.

**GREEN:** Introduce archive v3, make it the only new export format, and preserve honest dispatch for supported older non-Fusion archives.

Commit: `feat(archive): replace fusion payloads with lab archive v3`.

## Task 12: Remove obsolete authority and compile-time seams

**Files:**
- Remove old Fusion Study route branch/imports/components/repository exports/types after all canonical consumers migrate.
- Update `PRODUCT.md`, `DECISIONS.md`, UI/source comments, provider/archive docs, and spec indexes.
- Add forbidden-string/path tests or documentation validator for obsolete ownership/routes/store authority.

**RED:** Search/build assertions reject:

- `/evaluations/:suiteId/fusion/:studyId` runtime route;
- `Task Set owns Fusion Study` product copy;
- active old store/repository reads or writes;
- old Fusion-shaped archive export/import;
- visible future study placeholders;
- Rank/Fuse as peer root-mode framing.

**GREEN:** Remove obsolete runtime authority while retaining method-specific `FusionRecipe`, Fuse action, and Fusion Result names.

Commit: `refactor(lab): remove superseded fusion study authority`.

## Task 13: Responsive, accessibility, migration, security, and full gate

**Files:**
- Create `scripts/qa-research-lab.mjs` and `npm run qa:research-lab`.
- Create `docs/qa/research-lab/` evidence only if repository QA convention requires committed evidence.
- Add migration/security/performance corpus tests.

**Browser matrix:**

- `/lab`, every functional secondary section, study detail, asset detail, Task Set handoff, Compare playbook preflight/result;
- 1440, 1024, 768, 390 CSS px; 200% zoom; keyboard; reduced motion;
- empty/draft/running/interrupted/failed/completed/confirmed/archived/migration-blocked;
- large study/pair table and long labels/errors;
- focus trap/inert/Escape/restore, 44×44 targets, semantics, no color-only status;
- direct load/refresh/back-forward/exact Record round trip;
- no document/element accidental overflow, console errors, inert controls, old routes, or secret patterns.

**Performance/security:**

- measure migration preview/commit, Lab list, large study detail, archive v3 export/import, and main-thread long tasks against fixture budgets declared before optimization;
- recursively scan every study/asset/report/error/config/archive field for prohibited secrets;
- fuzz unknown kind/schema, malicious text, broken refs, oversized arrays, and cancellation boundaries.

**Commands:**

```bash
npm run typecheck:web
npm run qa:research-lab
npm run check
npm run format:check
git diff --check
git status --short --branch
```

Commit: `test(lab): verify research lab end to end`.

## Done definition

- Generic internal study substrate and complete Policy Study are functional; no future study shells are visible.
- Lab owns studies/assets/playbooks; Task Sets are pinned workloads and backlinks only.
- Compare preserves judged parent results and derived Fusion/Refined children; playbook use is explicit and cost-preflighted.
- Old Fusion stores are removed with no dual authority. Unconvertible development Fusion content is discarded with a receipt; Lab types stay strict.
- Archive v3 is canonical and complete; unsupported old Fusion archives fail atomically and clearly.
- Eligible underlying single-model candidate responses can qualify exactly once; policy outputs never inflate Model Evidence Profiles.
- Current staged research rigor, retries, recovery, provenance, costs, claim levels, responsive/accessibility, security, and full repository gates pass.
- Authority documents and source comments describe the Research Lab target state.
- No production deployment, push, or unrelated worktree change occurs without separate approval.