# Plan 008: Optimize loading and isolate protocol-sensitive integrations

> **Executor instructions**: Execute after Plan 007. This phase is deliberately
> last: measure first, optimize only observed bottlenecks, and keep protocol-
> sensitive providers isolated behind compatibility checks. Do not trade audit
> integrity, accessibility, or local reliability for smaller bundle numbers.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 8f22a6e..HEAD -- \
>   vite.config.* package.json src/main.tsx src/app-router.tsx \
>   src/lib/attachments src/workspaces server/codex-bridge \
>   src/lib/providers/chatgpt-codex.ts README.md PROVIDERS.md
> git status --short
> ```

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: MEDIUM
- **Depends on**: Plan 007
- **Blocks**: none
- **Category**: optimization
- **Planned at**: commit `8f22a6e`, 2026-08-06

## Goal

Reduce unnecessary startup/download/parse work for the common Compare workflow
and make Codex/bridge protocol drift diagnosable. Optimization must be justified
by repeatable measurements and must preserve existing behavior when optional
heavy features are loaded.

## Principles

1. Bundle warnings are signals, not product failures.
2. Measure route load, parse/evaluation cost, and interaction latency before
   setting budgets.
3. Lazy-load by user capability boundary: PDF/DOCX parsing, evaluation workspaces,
   experiment detail, and other heavy optional surfaces.
4. Do not lazy-load tiny critical modules merely to improve chunk counts.
5. Protocol compatibility failures must be explicit and actionable.
6. No optimization may silently reduce attachment fidelity, Judge evidence, or
   persisted provenance.

## Workstream A — Establish performance baselines

Measure a clean production build under a documented environment:

- initial JS transferred and uncompressed;
- main-thread parse/evaluation time;
- Compare first meaningful render;
- time until task input is interactive;
- route transition to Runs and Evaluations;
- first use of image, PDF, and DOCX attachment processing;
- memory impact of opening a large run/evaluation record.

Record:

- hardware/browser/Node versions;
- commit SHA;
- cold vs warm cache;
- measurement command/tool;
- median and tail observations over multiple runs.

Add a small checked-in report under `docs/performance/` rather than relying on a
single build warning.

## Workstream B — Route-level and feature-level lazy loading

1. Verify current route splitting before adding new boundaries.
2. Lazy-load Runs, Evaluations, experiment results, and profile/suite editors when
   they are not required for initial Compare rendering.
3. Lazy-load PDF.js only when a PDF is admitted or previewed.
4. Lazy-load Mammoth/DOCX handling only when a DOCX is admitted.
5. Keep text/image attachment paths responsive and capability checks available
   without loading unrelated parsers.
6. Add intentional loading states that preserve focus and do not flash generic
   spinners over the entire app.
7. Preload a route/parser only when user intent is clear (navigation hover/focus,
   accepted file type), and verify preloading does not restore all startup cost.
8. Confirm error boundaries make failed chunk loads recoverable.

## Workstream C — Chunk strategy and dependency review

1. Inspect the Vite bundle graph and duplicate dependency copies.
2. Prefer natural dynamic-import boundaries over brittle manual chunk maps.
3. Evaluate whether icon imports, PDF worker setup, DOCX generation, or shared UI
   dependencies are accidentally pulled into the initial path.
4. Remove genuinely unused dependencies and exports.
5. Do not replace stable libraries solely for size unless the replacement meets
   correctness, accessibility, and maintenance requirements.
6. Add measured budgets only after improvements:
   - initial entry chunk budget;
   - total initial JS budget;
   - maximum unexpected growth threshold.
7. Treat specialized lazy chunks separately; a large PDF parser chunk is
   acceptable when it is not initial and its first-use latency is reasonable.

## Workstream D — Codex protocol compatibility envelope

The Codex bridge currently depends on protocol details that may change. Isolate
those assumptions:

1. Create a `CodexProtocolAdapter` module containing backend URL, headers, client
   metadata, request translation, response event parsing, and supported protocol
   version identifiers.
2. Keep bridge HTTP routing independent from Codex protocol translation.
3. Add fixture-based tests for known response streams and terminal/error events.
4. Add a compatibility probe that checks a cheap, non-generation endpoint or
   validates auth/model metadata when available.
5. Classify failures:
   - bridge unavailable;
   - not logged in/token expired;
   - model unavailable;
   - protocol response shape changed;
   - upstream rejected client metadata;
   - stream terminated unexpectedly.
6. Surface protocol drift as an experimental-integration compatibility error, not
   a generic network failure.
7. Centralize client version/user-agent/OAuth constants and document how they are
   updated.
8. Never auto-retry with guessed protocol variants or send credentials to a new
   origin.

## Workstream E — Compatibility smoke workflow

Create an opt-in manual smoke procedure, not default paid CI:

- start the local bridge;
- verify health/auth status;
- list eligible models;
- perform one minimal bounded completion only with explicit operator consent;
- record protocol metadata and sanitized outcome;
- never upload credentials, prompts, or raw response bodies as artifacts.

Where possible, default CI runs recorded protocol fixtures and bridge routing
contracts. The live smoke may use a manually dispatched workflow only if secret
and cost handling are safe; otherwise keep it local and documented.

## Workstream F — Regression measurement and budgets

After implementation, repeat the exact baseline procedure and report:

- startup JS delta;
- parse/evaluation delta;
- Compare interactivity delta;
- route/attachment first-use costs;
- number and size of initial vs optional chunks;
- any regressions in navigation or parser availability.

Set budgets based on achieved, stable values with modest headroom. CI should fail
on meaningful regressions, not on harmless hash/chunk reshuffling.

## Workstream G — Documentation

Update README and provider docs with:

- which features load on demand;
- expected first-use parser delay;
- offline/cache behavior for lazy chunks;
- Codex's experimental compatibility status;
- protocol-drift troubleshooting;
- safe procedure for updating Codex compatibility fixtures/constants;
- performance measurement and budget commands.

## Scope

**In scope**:

- production bundle analysis
- route/feature dynamic imports
- PDF/DOCX lazy loading
- removal of proven unused dependencies
- performance reports and measured budgets
- Codex protocol adapter isolation and fixtures
- explicit protocol compatibility errors

**Out of scope**:

- redesigning the UI;
- reducing evidence persisted per run;
- lossy attachment extraction;
- changing evaluation methodology;
- scraping ChatGPT web surfaces;
- guessing undocumented fallback protocols;
- live paid tests in ordinary pull-request CI;
- optimization without before/after measurements.

## Verification commands

```bash
npm run format:check
npm run lint
npm run typecheck:web
npm run typecheck:server
npm test
npm run test:coverage
npm run build
npm run check
git diff --check
```

Also run:

- the documented production performance measurement procedure;
- deterministic attachment tests for text/image/PDF/DOCX;
- fixture-based Codex protocol tests;
- optional local live smoke only with explicit authorization.

## Acceptance criteria

- The common Compare path no longer eagerly loads optional PDF/DOCX/evaluation
  code where measurement confirms those costs existed.
- Initial load and interactivity improve or remain within an explicitly accepted
  tolerance.
- Optional feature first-use behavior remains clear, accessible, and correct.
- Performance budgets are based on recorded measurements.
- Codex protocol assumptions live in one adapter boundary.
- Protocol drift produces a distinct compatibility diagnosis.
- No credential, prompt, attachment, or raw upstream body appears in performance
  or compatibility artifacts.
- All hardened correctness and reliability gates from Plans 003–007 remain green.

## STOP conditions

Stop if:

- measurement does not show a meaningful initial-load problem;
- a lazy boundary breaks offline/local usage expectations without an acceptable
  mitigation;
- chunking causes duplicated heavy dependencies larger than the original cost;
- Codex compatibility work requires undocumented credential forwarding or a new
  upstream origin;
- optimization would weaken audit evidence or attachment fidelity.

## Program exit

When Plan 008 is complete, update `plans/README.md` with final statuses and add a
short hardening-program retrospective covering:

- findings fixed;
- decisions changed during implementation;
- residual accepted risks;
- measured reliability/performance outcomes;
- future work explicitly deferred.
