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

### Provider Setup

RSemble AI supports multiple AI providers: **OpenRouter**, **ChatGPT Subscription (via Codex bridge)**, and **Gemini AI Studio**.

#### 1. OpenRouter

1. Get a key at [https://openrouter.ai/keys](https://openrouter.ai/keys).
2. Add to `.env`:
   ```bash
   VITE_OPENROUTER_KEY=sk-or-v1-...
   ```

#### 2. ChatGPT Subscription (Codex Bridge)

Use your ChatGPT subscription entitlements locally without Platform API key billing.

1. Authenticate with Codex CLI:
   ```bash
   npx @openai/codex login
   ```
2. Start RSemble with the local bridge:
   ```bash
   npm run dev:bridge
   ```
   *(Or run `npm run dev` to launch Vite)*
3. The bridge listens on `127.0.0.1:8787` and reads credentials from `~/.codex/auth.json` (or `%USERPROFILE%\.codex\auth.json`).

**Troubleshooting:**
- **Bridge unreachable:** Ensure `npm run dev:bridge` is running.
- **Not logged in:** Run `npx @openai/codex login` in terminal and restart bridge.
- **Port 8787 in use:** Set `RSEMBLE_CODEX_BRIDGE_PORT=8788` in `.env` and `VITE_CODEX_BRIDGE_URL=http://127.0.0.1:8788`.

#### 3. Gemini (Google AI Studio)

1. Get a key at [https://aistudio.google.com](https://aistudio.google.com).
2. Add to `.env`:
   ```bash
   VITE_GEMINI_KEY=AIzaSy...
   ```

> **Local/personal use only.** Build-time `VITE_` vars and local bridge are embedded for local execution.
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
