# RSemble AI — Runs IA Prototypes

**Status: Exploratory — non-authoritative. Does not authorize application changes or modify current product authority.**

## How to open

Open `index.html` in a browser. It links to all four prototypes. Alternatively, open any prototype directly:

- `baseline.html` — Fair Baseline
- `first-class-runs.html` — Candidate A (First-Class Runs)
- `secondary-records.html` — Candidate B (Secondary Records)
- `corpus-views.html` — Candidate D (Corpus Views)

All files use `shared.css` (design system) and `shared.js` (synthetic dataset). No build step required.

## Purpose of each prototype

### Fair Baseline
The current three-destination model (Compare | Runs | Evaluations) with contextual connections repaired. Tests: if the existing surfaces are properly connected, does the current model already feel coherent?

### Candidate A — First-Class Runs
Runs as a rebuilt first-class corpus workspace with grouping, experiment containers, attention indicators, and richer detail. Tests: if corpus browsing genuinely deserves a primary workspace, what should that experience feel like?

### Candidate B — Secondary Records
Compare and Evaluations are primary; Records accessed via a slide-over drawer. Tests: does RSemble feel more focused when records are globally available but secondary?

### Candidate D — Corpus Views
Runs stays top-level but gets internal segmented views (Recent, From Compare, From Evaluations, Needs Attention). Tests: is the discomfort caused by flattening several kinds of evidence into one list rather than by Runs being top-level?

## Scenarios to try

1. **Compare → persisted record**: Run a comparison, then inspect the persisted record via "View record"
2. **Run Detail → Compare**: Open a previous run's configuration in Compare via "Open in Compare"
3. **Evaluation → Judge evidence**: From an Evaluation result, reach the exact underlying run evidence
4. **Find older run**: Find a specific older ad-hoc run with only partial memory of the task
5. **Inspect failure**: Inspect a failed run and determine what happened
6. **Browse corpus**: Browse several records because the corpus itself is the object of investigation
7. **Return after gap**: Return to the app and locate recent or unfinished work

## What to pay attention to

- Where did you instinctively look first?
- Did you know where to find the record you wanted?
- Did you need one known record or the corpus?
- Did anything feel buried?
- Did anything feel unnecessarily prominent?
- Which prototype best matched how you think about RSemble?
- What still felt wrong in the prototype you preferred?

## Known prototype limitations

- These are static HTML prototypes — no real LLM calls, no IndexedDB persistence
- The "Run comparison" button simulates a result; it does not execute a real comparison
- No virtualization or pagination — the synthetic dataset has 11 runs
- No responsive/mobile layout testing
- No running/aborted states modeled (all runs are terminal)
- The browser automation tool may not auto-execute inline scripts — if a page appears blank, refresh

## Qualitative feedback template

After trying the prototypes, note your observations:

```
Which prototype felt most natural? __________
Which prototype felt most focused? __________

Where did I instinctively look first for records?
  [ ] Runs nav item
  [ ] Records button/drawer
  [ ] From the context I was already in
  [ ] Other: __________

Did I need one known record or the corpus?
  [ ] One known record
  [ ] The corpus

Did anything feel buried? __________
Did anything feel unnecessarily prominent? __________

What still felt wrong in the prototype I preferred? __________

Would I miss Runs as a top-level destination if it were removed?
  [ ] Yes — I'd miss it
  [ ] No — secondary access is sufficient
  [ ] Unsure
```
