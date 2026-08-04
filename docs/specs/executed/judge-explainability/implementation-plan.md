# Judge Explainability and Blind Evaluation Implementation Plan

> Implement against `judge-explainability-spec.md`. Use TDD, preserve concurrent work, and commit each completed phase separately. Do not push unless explicitly requested.

## Goal

Make RSemble judging genuinely blind to model/provider metadata, retain structured score explanations, resolve blind labels after judging, compare similarly positioned answers, and export the complete audit trail without changing the core fanout → Judge → Rank/Fuse pipeline.

## Guardrails

- Read `CLAUDE.md`, `PRODUCT.md`, `UI.md`, `DECISIONS.md`, and the feature spec first.
- Check `git status` before every phase. Do not revert unrelated changes, including generated TypeScript build metadata created by other work.
- Use the existing provider-neutral pipeline and current strict failure path.
- Never request or display hidden chain-of-thought; request concise evaluation evidence only.
- Do not add an Analysis tab or historical dashboard.
- Do not alter fusion semantics.
- Keep judge custom instructions before the final JSON-only contract.

## Phase 0 — Establish the baseline and update authority docs

### Files

- Modify: `PRODUCT.md`
- Modify: `UI.md`
- Modify: `DECISIONS.md`

### Steps

1. Run the existing targeted judge, reducer, Rank UI, export, and run-controller tests.
2. Record the baseline test count and any pre-existing failures.
3. Update authority documents with true blind judging, post-judgment mapping, concise score explanations, and the compact Rank layout.
4. Keep the scope fence: no new top-level mode or analysis tab.
5. Run `git diff --check` and commit the documentation update.

### Exit criteria

- Documentation no longer claims a rationale is shown when the implementation discards it.
- Product and UI authority agree with the feature spec.

## Phase 1 — Add blind packet and report domain types

### Files

- Modify: `src/studio-data.ts`
- Modify: `src/lib/pipeline.ts`
- Modify: `src/lib/pipeline.test.ts`

### Suggested types

```ts
interface BlindCandidate {
  label: string;
  candidateId: string;
  content: string;
}

interface JudgeDeduction {
  severity: "minor" | "major";
  reason: string;
}

interface JudgeCriterionScore {
  criterionId: string;
  label: string;
  score: number;
  rationale: string;
}

interface CandidateEvaluation {
  candidateId: string;
  blindLabel: string;
  overallScore: number;
  position: string;
  rationale: string;
  strengths: string[];
  deductions: JudgeDeduction[];
  missedRequirements: string[];
  criterionScores: JudgeCriterionScore[];
}

interface JudgeComparison {
  candidateIds: [string, string];
  blindLabels: [string, string];
  reason: string;
}

interface JudgeReport {
  labelMap: Array<{ label: string; candidateId: string }>;
  evaluationsById: Record<string, CandidateEvaluation>;
  comparisons: JudgeComparison[];
}
```

### Steps

1. Write failing tests for `createBlindCandidateSet` or equivalent:
   - excludes model/provider/slug metadata;
   - assigns each eligible candidate one unique label;
   - shuffles before assigning labels;
   - accepts an injected deterministic random source/permutation for tests;
   - rejects unsupported candidate counts before the network call.
2. Implement the smallest helper that satisfies the tests.
3. Keep original candidate objects unchanged.
4. Ensure labels remain stable within one judge run and are not recomputed after score sorting.
5. Commit the phase.

### Exit criteria

- A blind packet can be inspected without finding any RSemble-supplied model identity.
- Mapping back to candidate IDs is lossless.

## Phase 2 — Replace the judge prompt and parser contract

### Files

- Modify: `src/lib/pipeline.ts`
- Modify: `src/lib/pipeline.test.ts`

### Prompt work

1. Change `judgeMessages` to receive the precomputed blind candidates rather than raw named candidates.
2. Render headings as `### Candidate A`, never `### Candidate A — Model Name`.
3. Include stable rubric IDs in the judge-facing rubric block when criteria are enabled.
4. Require the JSON shape from the specification:
   - consensus;
   - contradictions;
   - unique insights;
   - evaluations;
   - same-conclusion comparisons.
5. Tell the judge to return a comparison for materially similar positions with a score difference of at least 0.5.
6. Define rationale as concise decision evidence, explicitly not chain-of-thought.
7. Keep the custom instruction delimited and before the final JSON contract.

### Parser work

1. Replace the discarded optional `scores[].rationale` path with strict evaluation parsing.
2. Validate exactly one evaluation per blind candidate.
3. Validate overall scores, required strings, arrays, deduction severity, and comparison references.
4. For enabled rubric runs, require exactly one criterion result per enabled criterion ID.
5. For no-rubric runs, reject invented criterion results.
6. Remove model-name fallback from label normalization. Accept only bare/common wrapped blind labels.
7. Resolve labels to candidate IDs and create:
   - `scoresById` for existing ranking behavior;
   - `JudgeReport` for explanations;
   - existing `ConsensusBreakdown`, preserving compatible output where practical.
8. Continue throwing descriptive errors so malformed output reaches `JUDGE_FAILED`.

### Required tests

- Judge request contains no model/provider identity.
- Valid full report parses and resolves correctly after a non-identity permutation.
- Missing rationale, position, candidate evaluation, or required criterion fails.
- Duplicate, extra, unknown, or model-name labels fail.
- Out-of-range/non-finite overall and criterion scores fail.
- Invalid deduction severity fails.
- Comparison with duplicate or unknown labels fails.
- No-rubric criterion invention fails.
- Existing adversarial custom-instruction ordering remains protected.
- Existing partial-candidate behavior remains valid.

### Exit criteria

- No valid opaque score can enter application state.
- The judge cannot identify candidates from RSemble metadata.

## Phase 3 — Thread the report through controller and state

### Files

- Modify: `src/lib/run-controller.ts`
- Modify: `src/lib/run-controller.test.ts` or existing controller test file
- Modify: `src/studio-engine.ts`
- Modify: reducer tests

### Steps

1. Add `judgeReport: JudgeReport | null` to `StudioState` and initial state.
2. Extend `JUDGE_RESULT` with the report while retaining `scoresById` unless a safe local derivation simplifies the reducer.
3. In `runJudge`:
   - construct the blind set once;
   - pass it to `judgeMessages` and `parseJudge`;
   - dispatch the resolved report;
   - keep historical score telemetry provider-scoped and unchanged.
4. Clear stale reports on:
   - `FANOUT_START`;
   - `RESET_SESSION`;
   - `RETRY_CANDIDATE_START`;
   - failed/cancelled replacement judge runs as defined by the spec.
5. Preserve the report when toggling Rank/Fuse.
6. Populate `Candidate.scores` from explicit criterion scores so the existing criterion matrix becomes functional. Key display data consistently and avoid label collisions.
7. Ensure judge abort/epoch checks cannot dispatch a late report.
8. Commit the phase.

### Required tests

- Report reaches state with candidate IDs, not unresolved labels.
- Weighted leaderboard score remains the judge overall score.
- Criterion scores populate candidate score data only when a rubric exists.
- New run/retry/reset clears stale explanations.
- Rank/Fuse toggle preserves the report.
- Abort and stale epochs do not publish a report.
- Existing run-history score and winner recording remain unchanged.

### Exit criteria

- Current-run state contains one coherent report matching the displayed candidates and scores.

## Phase 4 — Build the compact Rank explanation UI

### Files

- Modify: `src/ui/RankResult.tsx`
- Add if useful: `src/ui/JudgeExplanation.tsx`
- Modify/add: Rank UI tests
- Optionally modify: `src/ui/FuseResult.tsx`

### Steps

1. Add a compact blind-label key after the leaderboard.
2. Show each candidate’s judge-time label next to its model in the leaderboard or explanation header.
3. Replace `buildWhyItWon` fallback copy with the winner’s actual judge rationale when available.
4. Add one explanation entry per ranked candidate:
   - model and blind label;
   - overall score;
   - position summary;
   - visible one-line rationale;
   - native disclosure for strengths, deductions, missed requirements, and criterion rationales.
5. Open the winner by default; avoid forcing all details open on mobile.
6. Add the same-conclusion comparison section only when comparisons exist.
7. Keep consensus and contradiction cards; make blind references understandable through the visible key.
8. Preserve full answers, failed candidates, Fuse action, and Compare action.
9. If Fuse exposes scores, add only a compact collapsed rationale without reducing fused-answer prominence.
10. Verify keyboard, focus, semantic headings, and 390px layout.

### Required tests

- Label key maps A/B/C to the correct models after randomized judge order.
- Rank sorting does not alter label identity.
- Every score has visible rationale.
- Winner recommendation uses judge rationale.
- Details render strengths, severity-labelled deductions, missed requirements, and criterion rationale.
- Empty optional arrays produce no inert headings.
- Same-conclusion comparison appears only when present.
- Duplicate model names are disambiguated with provider display name.
- Mobile layout does not overflow horizontally.

### Exit criteria

- A user can answer “why did this receive 3 instead of 5?” without reading raw JSON.
- A user can identify Candidate A/B/C without weakening judge-time blindness.

## Phase 5 — Extend Markdown export

### Files

- Modify: `src/lib/export-markdown.ts`
- Modify: `src/lib/export-markdown.test.ts`

### Steps

1. Add the blind evaluation key.
2. Add score explanations in ranked order, preserving judge-time labels.
3. Include position, rationale, strengths, deductions with severity, missed requirements, and criterion details.
4. Add same-conclusion comparisons with both label and model display name.
5. Keep task, judge instruction, full ranked answers, consensus, contradictions, and fused answer behavior.
6. Escape or format arbitrary model names and judge text safely for Markdown.
7. Never export internal candidate IDs or provider credentials.
8. Commit the phase.

### Required tests

- Full explainable report produces all expected sections.
- Empty optional sections are omitted.
- Label mapping is correct when ranking order differs from blind order.
- No-rubric reports omit criterion details.
- Legacy/current states without a report still export safely during transition.
- Fuse export remains valid.

### Exit criteria

- Shared exports are independently understandable and auditable.

## Phase 6 — Integration, regression, and visual QA

### Steps

1. Add an integration fixture matching the business-direction case:
   - two candidates choose the same option;
   - their scores differ;
   - a same-conclusion comparison explains the gap.
2. Capture the outgoing judge request and verify model/provider metadata is absent.
3. Verify the returned map resolves each label correctly in UI and export.
4. Test malformed judge output through the real visible failure state.
5. Test partial candidate failure and retry invalidation.
6. Test Rank → Fuse → Rank without another judge call or lost report.
7. Test desktop and 390px mobile layouts in a running browser.
8. Run:

```bash
npm test
npm run check
npm run build
npm audit

git diff --check
```

9. Review the final diff for:
   - accidental model-name leakage in judge prompts;
   - permissive model-name label matching;
   - stale report paths;
   - hidden criterion invention;
   - unrelated provider/fusion changes;
   - debug logging or secrets.
10. Commit final integration fixes. Do not push.

## Suggested commit sequence

```text
docs: specify explainable blind judging
refactor: add blind candidate mapping
feat: parse structured judge explanations
feat: retain judge reports in run state
feat: show judge score explanations
feat: export blind judge audit trail
test: verify judge explainability integration
```

## Rollback

The feature is client-side and schema-bound. If rollout reveals judge compatibility problems:

1. Revert the feature commits in reverse order.
2. Restore the previous judge JSON contract and `JUDGE_RESULT` shape together.
3. Do not leave a mixed state where the prompt requests evaluations but the parser expects scores, or vice versa.
4. Preserve unrelated provider work and historical score data.

## Definition of done

- All acceptance criteria in the feature spec pass.
- The judge receives no RSemble-provided model/provider identity.
- Scores cannot be accepted without explanations.
- Blind labels are resolved after judging in UI and export.
- Same-conclusion score gaps are explained.
- No new top-level mode or dashboard exists.
- Full tests, typechecks, build, audit, and whitespace checks pass.
- Changes are committed in focused commits and not pushed.
