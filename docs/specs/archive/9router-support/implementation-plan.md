# 9Router Provider Support Implementation Plan

> **For Hermes:** Use the `subagent-driven-development` skill to implement this plan task-by-task.

**Goal:** Add 9Router as a secure, first-class RSemble provider for model discovery,
streaming candidate generation, judging, and fusion.

**Architecture:** The browser uses the existing RSemble localhost bridge. The bridge
forwards only `GET /v1/models` and `POST /v1/chat/completions` to a server-configured
9Router upstream. A 9Router adapter reuses the OpenAI-compatible provider factory with
optional-key and catalog-probe readiness support; pipeline code remains unchanged.

**Tech stack:** React 18, TypeScript, Vite, Node `http`, Vitest, existing provider
registry and SSE parser. No new runtime dependency.

**Companion spec:** `docs/specs/archive/9router-support/9router-support-spec.md`

---

## Implementation constraints

- Work one phase at a time and run the named gate before committing.
- Re-read `git status` and shared files before each phase. The repository currently has
  concurrent uncommitted UI/live-transcript/attachment work; never reset or overwrite it.
- Never use or record a real 9Router key in tests, docs, commits, logs, or screenshots.
- Do not modify `pipeline.ts`, judge/fusion prompts, run semantics, or 9Router's own config.
- Do not expose arbitrary `/9router/*` or management endpoints.
- Do not push or merge without explicit user permission.

## Milestone map

| Phase | Deliverable | Main gate |
|---|---|---|
| 0 | Authority docs aligned | docs review |
| 1 | Hardened bridge route | server tests + server typecheck |
| 2 | Optional-key compatible adapter behavior | targeted provider tests |
| 3 | 9Router adapter + registry | adapter/registry tests |
| 4 | Connections and model/critic selectors | component tests |
| 5 | Persistence, integration, and full QA | `npm run check` + browser QA |

---

## Phase 0 — Lock product and provider authority

### Task 0.1: Update product scope

**Files:**
- Modify: `PRODUCT.md`
- Modify: `PROVIDERS.md`
- Modify: `DECISIONS.md`
- Modify: `.env.example`

**Steps:**

1. Add 9Router to PRODUCT's requested provider list. State that it is one provider
   adapter; its internal fallback does not alter RSemble's fanout spine.
2. Update PROVIDERS' provider table, architecture diagram, environment table,
   readiness rules, registry order, and implementation checklist.
3. Add the decision from spec §12: RSemble consumes but does not reproduce the 9Router
   control plane; the bridge uses a fixed environment-configured upstream.
4. Add placeholder-only entries:

```dotenv
# Optional 9Router API key (blank is valid when 9Router requireApiKey=false)
# VITE_9ROUTER_KEY=sk-your-local-router-key

# 9Router upstream used by the local RSemble bridge
# RSEMBLE_9ROUTER_URL=http://127.0.0.1:20128
```

5. Review docs for stale statements that only three providers are allowed.

**Verification:** No production code changes in this phase; links and names match the
companion spec exactly.

**Commit:** `docs: specify 9router provider support`

---

## Phase 1 — Add the allowlisted 9Router bridge proxy

### Task 1.1: Write proxy safety tests first

**Files:**
- Create: `server/tests/nine-router.test.ts`
- Modify: `server/tests/bridge.test.ts`

**Tests to add:**

1. `GET /9router/v1/models` maps to `<upstream>/v1/models` and preserves a safe query.
2. `POST /9router/v1/chat/completions` forwards JSON and streams response bytes.
3. Blank incoming Authorization is omitted upstream.
4. A supplied Bearer header is forwarded unchanged but never appears in errors.
5. `PUT`, `PATCH`, and `DELETE` return 405 without calling upstream.
6. `/9router/api/settings`, `/9router/api/health`, path traversal encodings, and unknown
   `/9router/*` paths return 404 without calling upstream.
7. `text/plain`, hostile Origin, and oversized POST bodies fail before upstream fetch.
8. An upstream redirect to another origin is rejected and receives no follow-up request.
9. Invalid `RSEMBLE_9ROUTER_URL` protocols (`file:`, `javascript:`) fail configuration.
10. Client disconnect/abort reaches the upstream signal.

**Run:**

```bash
npm test -- server/tests/nine-router.test.ts server/tests/bridge.test.ts
```

**Expected:** New tests fail because no 9Router route exists.

### Task 1.2: Implement upstream configuration and proxy wrapper

**Files:**
- Create: `server/codex-bridge/nine-router.ts`
- Modify: `server/codex-bridge/umans.ts`

**Contract:**

```ts
export interface NineRouterProxyDeps {
  upstream?: string;
  upstreamTimeoutMs?: number;
  maxBodyBytes?: number;
}

export function configuredNineRouterUpstream(): string;
export function handleNineRouterProxy(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathWithQuery: string,
  deps?: NineRouterProxyDeps,
): Promise<void>;
```

Implementation rules:

- Default upstream is `http://127.0.0.1:20128`.
- Parse with `URL`; allow only `http:` or `https:`; strip trailing `/`.
- Error text identifies invalid configuration but excludes credentials and request headers.
- Reuse `handleOpenAICompatibleProxy`; do not duplicate streaming/backpressure code.
- Change the shared proxy header construction so an absent/blank incoming Authorization
  header is omitted rather than sent as an empty string.
- Set `redirect: "manual"`; treat 3xx as an upstream error rather than following with
  credentials.

### Task 1.3: Register exact bridge routes

**Files:**
- Modify: `server/codex-bridge/index.ts`

Use exact `pathName` checks before invoking the handler:

```ts
const isNineRouterModels = pathName === "/9router/v1/models";
const isNineRouterChat = pathName === "/9router/v1/chat/completions";
```

- Models accepts GET only.
- Chat completions accepts POST only and requires JSON.
- Unsupported `/9router/*` paths are not handled by a prefix-wide generic proxy.
- Preserve `url.search` only after the exact path is accepted.

**Verification:**

```bash
npm test -- server/tests/nine-router.test.ts server/tests/bridge.test.ts server/tests/umans.test.ts server/tests/clinepass.test.ts
npm run typecheck:server
```

**Expected:** All targeted tests pass; existing compatible proxies retain behavior.

**Commit:** `feat: add hardened 9router bridge proxy`

---

## Phase 2 — Generalize the OpenAI-compatible adapter safely

### Task 2.1: Add failing optional-key tests

**Files:**
- Modify: `src/lib/providers/openai-compat.test.ts`

Add cases proving:

1. Existing adapters remain key-required by default.
2. Optional-key config calls `/models` with no Authorization header when blank.
3. Optional-key `testConnection("")` performs a real catalog probe.
4. Catalog-probe readiness distinguishes network, HTTP/auth, and malformed-schema failure.
5. A nonblank key produces exactly `Authorization: Bearer <key>`.
6. Completion, streaming, and listModels still use the same model IDs and request bodies.

**Run:**

```bash
npm test -- src/lib/providers/openai-compat.test.ts
```

**Expected:** New tests fail before implementation.

### Task 2.2: Extend the factory without changing defaults

**Files:**
- Modify: `src/lib/providers/openai-compat.ts`

Extend config with explicit defaults:

```ts
export interface OpenAICompatConfig {
  // existing fields...
  apiKeyRequired?: boolean;              // default true
  readinessProbe?: "credential" | "models"; // default credential
}
```

Refactor one shared model-probe helper used by `testConnection`, async readiness in
`models` mode, and `listModels`. Requirements:

- Build Authorization only for a non-empty key.
- `apiKeyRequired !== false` preserves current missing-key messages and sync readiness.
- `apiKeyRequired: false` accepts blank keys.
- `readinessProbe: "models"` returns an async `ProviderReadiness` with specific failure
  reasons and validates that `data` or `models` is an array.
- `listModels` remains user-safe and returns `[]` on failure, but must not be the only
  source of readiness diagnostics.
- Do not leak raw headers or keys into errors.

**Verification:**

```bash
npm test -- src/lib/providers/openai-compat.test.ts src/lib/providers/connection-tests.test.ts
npm run typecheck:web
```

**Commit:** `refactor: support optional-key compatible providers`

---

## Phase 3 — Add the 9Router provider adapter and registry entry

### Task 3.1: Write adapter contract tests

**Files:**
- Create: `src/lib/providers/nine-router.test.ts`

Tests:

- provider identity is `9router` / `9Router`;
- paths use the RSemble bridge, never direct browser traffic to port 20128;
- blank-key readiness/test works through `/9router/v1/models`;
- key comes from `VITE_9ROUTER_KEY`, then `rsemble.key.9router` fallback;
- namespaced and combo IDs round-trip unchanged;
- duplicate/malformed catalog entries are handled deterministically;
- completion and SSE streaming map through existing OpenAI wire format;
- 401/400/503 details become `ProviderError` with `providerId: "9router"`;
- abort propagates.

### Task 3.2: Implement and register the adapter

**Files:**
- Create: `src/lib/providers/nine-router.ts`
- Modify: `src/lib/providers/types.ts`
- Modify: `src/lib/providers/registry.ts`

Adapter configuration:

```ts
createOpenAICompatProvider({
  id: "9router",
  label: "9Router",
  baseUrl: getBridgeUrl(),
  envKey: "VITE_9ROUTER_KEY",
  storageKey: "rsemble.key.9router",
  modelsPath: "/9router/v1/models",
  completionsPath: "/9router/v1/chat/completions",
  apiKeyRequired: false,
  readinessProbe: "models",
});
```

Add 9Router last in `listProviders()` to preserve existing stable order.

### Task 3.3: Close exhaustive type seams

**Files:**
- Modify: `src/rsemble.tsx`
- Modify: `src/lib/preferences.ts`
- Modify their existing tests

Add `9router` to every exhaustive `Record<ProviderId, ...>`, persisted-ID validation,
and readiness initializer. Do not change default seed slots or default critic.

**Verification:**

```bash
npm test -- src/lib/providers/nine-router.test.ts src/lib/preferences.test.ts src/lib/provider-probes.test.ts
npm run typecheck:web
```

**Commit:** `feat: register 9router provider adapter`

---

## Phase 4 — Add Connections, candidate, and critic UX

### Task 4.1: Connections card with Test-before-Save behavior

**Files:**
- Modify: `src/ui/ConnectionsModal.tsx`
- Modify: `src/ui/ConnectionsModal.test.tsx`

Add descriptor, status/key initializers, optional-key copy, and setup hint. Tests prove:

- Test calls the adapter with the unsaved input and does not call `localStorage.setItem`;
- Save persists only after the explicit Save click;
- saving blank is permitted and refreshes readiness;
- a 401 is rendered accessibly without exposing the key;
- loading/testing states prevent conflicting actions.

### Task 4.2: Candidate model selector

**Files:**
- Modify: `src/ui/ModelList.tsx`
- Add or modify its component test

- Add `9router: "9Router"` to labels and provider options.
- Treat namespaced models, aliases, and combo IDs as opaque; accept any non-empty manual
  9Router ID and let the router validate it.
- Prefer catalog-backed IDs when available, but do not invent slash rules that reject aliases or combos.
- Make seven provider controls usable at 390px using horizontal scrolling or wrapping.
- Preserve keyboard navigation and 44px targets.

### Task 4.3: Critic selector

**Files:**
- Modify: `src/ui/JudgeConfig.tsx`
- Modify: `src/ui/JudgeConfig.test.tsx`

Add 9Router to badge/options and apply the same responsive provider-control behavior.
Verify a 9Router catalog model can be selected as critic in both Rank and Fuse state.

**Verification:**

```bash
npm test -- src/ui/ConnectionsModal.test.tsx src/ui/JudgeConfig.test.tsx
npm run typecheck:web
```

Render-check at 1440×1000 and 390×844 before committing.

**Commit:** `feat: expose 9router in provider controls`

---

## Phase 5 — End-to-end behavior, docs, and release gate

### Task 5.1: Integration tests across RSemble's pipeline

**Files:**
- Modify: `src/lib/run-controller.test.ts`
- Modify: `src/studio-engine.test.ts`
- Modify: `server/tests/bridge.test.ts` if final boundary coverage is missing

Add scenarios:

1. OpenRouter candidate + 9Router candidate complete in one fanout.
2. 9Router is the Rank critic.
3. 9Router is the Fuse synthesizer.
4. 9Router 503 fails one candidate while two other usable candidates still fuse.
5. Abort during a 9Router stream leaves no post-abort candidate deltas.
6. Persist/restore keeps `providerId: "9router"` and exact slug.

Do not make a paid/live model call in automated tests.

### Task 5.2: Local smoke test with fake-safe diagnostics

Prerequisites controlled by the user:

- 9Router process running;
- at least one configured chat model;
- optional local API key available without placing it in command history.

Manual checks:

1. Connections Test with current unsaved value.
2. Save, close, and reopen Connections.
3. Discover a model such as `ag/gemini-3.1-pro-low` if present in the user's catalog.
4. Run it beside one non-9Router model and inspect live streaming.
5. Use a 9Router model as judge in Rank.
6. Use a 9Router model as synthesizer in Fuse.
7. Stop 9Router and confirm the UI shows a specific unavailable reason.
8. Restart it and confirm Refresh restores readiness/catalog.

No prompt, response, header, or credential from the live smoke test is committed.

### Task 5.3: Full gate and visual QA

Run:

```bash
npm run check
git diff --check
```

Expected:

- all tests pass;
- web and server typechecks pass;
- production build passes;
- no whitespace errors;
- no new dependency or audit issue;
- provider controls and Connections remain operable at desktop and mobile widths.

Review the final diff for accidental changes to the concurrent attachment/live-transcript
work before committing.

**Commit:** `test: verify 9router provider integration`

---

## Test inventory

New files:

```text
server/codex-bridge/nine-router.ts
server/tests/nine-router.test.ts
src/lib/providers/nine-router.ts
src/lib/providers/nine-router.test.ts
```

Expected modified files:

```text
PRODUCT.md
PROVIDERS.md
DECISIONS.md
.env.example
server/codex-bridge/index.ts
server/codex-bridge/umans.ts
server/tests/bridge.test.ts
src/lib/providers/openai-compat.ts
src/lib/providers/openai-compat.test.ts
src/lib/providers/types.ts
src/lib/providers/registry.ts
src/lib/preferences.ts
src/lib/preferences.test.ts
src/rsemble.tsx
src/ui/ConnectionsModal.tsx
src/ui/ConnectionsModal.test.tsx
src/ui/ModelList.tsx
src/ui/JudgeConfig.tsx
src/ui/JudgeConfig.test.tsx
src/lib/run-controller.test.ts
src/studio-engine.test.ts
```

`pipeline.ts` should not change.

## Rollback

The feature is additive. To disable it without disturbing other providers:

1. Remove `9router` from registry/provider selectors while leaving the bridge route inert.
2. Remove the adapter and exhaustive union entries in one compile-checked commit.
3. Remove `/9router/*` bridge routes and proxy wrapper.
4. Retain the docs decision or mark it reverted with rationale; do not silently delete
   security history.

Existing persisted data containing `providerId: "9router"` must be handled before a
rollback release: ignore those slots with a visible unsupported-provider warning rather
than coercing them to OpenRouter.
