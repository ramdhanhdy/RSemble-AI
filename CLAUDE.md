# CLAUDE.md — Agent Guidelines & Code Rules

> Authority hierarchy: `PRODUCT.md` > `PROVIDERS.md` > `UI.md` / `DESIGN.md`.

## Principles
1. **Maintain single pipeline spine:** Task → Rubric → Compare (N models in parallel) → Judge → Rank / Fuse.
2. **Work strictly one phase at a time** per `PROVIDERS.md` §12 and `TODOS.md`.
3. **Keep pipeline code (`pipeline.ts`) strictly provider-agnostic.** Transport details stay inside `src/lib/providers/` adapters.
4. **Local/Personal use first:** Bridge binds to `127.0.0.1` only. Secrets/tokens stay local.
5. **No unrequested vendors:** OpenRouter, ChatGPT (Codex), Gemini, CommandCode, ClinePass, Umans, 9Router. Do not add Anthropic or platform chrome.
6. **9Router is a routing provider, not a second pipeline.** RSemble consumes its OpenAI-compatible API; the bridge forwards only `GET /v1/models` and `POST /v1/chat/completions` to a server-configured upstream. Do not reproduce 9Router's control plane (fallback, accounts, combos, quota).
