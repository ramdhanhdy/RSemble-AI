# PROVIDERS.md — Multi-provider support

> **Technical + product spec for widening RSemble beyond OpenRouter-only.**
> Authority: [`PRODUCT.md`](./PRODUCT.md) still defines *what the product is*.
> This file defines *how models are reached*. If anything here conflicts with
> PRODUCT.md's spine (fanout → Judge → Rank/Fuse), PRODUCT.md wins.
>
> Scope decision: [`DECISIONS.md`](./DECISIONS.md) #4.
> Implementation checklist: §12 (phases) in this file.

---

## 1. One sentence

**RSemble keeps one pipeline; each model slot routes through a pluggable
provider adapter (OpenRouter, ChatGPT-via-Codex, Gemini AI Studio, and future
peers) instead of a single hard-wired OpenRouter client.**

---

## 2. Why this exists

Today every live call goes through `src/lib/openrouter.ts`. That works, but it
couples the product to one billing surface and one catalog. The builder already
has (or wants):

| Resource | Auth | Why it matters |
|---|---|---|
| **OpenRouter** | API key | Broad multi-vendor catalog; current default |
| **ChatGPT subscription** | Codex OAuth (`codex login` → local credential cache) | Use Plus/Pro/Codex plan entitlements without Platform pay-as-you-go |
| **Gemini (Google AI Studio)** | API key | Direct Google models, separate quota/billing |
| **Other model resources** | Per-adapter | Same registry slot; add without touching the pipeline |

The job is still Rank/Fuse. Multi-provider only answers: *where do tokens come from?*

---

## 3. Goals and non-goals

### Goals

1. **Mixed-provider runs** — one fanout can include slots from different providers
   (e.g. OpenRouter DeepSeek + Codex GPT + Gemini Flash).
2. **Stable pipeline** — `pipeline.ts` prompt construction, judge parsing, and
   fusion stay provider-agnostic. Only transport changes.
3. **Uniform adapter contract** — every provider implements the same
   completion + optional stream + optional catalog surface.
4. **Honest readiness** — Run is enabled only when every *enabled* slot (and the
   judge) has a ready provider.
5. **Local/personal first** — optimized for the single builder on their machine
   (PRODUCT.md §7). Not a multi-tenant SaaS.
6. **Extensible registry** — adding a fourth provider is a new adapter file +
   registry entry, not a rewrite of `rsemble.tsx`.

### Non-goals (explicit)

| Out | Why |
|---|---|
| Anthropic (or any vendor not listed in §4) as a planned adapter | Not requested; do not pre-build |
| ChatGPT web scraping / unofficial chat.openai.com session hijack | Wrong surface; Codex auth is the supported subscription path |
| Using Platform `api.openai.com` with a normal API key *as* the "ChatGPT subscription" provider | Different product (pay-as-you-go). May be a later optional peer; not this provider |
| Hosted multi-user proxy that bills one person's ChatGPT plan for strangers | ToS + security; personal local use only |
| Full Python backend / SQLite / public REST API | Still OUT per PRODUCT.md §5 |
| Provider-specific prompt dialects in the UI | One message shape in the app; adapters translate |
| Cost dashboards, auto-routing, load balancing across keys | Platform chrome; out of focus |
| Replacing Rank/Fuse with provider-specific UX | The sole switch remains Rank/Fuse |

### Clarification: "local bridge" vs "Python backend"

PRODUCT.md cuts a **product backend** (datasets, benchmarks, multi-user API).
A **localhost-only Codex bridge** (thin Node process that reads `~/.codex/auth.json`
and proxies completions) is **in scope** for the ChatGPT subscription provider.
It is infrastructure for one auth method, not a second product surface.

---

## 4. Provider set (v1)

| `ProviderId` | Label (UI) | Auth | Transport | Catalog |
|---|---|---|---|---|
| `openrouter` | OpenRouter | `VITE_OPENROUTER_KEY` (or settings store) | `https://openrouter.ai/api/v1` chat completions + SSE | Live `GET /models` |
| `chatgpt-codex` | ChatGPT (Codex) | Codex login → `~/.codex/auth.json` (via local bridge) | Local bridge → Codex Responses backend | Bridge `GET /v1/models` (plan-eligible) |
| `gemini` | Gemini | Google AI Studio API key | `generativelanguage.googleapis.com` | ListModels API and/or curated fallback |

**Future peers** (not scheduled): any adapter implementing `LLMProvider`. Do not
name or stub vendors in code until requested.

---

## 5. Current state (baseline)

| Concern | Today |
|---|---|
| Client | `src/lib/openrouter.ts` — `chatCompletion`, `chatCompletionStream`, `listModels`, `extractJson`, `errorMessage` |
| Orchestration | `src/rsemble.tsx` imports OpenRouter directly |
| Slot model | `ModelSlot.{ provider, model, slug, enabled }` — `provider` is **display only**; `slug` is always an OpenRouter id (`org/model`) |
| Judge | `state.criticModel: string` — OpenRouter slug |
| Readiness | `hasApiKey()` → single OpenRouter key |
| Env | `.env` → `VITE_OPENROUTER_KEY` |
| Pipeline | Provider-agnostic messages; good to keep |

---

## 6. Architecture

### 6.1 Layering

```
┌─────────────────────────────────────────────────────────────┐
│  UI (ModelList, JudgeConfig, Connections / settings)        │
├─────────────────────────────────────────────────────────────┤
│  Orchestration (rsemble.tsx)                                │
│    runFanout / runJudge / runFusion                         │
│    resolve provider per slot → call adapter                 │
├─────────────────────────────────────────────────────────────┤
│  Domain (studio-data, studio-engine, pipeline)              │
│    messages, jobs, scores — no HTTP                         │
├─────────────────────────────────────────────────────────────┤
│  Provider registry                                          │
│    getProvider(id) → LLMProvider                            │
├──────────────┬─────────────────────┬────────────────────────┤
│ openrouter   │ chatgpt-codex       │ gemini                 │
│ (browser→OR) │ (browser→localhost  │ (browser→Google)       │
│              │   bridge→Codex)     │                        │
└──────────────┴─────────────────────┴────────────────────────┘
```

### 6.2 Target file layout

```
src/lib/
  llm-utils.ts                 # extractJson, errorMessage (provider-neutral)
  providers/
    types.ts                   # ProviderId, ChatMessage, ChatOptions, LLMProvider, CatalogModel
    registry.ts                # getProvider, listProviders, assertReady
    openrouter.ts              # moved from lib/openrouter.ts
    chatgpt-codex.ts           # client → local bridge
    gemini.ts                  # Google AI Studio
  pipeline.ts                  # unchanged contract; import ChatMessage from providers/types

server/                        # Node, local-only (Phase 2+)
  codex-bridge/
    index.ts                   # HTTP server, localhost bind
    auth.ts                    # read/refresh ~/.codex/auth.json
    responses.ts               # Codex Responses API + stream
    openai-compat.ts           # optional /v1/chat/completions façade
    models.ts                  # plan-eligible model list
```

Deprecate `src/lib/openrouter.ts` after the move: either delete or leave a
thin re-export for one phase, then remove.

### 6.3 Package / scripts (target)

```jsonc
// package.json (illustrative)
{
  "scripts": {
    "dev": "concurrently -k \"npm:dev:web\" \"npm:dev:bridge\"",
    "dev:web": "vite",
    "dev:bridge": "tsx server/codex-bridge/index.ts",
    "dev:web-only": "vite",          // OpenRouter + Gemini without Codex
    "build": "tsc -b && vite build"
  }
}
```

Bridge is **optional at runtime**: if the user never enables ChatGPT slots, they
can run `dev:web-only`. Default `dev` starts both for convenience.

---

## 7. Shared contracts

### 7.1 Types (`src/lib/providers/types.ts`)

```ts
export type ProviderId = "openrouter" | "chatgpt-codex" | "gemini";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  /** Provider-native model id (not namespaced). */
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface CatalogModel {
  id: string;
  name: string;
  providerId: ProviderId;
}

export type ProviderReadiness =
  | { ok: true }
  | { ok: false; reason: string };

export interface LLMProvider {
  readonly id: ProviderId;
  readonly label: string;

  /** Sync/async check: credentials + (for Codex) bridge reachability. */
  readiness(): ProviderReadiness | Promise<ProviderReadiness>;

  chatCompletion(opts: ChatOptions): Promise<string>;

  /**
   * Required for fanout live UI. Judge/fusion may use non-stream.
   * If a backend cannot stream, adapter may yield once with full text
   * (degraded UX) — document per provider; prefer real streaming.
   */
  chatCompletionStream(opts: ChatOptions): AsyncGenerator<string, void, unknown>;

  listModels?(signal?: AbortSignal): Promise<CatalogModel[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly providerId: ProviderId,
    public readonly status?: number
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
```

### 7.2 Registry rules

- `getProvider(id: ProviderId): LLMProvider` — throws if unknown id.
- `listProviders(): LLMProvider[]` — stable order: openrouter, chatgpt-codex, gemini.
- No singleton mutable "current provider." Routing is **per slot / per judge**.
- Adapters must not import React or studio state.

### 7.3 Domain model changes

```ts
// studio-data.ts

export interface ModelSlot {
  id: string;
  /** Routing key — which adapter handles this slot. */
  providerId: ProviderId;
  /** Display label, e.g. "OpenRouter", "OpenAI", "Google". */
  provider: string;
  /** Display model name. */
  model: string;
  /** Provider-native model id, e.g. "z-ai/glm-5.2", "gpt-5.4", "gemini-2.0-flash". */
  slug: string;
  enabled: boolean;
}

/** Judge / synthesizer target. */
export interface CriticRef {
  providerId: ProviderId;
  model: string; // native id
}
```

State:

- Replace `criticModel: string` with `critic: CriticRef` (or keep string *only*
  during a one-phase migration with a parser — prefer clean cut in Phase 1).
- `StudioState.models` becomes `CatalogModel[]` (multi-provider merge), not
  `OpenRouterModel[]`.

Seeds (`SEED_SLOTS`, `DEFAULT_CRITIC_*`): keep current OpenRouter defaults so
existing behavior is unchanged until the user adds other providers.

### 7.4 Fanout job

```ts
export interface FanoutJob {
  id: string;
  providerId: ProviderId; // NEW
  slug: string;
  displayName: string;
  provider: string;       // display
  accent: string;
  strategyLabel: string;
}
```

`buildFanoutJobs` copies `providerId` from each enabled slot.

### 7.5 Orchestration pattern

```ts
// Conceptual — rsemble.tsx
const provider = getProvider(job.providerId);
for await (const delta of provider.chatCompletionStream({
  model: job.slug,
  messages: draftMessages(...),
  temperature: s.temperature,
  signal,
})) {
  dispatch({ type: "CANDIDATE_DELTA", id: job.id, delta });
}

// Judge / fusion
const critic = getProvider(seed.critic.providerId);
const content = await critic.chatCompletion({
  model: seed.critic.model,
  messages: judgeMessages(...),
  temperature: 0.1,
});
```

Parallel fanout stays `Promise.all` over jobs; each job may hit a different
provider. Partial failure behavior unchanged (candidate error; ≥2 done required).

### 7.6 Readiness / `canRun`

```
canRun =
  !running
  && prompt.trim().length > 0
  && enabledSlots.length > 0
  && every enabled slot's provider.readiness().ok
  && critic provider.readiness().ok
```

UI:

- Global banner if *no* provider is ready (generalize today's NoKeyBanner).
- Per-slot / per-row warning if that slot's provider is not ready.
- Connections panel shows status per provider.

---

## 8. Provider specifications

### 8.1 OpenRouter (`openrouter`)

**Role.** Default, broadest catalog. Existing behavior under the new interface.

| Item | Spec |
|---|---|
| Base URL | `https://openrouter.ai/api/v1` |
| Auth | `Authorization: Bearer <key>` |
| Chat | `POST /chat/completions` |
| Stream | SSE `data:` lines; `choices[0].delta.content`; `[DONE]` |
| Catalog | `GET /models` → `{ id, name }` + `providerId: "openrouter"` |
| Headers | `Content-Type`, `X-Title: RSemble AI` (as today) |
| Key source | Phase 1: `import.meta.env.VITE_OPENROUTER_KEY`. Phase 4+: optional settings override |
| Errors | Map HTTP body `error.message` → `ProviderError` |

**Migration.** Move current `openrouter.ts` body into `providers/openrouter.ts`.
Behavior parity is the Phase 1 acceptance gate.

---

### 8.2 ChatGPT subscription via Codex (`chatgpt-codex`)

#### 8.2.1 What this is

OpenAI Codex clients support **Sign in with ChatGPT** for subscription-backed
access (as distinct from Platform API key pay-as-you-go). Official docs:
[Authentication (ChatGPT Learn)](https://learn.chatgpt.com/docs/auth).

After `codex login` (or IDE/desktop equivalent), credentials are cached locally
(default file: `~/.codex/auth.json`, or OS keyring per Codex config). ChatGPT
sign-in usage follows ChatGPT/Codex plan entitlements and workspace policy.

#### 8.2.2 Why a local bridge is required

| Constraint | Implication |
|---|---|
| Browser cannot read `~/.codex/auth.json` | Credentials stay on the machine via a local process |
| Codex subscription traffic uses the Codex backend, not a normal Platform key on `api.openai.com` | Bridge talks to the Codex Responses surface |
| Tokens expire and must refresh | Bridge owns refresh; browser only holds a session-to-localhost trust |
| CORS / secret exposure | Bridge binds **127.0.0.1 only**; never expose on LAN/WAN by default |

#### 8.2.3 User setup

1. Install Codex CLI (or use `npx @openai/codex`).
2. Run `codex login` → complete browser OAuth (Sign in with ChatGPT).
3. Confirm: `codex login status` shows ChatGPT auth (not only API key), if available.
4. Start RSemble (`npm run dev` includes bridge, or `npm run dev:bridge`).
5. In Connections: ChatGPT (Codex) shows **Connected** when bridge `/auth/status` is ok.
6. Add models from the Codex catalog or type a plan-eligible model id.

#### 8.2.4 Credential location (bridge)

| Platform | Default path |
|---|---|
| Windows | `%USERPROFILE%\.codex\auth.json` |
| macOS / Linux | `~/.codex/auth.json` |
| Override | `$CODEX_HOME/auth.json` if `CODEX_HOME` is set |

Bridge must handle:

- File missing → not logged in.
- Keyring-only storage (if user configured Codex keyring and no file) → document
  limitation in v1: **file store supported first**; keyring may require user to
  set `cli_auth_credentials_store = "file"` or we add keyring read later.
- Treat file contents as **password-equivalent**. Never log tokens. Never commit.

#### 8.2.5 Upstream protocol (bridge → OpenAI)

Implementation target (align with current Codex CLI behavior; verify against
live CLI if shapes drift):

| Item | Spec |
|---|---|
| Completion endpoint | Codex Responses backend (commonly `https://chatgpt.com/backend-api/codex/responses`) |
| Auth | `Authorization: Bearer <access_token>` from auth cache |
| Account header | Send ChatGPT account id header when required by backend (from id_token / auth payload) |
| Request shape | Responses API style (not classic chat-completions). Bridge translates from app messages |
| Stream | SSE or stream events as implemented by Codex backend; bridge normalizes to text deltas |
| Refresh | On near-expiry or HTTP 401: refresh via OpenAI OAuth token endpoint using cached `refresh_token`; write updated cache back to `auth.json` |
| Models | Subset eligible for Codex/ChatGPT plan — not full Platform catalog |

**Do not hardcode fragile client ids in the React bundle.** Keep OAuth client
details inside the bridge (or shell out to Codex for refresh if a stable CLI
path exists). Prefer: load tokens Codex already wrote; refresh the same way
Codex does; avoid inventing a second OAuth client if the cached refresh flow
suffices.

#### 8.2.6 Bridge HTTP API (browser → bridge)

Bind: `127.0.0.1` only. Default port: `8787` (configurable via env
`RSEMBLE_CODEX_BRIDGE_PORT`).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Process up |
| `GET` | `/auth/status` | `{ ok, authMode?, accountLabel?, plan?, lastRefresh?, error? }` — **no raw tokens** |
| `GET` | `/v1/models` | OpenAI-ish list or simplified `{ data: [{ id, name }] }` |
| `POST` | `/v1/chat/completions` | OpenAI-compatible façade (non-stream + `stream: true` SSE) so the web adapter stays simple |
| `POST` | `/v1/responses` | Optional native passthrough for debugging |

CORS: allow Vite origin only (`http://localhost:5173` and configured alternatives).

Optional shared secret: `RSEMBLE_BRIDGE_SECRET` header required if set (defense
in depth on shared machines).

#### 8.2.7 Web adapter (`chatgpt-codex.ts`)

| Item | Spec |
|---|---|
| Base URL | `import.meta.env.VITE_CODEX_BRIDGE_URL` default `http://127.0.0.1:8787` |
| Auth to bridge | None, or static secret header if configured |
| `readiness` | `GET /auth/status` → ok |
| `chatCompletion` / stream | `POST /v1/chat/completions` with native model id |
| `listModels` | `GET /v1/models` → tag `providerId: "chatgpt-codex"` |
| Failure UX | Distinguish: bridge down vs not logged in vs rate limit vs model not eligible |

#### 8.2.8 Scope and risk notes (document in README)

- **Personal local use.** Same class as embedding keys in a personal Vite app.
- **Not a hosted multi-user feature.** Deploying the bridge publicly would bill
  the operator's subscription for every visitor — forbidden by product intent.
- OpenAI documents ChatGPT sign-in for **Codex clients**. Third-party use of the
  same credential cache is a common local-tool pattern; treat as personal tooling.
  Prefer API keys for untrusted automation (per OpenAI's own CI guidance).
- Model availability and rate limits follow the user's ChatGPT/Codex plan
  (primary/secondary windows as exposed by backend headers, if we surface them later).
- Protocol can change when Codex CLI changes — bridge is the isolation layer.

#### 8.2.9 Out of scope for this provider

- Implementing full Codex agent loop, tools, or sandbox.
- Device-code enterprise flows beyond what we need for local login status messaging.
- Bundling or reverse-engineering the entire Codex CLI.

---

### 8.3 Gemini — Google AI Studio (`gemini`)

| Item | Spec |
|---|---|
| Base | `https://generativelanguage.googleapis.com` |
| Auth | API key from [Google AI Studio](https://aistudio.google.com) — query param or header per current Google docs |
| Key source | `VITE_GEMINI_KEY` and/or settings store (Phase 4) |
| Generate | `generateContent` (non-stream) for judge/fusion |
| Stream | `streamGenerateContent` (SSE or chunked) for fanout — map to text deltas |
| Message map | `system` → `systemInstruction`; `user`/`assistant` → `contents[]` with roles `user` / `model` |
| Model ids | e.g. `gemini-2.0-flash`, `gemini-2.5-pro` (verify against live ListModels) |
| Catalog | Prefer ListModels; fallback curated list if unauthenticated list is limited |
| Errors | Map Google error payload → `ProviderError` |

**CORS.** If browser calls to Google are blocked, options in order:

1. Document and test — many AI Studio keys work from browser for demos.
2. Vite dev proxy for local dev.
3. Extend the local bridge (or a tiny `gemini` route on the same localhost server)
   only if required — keep it thin.

Do not block Phase 3 on a full proxy if direct browser access works for the builder.

---

## 9. Configuration

### 9.1 Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `VITE_OPENROUTER_KEY` | Web → OpenRouter | Existing |
| `VITE_GEMINI_KEY` | Web → Gemini | New |
| `VITE_CODEX_BRIDGE_URL` | Web → bridge | Default `http://127.0.0.1:8787` |
| `RSEMBLE_CODEX_BRIDGE_PORT` | Bridge | Default `8787` |
| `RSEMBLE_BRIDGE_SECRET` | Bridge + web | Optional |
| `CODEX_HOME` | Bridge | Optional Codex override |

Update `.env.example` with commented placeholders. Never commit real secrets.

### 9.2 Settings UI (Phase 4)

Connections panel (command pane footer or header menu — keep chrome minimal):

| Row | Controls |
|---|---|
| OpenRouter | Key input (password), test, clear |
| ChatGPT (Codex) | Status badge, "How to connect" (`codex login` + bridge), refresh status |
| Gemini | Key input, test, clear |

Keys in settings may live in `localStorage` under `rsemble.providers.v1` for
personal convenience. Document XSS risk. Env vars remain the zero-UI path.

### 9.3 Vite note

`VITE_*` values are embedded in the client bundle. README already warns:
local/personal use only; shared deployment needs a server-side secret path.
Multi-provider does not change that rule.

---

## 10. UI / UX requirements

Follow [`DESIGN.md`](./DESIGN.md) and [`UI.md`](./UI.md). Multi-provider must not
turn the command pane into a platform console.

### 10.1 Model list

- Each row shows **provider badge** (short label or muted text) + model name.
- **Add model** flow:
  1. Choose provider (segmented control or select): OpenRouter | ChatGPT | Gemini.
  2. Search that provider's catalog (if ready) or enter native model id manually.
- Manual entry validation:
  - OpenRouter: prefer `org/model` (keep today's hint).
  - Codex / Gemini: non-empty native id; `/` not required.
- Disabled or not-ready provider: cannot add; tooltip explains why.
- Enabled slot whose provider becomes not-ready: row error state; excluded from
  effective `canRun` (or block run with clear message).

### 10.2 Judge config

- Provider select + model select/combobox (not a single OpenRouter slug field).
- Default remains current OpenRouter critic seed until user changes it.

### 10.3 Banners and empty states

| Condition | Message intent |
|---|---|
| No providers ready | Connect at least one provider to run |
| Bridge down, ChatGPT slots enabled | Start the Codex bridge / `npm run dev` |
| Not logged into Codex | Run `codex login`, then refresh status |
| Missing Gemini key | Add AI Studio key |
| Missing OpenRouter key | Existing copy, generalized |

### 10.4 Output pane

- Candidate cards already show `provider` display string — ensure it reflects
  real provider labels (OpenRouter / ChatGPT / Gemini), not only slug prefix.
- No provider-specific output layouts.

### 10.5 Rank/Fuse

Unchanged. Mode toggle remains the sole product switch. Provider choice is
configuration of the fanout, not a second mode.

---

## 11. Error handling, streaming, parity

| Stage | Stream? | On failure |
|---|---|---|
| Fanout (per candidate) | Yes | `CANDIDATE_FAILED` with `ProviderError` message; others continue |
| Judge | No (full JSON) | `JUDGE_FAILED` |
| Fusion | No | `FUSION_FAILED` |
| Abort | `AbortSignal` through adapters | User stop / unmount cancels in-flight where supported |

`errorMessage(err)` in `llm-utils.ts` handles `ProviderError`, `DOMException`
AbortError, and generic `Error`.

Streaming parity target: OpenRouter and Codex bridge SSE; Gemini stream API.
If Gemini stream is delayed, ship non-stream fanout for Gemini only with a
single full-text yield — mark as temporary in the phase notes.

---

## 12. Phase implementation plan

Guiding rules:

- One phase in progress at a time.
- Each phase leaves the app **runnable**.
- No provider-specific branches inside `draftMessages` / `judgeMessages` /
  `fusionMessages`.
- Do not add vendors beyond §4.

---

### Phase 0 — Spec lock (docs only)

**Goal.** Authority and fence updated before code.

- [ ] **0.1** Land `PROVIDERS.md` (this file).
- [ ] **0.2** Add `DECISIONS.md` #4 (multi-provider + Codex + Gemini; local bridge IN).
- [ ] **0.3** Update `PRODUCT.md` §5 IN table: multi-provider adapters + local Codex bridge.
- [ ] **0.4** Soften PRODUCT.md §5 OUT row for "Python backend…" so it does not
      forbid a localhost Node bridge (keep datasets/benchmarks/public API OUT).
- [ ] **0.5** Point `TODOS.md` / `CLAUDE.md` hierarchy at `PROVIDERS.md`.
- [ ] **0.6** README stub section "Providers (planned)" optional until Phase 2+.

**Exit.** Docs consistent; no code required.

---

### Phase 1 — Provider abstraction (OpenRouter only)

**Goal.** Zero user-visible behavior change; all calls go through the registry.

- [ ] **1.1** Add `src/lib/providers/types.ts` (`ProviderId`, `LLMProvider`, etc.).
- [ ] **1.2** Add `src/lib/llm-utils.ts` — move `extractJson`, `errorMessage` from
      openrouter; make errors provider-neutral (`ProviderError`).
- [ ] **1.3** Implement `src/lib/providers/openrouter.ts` (move current client).
- [ ] **1.4** Implement `src/lib/providers/registry.ts`.
- [ ] **1.5** Extend `ModelSlot` with `providerId`; set `"openrouter"` on all seeds
      and add-model paths.
- [ ] **1.6** Replace `criticModel: string` with `critic: CriticRef` (or migrate
      reducer + JudgeConfig in the same PR).
- [ ] **1.7** Update `buildFanoutJobs` to pass `providerId`.
- [ ] **1.8** Update `rsemble.tsx` to resolve providers per job / critic.
- [ ] **1.9** Update `studio-engine` catalog type to `CatalogModel[]`.
- [ ] **1.10** Remove or re-export-shim `src/lib/openrouter.ts`.
- [ ] **1.11** Typecheck clean; manual smoke: fanout stream, judge, fuse, rank toggle.

**Exit criteria.**

- Identical UX with only OpenRouter configured.
- No remaining direct OpenRouter imports outside `providers/openrouter.ts`
  (except temporary shim).
- `pipeline.ts` imports message types from `providers/types` or `llm-utils`, not
  openrouter-specific modules.

**Risk.** Reducer / localStorage shape if any critic slug persisted — grep and migrate.

---

### Phase 2 — Codex bridge + ChatGPT provider

**Goal.** ChatGPT subscription models usable in fanout and as judge via local bridge.

#### 2A — Bridge

- [ ] **2.1** Scaffold `server/codex-bridge/` (Node + TypeScript, ESM).
- [ ] **2.2** `auth.ts`: locate `auth.json`, parse safely, report status without
      leaking tokens.
- [ ] **2.3** Token refresh on expiry / 401; persist updated `auth.json`.
- [ ] **2.4** Responses client: non-stream completion → plain text.
- [ ] **2.5** Stream path → SSE compatible with OpenAI chat.completion.chunk
      *or* a documented simpler delta protocol the web adapter understands.
- [ ] **2.6** `GET /auth/status`, `GET /health`, `GET /v1/models`.
- [ ] **2.7** `POST /v1/chat/completions` façade (translate messages ↔ Responses).
- [ ] **2.8** Bind 127.0.0.1 only; CORS allowlist; optional bridge secret.
- [ ] **2.9** npm scripts: `dev:bridge`, compose into `dev`.
- [ ] **2.10** README: `codex login`, bridge, troubleshooting (not logged in /
      keyring-only / port in use).

#### 2B — Web adapter + UI minimum

- [ ] **2.11** `providers/chatgpt-codex.ts`.
- [ ] **2.12** Register in registry.
- [ ] **2.13** Model add: provider picker includes ChatGPT when bridge ready
      (or always listed with disabled state + reason).
- [ ] **2.14** Merge Codex models into catalog when status ok.
- [ ] **2.15** Seed optional example Codex slot **disabled by default** (or none —
      prefer none to avoid failed runs).
- [ ] **2.16** Readiness wiring for `canRun` and banners.
- [ ] **2.17** Manual test: mixed run (1 OpenRouter + 1 Codex), judge on either side,
      stream visible for both.

**Exit criteria.**

- With `codex login` + bridge up, user can complete Rank and Fuse using only
  Codex models, and mixed with OpenRouter.
- Bridge down → clear error; app still works for OpenRouter-only.
- Tokens never appear in browser network payloads (only localhost bridge calls).

**Risks.**

- Responses API shape drift → isolate in bridge.
- Keyring-only auth → document file-store requirement for v1.
- Rate limits / plan model allowlist → surface backend errors verbatim when useful.

---

### Phase 3 — Gemini (AI Studio)

**Goal.** Gemini as a third peer provider.

- [ ] **3.1** `providers/gemini.ts` — message mapping, generateContent.
- [ ] **3.2** Streaming for fanout (or documented single-yield fallback).
- [ ] **3.3** `listModels` + curated fallback.
- [ ] **3.4** `VITE_GEMINI_KEY` + `.env.example`.
- [ ] **3.5** Registry + ModelList + JudgeConfig + readiness.
- [ ] **3.6** CORS validation; add Vite proxy only if needed.
- [ ] **3.7** Manual test: Gemini-only run; mixed OpenRouter + Gemini; mixed all three
      if Codex available.

**Exit criteria.**

- Gemini slots stream (or accepted fallback) and judge/fuse work.
- Missing key disables Gemini readiness without breaking other providers.

---

### Phase 4 — Connections UX + catalog polish

**Goal.** Day-to-day usable multi-provider without editing `.env` for every change.

- [ ] **4.1** Connections UI (minimal, DESIGN.md-compliant).
- [ ] **4.2** Optional `localStorage` key store with clear/export-none.
- [ ] **4.3** Per-provider test connection actions.
- [ ] **4.4** Catalog merge UX: filter by provider; badges on rows.
- [ ] **4.5** Judge combobox searches across ready providers (grouped).
- [ ] **4.6** Persist last-used critic ref and slot list (if not already) without
      storing secrets in the same blob as prompts if avoidable.
- [ ] **4.7** Empty/error copy pass.
- [ ] **4.8** README: full multi-provider quickstart.

**Exit criteria.**

- Builder can configure all three providers from the UI and run mixed fanouts
  without reading the spec.

---

### Phase 5 — Hardening (optional, as needed)

- [ ] **5.1** Abort/cancel in-flight across providers.
- [ ] **5.2** Bridge: structured logs (no secrets), better refresh race handling.
- [ ] **5.3** Surface Codex quota headers in UI (subtle, RANK-adjacent) — only if
      low chrome cost.
- [ ] **5.4** Unit tests: message mappers (Gemini, Responses façade), readiness matrix.
- [ ] **5.5** Smoke script or Playwright happy path with mocks.
- [ ] **5.6** Revisit keyring support for Codex auth on Windows.

**Exit.** Confidence for daily driver use; still personal/local.

---

## 13. Testing strategy

| Layer | What |
|---|---|
| Typecheck | `npm run build` / `tsc -b` each phase |
| Manual matrix | See below |
| Unit | Pure mappers + `extractJson` + readiness pure helpers |
| Bridge integration | Real `codex login` on dev machine; do not CI with real tokens |
| Mocks | MSW or fetch mock for OpenRouter/Gemini in unit tests later |

### Manual test matrix (minimum)

| # | Scenario | Expect |
|---|---|---|
| M1 | OpenRouter only (Phase 1+) | Parity with today |
| M2 | No keys | Banner; cannot run |
| M3 | Codex only | Rank + Fuse |
| M4 | Bridge down, Codex slot on | Clear error; OpenRouter still works if configured |
| M5 | Not logged in Codex | Status not ok; instructions |
| M6 | Gemini only | Rank + Fuse |
| M7 | Mixed 3 providers fanout | ≥2 succeed → judge; streams per candidate |
| M8 | Judge on Codex, fanout OpenRouter | Works |
| M9 | Mode toggle Rank↔Fuse | Unchanged semantics (UI.md §6) |
| M10 | Insufficient candidates | Existing gate |

---

## 14. Security checklist

- [ ] Codex bridge listens on **127.0.0.1 only** by default.
- [ ] No access/refresh tokens in frontend state, logs, or analytics.
- [ ] `.gitignore` covers `.env`, any local auth copies.
- [ ] README warns: personal use; don't expose bridge; treat `auth.json` as a password.
- [ ] Optional bridge secret on shared workstations.
- [ ] Do not paste `auth.json` into issues/chats.
- [ ] Gemini/OpenRouter keys: prefer env for long-lived; settings store is convenience only.

---

## 15. Documentation deliverables (by phase)

| Doc | When |
|---|---|
| `PROVIDERS.md` | Phase 0 (this file) |
| `DECISIONS.md` #4 | Phase 0 |
| `PRODUCT.md` IN/OUT tweak | Phase 0 |
| `README.md` Codex + Gemini setup | Phase 2–4 |
| `.env.example` | Phase 1–3 as vars appear |
| `CLAUDE.md` hierarchy | Phase 0 |

---

## 16. Acceptance definition — "multi-provider done"

The feature is **done for daily use** when:

1. OpenRouter, ChatGPT (Codex subscription via local bridge), and Gemini AI Studio
   each work end-to-end for fanout + judge + fuse.
2. Mixed-provider runs work with per-candidate streaming (or documented Gemini fallback).
3. Readiness is accurate per provider; failures are attributable.
4. Rank/Fuse behavior and UI chrome remain focused (PRODUCT.md / UI.md).
5. README documents setup for all three without reading this full spec.
6. No Anthropic or other unrequested vendor code paths.

---

## 17. Open questions (resolve during implementation, not by speculation)

Record answers in DECISIONS.md or a short addendum here when decided.

1. **Keyring-only Codex auth on Windows** — require file store in v1, or invest in
   keyring read immediately?
2. **Default `npm run dev`** — always start bridge, or web-only with opt-in bridge?
3. **Settings keys vs env only** — Phase 4 scope vs keep env-only longer?
4. **Gemini CORS** — direct browser vs shared localhost proxy?
5. **Critic default** — stay on OpenRouter seed forever, or remember last ready critic?
6. **Bridge implementation language** — Node/tsx (matches repo) assumed; Bun acceptable?

**Recommended defaults if unblocking without the user:**
(1) file store v1, (2) `dev` starts bridge but web degrades gracefully, (3) env
through Phase 3 then settings, (4) direct then proxy if needed, (5) keep OpenRouter
seed, (6) Node/tsx.

---

## 18. Implementation order (summary)

```
Phase 0  Docs + decision fence
Phase 1  Registry + OpenRouter move          ← no UX change
Phase 2  Codex bridge + chatgpt-codex        ← ChatGPT subscription
Phase 3  Gemini AI Studio                    ← third provider
Phase 4  Connections UI + polish
Phase 5  Hardening / tests (as needed)
```

Do not start Phase 2 UI until Phase 1 registry is merged.
Do not start Phase 3 until Phase 2 bridge auth status is reliable enough to copy
patterns from.

---

## 19. References

- OpenAI Codex authentication: https://learn.chatgpt.com/docs/auth
- OpenRouter API: https://openrouter.ai/docs
- Google AI Studio / Gemini API: https://ai.google.dev/gemini-api/docs
- Existing client: `src/lib/openrouter.ts`
- Orchestration: `src/rsemble.tsx`
- Domain: `src/studio-data.ts`, `src/studio-engine.ts`
- Pipeline: `src/lib/pipeline.ts`
