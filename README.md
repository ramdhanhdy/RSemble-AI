# RSemble AI

Run several AI models on the same task at once, then choose your finish:
**Rank** which one is best, or **Fuse** them into a single answer.

One pipeline, two finish modes — a single toggle decides the outcome per run.

```
Task → Rubric → Compare (N models in parallel) → Judge
                                                       │
                                    ┌─────────────────┴──────────────────┐
                                  RANK                               FUSE
                          "Use this model."                "Here's the merged answer."
```

![The RSemble AI workspace — task and model roster on the left, output pane on the right.](docs/screenshots/rank.png)

## Features

**The run**
- **Multi-model comparison** — several models generate answers to the same task in parallel
- **Live catalog** — pick models from the live OpenRouter catalog, or type any slug
  directly so brand-new models work before they're cataloged
- **Rubric-driven judging** — define what "good" means; the judge scores each candidate
  and surfaces consensus, contradictions, and unique insights
- **Configurable judge** — set the model that scores candidates and synthesizes fusion

**Two finishes**
- **Rank** — a leaderboard with tier-colored scores, a recommendation callout, and every
  candidate's full answer rendered as Markdown
- **Fuse** — one merged answer synthesized from the strongest material across candidates,
  with each source expandable to see what it contributed

**The experience**
- **Live pipeline** — watch each model stream token-by-token through Generating →
  Judging → Fusing, and fuse a finished rank run with one click
- **Responsive** — two-pane workspace on desktop, stacked on tablet, output-first with a
  command drawer on mobile
- **Accessible** — keyboard-navigable, focus-visible throughout, reduced-motion aware

## Quick start

```bash
npm install
npm run dev
```

Open the printed local URL (default http://localhost:5173).

### OpenRouter key

RSemble AI calls real models through [OpenRouter](https://openrouter.ai).

1. Get a key at https://openrouter.ai/keys
2. Create a `.env` file at the project root:

   ```bash
   VITE_OPENROUTER_KEY=sk-or-v1-...
   ```

3. Restart `npm run dev` — Vite reads env vars only at startup.

Without a key the app still loads, shows a banner, and disables live runs.

> **Local/personal use only.** Build-time `VITE_` vars are embedded in the client bundle.
> For a shared deployment, move the OpenRouter calls behind a server proxy.

## How a run works

1. **Describe the task** in the command pane.
2. **Enable the models** you want to compare, or add new ones by slug.
3. **Add a rubric** *(optional)* so "good" is explicit for the judge.
4. **Run the pipeline** — candidates stream in as each model generates.
5. **Finish**: read the **Rank** leaderboard and recommendation, or flip to **Fuse** for
   one merged answer.

Rank and Fuse share the same pipeline and fork only at the finish, so you can start in
either mode and switch per run.

## Tech stack

React 18 · TypeScript · Vite 5 · Tailwind CSS 3 · lucide-react
