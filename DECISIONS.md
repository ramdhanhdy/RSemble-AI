# DECISIONS.md — RSemble AI Architectural Decisions

This document records architectural decisions made for RSemble AI.

---

## Decision #1: Focused Direction (Split Workspace / Variation B)
- **Date:** 2026-06-17
- **Context:** Orcha Studio was a 3-panel layout with a node-based canvas, reactive inspector drawer, and complex profile routing. It added unnecessary complexity for a personal model comparison tool.
- **Decision:** Replaced the 3-panel studio layout with a clean two-pane Split Workspace (Variation B):
  - Top header containing identity, run status, and the sole Rank/Fuse toggle.
  - Left pane: Command (Task input, toggleable model list, collapsed rubric, Run button).
  - Right pane: Output (Rank leaderboard or Fuse merged document).
- **Rationale:** Focuses on the single core capability: running N candidates in parallel, judging them against a rubric, and offering Rank or Fuse finishes.

---

## Decision #2: Technical Instrument Aesthetic
- **Date:** 2026-06-16
- **Context:** Choosing a visual design system for an AI model comparison tool.
- **Decision:** Adopt an industrial/utilitarian dark mode theme (`bg-zinc-950`), Geist + Geist Mono typography, compact density, and minimal cyan (`#00e5ff`) accents for active states and primary actions. Avoid generic AI SaaS tropes (gradients, SVG blobs, bubbly corners).

---

## Decision #3: Brand Identity — RSemble AI
- **Date:** 2026-06-19
- **Context:** Renaming product from Adaptive Fusion to RSemble AI.
- **Decision:** Update brand display text across title, header, and X-Title headers to RSemble AI. Retain the exact visual design system and single pipeline spine (Rank/Fuse).

---

## Decision #4: Multi-Provider Support & Localhost Codex Bridge
- **Date:** 2026-07-22
- **Context:** RSemble AI was bound exclusively to OpenRouter (`src/lib/openrouter.ts`). Users need to access models via ChatGPT subscriptions (via Codex CLI login) and direct Google AI Studio API keys (Gemini), alongside OpenRouter.
- **Decision:**
  1. Introduce a provider adapter registry (`src/lib/providers/`) supporting `openrouter`, `chatgpt-codex`, and `gemini`.
  2. Keep the pipeline (`pipeline.ts`) strictly provider-agnostic.
  3. Build a lightweight localhost Node server (`server/codex-bridge/`) bound exclusively to `127.0.0.1`. The bridge reads `~/.codex/auth.json` (or `%USERPROFILE%\.codex\auth.json`) and handles token refreshes to proxy Codex responses for personal local ChatGPT subscription access.
  4. Anthropic and other non-listed vendors are strictly out of scope.
  5. The bridge is an infrastructure detail for personal local auth, NOT a multi-user hosted backend (which remains strictly OUT per PRODUCT.md §5).

---

## Decision #5: 9Router Provider Support
- **Date:** 2026-07-29
- **Context:** A user wants to compare models already configured in 9Router (aliases, combos, account fallbacks) without duplicating provider credentials in RSemble. 9Router exposes a standard OpenAI-compatible API.
- **Decision:**
  1. Register `9router` as a first-class `ProviderId` using the OpenAI-compatible adapter factory.
  2. Route browser traffic through RSemble's localhost bridge to avoid CORS and keep the 9Router endpoint server-configured.
  3. The bridge forwards only `GET /v1/models` and `POST /v1/chat/completions` to a fixed upstream (`RSEMBLE_9ROUTER_URL`, default `http://127.0.0.1:20128`). No request parameter can alter the upstream host — this prevents SSRF.
  4. RSemble consumes but does not reproduce 9Router's control plane (fallback, account rotation, aliases, combos, quota tracking, pricing). One requested model ID produces one candidate.
  5. A blank API key is valid when 9Router's `requireApiKey` setting is disabled; readiness is established by a model-catalog probe, not key length.
  6. Upstream redirects are rejected (`redirect: "manual"`) to prevent credential forwarding to a different origin.
- **Rationale:** 9Router is an external routing provider. RSemble's single pipeline spine (fanout → Judge → Rank/Fuse) is unchanged; a `9router` slot delegates one completion to 9Router, which owns all internal routing decisions.

---

## Decision #6: Blind Judging with Post-Judgment Identity Reveal
- **Date:** 2026-07-29
- **Context:** The judge prompt embedded candidate model names (`### Candidate A — GLM 5.2`), so scores could be biased by model/provider reputation. The response schema also permitted a per-score rationale that `parseJudge` discarded, leaving the UI unable to explain why two same-conclusion answers scored differently.
- **Decision:**
  1. Judge input is blind to RSemble metadata: candidates are shuffled, labelled `Candidate A/B/C…`, and rendered without model names, provider names, slugs, order, latency, tokens, or cost. (Blindness covers RSemble-supplied metadata only; a model naming itself inside its own answer is not altered.)
  2. The label→candidate mapping is retained for the current run and revealed in the UI and Markdown export only after judging completes. Labels describe judge-time identity and are never reassigned by score sorting.
  3. Every accepted score requires a structured explanation (position, concise rationale, strengths, severity-labelled deductions, missed requirements, criterion scores when a rubric is enabled). Malformed or unexplained output fails through the visible `JUDGE_FAILED` path — no opaque rankings.
  4. The judge must explain material score gaps (≥0.5) between candidates with materially similar conclusions via same-conclusion comparisons.
  5. The rationale is concise decision evidence, explicitly not hidden chain-of-thought; no private reasoning traces are requested or displayed.
- **Rationale:** Scores become inspectable rather than asserted, while model anonymity at judge time keeps the comparison honest. The audit trail (blind key + explanations + comparisons) ships in both the Rank UI and Markdown export without adding a new top-level mode or dashboard.

---

## Decision #7: Evaluation Workbench — Three Workspaces, Durable History, Local Suites
- **Date:** 2026-07-30
- **Context:** RSemble had a single comparison surface and an in-memory `RunHistoryEntry` that could not reconstruct a completed run after reload. Heterogeneous telemetry was aggregated as if comparable, the rubric schema (`goal | metric | gap`) did not match specialized evaluation needs, and multi-task evaluation required manual external record-keeping.
- **Decision:** Expand RSemble from one surface into three top-level workspaces:
  1. **Compare** — preserves the existing one-task fanout → blind Judge → Rank/Fuse pipeline unchanged.
  2. **Runs** — durable, searchable, auditable run history persisted in browser-local IndexedDB: complete snapshots (task, candidates, Judge evidence, scores, config, failures) keyed by one stable run ID.
  3. **Evaluations** — versioned local suites of multiple tasks, each executed one at a time through the existing comparison pipeline, with a model-by-task result matrix, transparent coverage, equal-task aggregation, and provenance links to underlying run evidence.
- **Constraints:** Local-first and single-user. No hosted backend, accounts, collaboration, or public benchmark publishing. Rank/Fuse remains the sole per-task finish switch, shown only in Compare. The provider-agnostic pipeline (`pipeline.ts`) is unchanged. Profiles are versioned and immutable; suites pin to profile versions. Out of scope for this plan: embeddings, clustering, multiple Judges, multiple trials, arbitrary task weights, confidence intervals, and pairwise ranking.
- **Authority changes:** `PRODUCT.md`, `UI.md` (§6A), and `DESIGN.md` (§Workspace Navigation) amended to authorize three-workspace navigation, cross-workspace execution awareness, shared audit grammar (status tokens, model labels, record rows, split panes, monochrome matrices), and the working-surface versus audit-surface rule.
- **Rationale:** Structured, inspectable run history and multi-task suites are prerequisites for any later semantic-history intelligence. Separating working surfaces (Compare + editors) from audit surfaces (Runs + results) keeps each workspace focused and lets the existing pipeline engine serve both one-off and suite execution without branching.

---

## Decision #8: react-router-dom 7.18.2 — Audit Exemption for RSC-Only Advisory
- **Date:** 2026-07-30
- **Context:** Phase 0 of the evaluation workbench plan requires `npm install react-router-dom` and zero high-severity `npm audit` findings. `react-router-dom@7.18.2` reports 2 high findings from GHSA-qwww-vcr4-c8h2 (RSC-mode CSRF bypass). The advisory states: "This only affects your application if you are using the unstable RSC APIs."
- **Decision:** Accept `react-router-dom@7.18.2` with a documented exemption for GHSA-qwww-vcr4-c8h2. RSemble is a client-side HashRouter SPA with no server, no SSR, no RSC, and no server actions — the vulnerable code path is structurally unreachable. Downgrading to 7.11.0 (the only other React-18-compatible option below the advisory range) introduces 14 real vulnerabilities including XSS, RCE (turbo-stream deserialization), and DoS, making it strictly worse. React Router 8.3.0 (the fully patched version) requires React 19, which is incompatible with RSemble's React 18 stack.
- **Exemption scope:** This exemption applies only to GHSA-qwww-vcr4-c8h2. All other react-router advisories are cleared by 7.18.2. If RSemble ever adopts server-side rendering or RSC, this exemption must be revoked and the dependency upgraded.
- **Rationale:** 7.18.2 is the safest React-18-compatible version. The advisory's own note confirms RSC-only impact. Blocking Phase 0 on a structurally inapplicable vulnerability would delay the entire evaluation workbench indefinitely while accepting worse real-world risk by downgrading.
