# PRODUCT.md — RSemble AI Product Specification

> **The source of truth for what RSemble AI is and is not.**
> Authority: PRODUCT.md defines *what the product is*. `PROVIDERS.md` defines *how models are reached*.
> If implementation or provider details conflict with PRODUCT.md's spine (fanout → Judge → Rank/Fuse), PRODUCT.md wins.

---

## 1. Executive Summary

RSemble AI is a focused, personal local tool (React + Vite SPA) for comparing and synthesizing multiple LLM candidate outputs on a task.
One pipeline, two finish modes:
- **Rank**: Which candidate model performed best.
- **Fuse**: One merged answer synthesized from the strongest candidates.

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
- **Rank & Fuse finishes**: The single mode toggle in the header switches between Rank and Fuse.

### OUT Scope (§5 Scope Fence)
- **Python backend / SQLite / public REST API**: Out of scope.
- **Datasets, benchmarks, fine-tuning**: Out of scope.
- **Multi-user SaaS / hosted authentication / public proxying**: Personal local tool only.
- **Anthropic or unrequested provider adapters**: Out of scope for planned providers v1.
- **Replacing Rank/Fuse with provider-specific UX**: The sole switch remains Rank/Fuse.
- **Node-based canvas, connected execution blocks**: Out of scope.
- **Reactive inspector drawer / config tabs**: Out of scope.
- **Frankenstein manual snippet pickers**: Out of scope.
- **Routing profiles**: Out of scope.
- **Task-preset library**: Out of scope.
- **Strategy variants (pragmatic/rigorous/creative)**: Out of scope (every run is a plain multi-model fanout).
- **Model roles (draft/critic/verifier/synthesizer as user-facing concepts)**: Out of scope.
- **Standalone scorecard dashboard**: Out of scope (one-line callback in Rank mode only).

---

## 4. Single-User / Local First (§7)

RSemble AI is designed for personal local use by a single developer on their own machine.
Build-time `VITE_*` keys are client-embedded for local execution.
The local Codex bridge runs on `127.0.0.1` solely to allow the builder to use their own ChatGPT subscription via Codex credentials without hosting a proxy for third parties.
