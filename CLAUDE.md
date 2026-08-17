# CLAUDE.md — Agent Guidelines & Code Rules

> Authority hierarchy: `PRODUCT.md` > `PROVIDERS.md`. (`UI.md` / `DESIGN.md`
> are historical and no longer shipped; references to them are provenance-only.)
>
> **Terminology (Child 01, 2026-08-12):** Scoring objects are **Rubrics**, not
> "Profiles." Use canonical Rubric names (`EvaluationRubric`, `RubricRecord`,
> `RubricVersionRef`, `RubricRepository`) in new code. Legacy `profile*`
> identifiers survive only at frozen IndexedDB stores (`profiles`,
> `profileVersions`), frozen serialized fields (`evaluationProfileId`,
> `evaluationProfileVersion`), v1 archive payloads, and explicit compat modules
> (`rubric-compat.ts`, `evaluation-rubric-adhoc.ts`). The terminology guard
> (`src/lib/evaluations/rubric-terminology.test.ts`) enforces this boundary.
> The word "profile" is reserved for the future model evidence profile.

## Principles
1. **Maintain single pipeline spine:** Task → Evaluation → Compare (N models in parallel) → Judge → Rank / Fuse. The pipeline serves one-off Compare runs and per-task Task Set execution alike; do not branch `pipeline.ts` by workspace or provider.
2. **Work strictly one phase at a time** per `PROVIDERS.md` §12 and `TODOS.md`.
3. **Keep pipeline code (`pipeline.ts`) strictly provider-agnostic.** Transport details stay inside `src/lib/providers/` adapters.
4. **Local/Personal use first:** Bridge binds to `127.0.0.1` only. Secrets/tokens stay local. Durable run history and evaluation Task Sets persist in browser-local IndexedDB; never persist or export credentials, authorization headers, or environment contents.
5. **No unrequested vendors:** OpenRouter, ChatGPT (Codex), Gemini, CommandCode, ClinePass, Umans, 9Router. Do not add Anthropic or platform chrome.
6. **9Router is a routing provider, not a second pipeline.** RSemble consumes its OpenAI-compatible API; the bridge forwards only `GET /v1/models` and `POST /v1/chat/completions` to a server-configured upstream. Do not reproduce 9Router's control plane (fallback, accounts, combos, quota).
7. **Three workspaces are approved scope.** Compare, Runs, and Evaluations are navigation destinations (not pipeline modes), authorized by `PRODUCT.md`, `UI.md` §6A, `DESIGN.md` §Workspace Navigation, and `DECISIONS.md` #7. Do not reject primary navigation, durable run history, local evaluation Task Sets, or the result matrix as out-of-scope. Rank/Fuse remains the sole per-task finish switch and is shown only in Compare. Out of scope for the evaluation plan: embeddings, clustering, multiple Judges, multiple trials, arbitrary task weights, confidence intervals, and pairwise ranking.
8. **Evidence provenance and observation immutability (Child 04):** Observation is an immutable reference/index over exact Run/Experiment evidence and must never duplicate raw candidate output, candidate messages, or full judge rationale. Model configurations canonicalize stored facts only; unknown resolved versions remain unknown. Reused candidate outputs retain original `candidateAttemptId` without inflating sample counts (one active observation per lineage cell). Fusion observations are distinct study-owned entities and are strictly isolated from canonical observations without conversion or ID collision.
