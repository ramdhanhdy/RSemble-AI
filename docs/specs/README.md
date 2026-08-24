# Specs

Specs are split by status: `archive/` for work that shipped, `pending/` for
written contracts waiting on an authorized cycle, `open/` for design that is
still being argued and **must not be implemented**. Cross-references keep the
full paths, so `grep docs/specs/` still finds everything.

## archive/

Completed: specified, implemented, and verified. Kept for traceability — do not
re-execute. Each has commits landing the work; most have QA evidence under
`docs/qa/`.

| Spec | What shipped | Verification |
| --- | --- | --- |
| attachments | attachment pipeline phases 7.0–7.8 | plan 50/50 checked |
| evaluation-workspaces | Compare / Runs / Evaluations shell | workspace live |
| fusion-study | G1–G6 fusion study domain, recipes, stages, UI, authority docs | commits G1–G6 + anti-circularity fix |
| judge-explainability | blind judging + score rationale pipeline | `src/lib/judge-explainability.integration.test.ts` |
| run-recovery-model-selection | judge-only retry, experiment recovery, startup sweep | recovery dialog + sweep commits |
| suite-execution-reliability | preflight, 9Router compat, recovery, ranking, ledger | `docs/qa/suite-execution-reliability/` |
| 9router-support | 9Router provider adapter + SSE termination | provider registered |
| evaluations-identity-ux | workload/rubric identity grammar, honest tokens, stable geometry | `docs/qa/evaluations-identity-ux/` |
| design-motion-refinement | motion refinements + QA captures | `docs/qa/design-motion-refinement/` |
| 02-canonical-tasks | Canonical Tasks with immutable versions, instances, families, facets, conservative legacy migration, and archive v2 base | `docs/qa/canonical-tasks/` |
| task-first-evidence-workbench | Governing parent plus ten child specs (01 Rubrics → 10 Hardening). All children shipped/archived: 01–02 archived; 03 Task Sets (2026-08-16); 04 Observations; 05 Contextual Compare; 06 Research Lab; 07 Model evidence profiles; 08 Shell/Records (2026-08-23 at `709b78d`); 09 Attention; 10 Retrieval/hardening (2026-08-24). | `docs/qa/task-first-evidence-workbench/` (performance + workbench receipts), `docs/qa/model-evidence-profiles/`, `docs/qa/records-workbench/`, `docs/qa/research-lab/`, `docs/qa/compare-results/`, `docs/qa/evidence-matrix/` |

## pending/

Written contracts waiting on an authorized implementation cycle. If the spec
is stale, read its grounding audit first. Unsettled design does **not** belong
here — use `open/`.

| Spec | Status |
| --- | --- |
| ui-redesign-spec.md | **Stale (audit 2026-08-04)** — predates 140 commits; most items already shipped via other components; palette and icon-rail sections conflict with current DESIGN.md. See `ui-redesign-grounding-audit.md`. Genuinely unshipped remnants: gradient CTA, focus mode (⌘\\), self-judge warning, compare diff highlighting. |
| two-axis-navigation/ | **Pointer only.** The work is not pending execution. See `docs/specs/open/two-axis-navigation/`. |

## open/

Still being argued. **Not implemented. Not authorized. Do not build from these files.**

| Spec | Status |
| --- | --- |
| [two-axis-navigation/](./open/two-axis-navigation/) | Navigation chrome in iteration. Live app is still Compare · Evaluations · Lab · Models. Index: `open/two-axis-navigation/README.md`. |
