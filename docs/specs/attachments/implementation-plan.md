# Attachments — Phased Implementation Plan

> Companion to `attachments-spec.md`. Follows `CLAUDE.md` §2: **work strictly one phase
> at a time**, and §6: run `npm run check` before marking a phase complete.
> Phases are numbered 6.x to continue the `TODOS.md` sequence (Phase 5 = Hardening).

Ordering rationale: types and extraction first (pure, testable, no UI), then one
provider end-to-end, then the remaining providers, then UI, then the pipeline gate,
then cross-cutting polish. Each phase leaves the app shippable — attachments are
inert until Phase 6.5 wires the UI.

---

## Phase 6.0 — Spec lock (docs only)

- [ ] 6.0.1 Land `docs/specs/attachments/attachments-spec.md` (this set of files).
- [ ] 6.0.2 Add `DECISIONS.md` entry: attachments are **inline base64 only** — no provider Files API, no server-side storage, no text substitute for images.
- [ ] 6.0.3 Add `PROVIDERS.md` section: attachment capability matrix + per-adapter transport (spec §5).
- [ ] 6.0.4 Add `PRODUCT.md` §5 IN row ("task attachments: images / PDF / md / docx") and OUT rows (OCR, Files API, persistence, audio/video).
- [ ] 6.0.5 Append Phase 6 checklist to `TODOS.md` pointing at this file.

**Exit:** docs consistent; no code touched.

---

## Phase 6.1 — Attachment core (types, classification, limits)

New: `src/lib/attachments/types.ts`, `src/lib/attachments/classify.ts`, `src/lib/attachments/limits.ts`

- [ ] 6.1.1 `types.ts`: `AttachmentKind`, `AttachmentStatus`, `Attachment` exactly as spec §4.
- [ ] 6.1.2 `classify.ts`: `classifyFile(file: File): { kind: AttachmentKind; mimeType: string } | { rejected: string }`. MIME first, extension fallback (Windows reports `""` often). Explicit rejections for `.doc`, archives, audio/video, spreadsheets — each with the exact copy from spec §3.
- [ ] 6.1.3 `limits.ts`: `MAX_FILES`, `MAX_FILE_BYTES`, `MAX_TOTAL_BYTES`, `MAX_TEXT_CHARS_PER_FILE`, `MAX_TEXT_CHARS_TOTAL`, `MAX_IMAGE_DIM`, plus `admitFiles(existing, incoming)` returning `{ accepted: File[]; rejections: { name: string; reason: string }[] }`. Pure function, no DOM.
- [ ] 6.1.4 `sanitizeName(name: string): string` (control chars, ANSI, whitespace collapse, 120-char cap).
- [ ] 6.1.5 Tests `src/lib/attachments/classify.test.ts`, `limits.test.ts`: every accepted extension, every rejection reason, over-count, over-size, over-total (partial admission keeps the non-offending files), name sanitization incl. `..\..\etc` and CRLF injection.

**Exit:** pure modules, 100% of branches in `classify`/`admitFiles` covered. No UI, no state.

---

## Phase 6.2 — Extraction pipeline

New: `src/lib/attachments/extract.ts` (+ `image.ts`, `pdf.ts`, `docx.ts`)

- [ ] 6.2.1 `readAsBase64(file): Promise<string>` — `FileReader`/`arrayBuffer` → base64 without the data-URL prefix, chunked to avoid `String.fromCharCode` stack overflow on large buffers.
- [ ] 6.2.2 `image.ts`: `prepareImage(file)` → decode with `createImageBitmap`, downscale to fit `MAX_IMAGE_DIM` preserving aspect, re-encode to `image/png` (or keep JPEG if already JPEG and within bounds), return `{ data, width, height, mimeType }`. GIF → first frame.
- [ ] 6.2.3 `pdf.ts`: `extractPdf(file)` → **dynamic** `import("pdfjs-dist")`, return `{ pageCount, text, truncated }`. Zero extractable text ⇒ `{ text: "", pageCount }` and the caller records `noExtractableText`.
- [ ] 6.2.4 `docx.ts`: `extractDocx(file)` → **dynamic** `import("mammoth")` → `extractRawText`.
- [ ] 6.2.5 `extract.ts`: `extractAttachment(file, kind): Promise<Partial<Attachment>>` dispatching on kind; `text` kinds read via `file.text()`; all paths truncate at `MAX_TEXT_CHARS_PER_FILE` appending `[truncated: N of M characters shown]`; all paths catch and return a human-readable `error`.
- [ ] 6.2.6 Add `pdfjs-dist` + `mammoth` to `dependencies`; confirm via `npm run build` that neither appears in the entry chunk (dynamic-import chunk only).
- [ ] 6.2.7 Tests: truncation boundary, `[truncated: …]` marker, corrupt-PDF error text, empty-text PDF, base64 round-trip of a >1 MB buffer, downscale math (`4000×3000 → 4096 cap` no-op vs `8000×2000 → 4096×1024`).

**Exit:** `extractAttachment` handles every kind and every failure without throwing. Bundle unaffected when no file is attached.

---

## Phase 6.3 — Content parts + first provider (OpenRouter)

- [ ] 6.3.1 `providers/types.ts`: add `ContentPart`; widen `ChatMessage.content` to `string | ContentPart[]`.
- [ ] 6.3.2 `providers/capabilities.ts`: `ModelCapabilities`, `getModelCapabilities(providerId, slug)`, and a capability cache populated from `listModels`. Unknown ⇒ `{ image: false, pdf: false }`.
- [ ] 6.3.3 `openrouter.ts`: `toOpenAIContent(content)` — `string` passes through **unchanged**; `ContentPart[]` maps `text` → `{type:"text"}`, `image` → `{type:"image_url", image_url:{url:"data:…"}}`, `file` → `{type:"file", file:{filename, file_data}}`. Applied in both `chatCompletion` and `chatCompletionStream`.
- [ ] 6.3.4 `openrouter.listModels`: read `architecture.input_modalities` and record capabilities in the cache.
- [ ] 6.3.5 Surface HTTP 413 / 415 detail verbatim through `ProviderError` (already the shape; add a test).
- [ ] 6.3.6 Tests `providers/openrouter.test.ts`: **golden snapshot** of the request body for a string-content message (must equal the pre-change body), plus bodies for image-only, pdf-only, and mixed parts; capability parsing from a realistic `listModels` payload.

**Exit:** OpenRouter can carry an image and a PDF; attachment-free bodies byte-identical.

---

## Phase 6.4 — Remaining providers

- [ ] 6.4.1 `gemini.ts`: extend `mapMessagesToGemini` so a `ContentPart[]` user message becomes `parts: [{text}, {inlineData:{mimeType,data}}, …]`. String content path untouched.
- [ ] 6.4.2 `openai-compat.ts`: add `supportsImages?: boolean` to `OpenAICompatConfig` (default `false`); reuse the OpenRouter `toOpenAIContent` mapper (extract it to `providers/content.ts` so both import it); throw a clear `ProviderError` if a media part reaches a config with `supportsImages: false`.
- [ ] 6.4.3 Codex bridge: translate `content` arrays to Responses API `input_text`/`input_image`; reject `file` parts with HTTP 415 + readable message; raise the JSON body limit to 48 MB with a 413 message above it.
- [ ] 6.4.4 Bridge `GET /health` returns `capabilities: { image: true, pdf: false }`; `chatgpt-codex.ts` feeds that into the capability cache during `readiness()`.
- [ ] 6.4.5 Tests: `gemini` parts snapshot (string path golden-snapshot unchanged), `openai-compat` reject path, `server/tests/` case for array-content translation + 415 on `file` + 413 on oversize.

**Exit:** every registered provider either transports attachments correctly or refuses them with a message the UI can show. All string-content snapshots unchanged.

---

## Phase 6.5 — State + UI

- [ ] 6.5.1 `studio-engine.ts`: `attachments: Attachment[]` and `attachmentsToJudge: boolean` on `StudioState`; actions `ADD_ATTACHMENTS`, `ATTACHMENT_READY`, `ATTACHMENT_FAILED`, `REMOVE_ATTACHMENT`, `CLEAR_ATTACHMENTS`, `SET_ATTACHMENTS_TO_JUDGE`; `RESET_SESSION` clears them. Reducer enforces `MAX_FILES`/`MAX_TOTAL_BYTES` (defence in depth) and auto-computes the `attachmentsToJudge` default per spec §6.2.
- [ ] 6.5.2 `src/ui/useAttachments.ts`: hook owning the `File` → dispatch lifecycle (`reading` → `extracting` → `ready`/`error`), object-URL creation for thumbnails, and revocation on remove/reset/unmount.
- [ ] 6.5.3 `src/ui/AttachmentChips.tsx`: chip list with thumbnail/icon, name, size, status, `Remove` button, error text, and the `aria-live="polite"` announcer.
- [ ] 6.5.4 `TaskInput.tsx`: `Attach` button + hidden input, drag & drop overlay with a depth counter, `paste` handler for `clipboardData.files`, counter becomes `~N tokens · +M from files`.
- [ ] 6.5.5 `src/ui/AttachmentCapabilityStrip.tsx`: `Vision: X of Y selected models`, per-slot disclosure, `Disable incompatible` action.
- [ ] 6.5.6 `JudgeConfig.tsx`: `Send attachments to judge` toggle bound to `attachmentsToJudge`, with the auto-off explanation.
- [ ] 6.5.7 Tests: `studio-engine` reducer cases (cap enforcement, remove, reset, judge default flip at the 4-image/4 MB thresholds); `TaskInput.test.tsx` drop/paste/reject-reason rendering; `AttachmentChips` a11y (labels, live region).

**Exit:** a user can attach, see, and remove files. Nothing is sent yet.

---

## Phase 6.6 — Pipeline + run controller

- [ ] 6.6.1 `pipeline.ts`: `renderAttachmentBlocks(attachments)` implementing spec §6.3 (delimiter stripping, numbering, DATA-not-instructions banner, total-char truncation).
- [ ] 6.6.2 `pipeline.ts`: `draftMessages` accepts `attachments` + per-job `capabilities`; returns identical output to today when `attachments` is empty/absent.
- [ ] 6.6.3 `pipeline.ts`: `judgeMessages`/`fusionMessages` accept `attachments` + `includeNativeMedia`; add the "attachments you cannot see" line when media is withheld; JSON contract stays last and unconditional.
- [ ] 6.6.4 `pipeline.ts`: `checkAttachmentEligibility(slots, attachments)` → `{ ok } | { blocked: string } | { autoDisable: slotIds[], reason }` implementing spec §5.1.
- [ ] 6.6.5 `run-controller.ts`: call the eligibility check before `FANOUT_START`; dispatch a blocked/auto-disabled outcome; thread attachments into all three message builders. Abort/retry paths carry the same attachment set (retry must reproduce the original candidate's input exactly).
- [ ] 6.6.6 `RunButton`/`rsemble.tsx`: disable Run while any attachment is not `ready`, or when eligibility is `blocked`, with the reason as the tooltip/inline message.
- [ ] 6.6.7 Tests in `pipeline.test.ts` + `run-controller.test.ts`: attachment-free byte-identical message snapshots; delimiter-forgery input; injection payload still yields a parseable judge contract; block/auto-disable matrix (0/1/2 capable slots × 2/3/4 enabled); retry reuses attachments.

**Exit:** acceptance criteria §10.1–§10.5, §10.7 pass in tests. Live smoke test: one image, two vision models, Rank then Fuse.

---

## Phase 6.7 — Cross-cutting polish

- [ ] 6.7.1 `cost.ts`: `estimateAttachmentTokens` (text heuristic, image tile formula, native-PDF per-page estimate); wire into the Run button estimate.
- [ ] 6.7.2 `run-history.ts`: `RunRecord.attachments` metadata only; migrate/tolerate older records without the field.
- [ ] 6.7.3 `export-markdown.ts`: `## Attachments` section.
- [ ] 6.7.4 Object-URL leak audit + test (spec §10.8).
- [ ] 6.7.5 `README.md`: attachments quickstart, supported types, limits table, capability caveats.
- [ ] 6.7.6 `npm run check` clean; manual pass of every acceptance criterion in spec §10, including the 25 MB rejection and the mixed-capability block.

**Exit:** feature complete per spec §10; `TODOS.md` Phase 6 fully checked.

---

## Sequencing summary

| Phase | Deliverable | Blocked by | Ships behind |
|---|---|---|---|
| 6.0 | Docs | — | n/a |
| 6.1 | Types, classify, limits | 6.0 | not reachable from UI |
| 6.2 | Extraction | 6.1 | not reachable from UI |
| 6.3 | `ContentPart` + OpenRouter | 6.1 | attachment-free = unchanged |
| 6.4 | Gemini, openai-compat, bridge | 6.3 | attachment-free = unchanged |
| 6.5 | State + UI | 6.2, 6.4 | UI visible, nothing sent |
| 6.6 | Pipeline + controller | 6.5 | feature live |
| 6.7 | Cost, history, export, docs | 6.6 | polish |

## Test inventory (new files)

```
src/lib/attachments/classify.test.ts
src/lib/attachments/limits.test.ts
src/lib/attachments/extract.test.ts
src/lib/providers/content.test.ts          # ContentPart → OpenAI/Gemini mapping + golden snapshots
src/lib/providers/capabilities.test.ts
src/ui/AttachmentChips.test.tsx
server/tests/content-parts.test.ts         # bridge array-content translation, 415, 413
```
Extended: `pipeline.test.ts`, `run-controller.test.ts`, `studio-engine.test.ts`, `TaskInput.test.tsx`, `export-markdown.test.ts`, `run-history.test.ts`.

## Rollback

Every phase before 6.6 is additive and inert. If the feature must be pulled after 6.6,
reverting `run-controller.ts` and `pipeline.ts` to pass `attachments: []` disables it
end-to-end while leaving the UI harmless (chips render, nothing is transmitted); a
second commit can then hide the `Attach` button.
