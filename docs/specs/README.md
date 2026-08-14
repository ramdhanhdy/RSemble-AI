# Specs

Specs are split by status: `archive/` for work that shipped, `pending/` for
everything else. Cross-references keep the full paths, so `grep docs/specs/`
still finds everything.

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
| 01-rubric-terminology | Scoring Profiles renamed to Rubrics; legacy stores/routes remain readable | `docs/qa/rubric-terminology/` |
| 02-canonical-tasks | Canonical Tasks with immutable versions, instances, families, facets, conservative legacy migration, and archive v2 base | `docs/qa/canonical-tasks/` |

## pending/

Written but not executed as a project. New work should start here — or, if the
spec is stale, read its grounding audit first.

| Spec | Status |
| --- | --- |
| [task-first-evidence-workbench/](./pending/task-first-evidence-workbench/) | **Pending.** Governing parent plus remaining child specs. Children 01 (Rubric terminology) and 02 (Canonical Tasks) are archived; Children 03–10 remain pending. |
| ui-redesign-spec.md | **Stale (audit 2026-08-04)** — predates 140 commits; most items already shipped via other components; palette and icon-rail sections conflict with current DESIGN.md. See `ui-redesign-grounding-audit.md`. Genuinely unshipped remnants: gradient CTA, focus mode (⌘\), self-judge warning, compare diff highlighting. |
