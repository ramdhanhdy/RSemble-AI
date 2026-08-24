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
| E | Evidence/security/authority/full gate | Review-finding closure (REV-1…REV-11): Compare shortcut isolation, obsolete Fusion authority removal, archive v3 ↔ post-v13 canonical-state proof, zero provider egress, adversarial probes, authority/document reconciliation, `npm run check` green |

## Run 22 review addendum (external architectural/code review, verified 2026-08-19)

An external architecture/code review of the Child 06 state at HEAD `fd34c073b1562dcbddfebd40ca16f65867ed7a0d` produced six findings. Each was independently verified against HEAD before Run 22 was packaged; none is treated as a separate cleanup effort — they are first-class acceptance criteria in T11–T13 with traceable IDs.

| Finding | Verified at HEAD | Run 22 target |
|---|---|---|
| `/lab`, `/tasks`, `/compare/results/*`, and unknown routes inherit Compare keyboard shortcuts because `src/rsemble.tsx` (~99–108) only classifies `/runs`, `/evaluations`, `/experiments` and defaults everything else to `"compare"`; `useActionShortcuts` then enables ⌘Enter/⌘//⌘1–9/⌘F/⌘C | Yes — exact code path confirmed | T12 REV-5; adversarial probe T13 REV-7 |
| Executable Fusion remnants reachable as product authority: live `/evaluations/sets/:taskSetId/fusion/:studyId` route mounting `FusionStudyView`/`FusionStudyPanel` (imports live executor), Dexie Fusion repository exports, `fusion-live-executor`/controller imports | Yes — v13 deletes the seven stores and nulls `fusionRepo` at runtime, but the UI/routes/exports remain | T12 REV-6 |
| Child 03 still marked Pending though shipped (program README table; parent §15 table marks 02–05 Pending) | Yes | T13 REV-11 |
| PR #13 title/body claim Children 01–02 only and "Child 03+ not started" while the branch contains 01–06 work | Yes (`gh pr view 13`) | T13 REV-11 |
| Topology statements contradict: parent §4.1/P03 say final nav is `Compare · Evaluations · Models`; Child 08 outcome + Child 06 spec §7 say `Compare · Evaluations · Lab · Models` | Yes — both wordings confirmed | T13 REV-11 |
| Child numbering/status references disagree with the actual roadmap (parent §15 numbers `06 Model Profiles / 07 Shell / 08 Attention / 09 Hardening`; README roadmap is `06 Lab / 07 Models / 08 Shell+Records / 09 Attention / 10 Hardening`) | Yes | T13 REV-11 |

Run 21's closing gate verdict `approve_with_conditions` carries eight follow-ups (F1–F8, evidence-boundary ledger, qualified-count dedup, migration reindex guard, Judge/Rubric pin enforcement, price-change revalidation, Tailwind token/ClaimBadge fixes, manifestDigest seal guard, T8 characterization-test assertion) — these become T13's first class steps, never dropped.

Dependency order is preserved: T11 requires T0–T10 complete (baseline `fd34c07`); T12 materializes only after the T11 gate is clear; T13 only after T11+T12 review clear.

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

**External review acceptance (REV-1…REV-4, verified at `fd34c07`):**

- **REV-1 — same canonical state.** Archive v3 and the post-v13 persistence model must demonstrably describe the same canonical state. The round trip must cover every canonical Child 06 entity class that is supposed to survive: Lab assets, Policy Studies, trials/attempts/observations/playbooks, and every referenced exact-evidence record required to reconstruct their meaning. Ship a tested reconciliation (schema/count/digest crosswalk or fixture-level identity proof), not just per-entity round trips.
- **REV-2 — deleted stores stay deleted.** The seven stores removed by the v13 cutover (`fusionRecipes`, `poolManifests`, `fusionStudies`, `fusionTrials`, `fusionAttempts`, `fusionObservations`, `fusionPlaybooks`) must not appear as canonical archive authority: no v3 manifest naming them, no payload keys, no store/route references.
- **REV-3 — deterministic rejection with receipt.** Per the authorized discard amendment, do NOT reintroduce convert-or-fail for the discarded development Fusion corpus. Legacy Fusion-shaped inputs must hit an explicit deterministic rejection/discard path that (a) fails before any write, (b) records a receipt describing what was rejected and why, and (c) never silently enters the new model.
- **REV-4 — no authority resurrection, no provider egress.** Import/export must not load the deprecated Fusion repository/authority (module-load guard test), and must cause zero provider/network execution. Add a probe that instruments the provider registry and asserts export + import complete with zero invocations.

## Task 12: Remove obsolete authority and compile-time seams

**Files:**
- `src/rsemble.tsx` + `src/ui/useActionShortcuts.ts` — explicit routing/ownership rule for Compare shortcuts (REV-5).
- `src/app-router.tsx` — remove the live `/evaluations/sets/:taskSetId/fusion/:studyId` branch and `FusionStudyRouteWrapper`; keep the already-retired `:suiteId/fusion/:studyId` static notice.
- Remove `src/workspaces/evaluations/FusionStudyView.tsx`, `FusionStudyPanel.tsx` and their tests — the Lab replaces them.
- Trim `src/lib/persistence/fusion-study-repository.ts` exports to the canonical-consumer allowlist (REV-6).
- Update `PRODUCT.md`, `DECISIONS.md`, UI/source comments, provider/archive docs, and spec indexes.
- Add forbidden-string/path/import tests or documentation validator for obsolete ownership/routes/store authority.

**RED:** Search/build assertions reject:

- `/evaluations/sets/:taskSetId/fusion/:studyId` runtime route (REV-6);
- `/evaluations/:suiteId/fusion/:studyId` runtime route;
- live product imports of `FusionStudyView`/`FusionStudyPanel` or the Dexie Fusion repository phenotype (REV-6);
- `Task Set owns Fusion Study` product copy;
- active old store/repository reads or writes;
- old Fusion-shaped archive export/import;
- visible future study placeholders;
- Rank/Fuse as peer root-mode framing;
- Compare keyboard shortcuts firing outside the owning routes (REV-5).

**GREEN:** Remove obsolete runtime authority while retaining method-specific `FusionRecipe`, Fuse action, and Fusion Result names, and the allowlisted methodology modules the Lab adapter and Compare rendering depend on.

**External review acceptance (REV-5, REV-6, verified at `fd34c07`):**

- **REV-5 — executable routing/ownership rule.** Do not merely add a `"lab"` arm to the classifier. Establish an explicit routing/ownership rule so Compare execution shortcuts (⌘Enter run/abort, ⌘/ mode toggle, ⌘1–9 slot toggles, ⌘F focus, ⌘C copy) are enabled only on routes that actually own live Compare execution (Compare home plus the live execution surface — not `/compare/results/*`, not `/lab`, not `/tasks`, not unknown routes). Add regression coverage proving non-Compare workspaces cannot invoke Compare actions via keyboard: ⌘Enter must not call `requestRun`/`abortRun`, ⌘/ must not toggle mode, slot toggles and clipboard copy must not fire.
- **REV-6 — executable Fusion remnant sweep.** After the v13 migration the only Fusion modules reachable from product code must be the allowlisted ones intentionally required: `fusion-study-orchestration` + `fusion-confirmation` (consumed by `policy-study-adapter`), `fusion-live-executor` (consumed by `PolicyStudyPage`), `fusion-recipes` renderers/consts (consumed by `pipeline.ts`/`run-controller.ts`), the `InMemoryFusionStudyRepository` used by the Lab adapter, and hard type/shape references. The Fusion Study UI routes, components, and the Dexie Fusion repository must not remain reachable as competing live product authority. Migration fixtures, historical receipts, and compatibility tests may keep references; they must not be importable from product code. Pin this with forbidden-import/route tests.

Commit: `refactor(lab): remove superseded fusion study authority`.

## Task 13: Responsive, accessibility, migration, security, and full gate

**Files:**
- Create `scripts/qa-research-lab.mjs` and `npm run qa:research-lab`.
- Create `docs/qa/research-lab/` evidence only if repository QA convention requires committed evidence.
- Add migration/security/performance corpus tests.
- `src/workspaces/lab/*`, `src/lib/studies/*`, `src/lib/migrations/*` only as required by the carried follow-ups F1–F8 below.
- Authority documentation targets under REV-11.

**Carried from Run 21 closing gate (`approve_with_conditions`, F1–F8 — first-class steps, in order):**

1. **F1:** Restore the two-sided evidence-boundary ledger per Fable §6.10 (`.boundary-rule`, the exact "Never attributed — wholly, fractionally, or collectively — to any participating model" copy, `N qualified` as the specified link).
2. **F2:** `N qualified` must be the honest unique count — dedup trial artifact refs by runId, exclude synthesis/Fusion/Refine refs.
3. **F3:** Migration reindex must not let synthesis refs (legacy fusionAttemptId) be treated as single-model candidates (`fusion-to-research-lab.ts` ~731).
4. **F4:** Enforce Judge/Rubric pins from `study.definition` in the playbook compatibility gate and `runWithPlaybook`; the run record remains the truthful record of the judge actually used.
5. **F5:** Revalidate confirmed preflights at run start (plan T10 RED price-change scenario); the check must exist and be tested even with the static pricing table.
6. **F6:** Replace undefined Tailwind tokens in `RunWithPlaybookDialog` with real design-system tokens and reuse `ClaimBadge` (Fable §4.1/§6.9).
7. **F7:** Task Set deep-link prefill must resolve a real manifestDigest at draft creation or reject `PLACEHOLDER_DIGEST` in seal validation.
8. **F8:** Update T8 characterization tests to assert `RetiredFusionRoute` semantics instead of comment-level legacy strings.

**Adversarial gate (REV-7…REV-10, verified at `fd34c07`):**

- **REV-7 — shortcut isolation proven.** CDP/unit probes: on `/lab`, `/tasks`, `/compare/results/:id`, and an unknown route, no Compare pipeline action (request run, abort, mode toggle, slot toggle) can be triggered via keyboard; on `/compare` the shortcuts work.
- **REV-8 — no usable obsolete Fusion authority.** Post-migration: v13 leaves the intended receipt/state; retired Fusion routes cannot reach deleted persistence; no route or import path lets product code re-open the deleted Fusion stores.
- **REV-9 — zero provider egress.** Archive v3 export/import and migration operations cause zero provider egress (probe asserts zero provider invocations; also covers REV-4).
- **REV-10 — archive round-trip corpus.** Archive v3 round-trips a realistically populated Lab corpus (assets, studies, trials/attempts/observations, playbooks, referenced exact evidence) with identity/byte stability.

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

**Authority/document reconciliation (REV-11, verified at `fd34c07`):**

- **Child 03 status:** program README marks 03 Pending though it shipped (PRODUCT.md "Last reconciled" section confirms Task Sets shipped); mark 03 Shipped (dated), 06 in progress; refresh parent §15 status table (01 Shipped, 02 Archived, 03–05 Shipped, 06 in progress).
- **Numbering:** parent §15 numbers children `06 Model Profiles / 07 Shell / 08 Attention / 09 Hardening`; the README roadmap (the actual program order) numbers them `06 Lab / 07 Model evidence profiles / 08 Shell+Records / 09 Attention / 10 Hardening`. Reconcile parent §15 and every sibling reference to the README roadmap.
- **Topology — distinguish current vs. target, do not pull Child 08 into Child 06:** after Child 06 the current product topology is Compare · Evaluations · Runs in primary navigation, with Lab at direct routes plus Task Set backlinks (no inert destination). The authorized target after Child 08 is Compare · Evaluations · Lab · Models with Records secondary and `/runs/:runId` compatibility. Parent §2.3, §4.1, P03, the README child 08 row, Child 06 spec §7, and `PRODUCT.md` must all state this consistently (PRODUCT.md gains a "Reconciled (Child 06 …)" note describing current state and naming the deferred target).
- **PR #13:** title/body still claim Children 01–02 only and "Child 03+ not started". Update title/body to the branch's actual contents (Children 01–06 through Milestone E) via `gh pr edit 13`; if `gh` is not authenticated in the execution environment, write the exact proposed title/body to `.omp/rlm/state/runs/run22-pr13-title-body.md` for manual application — never claim the edit landed without command output proving it. Do not change the base branch.
- **Spec index:** `docs/specs/README.md` still says "Children 03–10 remain pending" — update to the shipped/pending reality.

**Commands:**

```bash
npm run typecheck:web
npm run qa:research-lab
npm run check
npm run format:check
git diff --check
git status --short --branch
```

**Clean-checkout gate:** besides the ordinary full matrix, a fresh clone at the milestone HEAD must pass the complete project gate (`npm ci && npm run check`) — declared green only with real command output.

Commit: `test(lab): verify research lab end to end`.

## Done definition

- Generic internal study substrate and complete Policy Study are functional; no future study shells are visible.
- Lab owns studies/assets/playbooks; Task Sets are pinned workloads and backlinks only.
- Compare preserves judged parent results and derived Fusion/Refined children; playbook use is explicit and cost-preflighted; Judge/Rubric pins are enforced (F4); confirmed preflights are revalidated (F5); `N qualified` counts unique runs only (F2).
- Old Fusion stores are removed with no dual authority; Fusion Study UI routes/components/repository phenotype are unreachable from product code; only the allowlisted methodology modules remain (REV-6). Unconvertible development Fusion content is discarded with a receipt; legacy Fusion-shaped inputs reject deterministically with a receipt (REV-3).
- Archive v3 is canonical and complete; unsupported old Fusion archives fail atomically and clearly; v3 and the post-v13 persistence model provably describe the same canonical state (REV-1/REV-2/REV-10).
- Compare execution shortcuts fire only on routes owning live Compare execution; non-Compare workspaces are proven unable to invoke Compare actions via keyboard (REV-5/REV-7).
- Archive and migration operations cause zero provider egress (REV-4/REV-9).
- Run 21 closing-gate follow-ups F1–F8 are closed with regression proof.
- Authority documents, spec statuses, numbering, and PR #13 metadata agree with the actual roadmap and distinguish current vs. target topology (REV-11).
- Eligible underlying single-model candidate responses can qualify exactly once; policy outputs never inflate Model Evidence Profiles.
- Current staged research rigor, retries, recovery, provenance, costs, claim levels, responsive/accessibility, security, and full repository gates pass, including a clean-checkout full gate.
- No production deployment, push, or unrelated worktree change occurs without separate approval.