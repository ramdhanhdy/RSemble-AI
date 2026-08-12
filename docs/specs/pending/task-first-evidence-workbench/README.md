# Task-First Evidence Workbench Program

**Status:** Pending
**Parent specification:** [`task-first-evidence-workbench-spec.md`](./task-first-evidence-workbench-spec.md)
**Production baseline:** `feat/runs-fairness-baseline` at `309130e`

## Purpose

This program evolves RSemble AI from a three-workspace comparison/evaluation tool into a task-first evidence workbench:

> Give models a task. Compare what they did. Preserve why the result is trustworthy. Repeat until the evidence supports an honest understanding of each model.

The parent specification is the governing contract. Each child is a vertical, independently verifiable product outcome with its own implementation plan. Child specifications may refine local implementation details but may not redefine canonical identity, contextual ownership, evidence counting, comparability, migration, archive progression, or claim-honesty rules.

## Authority

- The parent specification governs the **target state** and all cross-child decisions in this program.
- `PRODUCT.md`, `DECISIONS.md`, and shipped code govern the **current state** until a child completes its validation gate.
- A completed child must update current-state authority documents in the same workstream that archives that child.
- If implementation discovery contradicts a locked parent decision, stop and amend the parent before coding around it.

## Child specifications

| Order | Child | Outcome | Depends on | Status |
|---|---|---|---|---|
| 01 | [Rubric terminology and compatibility](../../archive/01-rubric-terminology/rubric-terminology-spec.md) | Scoring Profiles become Rubrics everywhere users and new domain code see them, while old data remains readable. | Parent | Archived |
| 02 | [Canonical tasks and immutable versions](./02-canonical-tasks/canonical-tasks-spec.md) | Tasks exist independently of comparisons and task sets, with explicit identity, immutable executable versions, instances, families, and facets. | 01 | Pending |
| 03 | [Task sets and owned evaluation results](./03-task-sets-and-evaluations/task-sets-and-evaluations-spec.md) | Task Sets reference canonical Task Versions and own ordinary Evaluation executions/results/recovery/roster-extension history—not Policy Studies. | 01, 02 | Pending |
| 04 | [Observations and evidence provenance](./04-observations-and-evidence/observations-and-evidence-spec.md) | Accepted attempts become idempotent, eligibility-scoped Observations without duplicating immutable source evidence or inflating counts. | 01, 02, 03 | Pending |
| 05 | [Contextual Compare results](./05-contextual-compare-results/contextual-compare-results-spec.md) | Compare owns a judged parent result, optional derived Fusion/Refined Results, task promotion/linking, evidence receipts, and recovery. | 02, 04 | Pending |
| 06 | [Research Lab and Policy Studies](./06-research-lab-policy-studies/research-lab-policy-studies-spec.md) | A generic first-party study substrate powers complete Policy Studies; Fusion is one tested method, reusable assets live in Lab, and playbooks hand off explicitly to Compare. | 01–05 | Pending |
| 07 | [Qualified model evidence profiles](./07-model-evidence-profiles/model-evidence-profiles-spec.md) | Models gain coverage-aware, protocol-qualified evidence profiles with uncertainty and exact supporting Observations—never a timeless universal score. | 04, 05, 06 | Pending |
| 08 | [Workbench shell and secondary Records](./08-workbench-shell-and-records/workbench-shell-and-records-spec.md) | Primary navigation becomes Compare · Evaluations · Lab · Models; Records remains a secondary typed audit ledger with `/runs/:runId` compatibility. | 03, 05, 06, 07 | Pending |
| 09 | [Bounded Attention and recovery handoffs](./09-attention-and-recovery/attention-and-recovery-spec.md) | A small derived Attention surface points to actionable recovery in the owning workspace and never becomes another execution engine. | 03, 05, 06, 08 | Pending |
| 10 | [Retrieval, archive, migration, and authority hardening](./10-retrieval-and-hardening/retrieval-and-hardening-spec.md) | Cross-entity search, archive compatibility, idempotent repair, performance/accessibility QA, and authority reconciliation complete the program. | 01–09 | Pending |

## Dependency graph

```text
Parent
├── 01 Rubrics ─┐
└── 02 Tasks ───┴──> 03 Task Sets / Evaluation Results
                         │
                         └──> 04 Observations / evidence
                                  │
                                  └──> 05 Contextual Compare
                                           │
                                           └──> 06 Research Lab / Policy Studies
                                                    │
                                                    └──> 07 Model evidence profiles
                                                             │
03 ──────────────────────────────────────────────────────────┴──> 08 Shell / Records
05 + 06 ─────────────────────────────────────────────────────────>
                                                                  │
03 + 05 + 06 + 08 ─────────────────────────────────────────────> 09 Attention
01–09 ─────────────────────────────────────────────────────────> 10 Hardening
```

Children 01 and 02 may be implemented concurrently only because the parent owns their shared identity and compatibility rules. All later children follow the dependency gates above.

## Intentional compatibility boundary

Children 02–05 extend archive v2 while current Fusion-shaped persistence still exists. Child 06 performs the user-approved one-time semantic conversion into generic Research Lab stores, removes old Fusion Study routes/runtime stores/import shapes, and introduces archive v3. Later children extend v3. This is a deliberate break from the old Fusion Study schema, not an accidental omission or permanent dual authority.

## Program completion

The program is complete only when:

- every child has met its automated and browser validation gates;
- every child directory has moved from `pending/` to `archive/` with cross-references updated;
- `PRODUCT.md`, `DECISIONS.md`, provider documentation, archive documentation, and source comments describe the shipped state rather than the old three-workspace/Fusion-Study contract;
- migrations and supported archive imports are idempotent against clean, legacy, partially migrated, and restored databases;
- no primary navigation or meaningful result surface uses **Runs** as the normal organizing concept;
- exact records, recovery, retries, roster extension, protocol identity, costs, failures, and `/runs/:runId` links remain intact;
- Research Lab owns Policy Studies, reusable Fusion Recipes/Model Pools, and Policy Playbooks while Task Sets remain pinned workloads;
- old local Fusion content is semantically converted once, but old Fusion routes/stores/archive shapes are absent after child 06;
- model evidence claims disclose model configuration, Task coverage, sample structure, protocol/Rubric/evaluator provenance, uncertainty, recency, and exact support.

No calendar-duration estimate is part of this program. Progress is measured by dependency and evidence gates.
