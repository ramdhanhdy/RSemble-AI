# 9Router Provider Support Specification

> Feature: use a local or explicitly configured 9Router instance as a first-class
> RSemble provider for candidate generation, judging, and fusion.
> Authority hierarchy: `PRODUCT.md` > `PROVIDERS.md` > `UI.md` / `DESIGN.md`.
> This specification requires the authority-document updates in §12 before code ships.

---

## 1. Problem

RSemble can compare models exposed by several direct providers, but it cannot use the
models, aliases, account fallbacks, or combo models already configured in 9Router.
A user must duplicate provider credentials in RSemble or choose a different harness,
even though 9Router exposes a standard OpenAI-compatible API.

9Router support is a **provider integration**, not a new routing system inside RSemble.
RSemble retains its single pipeline:

```text
Task → Rubric → Compare (N model slots) → Judge → Rank / Fuse
```

A model slot with `providerId: "9router"` delegates one completion to 9Router. Any
provider/account/combo fallback within that request remains owned by 9Router.

## 2. Goals

- Register `9router` as a first-class `ProviderId` available to candidate slots and the critic.
- Discover chat models from 9Router's OpenAI-compatible `GET /v1/models` endpoint.
- Preserve returned model IDs exactly, including namespaced IDs such as `ag/gemini-3.1-pro-low` and combo IDs.
- Support non-streaming and SSE streaming chat completions through `POST /v1/chat/completions`.
- Support both 9Router configurations: API-key authentication enabled and local authentication disabled.
- Keep Test and Save as distinct states: testing an unsaved key must not persist it.
- Route browser traffic through RSemble's localhost bridge to avoid browser CORS assumptions and keep the 9Router endpoint server-configured.
- Preserve mixed-provider runs, retries, aborts, partial-failure behavior, Rank, and Fuse.

## 3. Non-goals

| Out of scope | Reason |
|---|---|
| Reimplementing 9Router fallback, account rotation, aliases, combos, quota tracking, or pricing | 9Router already owns these concerns. RSemble consumes its API. |
| Managing 9Router provider accounts or OAuth from RSemble | Configuration stays in the 9Router dashboard. |
| Exposing arbitrary 9Router management routes under `/api/*` | Unnecessary and expands the bridge's security surface. |
| A user-editable upstream URL sent in each browser request | This would create an SSRF-capable local proxy. The upstream is process configuration only. |
| 9Router image, audio, embedding, search, fetch, or video endpoints | This phase supports chat/LLM comparison only. |
| Importing 9Router usage analytics into RSemble | Separate concern; 9Router remains the usage authority. |
| Treating one 9Router combo as multiple RSemble candidates | One requested model ID produces one candidate, regardless of internal fallback. |
| Automatic installation or startup of 9Router | RSemble reports an unavailable service and gives setup guidance. |
| A provider-specific workflow or new finish mode | Rank/Fuse remains the only finish switch. |

## 4. External API contract

Authoritative 9Router sources describe an OpenAI-compatible service, normally at
`http://127.0.0.1:20128`:

| Purpose | Upstream request | Response used by RSemble |
|---|---|---|
| Health/setup diagnosis | `GET /api/health` | Optional operational diagnosis only; not proxied in v1. |
| Chat catalog | `GET /v1/models` | `{ object: "list", data: [{ id, name?, owned_by?, kind? }] }` |
| Completion | `POST /v1/chat/completions` | OpenAI-style `choices[0].message.content` |
| Streaming completion | `POST /v1/chat/completions` with `stream: true` | SSE content deltas and `[DONE]` |

Model IDs from `data[].id` are opaque provider-native identifiers. RSemble must not
split, rewrite, de-prefix, or infer an upstream provider from them. `owned_by` and
`kind` may inform display/filtering later but are not required by `CatalogModel` v1.
The default `/v1/models` endpoint is the chat/LLM catalog; service-kind endpoints such
as `/v1/models/image` are not queried.

Expected upstream error meanings:

- `401`: 9Router requires a key and the supplied key is missing or invalid.
- `400` with invalid model: the selected ID is no longer in the catalog or malformed.
- `503`: all configured accounts/routes are currently unavailable.

RSemble surfaces the upstream message through `ProviderError`; it does not perform a
second provider fallback because that would duplicate 9Router policy.

## 5. Transport architecture

```text
RSemble browser
  ├─ GET  http://127.0.0.1:8787/9router/v1/models
  └─ POST http://127.0.0.1:8787/9router/v1/chat/completions
                 │
                 ▼
RSemble localhost bridge (origin-checked, body-limited, route-allowlisted)
                 │
                 ▼
RSEMBLE_9ROUTER_URL (default http://127.0.0.1:20128)
  ├─ GET  /v1/models
  └─ POST /v1/chat/completions
```

### 5.1 Why the bridge is required

9Router may run locally or remotely and is not required to provide browser CORS for
RSemble's origin. A direct browser integration would also make an endpoint field part
of client state. The existing RSemble bridge already provides localhost binding,
origin allowlisting, JSON-only POST enforcement, body limits, disconnect propagation,
and SSE backpressure.

This does **not** move 9Router credentials into server storage. The browser reads the
key from the existing environment/local-storage mechanism and sends it as an
Authorization header to the local bridge. The bridge forwards it for that request and
must never log or persist it.

### 5.2 Upstream configuration

- Server environment: `RSEMBLE_9ROUTER_URL`
- Default: `http://127.0.0.1:20128`
- Accepted schemes: `http:` and `https:` only.
- Normalize by removing trailing slashes.
- Invalid URLs fail bridge startup with a redacted configuration error.
- The browser cannot override the upstream URL.
- Documentation may use `[REDACTED]` placeholders only; no real keys in fixtures or logs.

### 5.3 Proxy allowlist

Only these method/path pairs are accepted:

- `GET /9router/v1/models`
- `POST /9router/v1/chat/completions`
- `OPTIONS` for an allowlisted browser origin

All other `/9router/*` routes return JSON `404`; unsupported methods return `405`.
POST requires `Content-Type: application/json`; the normal bridge request-size limit
applies. Query parameters on `/v1/models` may be preserved, but cannot change the host
or path family.

## 6. Provider contract

`src/lib/providers/types.ts` extends:

```ts
export type ProviderId =
  | "openrouter"
  | "chatgpt-codex"
  | "gemini"
  | "commandcode"
  | "clinepass"
  | "umans"
  | "9router";
```

The adapter is registered as:

```ts
{
  id: "9router",
  label: "9Router"
}
```

Configuration:

| Item | Value |
|---|---|
| Browser bridge base | `VITE_CODEX_BRIDGE_URL`, default `http://127.0.0.1:8787` |
| Browser key environment | `VITE_9ROUTER_KEY` |
| Browser key storage | `rsemble.key.9router` |
| Models path | `/9router/v1/models` |
| Chat path | `/9router/v1/chat/completions` |
| Upstream server environment | `RSEMBLE_9ROUTER_URL` |

### 6.1 Optional authentication

A blank key is valid when the user's 9Router setting `requireApiKey` is disabled.
Therefore, the generic OpenAI-compatible adapter must support an **optional-key** mode:

- omit the `Authorization` header entirely when the key is blank;
- never send `Authorization: Bearer `;
- in optional-key mode, readiness is established by an authenticated model-catalog
  probe rather than by checking key length;
- `testConnection("")` still probes `/v1/models` and may succeed;
- when auth is required, the resulting 401 is shown as the test/readiness reason.

All existing providers remain key-required by default. The generic factory's default
behavior must be byte-for-byte unchanged except for omitting an impossible empty
Authorization header.

### 6.2 Readiness

`9routerProvider.readiness()` is async and returns ready only when:

1. RSemble's bridge is reachable;
2. the bridge can reach the configured 9Router service;
3. `GET /v1/models` succeeds with the currently saved/environment key; and
4. the response has a valid `data` array (the array may be empty).

Failure copy distinguishes:

- RSemble bridge unavailable;
- 9Router unavailable at the configured server endpoint;
- authentication rejected;
- malformed catalog response.

## 7. Model discovery and selection

- `listModels()` maps every valid string `data[].id` to `CatalogModel` with
  `providerId: "9router"` and `name: item.name ?? item.id`.
- Duplicate IDs are deduplicated by exact ID; first occurrence wins.
- Catalog order is deterministic (case-insensitive ID sort), matching existing adapters.
- A catalog failure returns `[]` to the picker but readiness retains the actual failure reason.
- Raw slug entry remains available. For 9Router, any non-empty manual ID is accepted
  because provider-prefixed models, aliases, and combo IDs are opaque router-native strings;
  9Router remains the authority that validates the ID.
- Candidate and critic selectors both include 9Router.
- Provider tabs must remain usable at desktop and 390px mobile width. Adding a seventh
  provider must use wrapping or horizontal scrolling rather than compressing labels into
  unreadable buttons.
- The display provider is `9Router`; the model slug remains the exact router ID.
- A 9Router model can be used for candidates, judge, fusion, or any combination.

## 8. Completion behavior

The adapter uses the existing `ChatOptions` without adding routing fields:

```ts
{
  model: "ag/gemini-3.1-pro-low",
  messages,
  temperature,
  max_tokens: maxTokens,
  stream
}
```

No 9Router-specific prompt changes enter `pipeline.ts`. The shared SSE reader handles
content deltas. Abort signals propagate browser → bridge → 9Router request. A client
disconnect aborts the upstream fetch. Non-streaming judge/fusion responses use
`choices[0].message.content` and reject empty content.

A 9Router request failing during mixed fanout marks only that candidate as failed.
Existing RSemble policy applies: Rank/Fuse may continue when enough usable candidates
remain, and Fuse requires at least two usable responses.

## 9. Connections UX

Connections adds a data-driven 9Router card:

- Label: `9Router`
- Subtitle: `via 127.0.0.1:8787 → 9Router`
- Description: one local/remote gateway with 9Router-managed models and fallback.
- Key label/placeholder clearly says the key is optional when 9Router auth is disabled.
- Setup hint: start 9Router separately and configure providers in its own dashboard.
- **Test** probes using the current unsaved input and never writes local storage.
- **Save** persists the trimmed value (including an intentionally blank value), refreshes
  readiness/catalog, and uses existing local-only key copy.
- Test and Save remain distinct visually and behaviorally.

The UI never displays or logs the key. Error messages must not include request headers,
URLs containing credentials, 9Router database paths, or raw upstream response bodies
that could echo secrets.

## 10. Persistence and history

Existing structures already preserve `providerId` and native slug in model slots,
critic references, candidates, telemetry keys, preferences, and run history. Required
work is exhaustive-union support, not a schema redesign:

- add `9router` to all `Record<ProviderId, ...>` values and validation sets;
- preserve `modelKey("9router", slug)` separation from direct-provider runs;
- tolerate old persisted preferences without 9Router;
- never rewrite an existing slot to 9Router automatically;
- do not persist the upstream base URL in browser preferences.

## 11. Security requirements

1. Bridge remains bound to `127.0.0.1`.
2. Existing exact-origin allowlist applies before proxy routing.
3. No-Origin local clients remain supported.
4. Only the two inference routes in §5.3 are exposed.
5. Upstream host is environment-controlled; no request parameter can alter it.
6. Only `http:`/`https:` upstream schemes are accepted.
7. Authorization is forwarded per request but never logged, cached, or written to disk.
8. POST is JSON-only and body-limited before upstream fetch.
9. Upstream redirects must not cause credentials to be forwarded to a different origin;
   use `redirect: "manual"` or reject cross-origin redirects.
10. Tests use fake keys such as `[REDACTED]`, never real credentials.
11. 9Router's own request logger can contain sensitive prompts/headers when enabled;
    RSemble documentation warns users but does not manage that setting.

## 12. Authority-document updates

Before implementation is considered shippable:

- `PRODUCT.md` IN scope adds 9Router as a requested provider adapter and clarifies the
  existing localhost bridge also supports allowlisted compatible-provider proxies.
- `PROVIDERS.md` adds `9router` to the provider set, transport table, environment table,
  readiness behavior, and phase checklist. It must distinguish RSemble fanout from
  9Router's internal fallback.
- `DECISIONS.md` records: 9Router is an external routing provider; RSemble does not
  reproduce its control plane; bridge upstream is server-configured to prevent SSRF.
- `.env.example` documents `VITE_9ROUTER_KEY` and `RSEMBLE_9ROUTER_URL` using placeholders.

## 13. Acceptance criteria

1. With local 9Router running and auth disabled, Test succeeds with a blank key and no
   Authorization header is sent upstream.
2. With auth required, an unsaved valid key can be tested successfully without being
   persisted; an invalid key shows the upstream 401 reason.
3. Saving a key and reopening Connections restores it only from the established local
   credential mechanism; the UI never renders it as plain text.
4. Catalog discovery displays namespaced IDs and combo IDs exactly as returned.
5. A 9Router candidate streams visibly and completes in a mixed-provider run.
6. A 9Router model can act as Rank judge and Fuse synthesizer.
7. Cancelling a run aborts the upstream request and does not leave an active stream.
8. A 503 from 9Router fails only the affected candidate and preserves existing partial-
   failure fusion behavior.
9. Hostile origins, non-JSON POSTs, oversized bodies, unsupported methods, and arbitrary
   `/9router/*` paths are rejected before any upstream call.
10. A configured upstream URL cannot be overridden through request path, query, header,
    or body.
11. Existing provider request snapshots and all current tests remain green.
12. Candidate and critic provider controls remain readable and operable at 1440×1000 and
    390×844.
13. `npm run check` passes.

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Browser cannot reach 9Router due to CORS | Always use RSemble's localhost bridge. |
| Optional auth is mistaken for missing configuration | Probe `/v1/models`; do not use key length as 9Router readiness. |
| Bridge becomes a generic SSRF proxy | Server-only fixed upstream plus exact method/path allowlist. |
| 9Router internally changes provider during fallback | Treat router model ID as one candidate and label it honestly as 9Router; do not claim a direct upstream provider. |
| Combo/catalog IDs are rewritten or split | IDs are opaque strings and round-trip unchanged. |
| Seven provider tabs break mobile layout | Add responsive wrap or horizontal scrolling and browser-test both selectors. |
| Duplicate retry policy causes long delays | RSemble performs no provider fallback; 9Router owns internal retry/fallback. |
| Remote 9Router sends redirect to another host | Reject cross-origin redirects before forwarding credentials. |
| Concurrent attachment/live-transcript work changes shared UI files | Rebase/re-read before implementation; do not overwrite uncommitted work. |

## 15. Source references

- 9Router docs: `https://docs.9router.com/`
- 9Router integration skill: `https://github.com/decolua/9router/blob/master/skills/9router/SKILL.md`
- 9Router architecture: `https://github.com/decolua/9router/blob/master/docs/ARCHITECTURE.md`
- RSemble provider contract: `src/lib/providers/types.ts`
- Shared compatible adapter: `src/lib/providers/openai-compat.ts`
- RSemble bridge routing: `server/codex-bridge/index.ts`
- Shared hardened proxy: `server/codex-bridge/umans.ts`
