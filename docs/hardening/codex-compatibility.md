# Codex Protocol Compatibility (Plan 008 — experimental integration)

> Status: **experimental**. The ChatGPT (Codex) bridge integration depends on an
> upstream protocol that is not a public, stable API. This document defines the
> compatibility boundary, how failures are classified, and the safe procedure
> for updating Codex compatibility fixtures/constants. Live Codex auth is not
> available in CI; compatibility is deterministically verified by fixture-based
> tests (see `server/tests/protocol.test.ts` and `__fixtures__/`).

## Scope

The Codex protocol surface is isolated in one module:

- `server/codex-bridge/protocol.ts` — `CodexProtocolAdapter`

It owns (and nothing else does):

- **Protocol constants**: upstream endpoint, supported protocol version,
  User-Agent, Originator, OAuth client id, OAuth token endpoint.
- **Upstream headers** (`buildUpstreamHeaders`): Authorization + client metadata.
- **Request translation** (`translateToCodexRequestBody`): bridge OpenAI-compat
  body → Codex Responses-API input shape.
- **Upstream SSE event parsing** (`parseCodexSseEvent`): `output_text.delta`,
  `output_text.done`, `[DONE]`, and unexpected forms.
- **Failure classification** (`classifyCodexOutcome`): protocol drift surfaces as
  a distinct experimental-integration diagnosis.

Bridge **HTTP routing** (`server/codex-bridge/index.ts`) stays separate from
protocol translation. The web-side provider (`src/lib/providers/chatgpt-codex.ts`)
consumes the bridge's OpenAI-compat contract only; it never reaches the Codex
upstream directly.

## Protocol assumptions (centralized)

| Assumption | Constant | File |
| --- | --- | --- |
| Upstream endpoint | `CODEX_UPSTREAM_ENDPOINT` | `protocol.ts` |
| Protocol version (`client_version`) | `CODEX_PROTOCOL_VERSION` | `protocol.ts` |
| User-Agent | `CODEX_USER_AGENT` | `protocol.ts` |
| Originator header | `CODEX_ORIGINATOR` | `protocol.ts` |
| OAuth client id | `CODEX_OAUTH_CLIENT_ID` | `protocol.ts` |
| OAuth token endpoint | `CODEX_OAUTH_TOKEN_ENDPOINT` | `protocol.ts` |
| Default model slug | `CODEX_DEFAULT_MODEL` | `protocol.ts` |
| Bridge secret header | `X-RSemble-Bridge-Secret` (D3) | `index.ts` |
| Bridge endpoint (web) | `VITE_CODEX_BRIDGE_URL`, default `http://127.0.0.1:8787` | `chatgpt-codex.ts` |
| Bridge listen port | `RSEMBLE_CODEX_BRIDGE_PORT`, default `8787` (host fixed at `127.0.0.1`) | `index.ts` |

## Failure classification

Protocol drift must not be collapsed into a generic network failure. The bridge
classifies outcomes into these categories (see `CODEX_FAILURE_LABELS`):

| Category | Meaning |
| --- | --- |
| `bridge_unavailable` | The bridge could not be reached. |
| `auth_unavailable` | Upstream token missing/expired/rejected (401/403). |
| `model_unavailable` | Requested model not found upstream (404). |
| `protocol_shape_changed` | Upstream rejected the request shape (400) or the response no longer matches a known event form. |
| `client_metadata_rejected` | Upstream rejected the client metadata / version. |
| `stream_terminated_unexpectedly` | Upstream stream ended without a terminal event. |

Only the classification **label** is surfaced in the bridge error payload; the
raw upstream body is sanitized by the shared provider-error policy and never
travels to the client or logs.

## Safe procedure for updating Codex fixtures/constants

1. Change the constant(s) in `server/codex-bridge/protocol.ts` (single source of
   truth).
2. Refresh the fixture corpus under `server/tests/__fixtures__/` if the expected
   event forms changed.
3. Run the compatibility tests:
   ```bash
   npx vitest run server/tests/protocol.test.ts server/tests/responses.test.ts
   ```
4. Confirm no raw credentials, prompts, attachments, or upstream bodies were
   added to any fixture (they must remain synthetic).

## Deterministic vs owner-only live validation

- **Deterministic (default CI)**: fixture-based protocol tests and bridge
  routing contract tests. No live Codex payment or auth is required.
- **Owner-only manual smoke (never in default CI)**: see `docs/qa/` — a bounded,
  operator-triggered local completion. It must never upload credentials,
  prompts, or raw response bodies as artifacts, and is only performed with
  explicit operator consent.

Forbidden: guessing fallback protocol variants, auto-retrying with guessed
variants, scraping ChatGPT web surfaces, sending credentials to a new origin,
and altering the credential policy (D1/D3).
