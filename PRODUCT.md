# PRODUCT.md — RSemble AI Product Specification

> **The source of truth for what RSemble AI is and is not.**
> Authority: PRODUCT.md defines *what the product is*. `PROVIDERS.md` defines *how models are reached*.
> If implementation or provider details conflict with PRODUCT.md's spine (fanout → Judge → Rank/Fuse), PRODUCT.md wins.

---

## 1. Executive Summary

RSemble AI is a focused, personal local tool (React + Vite SPA) for comparing and synthesizing multiple LLM candidate outputs on a task, inspecting past runs, and executing small local evaluation suites.
One pipeline, two finish modes:
- **Rank**: Which candidate model performed best.
- **Fuse**: One merged answer synthesized from the strongest candidates.

The product has three top-level workspaces:
- **Compare** — the working surface for one-off fanout → Judge → Rank/Fuse work.
- **Runs** — an audit surface making previous work searchable: task inputs, outputs, Judge evidence, scores, configuration, and failures.
- **Evaluations** — an audit surface grouping several tasks into a versioned local suite, executing the same comparison pipeline per task, and presenting a model-by-task result matrix.

These are navigation destinations, not pipeline modes. Rank/Fuse remains the per-task finish choice and is shown only where it is relevant (Compare). The evaluation feature is local-first and single-user: it introduces no hosted backend, accounts, collaboration, public benchmark publishing, or general workflow canvas.

---

## 2. Core Spine (§3)

```
Task → Rubric → Compare (N models in parallel) → Judge
                                                       │
                                    ┌─────────────────┴──────────────────┐
                                  RANK                               FUSE
                          "Use this model."                "Here's the merged answer."
```

1. **Command**: User describes task + optional rubric criteria.
2. **Fanout**: N enabled candidate slots stream responses in parallel.
3. **Judge**: Single judge model scores candidates against the rubric and breaks down consensus and contradictions. Judging is **blind**: candidates reach the judge only as `Candidate A/B/C…` in randomized order — never with RSemble-supplied model/provider identity — and every accepted score carries a structured explanation (position, rationale, strengths, deductions, missed requirements, criterion scores). A score without an explanation is rejected as a visible judge failure, never an opaque ranking.
4. **Finish**:
   - **Rank**: Leaderboard with recommendation callout, tier scores, and candidate prose. After judging completes, the blind-label mapping is revealed (Candidate A → model) and each ranked entry shows its judge explanation; materially similar positions with score gaps get a comparative explanation. The recommendation line quotes the judge's actual winner rationale.
   - **Fuse**: Single merged document synthesized from candidate strengths.

---

## 3. Scope Fence (§5)

### IN Scope
- **Multi-model comparison & parallel fanout**: Run N candidate models on the same task simultaneously.
- **Pluggable provider adapters**:
  - OpenRouter (`openrouter`)
  - ChatGPT subscription via local Codex bridge (`chatgpt-codex`)
  - Gemini AI Studio (`gemini`)
  - CommandCode (`commandcode`)
  - ClinePass (`clinepass`)
  - Umans (`umans`)
  - 9Router (`9router`) — a local/remote routing gateway with 9Router-managed models and fallback; one requested model ID produces one candidate, regardless of internal fallback
- **Localhost Node Codex bridge**: Lightweight 127.0.0.1 process that also serves as an allowlisted proxy for compatible providers (e.g. 9Router). The bridge forwards only approved method/path pairs to server-configured upstreams; it is not a general-purpose proxy.
- **Rubric-driven blind judging**: Configurable judge model evaluates anonymized candidates and outputs consensus/contradictions plus a per-candidate score explanation. The judge receives no RSemble-supplied model/provider metadata; the label mapping is resolved only after judging and is auditable in the UI and Markdown export.
- **Rank & Fuse finishes**: The single mode toggle in the header switches between Rank and Fuse. It is the sole per-task finish switch, shown only in Compare.
- **Three workspaces — Compare, Runs, Evaluations**: Navigation destinations, not pipeline modes. Compare is the one-off working surface; Runs and Evaluations are audit surfaces. Profile and suite editors are working surfaces nested inside Evaluations.
- **Durable run history**: Browser-local (IndexedDB) persistence of complete run evidence — task inputs, candidate outputs, Judge evidence, scores, configuration, and failures — so completed, partial, failed, aborted, and interrupted runs are inspectable after reload.
- **Local evaluation suites**: Versioned suites of multiple tasks, each executed one at a time through the existing comparison pipeline, with a model-by-task result matrix, transparent coverage, equal-task aggregation, and provenance links to underlying run evidence. Profiles are versioned and immutable; suites pin to profile versions. Suite executions produce immutable experiment snapshots with per-task results, coverage, and provenance — experiment history is auditable but not semantic-searchable in this phase.
- **Structured workspaces vs. exploratory semantic intelligence**: The three workspaces (Compare, Runs, Evaluations) are committed, structured audit and working surfaces with explicit data contracts. Embedding search, semantic clustering, "Ask history," and automatic benchmark generation remain exploratory roadmap phases that require the structured history to exist first; they are not part of the current approved scope and must not be implied by the workspace UI.

### OUT Scope (§5 Scope Fence)
- **Python backend / SQLite / public REST API**: Out of scope.
- **Datasets, benchmarks, fine-tuning**: Out of scope, *except* the constrained local evaluation-suite contract above (versioned local suites of tasks executed through the existing comparison pipeline with a model-by-task result matrix). No hosted benchmarks, public benchmark publishing, fine-tuning, or training-data management.
- **Multi-user SaaS / hosted authentication / public proxying**: Personal local tool only.
- **Anthropic or unrequested provider adapters**: Out of scope for planned providers v1.
- **Replacing Rank/Fuse with provider-specific UX**: The sole switch remains Rank/Fuse.
- **Node-based canvas, connected execution blocks**: Out of scope.
- **Reactive inspector drawer / config tabs**: Out of scope.
- **Frankenstein manual snippet pickers**: Out of scope.
- **Routing profiles / model routing strategies**: Out of scope as pipeline concepts. (Evaluations' local Suites | Profiles navigation is in scope — see IN scope above.)
- **Task-preset library**: Out of scope.
- **Strategy variants (pragmatic/rigorous/creative)**: Out of scope (every run is a plain multi-model fanout).
- **Model roles (draft/critic/verifier/synthesizer as user-facing concepts)**: Out of scope.
- **Standalone scorecard dashboard**: Out of scope (one-line callback in Rank mode only).

---

## 4. Single-User / Local First (§7)

RSemble AI is designed for personal local use by a single developer on their own machine.
Build-time `VITE_*` keys are client-embedded for local execution.
The local Codex bridge runs on `127.0.0.1` solely to allow the builder to use their ChatGPT subscription via Codex credentials without hosting a proxy for third parties.
Durable run history and evaluation suites persist in browser-local IndexedDB. No credentials, authorization headers, or environment contents are ever persisted or exported.
