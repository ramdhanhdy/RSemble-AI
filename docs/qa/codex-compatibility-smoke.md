# Codex Bridge — Opt-in Manual Compatibility Smoke (Plan 008 W/E)

> This is an **operator-triggered** smoke, never part of default CI and never a
> paid automated test. Live Codex authentication is not available in worker
> environments; compatibility is deterministically verified by fixture-based
> tests in default CI (`server/tests/protocol.test.ts`). Run this smoke only on
> a machine with real Codex credentials and only with explicit operator consent.

## Purpose

Confirm that the local bridge actually reaches the live Codex upstream and that
the centralized protocol adapter (`server/codex-bridge/protocol.ts`) produces a
valid completion. It validates what deterministic fixtures cannot: that the
current `CODEX_PROTOCOL_VERSION` / User-Agent / Originator still work against
the live backend.

## Preconditions

- `codex login` completed (auth.json exists; see `server/codex-bridge/auth.ts`).
- Local bridge runs on `127.0.0.1:8787` (`npm run dev:bridge`).

## Procedure (bounded, credential-safe)

1. **Verify health**
   ```bash
   curl -s http://127.0.0.1:8787/health
   # expect: {"status":"ok",...,"capabilities":{"image":true,"pdf":false}}
   ```

2. **Verify auth status**
   ```bash
   curl -s http://127.0.0.1:8787/auth/status
   # expect: {"ok":true,...} when authenticated
   ```

3. **List eligible models (bridge-secret protected when configured)**
   ```bash
   # when RSEMBLE_BRIDGE_SECRET is set, add: -H "X-RSemble-Bridge-Secret: $RSEMBLE_BRIDGE_SECRET"
   curl -s http://127.0.0.1:8787/v1/models
   # expect: {"data":[...]} — the centralized model catalog
   ```

4. **One minimal bounded completion (EXPLICIT OPERATOR CONSENT ONLY)**
   ```bash
   curl -s -X POST http://127.0.0.1:8787/v1/chat/completions \
     -H "Content-Type: application/json" \
     -H "X-RSemble-Bridge-Secret: $RSEMBLE_BRIDGE_SECRET" \
     -d '{"model":"gpt-5.6-sol","messages":[{"role":"user","content":"Say hello in one short sentence."}],"stream":false}'
   ```
   Confirm the classification absent (a 200 with a completion) and that the
   upstream still accepts the centralized client metadata.

5. **Record (sanitized only)**
   - protocol version used (`CODEX_PROTOCOL_VERSION`);
   - model slug; upstream HTTP status;
   - any compatibility category surfaced by the bridge (`compatibility` field);
   - the *fact* that a completion succeeded/failed — never the prompt, the
     response body, credentials, or raw upstream text.

## Credential and cost safety

- Never upload credentials, prompts, attachments, or raw upstream response
  bodies as CI artifacts, logs, or issue attachments.
- This smoke is operator-initiated; it never runs in default CI and is not a
  required gate for Plan 008 acceptance (deterministic fixtures are).

## Update checklist

If the upstream rejects the request with `protocol_shape_changed` or
`client_metadata_rejected`, bump `CODEX_PROTOCOL_VERSION` in
`server/codex-bridge/protocol.ts`, refresh `server/tests/__fixtures__/`, and
re-run `server/tests/protocol.test.ts` before re-smoking.
