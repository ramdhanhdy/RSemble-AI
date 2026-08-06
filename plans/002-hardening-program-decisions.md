# Plan 002: Lock the hardening program's product and technical decisions

> **Executor instructions**: Complete this plan before Plans 003–008. This phase
> intentionally changes documentation and contracts only. Do not implement a
> partial credential store, bridge authentication, or single-model execution
> while the governing decisions remain ambiguous. Record every accepted decision
> in the authoritative specifications and add decision tests only where an
> existing executable contract already exists.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 8f22a6e..HEAD -- PRODUCT.md PROVIDERS.md DECISIONS.md README.md plans
> git status --short
> ```
>
> If credential handling, Compare cardinality, bridge authentication, or
> attachment limits changed after `8f22a6e`, reconcile this plan against live
> code before editing specifications.

## Status

- **Priority**: P0
- **Effort**: S
- **Risk**: MEDIUM
- **Depends on**: Plan 001 complete
- **Blocks**: Plans 003–008
- **Category**: direction
- **Planned at**: commit `8f22a6e`, 2026-08-06
- **Source**: external repository assessment received 2026-08-06
- **Execution status**: DONE — decisions D1–D6 locked in `DECISIONS.md` #11 and
  reconciled in `PRODUCT.md`, `PROVIDERS.md`, `README.md`, and this index
  (commit `docs: lock hardening product and security contracts`)

## Goal

Remove policy ambiguity before hardening implementation begins. The repository
currently contains conflicting statements about credential persistence and an
implicit mismatch between Compare's UI gate and its two-candidate Judge/Fuse
contract. This plan makes the intended behavior explicit and establishes shared
terminology used by every later phase.

## Decisions to lock

### D1. Credential persistence policy

Adopt the following policy unless the owner deliberately records an alternative:

1. Environment variables remain the preferred persistent credential source.
2. Keys entered in Connections are session-only by default.
3. Persistent browser storage is an explicit per-key opt-in labeled
   **Remember on this device**.
4. The UI states that persistent browser storage is readable by same-origin
   JavaScript and is suitable only for this personal local application.
5. Credentials, authorization headers, bridge secrets, and environment contents
   never enter run records, experiment records, logs, archives, or exports.
6. All provider adapters resolve credentials through one `CredentialStore`
   contract rather than reading `localStorage` independently.

This resolves the current contradiction between `PRODUCT.md` (never persisted)
and `PROVIDERS.md` (localStorage permitted) without silently removing a useful
local-first convenience.

### D2. Compare candidate cardinality

Compare requires at least two enabled candidate slots before a paid run starts.
A single-model baseline remains valid inside evaluation experiments where the
policy explicitly defines it, but it is not a degenerate Compare execution.

Required user-facing language:

- Zero candidates: `Enable at least two candidate models.`
- One candidate: `Add or enable one more candidate to compare.`
- Two or more candidates with provider failures: identify the exact unavailable
  slot/provider rather than reporting a generic offline state.

### D3. Bridge authentication contract

`RSEMBLE_BRIDGE_SECRET` is optional configuration, but when set it is enforced.

- `/health` remains unauthenticated.
- Credential-bearing proxy and Codex endpoints require
  `X-RSemble-Bridge-Secret` when configured.
- Browser adapters attach the header only when `VITE_RSEMBLE_BRIDGE_SECRET` or
  the agreed local runtime source is configured.
- Failure is `401 bridge_auth_required` or `401 bridge_auth_invalid`.
- Loopback binding and CORS remain defense-in-depth, not substitutes for the
  configured secret.

If exposing the secret to Vite is rejected, record the alternative transport in
`DECISIONS.md`; do not retain a documented-but-unimplemented variable.

### D4. Attachment size authority

Create one product-level raw attachment limit and one transport-level encoded
body limit. The UI may not admit a request that the selected provider transport
cannot carry.

Initial decision:

- Keep the existing 40 MiB aggregate raw limit unless measurement shows it is
  impractical.
- Set the bridge body ceiling high enough for base64 and JSON overhead, with a
  safety margin (target 64 MiB).
- Add encoded-size preflight for bridge-routed requests.
- Provider-specific lower limits remain capability constraints surfaced before
  execution.

### D5. Timeout semantics

Later implementation must distinguish:

- connection/header deadline;
- stream inactivity deadline;
- optional total execution ceiling;
- explicit user abort.

A single short wall-clock timeout is rejected because reasoning models may remain
healthy while running for a long time.

### D6. Program ordering

The mandatory order is:

1. boundary hardening;
2. run integrity and truthful preflight;
3. execution reliability;
4. quality gate and documentation reconciliation;
5. controlled maintainability extraction;
6. measured optimization and protocol compatibility.

No feature expansion should enter the same pull requests unless required to
preserve existing behavior.

## Workstream A — Reconcile authoritative specifications

Update `PRODUCT.md`, `PROVIDERS.md`, and `DECISIONS.md` so they agree on D1–D6.
Use normative words consistently:

- **must** for enforced invariants;
- **should** for recommended local configuration;
- **may** for optional convenience.

Add a short security-model subsection covering:

- single-user localhost deployment;
- same-origin script/XSS risk;
- untrusted local processes;
- exports and persisted evidence;
- upstream provider error bodies.

Do not claim OS-keychain security unless an OS-keychain implementation is in
scope and available.

## Workstream B — Define shared vocabulary

Use these terms throughout later plans and implementation:

- `session credential`: memory-only until tab/process exit;
- `remembered credential`: explicit persistent browser credential;
- `bridge secret`: local request-authentication token, not a provider key;
- `raw attachment bytes`: original admitted files;
- `encoded request bytes`: serialized transport body;
- `reported usage`: provider-authoritative usage;
- `estimated usage`: estimator with identified method and limitations;
- `unknown usage`: no defensible estimate;
- `execution owner`: in-tab ownership;
- `execution lease`: cross-tab persisted coordination.

## Workstream C — Update the plan index

Add Plans 002–008 to `plans/README.md` with dependencies and status `TODO`.
State that Plan 002 is the decision gate and that Plans 003–008 may be refined
against live code but may not reverse D1–D6 without updating this file and
`DECISIONS.md` first.

## Scope

**In scope**:

- `PRODUCT.md`
- `PROVIDERS.md`
- `DECISIONS.md`
- `README.md` only for a short security/configuration pointer if necessary
- `plans/README.md`
- this plan's status

**Out of scope**:

- production TypeScript changes;
- migrations;
- UI implementation;
- bridge route changes;
- provider timeout implementation;
- bundle optimization.

## Verification

```bash
rg -n "credential|localStorage|bridge secret|RSEMBLE_BRIDGE_SECRET|candidate" \
  PRODUCT.md PROVIDERS.md DECISIONS.md README.md
npm run typecheck:web
npm run typecheck:server
git diff --check
```

Documentation assertions:

1. No authoritative file simultaneously says UI-entered credentials are never
   persisted and that they are automatically persisted.
2. Compare's minimum of two enabled candidates is explicit.
3. The bridge secret is either an enforceable contract or removed everywhere.
4. Attachment raw and encoded limits are distinguished.
5. The phase dependency order is identical in every plan and the index.

## STOP conditions

Stop and request a product decision if:

- the owner wants automatic persistent credential storage with no opt-in;
- Compare is intended to gain a general single-model mode;
- the bridge secret cannot be transported without creating a worse exposure;
- the 40 MiB raw limit is no longer desired.

## Exit criteria

- D1–D6 are recorded in `DECISIONS.md`.
- `PRODUCT.md` and `PROVIDERS.md` are mutually consistent.
- Plans 003–008 can reference stable contracts rather than reinterpret intent.
- No production behavior changes in this phase.
