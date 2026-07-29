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
