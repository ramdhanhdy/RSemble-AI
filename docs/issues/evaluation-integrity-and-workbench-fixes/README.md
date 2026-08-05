# Evaluation integrity and workbench fixes

Status: **specified, not implemented**  
Reported: 2026-08-05  
Planned against: commit `fdf078b` plus the current dirty working tree

This folder analyzes and specifies seven related issues reported while repairing
missing evaluation results. The first two log lines in the report establish an
important fact: execution is correctly sending a request to
`deepseek:deepseek-v4-flash`, while the progress banner incorrectly claims that
`umans:umans-glm-5.2` is the active model. The execution path and display path
therefore disagree; this is not a provider-routing failure.

## Documents

- `analysis.md` — verified causes, impact, evidence, and rejected explanations.
- `specs/01-active-operation-scope.md` — make progress copy derive from the active task plan.
- `specs/02-remove-attempt-ordinals.md` — remove experiment-facing Attempt 1/2/3 concepts while preserving internal evidence.
- `specs/03-probe-cancellation.md` — prevent lifecycle-cancelled catalog probes from surfacing as health errors.
- `specs/04-compare-finish-control.md` — move Rank/Fuse into the Compare workspace and stabilize global navigation.
- `specs/05-run-completion-time.md` — show explicit start and completion timestamps.
- `specs/06-cost-accounting.md` — replace static slug guesses with provider-aware pricing and persisted usage provenance.
- `specs/07-reasoning-effort.md` — configure, validate, fingerprint, and persist reasoning effort.
- `implementation-plan.md` — phased handoff plan, dependencies, tests, and STOP conditions.

## Priority order

| ID | Finding | Priority | Effort | Confidence |
|---|---|---:|---:|---:|
| 01 | Progress banner reads latest extension history instead of the active plan | P0 | S | High |
| 03 | Lifecycle-cancelled provider probes can still paint an error banner | P0 | S | High |
| 07 | Reasoning effort is absent from requests, snapshots, and run provenance | P1 | L | High |
| 06 | Pricing is mostly unavailable and actual Judge/Fusion usage is not recorded | P1 | L | High |
| 02 | Numbered experiment attempts imply unsupported trial semantics | P2 | S–M | High |
| 04 | Compare-only Rank/Fuse changes the global header geometry | P2 | M | High |
| 05 | Run detail does not explicitly show completion time | P2 | S | High |

## Scope and safety

These documents do not authorize deleting persisted attempt records. Attempts
remain load-bearing for immutable evidence, retries, selected-run semantics,
lease recovery, and archive compatibility. Spec 02 removes the numbered concept
from experiment-facing UI only.

The repository already contains uncommitted roster-extension and diagnostics
work in several in-scope files. An executor must preserve it, compare live code
against the excerpts in `analysis.md`, and must not reset or overwrite the dirty
working tree.

