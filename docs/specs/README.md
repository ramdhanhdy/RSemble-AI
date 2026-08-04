# Specs

Specs are split by execution status. Cross-references keep the full paths, so
`grep docs/specs/` still finds everything.

## executed/

Specified, implemented, and verified. Each has commits landing the work; most
have QA evidence under `docs/qa/`.

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
| design-motion-refinement | motion refinements + QA captures | `docs/qa/design-motion-refinement/` (spec files themselves were never committed) |

## pending/

Written but not executed as a project.

| Spec | Status |
| --- | --- |
| ui-redesign-spec.md | **Stale (audit 2026-08-04)** — predates 140 commits; most items already shipped via other components; palette and icon-rail sections conflict with current DESIGN.md. See `ui-redesign-grounding-audit.md`. Genuinely unshipped remnants: gradient CTA, focus mode (⌘\), self-judge warning, compare diff highlighting. |
