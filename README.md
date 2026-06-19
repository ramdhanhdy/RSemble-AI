# Adaptive Fusion

Put multiple AI models on the same task at once, then choose your finish:
**Rank** which one to use, or **Fuse** them into one answer.

One pipeline, two finish modes — a single toggle decides the outcome per run.

```
Task → Rubric → Fanout (N models in parallel) → Judge
                                                       │
                                    ┌─────────────────┴──────────────────┐
                                  RANK                               FUSE
                          "Use this model."                "Here's the merged answer."
```

Built for the recurring question: *"which model is actually best for this kind of
task?"* Run several models on a real task, get a defensible ranking — or fuse the
strongest material from all of them into a single, stronger answer.

## Features

- **Multi-model fanout** — run several models on the same task in parallel
- **Configurable model roster** — pick from the live OpenRouter catalog, or type any
  slug directly (so brand-new models work before they're cataloged)
- **Configurable judge** — set the model that scores candidates and synthesizes fusion
- **Rubric-driven judging** — define what "good" means; the judge scores each
  candidate and reports consensus, contradictions, and unique insights
- **Rank mode** — leaderboard with tier-colored scores, a recommendation callout, and
  every candidate's full answer rendered as Markdown
- **Fuse mode** — one merged answer synthesized from all candidates, with each source
  expandable to read what it contributed
- **Live pipeline** — stream each model's generation token-by-token, watch the
  Generating → Judging → Fusing stages advance, and fuse a finished rank run with one
  click
- **Responsive** — two-pane workspace on desktop, stacked on tablet, output-first with
  a command drawer on mobile
- **Accessible** — keyboard-navigable, focus-visible throughout, reduced-motion aware

## Stack

React 18 · TypeScript · Vite 5 · Tailwind CSS 3 · lucide-react

## Quick start

```bash
npm install
cp .env.example .env   # then paste your OpenRouter key
npm run dev
```

Open the printed local URL (default http://localhost:5173).

## OpenRouter setup

Adaptive Fusion calls real models through [OpenRouter](https://openrouter.ai).

1. Get a key at https://openrouter.ai/keys
2. Create a `.env` file at the project root:
   ```bash
   VITE_OPENROUTER_KEY=sk-or-v1-...
   ```
3. Restart `npm run dev` (Vite reads env vars only at startup)

If no key is present, the app loads but shows a banner and live runs are disabled.

> **Local/personal use only.** With build-time `VITE_` vars the key is embedded in
> the client bundle. For a shared deployment, move the OpenRouter calls behind a
> server proxy.

## Models

Model slots use OpenRouter slugs (e.g. `z-ai/glm-5.2`). When a key is configured the
full live catalog is fetched for autocomplete in the **+ add** combobox; you can also
type any valid slug directly (e.g. a brand-new model not yet in the catalog). All slots
are equal fanout participants — there are no roles (draft/critic/verifier). The
Judge/Fusion model is separately configurable in the command pane.

## How a run works

1. **Task** — describe the job in the command pane
2. **Models** — enable the models you want to compare (or add new ones)
3. **Rubric** *(optional)* — add criteria so "good" is explicit for the judge
4. **Run pipeline** — candidates stream in as each model generates
5. **Rank** — get a leaderboard + recommendation; expand any candidate's full answer
6. **Fuse** — flip the toggle (or click *Fuse these candidates*) to synthesize one
   merged answer from the run

Rank and Fuse share the same spine and fork only at the finish — so you can start in
either mode and switch per run.

## Project structure

```
.
├── PRODUCT.md          # what this product is & is not (source of truth)
├── DESIGN.md           # visual system (color / type / spacing / motion)
├── UI.md               # interaction spec (Split Workspace)
├── DECISIONS.md        # dated log of scope decisions
└── src/
    ├── AdaptiveFusion.tsx   # root — shell + pipeline orchestration
    ├── studio-engine.ts     # state + reducer
    ├── studio-data.ts       # domain types + seeds
    ├── ui/                  # Command pane, Output pane, and result components
    └── lib/
        ├── openrouter.ts    # OpenRouter client (incl. streaming)
        └── pipeline.ts      # prompt construction, fanout, judge, fusion
```

## Documentation

- **[PRODUCT.md](./PRODUCT.md)** — the product's direction and scope (source of truth)
- **[DESIGN.md](./DESIGN.md)** — the visual system
- **[UI.md](./UI.md)** — the interaction spec
- **[DECISIONS.md](./DECISIONS.md)** — why the scope is what it is

## Working on this project

Read [PRODUCT.md](./PRODUCT.md) first — its scope fence (IN/OUT) is the contract.
Anything outside the IN table is a scope decision that belongs in DECISIONS.md, not a
quiet addition.
