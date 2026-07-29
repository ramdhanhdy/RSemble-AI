# Issue: live run transcript is unreadable, and finished candidates show 2 lines

**Reported:** 2026-07-29, during a live 3-model run (umans-glm-5.2, Qwen3.7 Flash, Kimi).
**Symptoms as reported:**
1. While a model is generating, it does not feel live — text flies past too fast to read.
2. One model (`umans-glm-5.2`) sat at `43s GENERATING` with a completely empty card.
3. The two finished (`DONE`) models each show only 1–2 lines of text inside a very tall, mostly empty card.

**Verdict: valid.** Three of the four causes are confirmed in code and fully explain the
screenshot. The fourth (empty umans card) has one confirmed contributing cause and one
hypothesis that needs a 1-line instrumentation check (§B4).

---

## A. What the screenshot actually shows

| Card | Rendered by | What's on screen | Why |
|---|---|---|---|
| `umans-glm-5.2` — `43s GENERATING` | `LiveCandidateCard`, `active` branch | nothing | `streamingTail.length > 0` is false ⇒ the whole transcript block is unmounted (`@/e:/2026/RSemble-AI/src/ui/OutputPane.tsx:323`). Zero deltas have arrived in 43s. |
| `Qwen3.7 Fl…` — `318 tok 22s DONE` | `LiveCandidateCard`, `done` branch | 2 lines ending in `…` | `excerpt = segments[0].text` clamped by `line-clamp-2` (`OutputPane.tsx:268-271`, `:329-331`). |
| `MoonshotAI: Kimi…` — `297 tok 14s DONE` | same | 1 line | Its first paragraph is a single short sentence, so the 2-line clamp isn't even filled. |

The user's phrase "only showed the last few lines" is actually the **first paragraph,
clamped to two lines**. Either way the complaint is right: 318 tokens were generated and
~15 words are readable, inside a ~500px-tall card.

---

## B. Root causes

### B1. Confirmed — the live transcript is a rolling 600-character tail window

```@/e:/2026/RSemble-AI/src/ui/OutputPane.tsx:272-273
  const streaming = candidate.streamingText ?? "";
  const streamingTail = streaming.length > 600 ? "…" + streaming.slice(-600) : streaming;
```

`streamingText` in state holds the **full** accumulated answer (`@/e:/2026/RSemble-AI/src/studio-engine.ts:243-253`), but the view throws away everything except the last 600 chars on every frame. Consequences:

- Text that scrolled past is **gone from the DOM**, so scrolling up to read it is impossible — the container's `overflow-y-auto` has almost nothing to scroll.
- The visible window is a treadmill: each rAF flush replaces the head with new tail, so the paragraph the user was reading shifts upward and then disappears. This is precisely the "too fast, I can't even read it" sensation. It is *not* a wrapping problem and *not* a missing-stream problem.

### B2. Confirmed — auto-scroll fights the user on every delta

```@/e:/2026/RSemble-AI/src/ui/OutputPane.tsx:286-290
  useEffect(() => {
    if (active && streamingTail && transcriptRef.current) {
      scrollLiveTranscriptToEnd(transcriptRef.current);
    }
  }, [active, streamingTail]);
```

`scrollTop = scrollHeight` is applied unconditionally on every transcript change (one per animation frame while tokens flow). There is no "is the user near the bottom?" check, so any attempt to scroll back is reverted within ~16ms. Combined with B1 the transcript is effectively unreadable until the stream ends.

### B3. Confirmed — completion *destroys* the transcript instead of promoting it

`CANDIDATE_RESULT` sets `streamingText: ""` and fills `segments`:

```@/e:/2026/RSemble-AI/src/studio-engine.ts:233-241
    case "CANDIDATE_RESULT":
      return {
        ...state,
        candidates: state.candidates.map((c) =>
          c.id === action.id
            ? { ...c, status: "done", segments: action.segments, summary: action.summary, streamingText: "", finishedAt: action.finishedAt, tokensIn: action.tokensIn, tokensOut: action.tokensOut }
            : c
        ),
      };
```

The data is not lost (`segments` has everything), but the **view** swaps from "scrollable transcript" to "2-line clamp of paragraph 1". So at the exact moment the answer becomes complete and readable, the UI shows *less* of it than it did a frame earlier. During the run there is no other surface that shows a finished candidate's full text: `CandidateAnswer` and `CompareView` only mount after `state.running` goes false (`@/e:/2026/RSemble-AI/src/ui/OutputPane.tsx:72-89` vs `:109-130`), and even then `CandidateAnswer` is collapsed for every candidate except rank 1 (`@/e:/2026/RSemble-AI/src/ui/RankResult.tsx:116`).

So while the judge stage runs (which can take 10–30s), the user is looking at finished answers they cannot read at all.

### B4. The empty `GENERATING` card — two causes

**B4a. Confirmed (presentation):** an in-flight candidate with zero deltas so far renders *nothing* — no skeleton, no "waiting for first token", no "thinking" state. `streamingTail.length > 0` gates the entire block. A 43-second blank rectangle is indistinguishable from a hung UI, which is why the user suspected streaming was broken.

**B4b. Hypothesis (transport) — reasoning deltas are dropped.** The shared SSE reader only recognises `choices[0].delta.content`:

```@/e:/2026/RSemble-AI/src/lib/providers/sse-stream.ts:22-24
export interface SseChunk {
  choices?: { delta?: { content?: string } }[];
}
```

`glm-5.2` is a thinking model. OpenAI-compatible gateways emit its chain-of-thought as `delta.reasoning_content` (Zhipu/DeepSeek convention) or `delta.reasoning` (OpenRouter convention) and send `delta.content` only *after* the thinking block closes. If umans forwards those fields, the adapter silently discards every chunk for the whole thinking phase — exactly a long blank `GENERATING`, then a burst of visible text. That burst arriving all at once is the second half of the "it's not streaming, it's too fast" report.

The bridge proxy is **not** the culprit: `@/e:/2026/RSemble-AI/server/codex-bridge/umans.ts:138-148` streams the upstream body chunk-by-chunk with backpressure and does not buffer.

*Verification before implementing:* temporarily log `payload` in `readSseChatStream` for one umans run and inspect whether early chunks carry `reasoning_content`/`reasoning`. If they don't, B4b is not in play and only B4a applies. Do not implement a reasoning-channel change on speculation.

### B5. Confirmed — the grid stretches every card to full pane height

```@/e:/2026/RSemble-AI/src/ui/OutputPane.tsx:83
          <ul className="grid flex-1 grid-cols-1 gap-2 overflow-y-auto scroll-thin xl:grid-cols-2 2xl:grid-cols-3">
```

The `<ul>` is a `flex-1` child of a flex column, so it has a definite height. With a single implicit grid row and `align-content: normal` (behaves as `stretch`), that row absorbs all remaining height, so each card becomes ~500px tall no matter what it contains. That is the huge dead space in the screenshot. This is only a *bug* because the card body doesn't use the space (B1/B3); with a full-height scrollable transcript the stretch becomes desirable.

---

## C. What is NOT broken (ruled out)

| Suspicion | Finding |
|---|---|
| "Streaming isn't wired up" | It is: provider deltas → `streamBuffer.push` (`@/e:/2026/RSemble-AI/src/lib/run-controller.ts:69-83`) → rAF flush → `CANDIDATE_DELTA` (`@/e:/2026/RSemble-AI/src/rsemble.tsx:79-85`). Qwen/Kimi visibly streamed. |
| "Text wrapping is broken" | The transcript uses `whitespace-pre-wrap break-words` (`OutputPane.tsx:324`); wrapping is correct. The truncation is `line-clamp-2` and the 600-char window, not wrapping. |
| "rAF batching is too coarse / causes bursts" | One flush per frame (≤60/s) is the right granularity; `StreamDeltaBuffer` is correct and tested. |
| "The bridge buffers the SSE response" | No — it pipes with backpressure (`server/codex-bridge/umans.ts:139-142`). |
| Escaped-content / Markdown cost during streaming | The live transcript renders plain text, not Markdown; no per-frame parse cost. |

---

## D. Severity

| Cause | Severity | Why |
|---|---|---|
| B3 (completion shows less than streaming did) | **High** | The product's core output is unreadable for the whole judge stage. |
| B1 + B2 (tail window + forced scroll) | **High** | Makes the live stage decorative rather than informative. |
| B4a (blank in-flight card) | Medium | Looks like a hang; erodes trust in the run. |
| B4b (dropped reasoning deltas) | Medium, unconfirmed | If real, thinking models appear dead for tens of seconds. |
| B5 (stretched cards) | Low | Cosmetic once B1/B3 fill the space. |

---

## E. Design target

The live card should be the **single continuous surface** for one candidate's output:

1. Before the first token: an explicit waiting state (elapsed timer + "waiting for first token", and "thinking…" if a reasoning channel is detected).
2. While streaming: the **entire** accumulated text, wrapped, in a scrollable body that sticks to the bottom **only while the user is already at the bottom**.
3. On completion: the same body, same scroll position, now showing the full answer from `segments` — nothing is removed, nothing is clamped. The status pill flips to `DONE` and token/latency numbers appear.
4. The card never contains a truncated `…` excerpt; truncation belongs to the post-run leaderboard, not to the run view.

That single change resolves B1, B2, B3, B4a and turns B5 into an asset.

Fix sequencing is in `implementation-plan.md` in this folder.
