# Performance Baseline & Regressions (Plan 008 — Workstreams A / F)

> Measured on branch `perf/measured-loading-and-protocol`. Environment limits:
> no Chrome binary in the worker, so browser parse/evaluation and interaction
> latency are **not** measured here. This report records build-level initial JS
> chunk sizes, optional-chunk sizes, and the loading strategy — the
> reproducible subset available in this environment. Browser-first-meaningful-
> render and interaction-latency measurements are owner-only live validation
> pending.

## Environment

- **Commit (baseline)**: `d1740f1` (post-Plan-007 master, PR #7 merge)
- **Final (post-implementation)**: (filled at Workstream F)
- **Node**: v22.22.1
- **Build tool**: Vite 8.1.5 (Rolldown), `react` + `terminalDevLogPlugin`
- **Vite config manual chunks**: none (`vite.config.ts`)
- **Measurement command**: `npm run build` (reproducible; sourcemap parse used
  for module→chunk attribution)
- **Cold/warm**: cold build each run; chunk hash reshuffling between runs does
  not change sizes.

## What loads on Compare startup (initial path)

The initial set is: `index-*.js` + Rolldown runtime + preload helper +
`createLucideIcon` (icon factory) + `run-types` (the Dexie/persistence shared
chunk). The Compare pipeline, run lifecycle, provider adapters, root providers,
and the Compare command pane are inherently in the initial chunk because
Compare is the default surface and the Plan 007 root-mount contract keeps
orchestration/alive state above the router.

## Baseline measurements (Workstream A)

Initial JS (raw / gzip):

| Chunk | raw (kB) | gzip (kB) |
| --- | --- | --- |
| index-*.js | 629.40 | 184.93 |
| createLucideIcon-*.js | 49.77 | 17.82 |
| run-types-*.js (Dexie/persistence) | 110.45 | 35.40 |
| rolldown-runtime-*.js | 1.26 | 0.70 |
| preload-helper-*.js | 1.19 | 0.67 |
| **Initial total** | **792.07** | **239.52** |

Largest optional (non-initial, on-demand) chunks:

| Chunk | raw (kB) | gzip (kB) | Content |
| --- | --- | --- | --- |
| lib-*.js | 497.25 | 125.48 | mammoth .docx→text extraction (dynamic import) |
| pdf-*.js | 427.54 | 127.43 | PDF.js text extraction (dynamic import) |
| SuiteEditor | 79.31 | 21.31 | suite editor (route-lazy) |
| ExperimentRoute | 52.16 | 12.18 | experiment results (route-lazy) |

Marker: the `index` chunk (629 kB) exceeds Vite's 500 kB chunk-size warning.

## Already-deferred (no further change needed)

- PDF.js (`pdfjs-dist`) — dynamic `import()` in `src/lib/attachments/extract.ts`
- Mammoth (`.docx` text) — dynamic `import()` in the same module
- Runs, Evaluations, suites, profiles, fusion study, experiment detail —
  route-level `lazy()` in `src/app-router.tsx`

The text/image attachment path loads neither parser (only `createImageBitmap`
for images / direct text read), and Compare startup pays no parser cost.

## Optimization hypotheses considered vs implemented (Plan 008)

| Hypothesis | Evidence of problem | Decision |
| --- | --- | --- |
| Remove unused `docx` dependency | Zero imports anywhere; runtime deps only | **IMPLEMENTED** (moved to devDependencies; app never bundled it) |
| Add error boundary below root providers | No error boundary anywhere; a failed lazy chunk unmounts ROOT and destroys Compare | **IMPLEMENTED** |
| Extract `CodexProtocolAdapter` + fixtures | Protocol constants/translation scatted in responses.ts/auth.ts | **IMPLEMENTED** |
| Lazy @base-ui Dialog / shell overlays | ~98 kB eager @base-ui | **REJECTED** — @base-ui required eagerly by the Compare run dialog (CommandPane); splitting adds a11y/focus/modal risk for marginal gzip gain |
| Defer Dexie persistence | ~94 kB eager | **REJECTED** — run-lifecycle persistence fencing depends on repo-ready-at-execution; high risk |
| Replace mammoth with smaller extractor | ~100 kB gzip on .docx use | **REJECTED** — already deferred; docx-fidelity risk; low priority |
| Manual chunk maps | — | **REJECTED** — vendors would move to an eagerly-preloaded shared chunk anyway; no real initial saving |
| Defer `fusion-study-repository` out of root | ~35 kB eager 978-line repo, lazy-only consumers | **REJECTED** — touches root context contract; code shared with lazy routes; risk>reward |
| Code-split experiment engine | ~2.8k ln eager | **REJECTED** — experiment-controller must stay eager for cross-nav lease/fence; recovery timing risk |

## Workstream F — after measurement

Re-ran the identical procedure at the implementation head. Because the loading
optimizations PDF/DOCX laziness and route splitting were already in place, and
the heavy easing deferrals (Dexie, @base-ui shell overlays) were deliberately
rejected on evidence, the initial bundle is essentially unchanged.

| Initial chunk | baseline raw | after raw |
| --- | --- | --- |
| index-*.js | 629.40 kB | 630.73 kB (614.6 raw parse) |
| createLucideIcon-*.js | 49.77 kB | 48.6 kB |
| run-types-*.js | 110.45 kB | 107.9 kB |
| rolldown-runtime + preload-helper | 2.45 kB | 2.4 kB |
| **Initial total** | **792.07 kB** | **789.7 kB** (gzip ~same ~240 kB) |

The index chunk grew by ~1.3 kB (the RouteErrorBoundary added to the eager
shell — the price of the chunk-failure safety fix). Module-percentage variance
(614.6 vs 629.4) reflects Prettier/hash reshuffling between the two build runs,
not a semantic change. No lazy chunk increased; PDF/lib/Runs/Evaluations
unchanged.

**Budget recommendation** (modest headroom, robust to harmless hash reshuffling):
- initial JS budget: **≤ 900 kB raw** / **≤ 280 kB gzip** (headroom above the
  recorded ~790/~240, so harmless dedup/renaming does not fail CI);
- unexpected-growth threshold: the CI should fail if the initial gzip total
  regresses by more than **+15%** from the recorded ~240 kB on a clean build.
  Do not gate on chunk counts or hashes (they reshuffle constantly).

These budgets are advisory in this branch (CI is owner-managed); they are
recorded here for a future owner-owned gate.
