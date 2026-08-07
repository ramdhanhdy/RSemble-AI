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
   Set the smoke model to an eligible ID returned by the `/v1/models` catalog
   in the preceding step (shell-local only — no application configuration):
   ```bash
   CODEX_SMOKE_MODEL="$(curl -s http://127.0.0.1:8787/v1/models \
     -H "X-RSemble-Bridge-Secret: $RSEMBLE_BRIDGE_SECRET" \
     | python3 -c "import sys,json; print(json.load(sys.stdin)['data'][0]['id'])")"
   curl -s -X POST http://127.0.0.1:8787/v1/chat/completions \
     -H "Content-Type: application/json" \
     -H "X-RSemble-Bridge-Secret: $RSEMBLE_BRIDGE_SECRET" \
     -d "{\"model\":\"$CODEX_SMOKE_MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Say hello in one short sentence.\"}],\"stream\":false}"
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

A surfaced compatibility category is a **hypothesis**, not a mandate to bump
the version. Before touching any constant:

1. **Record evidence first.** Capture the surfaced `compatibility` category and
   the bounded upstream error message (sanitized) that triggered it. The
   classifier is evidence-based; a generic 429/5xx produces no category and is
   not protocol drift.
2. **Map the category to the specific constant(s) that plausibly changed:**
   - `protocol_shape_changed` → request/response shape: review
     `translateToCodexRequestBody` and `parseCodexSseEvent`, and refresh
     `server/tests/__fixtures__/` only if the actual event/request forms
     changed;
   - `client_metadata_rejected` → User-Agent/Originator/version metadata:
     review `CODEX_USER_AGENT` / `CODEX_ORIGINATOR`, NOT necessarily
     `CODEX_PROTOCOL_VERSION`;
   - `model_unavailable` → model slug/catalog, not protocol constants;
   - `auth_unavailable` → credentials/login, not protocol constants;
   - upstream endpoint moves → `CODEX_UPSTREAM_ENDPOINT`;
   - a genuine protocol/client-version change (only with current Codex CLI
     evidence that the upstream now expects a different version) →
     `CODEX_PROTOCOL_VERSION`.
3. **Require current Codex CLI evidence** before changing version or client
   metadata constants: confirm the live CLI sends the new value, otherwise the
   change is a guess.
4. Re-run `server/tests/protocol.test.ts` and `server/tests/responses.test.ts`
   before re-smoking.
