# Judge Explainability and Blind Evaluation Specification

> Feature: make RSemble rankings auditable while preserving model anonymity during judging.
> Authority: subordinate to `PRODUCT.md`, `UI.md`, and `DECISIONS.md`.

## 1. Problem

RSemble currently returns an overall 1.0–5.0 score, consensus, and contradictions, but the useful explanation is lost:

- the judge response schema permits a score rationale, but `parseJudge` discards it;
- the UI and Markdown export cannot explain why two candidates with the same recommendation received different scores;
- consensus text may refer to Candidate A/B/C without showing which model each label maps to;
- the current judge prompt is not truly blind because candidate headings include model names.

A user therefore cannot distinguish a defensible score from judge noise. This is especially damaging for subjective comparisons such as product judgment, strategy, or business sense.

## 2. Goals

1. Make the judge blind to provider and model identity supplied by RSemble.
2. Reveal the blind-label mapping to the user only after judging completes.
3. Preserve a concise, decision-focused explanation for every score.
4. Explain material score differences between candidates that reach substantially similar conclusions.
5. Populate criterion-level scores when an explicit enabled rubric exists.
6. Include the same evidence in the UI and Markdown export.
7. Preserve the existing fanout → Judge → Rank/Fuse spine and strict judge-output validation.

## 3. Non-goals

- Exposing hidden chain-of-thought or asking the judge for private reasoning traces.
- Adding an Analysis tab, dashboard, or new top-level mode.
- Automatically generating a rubric from arbitrary task text in this phase.
- Replacing one judge with a multi-judge ensemble.
- Persisting full judge reports in historical telemetry.
- Changing fusion behavior or candidate generation.
- Claiming that a score is objectively correct; the feature makes it inspectable.

## 4. Terminology

- **Blind label:** temporary identifier such as Candidate A.
- **Blind mapping:** relation between a blind label and an internal candidate ID.
- **Evaluation:** structured score explanation for one candidate.
- **Deduction:** concise weakness that materially lowered the score.
- **Position summary:** short description of the candidate’s main recommendation or answer.
- **Same-conclusion comparison:** explanation of why similarly positioned candidates received different scores.

## 5. Product behavior

### 5.1 True blind judging

Before the judge call, eligible candidates receive blind labels. The judge input may contain:

- the user task;
- enabled rubric criteria;
- custom judge instruction;
- `### Candidate A`, `### Candidate B`, and similar headings;
- candidate answer text.

RSemble-generated judge input must not contain candidate model names, provider names, provider IDs, model slugs, UI order, rank, latency, token use, or cost. Candidate text is passed unchanged; RSemble cannot prevent a model from naming itself inside its own answer.

Candidate order must be randomized before labels are assigned to reduce positional bias. The resulting mapping is retained for the current run and used to map judge output back to internal candidate IDs. Tests must be able to inject deterministic ordering.

### 5.2 Post-judgment identity mapping

After a valid result is parsed, the Rank surface displays a compact key:

```text
Candidate A  Kimi K3
Candidate B  Qwen 3.7 Flash
Candidate C  GLM 5.2
```

Each leaderboard/evaluation entry also shows its blind label. Labels describe judge-time identity, not rank order, and must not be reassigned when sorting by score.

Consensus or contradiction prose that mentions Candidate A/B/C remains understandable through this key. Display code may annotate exact `Candidate X` tokens with the mapped model, but must not perform unrestricted letter replacement.

### 5.3 Per-candidate explanation

Every candidate evaluation contains:

- blind label;
- overall score from 1.0 to 5.0;
- position summary;
- one concise score rationale;
- one or two strengths;
- zero or more deductions, each marked `minor` or `major`;
- zero or more missed requirements;
- criterion scores when an explicit enabled rubric exists.

The rationale is an evaluation summary, not chain-of-thought. It should identify the decisive qualities and omissions without narrating token-by-token reasoning.

The Rank surface shows the rationale directly. Strengths, deductions, missed requirements, and criterion details may use native disclosure controls to preserve the compact UI. The winner’s explanation is open by default; other entries may be collapsed.

### 5.4 Same-conclusion comparisons

The judge must return a comparison when:

- two or more candidates reach materially similar conclusions or recommendations; and
- their overall scores differ by at least 0.5.

The comparison identifies the blind labels and explains what created the difference, such as stronger quantification, evidence quality, constraint awareness, falsifiability, feasibility, or task compliance.

If no pair qualifies, the judge returns an empty comparison array. The UI omits the section entirely when empty.

### 5.5 Criterion scores

When one or more rubric criteria are enabled, every evaluation must include exactly one 1.0–5.0 score and concise rationale for every enabled criterion. Criteria are identified by stable rubric IDs in the judge contract and mapped to display labels after parsing.

When no rubric criteria are enabled, `criterionScores` must be an empty array. The judge must not invent hidden scoring dimensions.

The existing overall score remains the leaderboard score for backward compatibility. Criterion scores explain it but are not silently averaged into a replacement score in this phase.

### 5.6 Consensus and unique insights

Existing consensus, contradictions, and unique insights remain supported. Unique-insight sources must resolve through blind labels to candidate IDs and then to display names after parsing.

Free-text references to candidates must use blind labels. Model names in judge output are not accepted as score identifiers because a properly blinded judge does not know them.

## 6. Judge output contract

The required logical shape is:

```json
{
  "consensus": ["..."],
  "contradictions": ["..."],
  "uniqueInsights": [{"source": "A", "insight": "..."}],
  "evaluations": [
    {
      "label": "A",
      "score": 4.5,
      "position": "Fix onboarding reliability first",
      "rationale": "Strong quantified comparison with credible early decision gates.",
      "strengths": ["Quantifies the revenue exposure"],
      "deductions": [{"severity": "minor", "reason": "The adoption threshold is underspecified"}],
      "missedRequirements": [],
      "criterionScores": [
        {"criterionId": "commercial-reasoning", "score": 4.7, "rationale": "Uses supplied commercial evidence."}
      ]
    }
  ],
  "comparisons": [
    {
      "labels": ["A", "B"],
      "reason": "Both recommend reliability, but A quantifies the downside and defines earlier falsification gates."
    }
  ]
}
```

The actual prompt must end with the non-negotiable JSON-only contract. Custom judge instructions remain delimited, subordinate data placed before that contract.

## 7. Validation

A judge result is accepted only when:

- all top-level required arrays exist and have the expected types;
- there is exactly one evaluation for every eligible candidate;
- every label resolves to one blind mapping, with no duplicate, missing, or extra labels;
- every overall and criterion score is finite and within 1.0–5.0;
- every rationale and position is non-empty after trimming;
- strengths, deductions, missed requirements, and criterion scores use the expected shapes;
- deduction severity is `minor` or `major`;
- enabled-rubric runs contain exactly one criterion result for every enabled criterion;
- no-rubric runs contain no criterion results;
- each comparison has exactly two distinct, valid labels and a non-empty reason;
- unique-insight sources resolve to valid labels.

Malformed output fails through the existing visible `JUDGE_FAILED` path. RSemble must not accept an unexplained score or partially map a report.

Label normalization may tolerate `A` and `Candidate A`, but must not fall back to model-name matching.

## 8. State model

Add a current-run `JudgeReport` separate from candidate content:

```ts
interface JudgeReport {
  labelMap: Array<{ label: string; candidateId: string }>;
  evaluationsById: Record<string, CandidateEvaluation>;
  comparisons: JudgeComparison[];
}
```

`CandidateEvaluation` stores resolved candidate IDs plus the original blind label. Existing `scoresById` remains available to the reducer or is derived from the report to minimize unrelated pipeline changes.

The report is cleared on:

- new fanout;
- reset;
- candidate retry, because retry invalidates the prior judgment;
- judge failure before a new valid result replaces it.

Changing Rank/Fuse view does not discard it.

## 9. Rank UI

The existing Rank surface remains one page:

1. Recommendation callout
2. Leaderboard
3. Blind evaluation key
4. Score explanations
5. Same-conclusion comparison, when present
6. Consensus and contradictions
7. Full candidate answers
8. Failed candidates

Requirements:

- The recommendation line uses the judge-provided winner rationale rather than a fabricated generic line.
- Every score can be traced to its evaluation.
- The score explanation is readable at 390px without horizontal page overflow.
- Native disclosure controls remain keyboard accessible.
- No empty headings or disabled scaffolding appear when optional data is absent.
- The criterion matrix appears only when explicit criterion scores exist.

## 10. Fuse UI

Fusion behavior is unchanged. If the existing Fuse surface exposes candidate scores, it may show the blind label and concise rationale in the same collapsed secondary area. This must not displace the fused answer as the primary deliverable.

## 11. Markdown export

Rank exports add:

```text
## Blind Evaluation Key
- Candidate A: Kimi K3 (MoonshotAI)

## Score Explanations
### Kimi K3 (Candidate A) — 5.0/5
Position: ...
Why this score: ...
Strengths:
- ...
Deductions:
- Major: ...
Missed requirements:
- ...
Criterion scores:
- Commercial reasoning: 4.8/5 — ...

## Same-Conclusion Comparisons
- Candidate A (Kimi K3) vs Candidate B (Qwen 3.7 Flash): ...
```

The export keeps the task, judge instruction, ranked answers, consensus, and contradictions. It must never expose hidden provider credentials or internal IDs.

## 12. Error and edge cases

- Partial candidate failures: only usable candidates enter the blind set; the map contains only those candidates.
- Equal scores: preserve stable display ordering after the randomized judge order is mapped back; do not imply a meaningful winner margin.
- Duplicate model display names: include provider display names in the key when needed to disambiguate.
- Candidate retries: clear stale explanations and rerun judging through the normal path.
- Judge cancellation: do not retain a half-populated report.
- Model self-identification: do not alter candidate content; document that blindness covers RSemble metadata, not self-disclosure in generated prose.
- More candidates than supported labels: fail before the judge call with an actionable error rather than silently reusing a label.

## 13. Acceptance criteria

1. Captured judge requests contain Candidate labels and answer text but no RSemble-supplied model/provider identity.
2. Candidate order is randomized, and deterministic tests can control the permutation.
3. The judge report maps every blind label back to exactly one candidate ID.
4. The Rank UI shows which model was Candidate A/B/C only after judging.
5. Every displayed score has a non-empty rationale, strengths, and structured deductions/missed requirements where applicable.
6. Two same-position candidates separated by at least 0.5 display a comparative explanation.
7. Explicit rubric runs populate and display all criterion scores; no-rubric runs invent none.
8. Malformed or incomplete explanations cause a visible judge failure rather than an opaque ranking.
9. Recommendation copy uses the actual winner rationale.
10. Markdown exports include the blind key, score explanations, criterion details, and comparisons.
11. Existing custom judge instruction, partial failure, retry, Rank/Fuse, and fusion behavior remains intact.
12. Full tests, web/server typechecks, production build, `git diff --check`, and dependency audit pass.

## 14. Product documentation changes

Implementation must update:

- `PRODUCT.md` to make explainable blind ranking part of Judge/Rank behavior;
- `UI.md` sections 4.1–4.3 with the compact explanation surface;
- `DECISIONS.md` with the choice to blind RSemble metadata during judging and reveal the mapping afterward.

## 15. Deferred options

Potential later work, explicitly outside this implementation:

- optional second-judge or rejudge comparison;
- judge confidence/calibration displays;
- automatic rubric generation from task and judge instructions;
- persisted full judge reports and longitudinal judge-agreement analytics;
- evidence-span verification against exact candidate text.
