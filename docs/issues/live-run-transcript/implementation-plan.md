# Fix plan — live run transcript readability

Companion to `analysis.md` in this folder. Cause IDs (B1–B5) refer to that document.

Ordering principle: fix the readability regression first (pure UI, no transport risk),
then the blank-card state, then — only after instrumented confirmation — the reasoning
delta channel. Steps 1–3 are independent of any provider behaviour.

---

## Step 1 — Live card renders the full text, streaming and done (B1, B3, B5)

Files: `src/ui/OutputPane.tsx`, new `src/ui/useStickToBottom.ts`

- [ ] 1.1 In `LiveCandidateCard`, replace the two mutually exclusive bodies (600-char tail vs `line-clamp-2` excerpt) with **one** body fed by a single source:

  ```ts
  const liveText =
    candidate.segments.length > 0
      ? candidate.segments.map((s) => s.text).join("\n\n")
      : (candidate.streamingText ?? "");
  ```

  Rationale: `segments` is populated by `CANDIDATE_RESULT` at the same moment `streamingText` is cleared, so this expression is continuous across completion — no flicker, no content loss. **Do not** change the reducer to keep `streamingText` after completion; duplicating the answer in two state fields is the worse fix.
- [ ] 1.2 Delete the `streamingTail` slice entirely. The body renders `liveText` in full with `whitespace-pre-wrap break-words` inside `min-h-0 flex-1 overflow-y-auto scroll-thin`.
- [ ] 1.3 Keep the blinking caret span, but render it only while `active`.
- [ ] 1.4 Remove `line-clamp-2` from the done branch. The done card body is the same scrollable element, scroll position preserved, plus a small footer row with `{tokensOut} tok · {elapsed}s`.
- [ ] 1.5 Keep the `<ul>` grid stretch (`OutputPane.tsx:83`) — with a full-height scrollable body the stretch is now correct. Add `min-h-0` where needed so the inner `overflow-y-auto` actually scrolls instead of expanding the card.
- [ ] 1.6 Add a per-card `copy` button (mirrors `CandidateAnswer`) so a finished answer can be lifted during the judge stage without waiting for the run to end.

**Guard:** state shape unchanged; `pipeline.ts` and `run-controller.ts` untouched.

## Step 2 — Stick-to-bottom instead of forced scroll (B2)

- [ ] 2.1 New hook `src/ui/useStickToBottom.ts`:
  - `const { ref, onScroll } = useStickToBottom(dep)`.
  - Tracks `pinned` in a ref, updated in `onScroll` via `scrollHeight - scrollTop - clientHeight <= 32`.
  - On `dep` change, scrolls to the end **only if** `pinned` is true; on mount `pinned = true`.
- [ ] 2.2 Replace the unconditional effect at `OutputPane.tsx:286-290` with the hook.
- [ ] 2.3 When `pinned` is false while `active`, render a small `Jump to latest ↓` button pinned to the card's bottom-right that re-pins on click. This is what makes reading mid-stream possible: scroll up freely, then rejoin.
- [ ] 2.4 Keep the exported `scrollLiveTranscriptToEnd` helper (it is unit-tested); the hook calls it, so `OutputPane.test.tsx:33-37` keeps passing unchanged.

## Step 3 — Honest pre-first-token state (B4a)

- [ ] 3.1 When `active && liveText.length === 0`, render an explicit waiting block instead of nothing: three shimmering skeleton lines plus `waiting for first token · {elapsed}s`.
- [ ] 3.2 After 15s with no delta, swap the caption to `still waiting — model may be thinking before it emits text` (warning tone, not error). Threshold as a named constant `FIRST_TOKEN_PATIENCE_MS`.
- [ ] 3.3 Announce the transition once through the existing status pill semantics; do not add a second live region per card (would flood AT during a 3-model fanout).

## Step 4 — Confirm the reasoning-delta hypothesis before coding (B4b)

- [ ] 4.1 Add a **temporary** dev-only log in `readSseChatStream` (`if (import.meta.env.DEV) console.debug("[sse]", payload.slice(0, 200))`) and do one `umans-glm-5.2` run.
- [ ] 4.2 Record the finding in this folder as `sse-capture.md` (redact any ids): do early chunks carry `delta.reasoning_content`, `delta.reasoning`, or nothing at all?
- [ ] 4.3 **If reasoning fields are present**, proceed to Step 5. **If not**, close B4b as not-applicable — the blank card was Step 3's problem only — and remove the log.

## Step 5 — Reasoning channel (conditional on Step 4)

Files: `src/lib/providers/sse-stream.ts`, `src/lib/providers/types.ts`, `src/lib/run-controller.ts`, `src/studio-engine.ts`, `src/ui/OutputPane.tsx`

- [ ] 5.1 Widen `SseChunk` to `delta?: { content?: string; reasoning?: string; reasoning_content?: string }`.
- [ ] 5.2 Change the generator's yield type from `string` to a tagged chunk: `{ kind: "text" | "reasoning"; text: string }`. This is a breaking signature change on `LLMProvider.chatCompletionStream`, so it must be applied to **every** adapter (`openrouter`, `gemini`, `openai-compat`, `chatgpt-codex`) in the same commit.
- [ ] 5.3 `yieldedAny` must remain driven by **text** deltas only: a stream that emits reasoning and then dies still has no answer, and must still throw the empty-stream `ProviderError`. This preserves the `isUsableCandidate` contract.
- [ ] 5.4 Reasoning text must **never** enter `content`, `segments`, `summary`, the judge prompt, or `estimateTokens` output. It is display-only telemetry.
- [ ] 5.5 Route reasoning through a separate `reasoningText` field on `Candidate` via a new `CANDIDATE_REASONING_DELTA` action, cleared by `CANDIDATE_RESULT` like `streamingText`.
- [ ] 5.6 UI: while `active` and no text has arrived, show `thinking… {n} chars` with a collapsed disclosure to read the reasoning. Once text starts, collapse the reasoning block automatically.
- [ ] 5.7 If Step 5 is not needed, skip entirely — do not widen the provider contract speculatively.

## Step 6 — Tests

- [ ] 6.1 `OutputPane.test.tsx`: assert a done candidate's card contains the **full** joined `segments` text (add a fixture with 3 paragraphs and assert paragraph 3 is present), and that `line-clamp-2` is absent.
- [ ] 6.2 `OutputPane.test.tsx`: assert a streaming candidate with 2000 chars of `streamingText` renders the **first** characters as well as the last (i.e. no tail truncation, no leading `…`).
- [ ] 6.3 New `src/ui/useStickToBottom.test.ts`: pinned → scrolls on dep change; unpinned (scrollTop far from bottom) → does not scroll; re-pin on returning to the bottom threshold.
- [ ] 6.4 `OutputPane.test.tsx`: `active` + empty text renders the waiting caption; `active` + text does not.
- [ ] 6.5 If Step 5 lands: `sse-stream.test.ts` cases for reasoning-only chunks (no text yield, `[DONE]` after reasoning-only still throws empty-stream), mixed reasoning→text, and `run-controller.test.ts` proof that reasoning text never reaches `segments`/judge messages.
- [ ] 6.6 `npm run check`.

## Step 7 — Manual verification

- [ ] 7.1 Three-model run (1 fast, 1 slow, 1 thinking): each card streams full text, scroll-up holds position, `Jump to latest` re-pins.
- [ ] 7.2 At the moment a candidate flips to `DONE`, the visible text does **not** shrink or jump.
- [ ] 7.3 During the judge stage, all finished answers are fully readable and copyable from the live grid.
- [ ] 7.4 Abort mid-stream: partial text remains visible, no scroll thrash, no console errors.
- [ ] 7.5 A candidate that fails after partial output still shows its error row plus the partial text.

---

## Non-goals for this fix

- No change to `pipeline.ts` prompt assembly, judge contract, or `isUsableCandidate`.
- No Markdown rendering in the live card — plain text during streaming avoids per-frame parsing of half-open code fences. Markdown stays in the post-run surfaces (`CandidateAnswer`, `CompareView`, `FuseResult`).
- No change to `StreamDeltaBuffer` rAF batching; it is not a cause (analysis §C).
- Not fixing `CandidateAnswer`'s collapsed-by-default behaviour in `RankResult` here; once Step 1 lands the live grid is readable, and the post-run default is a separate UX decision.

## Rollback

Steps 1–3 are contained in `src/ui/OutputPane.tsx` plus one new hook file; reverting that
commit restores the current behaviour with no state or provider implications. Step 5 is a
separate commit because it touches the provider contract.
