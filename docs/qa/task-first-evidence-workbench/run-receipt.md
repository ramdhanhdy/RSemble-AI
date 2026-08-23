# Workbench Browser/Accessibility/Security Matrix Run Receipt
**Generated at:** 2026-08-23T22:09:26.485Z  
**Specification:** docs/specs/archive/task-first-evidence-workbench/10-retrieval-and-hardening/retrieval-and-hardening-spec.md §8, §9  
**Execution Status:** NOT EXECUTED (RECEIPT ONLY)  
**Verdict:** RECEIPT_ONLY  
**Environment:**
- **OS / Platform:** Windows_NT 10.0.26200 (win32) (x64)
- **Node Runtime:** v25.9.0 (PID 13248)
- **CPU:** 12th Gen Intel(R) Core(TM) i7-12650H (16 logical cores)
- **Memory:** 729 MB free / 16005 MB total
- **E: Drive Containment:** Strictly enforced at `E:/2026/RSemble-AI/.qa-runtime/run32`

---

## 1. Execution Summary

> **Notice:** Live headless browser execution was not performed in this session.
> **Reason:** Dry-run / receipt-only flag passed
> **Contract Guarantee:** In accordance with run specifications, when the harness cannot execute headless in this environment, this receipt records the complete matrix specification, verified schema v15 deterministic fixtures, E: containment boundaries, and reproduction runbook honestly without faked probe passes.

### Probes Status
- **deterministic_fixture_integrity:** ⏸️ NOT EXECUTED — *Corpus entities strictly adhere to schema v15 shape*
- **e_drive_containment_policy:** ⏸️ NOT EXECUTED — *All QA paths, caches, profiles, and dumps contained on E:*
- **zero_paid_provider_egress_contract:** ⏸️ NOT EXECUTED — *Mock network egress gate intercepts all external AI endpoints*
- **secret_probe_sanitization_contract:** ⏸️ NOT EXECUTED — *Credential tokens in error fields redacted before UI rendering*
- **responsive_ladder_coverage:** ⏸️ NOT EXECUTED — *All 4 viewports (1440, 1024, 768, 390) registered and probed*
- **accessibility_conditions_coverage:** ⏸️ NOT EXECUTED — *200% zoom, reduced motion, keyboard-only, and semantic landmarks registered*
- **primary_and_secondary_routes_coverage:** ⏸️ NOT EXECUTED — *All 22 primary, 11 secondary, and 3 canonical/retired fusion routes covered*

---

## 2. Matrix Coverage Specification

The browser/accessibility/security matrix harness declares and exercises every primary, secondary, and canonical-fusion route across all declared viewports, accessibility states, and security boundaries.

### Primary Navigation Routes
- `/compare`
- `/compare/results/:comparisonId`
- `/evaluations`
- `/evaluations/sets`
- `/evaluations/sets/new`
- `/evaluations/sets/:taskSetId`
- `/evaluations/sets/:taskSetId/versions/:version`
- `/evaluations/sets/:taskSetId/tasks/:taskId`
- `/evaluations/rubrics`
- `/evaluations/rubrics/:rubricId`
- `/evaluations/rubrics/:rubricId/versions/:version`
- `/evaluations/results/:evaluationExecutionId`
- `/lab`
- `/lab/recipes`
- `/lab/recipes/:recipeId/versions/:version`
- `/lab/model-pools`
- `/lab/model-pools/:poolId/versions/:version`
- `/lab/studies/:studyId`
- `/models`
- `/models/:modelConfigurationId`
- `/models/:modelConfigurationId/evidence/:observationId`
- `/models/rollups/:rollupId/versions/:version`

### Secondary & Diagnostic Routes
- `/records`
- `/records/diagnostics`
- `/records/:recordType/:recordId`
- `/attention`
- `/search`
- `/runs`
- `/runs/:runId`
- `/tasks`
- `/tasks/new`
- `/tasks/:taskId`
- `/tasks/:taskId/versions/:version`

### Canonical & Retired Fusion Routes
- `/evaluations/:suiteId/fusion/:studyId (retired static notice)`
- `/lab/studies/:studyId (canonical policy study route)`
- `/evaluations/sets/:taskSetId (canonical task set route)`

---

## 3. Viewports & Responsive Ladder
- **Desktop 1440:** 1440x900 (scale: 1, mobile: false)
- **Laptop/Tablet Landscape 1024:** 1024x768 (scale: 1, mobile: false)
- **Tablet Portrait 768:** 768x1024 (scale: 1, mobile: true)
- **Mobile Phone 390:** 390x844 (scale: 1, mobile: true)

---

## 4. Accessibility & Robustness Gates
- **200% Zoom:** zero horizontal document overflow, touch/click targets preserved
- **Reduced Motion:** css transitions/animations instant/disabled
- **Keyboard Only:** tab-walk interactive reachability, :focus-visible indicators, Escape dismissals
- **Screen Reader Semantics:** landmarks (<header>, <main>, <nav>, role='region'), real <table> with <th scope>

### States Covered:
- new (fresh empty collections)
- legacy (v1/v2 imported records)
- migration (in-flight inspection, complete discard/convert receipt)
- error (not-found, corrupt crosswalk, unknown version refusal)
- loading / partial (streamed chunks, skeleton fallbacks)
- storage-full (quota simulated refusal, non-destructive repair)

---

## 5. Security & Invariant Contracts
- **Zero Paid Provider Egress:** Intercepts `window.fetch` and blocks any requests to `api.openai.com`, `anthropic.com`, `openrouter.ai`, `generativelanguage.googleapis.com`, `umans.ai`.
- **Secret Probe Sanitization:** Enforces that credential tokens and authorization headers present in raw error payloads are completely redacted and never appear in the rendered DOM.
- **Local Link Copying:** Confirms that all copy-link actions produce local `http://127.0.0.1` or hash URLs without remote telemetry or tracking parameters.
- **Console Errors:** Zero tolerance for unhandled JavaScript exceptions, uncaught Promise rejections, or `console.error` logs.

---

## 6. Seeded Fixture Inventory
- **Run Summaries:** 5
- **Run Details:** 5
- **Comparison Results:** 2
- **Tasks & Versions:** 2 tasks, 2 versions
- **Task Sets & Versions:** 1 sets, 1 versions
- **Rubrics & Versions:** 1 rubrics, 1 versions
- **Model Configurations:** 2
- **Observations & Decisions:** 2 observations, 1 decisions, 1 verifier outcomes
- **Lab Assets:** 1 recipes, 1 pools, 1 studies
- **Search Documents:** 6

---

## 7. How to Run the Matrix Manually

To execute this matrix with live Chrome CDP against a local development server:

```bash
# Step 1: Start the application development server or preview build on port 5198
npm run build
npx vite preview --port 5198 --strictPort

# Step 2: In another terminal, run the workbench matrix harness
npm run qa:task-first-workbench
```

Optional parameters:
- `QA_BASE_URL=http://127.0.0.1:5198/` — target application base URL
- `QA_PORT=5198` — target port
- `CDP_PORT=9398` — Chrome DevTools Protocol debugging port
- `CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"` — custom Chrome executable
- `--dry-run` / `--receipt-only` — verify fixtures and generate receipt without launching browser
