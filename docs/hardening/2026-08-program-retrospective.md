# 2026-08 Hardening-Program Retrospective (Plans 002–008)

> Written at the end of Plan 008, the final hardening phase, describing the
> repository that actually exists after the whole program. This is not a
> paraphrase of the seven plan files; it records what was fixed, the boundaries
> established, decisions that changed, and the measured reliability/performance
> outcomes.

## Commit / PR mapping

| Plan | Title | PR / branch | Head |
| --- | --- | --- | --- |
| 002 | Hardening decisions lock (D1–D6) | merged | — |
| 003 | Credential and bridge boundary hardening | merged | — |
| 004 | Run integrity and truthful preflight | merged | — |
| 005 | Execution reliability and cross-tab leases | merged | — |
| 006 | Quality gate and documentation reconciliation | merged | — |
| 007 | Controlled maintainability extraction | **PR #7** `refactor/controlled-maintainability` → merged as `d1740f1` | `649bae3` |
| 008 | Measured loading and protocol compatibility | **PR (this)** `perf/measured-loading-and-protocol` (draft) | `24764c4` |

## Important findings fixed across the program

- **Credential persistence/containment (003)**: environment-first, session-only
  defaults, remember-on-device opt-in, and a shared `CredentialStore`; credentials
  never enter runs, logs, archives, exports, screenshots, or fixtures. Raw
  provider stacks and bridge secrets are redacted at every log/export boundary.
- **Bridge boundary (003)**: exact route table with 404/405/415, optional
  `X-RSemble-Bridge-Secret` (D3), bounded 40 MiB / 64 MiB attachment ceilings (D4),
  loopback/CORS defense-in-depth, and provider-error sanitization.
- **Run integrity (004)**: truthful preflight (Compare requires ≥2 enabled slots,
  frozen reasoning policy, encoded-size preflight), honest evidence (missing
  usage/cost/output stay missing, never fabricated), and correct attachment
  error surfacing instead of "perpetual reading".
- **Execution reliability (005)**: distinct connect/inactivity/overall/user-abort
  deadline clocks (D5); cross-tab execution leases, fencing, and heartbeats that
  are IndexedDB-authoritative.
- **Quality gate (006)**: Prettier, ESLint (incl. jsx-a11y + react-hooks),
  typecheck (web + server), vitest + coverage-v8 with enforced thresholds and
  targeted load-bearing floors, a console-warning guard, and a coherent `npm run
  check`. `vite.config.ts` dev-log endpoint sanitizes terminal fields.
- **Maintainability (007)**: `triggerFusion()` reads the persisted record exactly
  once; experiment task-terminal commit is one atomic, recoverable boundary with
  engine snapshot/restore; typed Fusion Study stage contract; import-boundary
  rule scoping `pipeline.ts` to the provider-agnostic domain; the Compare shell
  decomposed into presentational components; a route error boundary so a failed
  lazy chunk cannot unmount the ROOT (Compare/execution state preserved).
- **Loading/protocol (008, this phase)**: unused `docx` classified as a dev-only
  tool dependency; the Codex protocol surface isolated behind a single
  `CodexProtocolAdapter` with fixture-driven compatibility tests and distinct
  failure classification.

## Architectural boundaries established

- **One provider-neutral pipeline spine** (`src/lib/pipeline.ts`): prompt
  construction, blind-set construction, Judge parsing/validation; transport and
  persistence kept out. `eslint` enforces that lazy/eager modules do not drag
  `pipeline.ts` off its domain by importing react or persistence internals.
- **Credential store** and **bridge secret** are the single containment points for
  credentials and the optional bridge auth.
- **Execution lease/fence + deadlines** wrap all provider calls and cross-tab run
  ownership; Compare/experiment state live at the root above the router so they
  survive navigation.
- **Loader boundaries**: PDF.js and Mammoth are dynamically imported; Runs,
  Evaluations, suites, profiles, fusion study, and experiment detail are
  route-lazy. A `RouteErrorBoundary` makes failed chunk loads recoverable below
  the root providers.
- **Codex protocol adapter**: all upstream endpoint/version/User-Agent/
  Originator/OAuth constants, request translation, event parsing, and failure
  classification live in `server/codex-bridge/protocol.ts`; bridge HTTP routing
  (`index.ts`) stays separate.

## Security / reliability guarantees that now hold

- Credentials, bridge secrets, and environment contents never reach runs,
  experiments, logs, archives, exports, screenshots, or CI artifacts.
- Raw upstream/provider bodies are always sanitized before they cross a boundary.
- Missing evidence is never quietly turned into zero or an estimate.
- Retries, repairs, roster extensions, and Fusion Study stages preserve exact
  source attempts and protocol identity (immutable provenance via fingerprinting).
- No hidden paid calls: preflight, recovery, retry, and extension expose
  deterministic provider-stage cardinality.
- A failed final-task commit leaves the persisted experiment deterministically
  `aborted` (never "running" with a terminal in-memory record).
- Default CI/browser QA is deterministic (mocks/fixtures); live paid Codex calls
  are owner-only and opt-in.

## Product decisions that changed during implementation

- **D1 confirmed + sharpened**: "Remember on this device" is explicit opt-in only;
  the UI exposes env secrets read-only.
- **Attachment size authority (D4)**: 40 MiB raw UI limit / 64 MiB encoded bridge
  ceiling enforced in shared/limits.ts with encoded-size preflight, not just UI.
- **Codex treated as an experimental integration** (Plan 008): its upstream
  protocol is not a public stable API, so a deterministically tested adapter +
  fixture corpus is the compatibility contract; live smoke is operator-only.

## Performance baseline and final measurements

See `docs/performance/2026-08-plan008-baseline.md` for the full record.

- **Baseline (commit `d1740f1`)**: initial JS **792.07 kB raw / ~240 kB gzip**
  (index 629.40 / gzip 184.93; createLucideIcon 49.77; run-types/Dexie 110.45).
  PDF (427 kB) and mammoth (497 kB) were already deferred.
- **Final (commit `24764c4`)**: initial **789.7 kB raw / ~same gzip**. Index grew
  ~1.3 kB (the RouteErrorBoundary safety fix). No lazy chunk increased.
- **Conclusion**: PDF/DOCX/route laziness and provider separation were already in
  place; the heavy initial-path costs (Compare pipeline itself, Dexie, the
  @base-ui dialog required by the Compare run dialog) cannot be safely deferred
  without violating Compare-alive or persistence-fencing invariants. "No
  meaningful loading change" is the evidence-backed result.

## Optimizations deliberately rejected (with evidence)

- **Dexie deferral** (~94 kB eager): run-lifecycle persistence fencing depends on
  the repository being ready at Compare execution; highest regression risk.
- **@base-ui Dialog shell-overlay lazy** (~98 kB eager): @base-ui is required
  eagerly by the Compare run dialog (CommandPane); splitting adds accessibility/
  focus/modal risk for marginal gzip gain on a surface already on the initial
  path; full removal is impossible.
- **Mammoth replacement**: already deferred; .docx parsing-fidelity risk; low
  priority (only paid when a user attaches .docx).
- **Manual chunk maps**: vendors would move to an eagerly-preloaded shared chunk;
  no real initial-load saving, brittle coupling.
- **`fusion-study-repository` deferral out of root** (~35 kB): touches the root
  context contract; consumers are lazy but the code is shared; risk > reward.
- **Experiment-engine code-split** (~2.8k lines): experiment-controller must stay
  eager for cross-nav lease/fence and startup recovery; recovery-timing risk.

## Codex compatibility boundary

- **Adapter**: `server/codex-bridge/protocol.ts` (constants, headers, request
  translation, SSE event parsing, `classifyCodexOutcome`).
- **Fixture corpus**: `server/tests/__fixtures__/codex-stream-events.json`
  (synthetic only; no real prompts/bodies/credentials).
- **Tests**: `server/tests/protocol.test.ts` (18 deterministic tests) +
  existing `responses.test.ts`, `bridge.test.ts`, `bridge-security.test.ts`.
- **Failure classes**: `bridge_unavailable`, `auth_unavailable`,
  `model_unavailable`, `protocol_shape_changed`, `client_metadata_rejected`,
  `stream_terminated_unexpectedly`. Protocol drift surfaces as a distinct
  experimental-integration diagnosis, not a generic network failure.
- **Smoke**: `docs/qa/codex-compatibility-smoke.md` (opt-in, operator-triggered,
  credential-safe); `docs/hardening/codex-compatibility.md` documents the update
  procedure.

## Deterministic vs owner-only validation

- **Deterministic (done here)**: full gate set, attachment tests (text/image/PDF/
  DOCX), fixture-based Codex protocol tests, and route/error-boundary tests.
- **Owner-only live validation pending (NOT performed — no worker Codex auth /
  Chrome)**: live Codex completion smoke, CDP browser QA (parse/evaluation and
  interaction latency), and real-browser first-meaningful-render.

## Residual accepted risks

- The Codex upstream protocol may change; the adapter + fixtures isolate it so a
  change is diagnosable, but a live compatibility break still requires an owner
  to update the version constant and re-smoke.
- Browser interaction latency is unmeasured here (no Chrome); the recorded
  build-level budgets are advisory until owner browser QA.
- The `lib`/PDF lazy chunks remain large on first use (~100 kB gzip each); this is
  accepted because they are on-demand and their first-use latency was in the
  acceptable deferred range.

## Future work explicitly deferred

- A smaller `.docx`-text extractor (only if .docx first-use latency becomes a
  measured problem and fidelity can be preserved).
- Moving @base-ui / Dexie off the initial path only under a future measured
  profile baseline with a dedicated a11y budget.
- A CI performance gate enforcing the recorded budgets (owner-managed CI).
- Live Codex smoke + browser QA (owner-only).

## Invariant-preservation evidence

Plans 003–007 cross-phase invariants 1–10 and decisions D1–D6 remain intact:
- One pipeline / blindness / evidence honesty / immutable provenance: pinned by
  `pipeline.test.ts`, `judge-explainability.integration.test.ts`, `run-recorder`,
  `experiment-unit-of-work`, `protocol-fingerprint`.
- Credential containment: `credential-store` + `error-redaction` + archive/run-
  recorder tests (All green).
- Deadlines & lease/fence & atomic commit: `execution-deadline`,
  `execution-lease`, `execution-heartbeat`, `experiment-unit-of-work`,
  `run-controller` cross-tab tests.
- Compare nav-alive: `rsemble-shell.test.tsx` (state survives navigation).
- Accessibility: jsx-a11y lint (errors) + `DialogSurface`, `WorkspaceNav`,
  `GlobalExecutionStrip`, `motion-contract`, `StatusMark` reduced-motion tests.
- Plan 008 added its own guards: the `RouteErrorBoundary` preserves root state on
  chunk failure, and the Codex adapter never forwards credentials to a new origin
  and never guesses fallback variants.

## Gate results at Plan 008 completion

- `npm ci` clean. `format:check`, `lint`, `typecheck:web`, `typecheck:server`,
  `test`, `test:coverage`, `build`, `check` all pass; `git diff --check` clean.
- **145 test files / 2100 tests**.
- **Coverage**: statements **79.21** / branches **72.20** / functions **80.94** /
  lines **83.34** — above the enforced global and targeted thresholds.
