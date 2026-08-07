# Plan 003: Harden credential handling and local bridge boundaries

> **Executor instructions**: Execute only after Plan 002 is complete and its
> decisions are reflected in the authoritative specs. Preserve current provider
> behavior while narrowing credential-bearing surfaces. Add tests before changing
> route dispatch or credential resolution. Do not combine this phase with run UX,
> timeout, or large refactors.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 8f22a6e..HEAD -- \
>   src/ui/ConnectionsModal.tsx \
>   src/lib/providers \
>   src/lib/persistence/error-redaction.ts \
>   src/lib/run-executor.ts \
>   src/lib/dev-terminal-log.ts \
>   server/codex-bridge \
>   PRODUCT.md PROVIDERS.md DECISIONS.md package.json
> git status --short
> ```
>
> If route dispatch, provider key lookup, error redaction, or bridge configuration
> changed after `8f22a6e`, reconcile line references and contracts before coding.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plan 002
- **Blocks**: Plan 004
- **Category**: security
- **Planned at**: commit `8f22a6e`, 2026-08-06
- **Execution status**: DONE — owner validation pending (deterministic security
  and unit suites pass; live multi-provider checks require the owner's PC)

## Goal

Make the implementation match the local-first security model: credentials are
resolved through one explicit policy, proxy routes expose only approved upstream
operations, configured bridge authentication is real, and raw provider failures
cannot leak secrets through development logging or persisted evidence.

## Current risks to remove

1. `ConnectionsModal` automatically saves keys to `localStorage`.
2. Provider adapters read environment variables and ad hoc storage keys directly.
3. Umans and ClinePass accept broad `/provider/*` prefixes and forward caller
   authorization headers.
4. `RSEMBLE_BRIDGE_SECRET` is documented but not enforced.
5. `run-executor` logs a sanitized error message and may also attach the original
   `err.stack`.
6. Provider adapters can construct errors from raw upstream response bodies.
7. The 48 MiB bridge body limit can reject a UI-admitted 40 MiB base64 payload.

## Target architecture

### CredentialStore

Add a provider-neutral credential service, for example:

```ts
export type CredentialPersistence = "session" | "remembered";

export interface CredentialStore {
  get(providerId: ProviderId): string;
  set(providerId: ProviderId, value: string, persistence: CredentialPersistence): void;
  clear(providerId: ProviderId): void;
  persistence(providerId: ProviderId): CredentialPersistence | null;
  configuredValues(): string[];
}
```

Required behavior:

- environment credentials have highest precedence and are read-only in UI;
- session credentials live in module memory or a dedicated session store;
- remembered credentials use versioned storage keys;
- legacy `rsemble.key.*` values are migrated deliberately, never silently copied
  into a new remembered store without preserving the user's prior behavior;
- adapters depend on a shared resolver, not UI state;
- `configuredValues()` supplies redaction inputs without exposing them to logs.

If dependency injection across every adapter is too invasive, expose a narrow
singleton module first, but do not retain direct `localStorage.getItem` calls in
provider files.

### Bridge route policy

Represent allowed routes as data, not nested prefix branches:

```ts
interface AllowedBridgeRoute {
  publicPath: string;
  method: "GET" | "POST";
  handler: BridgeHandler;
  auth: "public" | "bridge-secret";
  contentType?: "application/json";
}
```

Exact routes for Umans and ClinePass:

- `GET /umans/v1/models`
- `POST /umans/v1/chat/completions`
- `GET /clinepass/v1/models`
- `POST /clinepass/v1/chat/completions`

Unknown paths return `404` without calling the handler. Known path with wrong
method returns `405` and an exact `Allow` header.

### Bridge secret

When `RSEMBLE_BRIDGE_SECRET` is non-empty:

- require `X-RSemble-Bridge-Secret` on protected routes;
- compare supplied and configured values without early-exit string comparison;
- never echo the configured secret;
- allow CORS preflight to advertise the header;
- keep `/health` public;
- decide explicitly whether `/auth/status` is public metadata or protected;
- protect Codex completion/model routes and credential-forwarding proxies.

The web side must source the secret according to Plan 002. Tests must cover both
configured and unconfigured modes.

## Workstream A — Credential-store contract and migration

1. Add `src/lib/credentials/types.ts` and `credential-store.ts`.
2. Add unit tests for environment, session, remembered, clear, precedence, and
   unavailable-storage behavior.
3. Define migration from legacy `rsemble.key.<provider>` values. Migration must
   be idempotent and must not log values.
4. Replace every provider-specific key reader with the store/resolver.
5. Update `configuredCredentialValues()` to consume the shared store plus
   environment-backed values.
6. Update Connections UI:
   - show whether an environment key is active;
   - default new UI keys to session-only;
   - expose **Remember on this device** explicitly;
   - provide Clear for both session and remembered values;
   - never render the existing key value in plaintext;
   - preserve Test-before-save behavior.
7. Add component tests proving default session behavior and remembered opt-in.

## Workstream B — Exact bridge route allowlists

1. Add failing tests for unknown Umans/ClinePass paths, management-like paths,
   query strings, wrong methods, and unsupported content types.
2. Introduce a route table or equivalent exact matcher.
3. Ensure query strings are forwarded only for an already-approved exact path.
4. Preserve 9Router's existing exact allowlist behavior.
5. Verify Authorization is omitted when blank and forwarded only on approved
   routes.
6. Verify upstream redirects remain rejected.

Tests must use an injected/mock upstream or handler spy and assert that forbidden
requests make zero upstream calls.

## Workstream C — Implement bridge authentication

1. Add configuration parsing and validation.
2. Add secret-check middleware before body reading or upstream contact.
3. Update CORS allowed headers.
4. Add browser adapter header construction.
5. Add tests for:
   - no configured secret;
   - configured + correct;
   - configured + missing;
   - configured + wrong;
   - public health endpoint;
   - preflight behavior;
   - no secret in response bodies or logs.
6. Update `.env.example` and provider documentation.

## Workstream D — Error and log containment

1. Remove raw `err.stack` from provider-failure terminal logs.
2. If stacks remain useful for internal programming errors, log only stacks from
   errors classified as application/invariant failures and pass them through a
   redactor first.
3. Bound provider error-body reads by bytes.
4. Parse known `{ error: { message } }` shapes; otherwise emit a generic status-
   based message rather than serializing arbitrary JSON.
5. Run configured-value redaction before constructing persisted and terminal-log
   fields.
6. Add adversarial tests containing bearer tokens, API keys, prompt fragments,
   newlines, and oversized HTML error bodies.

## Workstream E — Reconcile attachment transport limits

1. Move raw and encoded limits to a shared contract importable by web and server,
   or generate equivalent constants from one source.
2. Raise the bridge body limit to the decision from Plan 002.
3. Add encoded-request-size preflight for bridge providers.
4. Ensure the error identifies transport size, not attachment extraction.
5. Add boundary tests:
   - maximum accepted raw set succeeds;
   - one byte/representative margin over encoded limit fails before fetch;
   - server rejects oversized direct callers with `413`;
   - request destruction does not produce double responses.

## Scope

**In scope**:

- `src/lib/credentials/**` (create)
- `src/ui/ConnectionsModal.tsx` and tests
- provider adapter credential lookup and bounded error parsing
- `src/lib/persistence/error-redaction.ts`
- `src/lib/run-executor.ts` logging only
- `src/lib/dev-terminal-log.ts` if required
- `server/codex-bridge/**`
- attachment limit constants/preflight required for bridge parity
- `.env.example`, `PRODUCT.md`, `PROVIDERS.md`, `DECISIONS.md`

**Out of scope**:

- Compare minimum candidate count;
- reasoning-policy freezing;
- cost estimator redesign;
- request/inactivity deadlines for direct providers;
- cross-tab leases;
- general controller/module extraction;
- OS keychain integration.

## Verification commands

```bash
npm test -- \
  src/lib/credentials \
  src/ui/ConnectionsModal.test.tsx \
  src/lib/persistence/error-redaction.test.ts \
  src/lib/run-executor.test.ts \
  server/codex-bridge
npm run typecheck:web
npm run typecheck:server
npm run check
git diff --check
```

Add or update a deterministic bridge security QA script if unit/integration tests
cannot prove that forbidden paths make no upstream request.

## Acceptance criteria

- No provider adapter directly reads a legacy key from `localStorage`.
- UI-entered keys are session-only unless the user explicitly opts in.
- Every credential-forwarding bridge route uses exact path and method matching.
- Configured bridge authentication is enforced before upstream contact.
- Raw provider stacks/bodies do not enter dev logs or persisted records.
- The maximum UI-admitted bridge payload is transportable, or blocked locally
  with an exact encoded-size error.
- Existing providers still complete catalog, non-stream, and stream calls under
  their prior valid configurations.

## STOP conditions

Stop if:

- Plan 002 credential or bridge-secret decisions are not finalized;
- migration would destroy or expose existing saved credentials;
- a provider needs an additional route not documented in the allowlist;
- shared attachment-limit code would force server code into the browser bundle;
- a test can observe credential material after redaction.

## Handoff to Plan 004

Plan 004 may assume one credential source, sanitized provider errors, exact bridge
routes, and coherent body limits. It must not reintroduce direct storage access or
raw provider diagnostics while repairing run integrity.
