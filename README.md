# Adaptive Fusion

> Put multiple AI models on the same task at once, then choose your finish:
> **Rank** them, or **Fuse** them into one answer.

One pipeline. Two finish lines. The Rank/Fuse toggle is the only switch in the product.

The full product direction, scope, and IN/OUT boundary live in
**[PRODUCT.md](./PRODUCT.md)** — that file is the source of truth. If anything here
conflicts with it, PRODUCT.md wins.

---

## What it does

```
Input → Rubric → Fanout (N models in parallel) → Judge
                                                       │
                                    ┌─────────────────┴──────────────────┐
                                  RANK                               FUSE
                          "Use Claude for this."           "Here's the merged answer."
```

- **Up through Judge**, the pipeline is identical for both modes.
- At the fork you pick, per run:
  - **RANK** — stop at Judge. Promote scores to the headline result: a leaderboard +
    a single recommendation of which model to use for this kind of task.
  - **FUSE** — continue into the synthesizer. Return one merged Markdown answer,
    visibly stronger than any single model's draft.

---

## Stack

- React 18 + TypeScript
- Vite 5
- Tailwind CSS 3
- lucide-react

## Getting started

```bash
npm install
cp .env.example .env   # then paste your OpenRouter key
npm run dev
```

Open the printed local URL (default http://localhost:5173).

## OpenRouter setup (live LLM calls)

This app calls real models through [OpenRouter](https://openrouter.ai). The browser
reads the key at build time from a Vite env var.

1. Get a key at https://openrouter.ai/keys
2. Create a `.env` file at the project root:

   ```bash
   VITE_OPENROUTER_KEY=sk-or-v1-...
   ```

3. Restart `npm run dev` (Vite only reads env vars at startup).

If no key is present the app still loads but shows a banner and live runs are disabled.

> **Note:** with build-time `VITE_` vars the key is embedded in the client bundle, so
> this setup is intended for **local/personal use only**. For a shared deployment,
> move the calls behind a server proxy instead.

### Models

Model slots use OpenRouter slugs (e.g. `z-ai/glm-5.2`). When a key is configured the
full live catalog is fetched for autocomplete in the **+ add** combobox; you can also
type any valid slug directly (e.g. a brand-new model not yet in the catalog). All
slots are equal fanout participants — there are no roles (draft/critic/verifier) in
this product. The Judge/Fusion model is separately configurable in the Command pane.

---

## UI direction — Split Workspace (Variation B)

The rebuild target is a two-pane IDE-like layout:

- **Left pane (command):** task input, models, a collapsed optional rubric. Identical
  in both modes.
- **Right pane (output):** RANK → leaderboard + recommendation. FUSE → one merged
  document.
- **Header:** identity, run status, and the **Rank/Fuse toggle** (the sole switch).

The interactive mock with all three explored variations is in
**[ui-variations.html](./ui-variations.html)**; Variation B is the chosen one.

> **Current state:** `src/OrchaStudio.tsx` is the *prior* studio UI (node canvas +
> inspector + Frankenstein picker + scorecard dashboard) and does **not** yet reflect
> the focused direction. It is scheduled for rebuild per `TODOS.md`. The valuable,
> reusable pipeline logic (`src/lib/pipeline.ts`, `src/studio-data.ts`) is kept and
> will be re-housed in the new two-pane component.

---

## Project structure

```
.
├── PRODUCT.md          # ← source of truth: what this product is & is not
├── DESIGN.md           # visual system (color/type/spacing/motion)
├── CLAUDE.md           # agent operating rules (points to PRODUCT.md)
├── ui-variations.html  # the 3 UI explorations (Variation B chosen)
└── src/
    ├── OrchaStudio.tsx # prior studio UI — pending rebuild
    ├── studio-data.ts  # domain types + seed state   (kept)
    ├── main.tsx        # entry point
    ├── index.css       # Tailwind layers + scrollbar styling
    └── lib/
        ├── openrouter.ts  # OpenRouter client   (kept)
        └── pipeline.ts    # prompt/fanout/judge/fusion logic — THE GOLD (kept)
```

---

## Working on this project

Read **[PRODUCT.md](./PRODUCT.md)** first. The scope fence there (IN/OUT) is the
contract. If a feature isn't in the IN table, it's a scope decision, not a TODO —
add it via `DECISIONS.md`, not by quietly building it.
