«Status: Exploratory — non-authoritative. Does not authorize application changes or modify current product authority.»

# Runs IA — Dogfooding Protocol

**Repository:** `/opt/data/projects/RSemble-AI` · master @ `0b01e69`
**Date:** 2026-08-09

---

## 1. Lightweight Diary Template

Complete this when a meaningful Run-related interaction occurs. Do NOT complete it for every routine click. The objective is qualitative recall of intent, stakes, and friction.

```
Date: __________
Time: __________

What was I trying to accomplish?
  [ ] Inspect one known record
  [ ] Browse/search across multiple records
  [ ] Recover/relaunch failed or interrupted work
  [ ] Audit/verify evidence
  [ ] Other: __________

Did I need one known record or the corpus?
  [ ] One known record
  [ ] The corpus (multiple records)

What context did I start from?
  [ ] Compare (live result or empty state)
  [ ] Evaluations (matrix/ledger/results)
  [ ] Runs list
  [ ] Run Detail (deep link)
  [ ] Other: __________

Where did I expect to find the information?
  [ ] From the context I was already in
  [ ] In the Runs collection
  [ ] Via a link I already had
  [ ] Other: __________

Did the available path work?
  [ ] Yes — found it directly
  [ ] Yes — but required extra steps
  [ ] No — had to use an alternative path
  [ ] No — could not find it

Did I use Runs because I wanted Runs, or because it was the only path?
  [ ] Wanted Runs (corpus-level intent)
  [ ] Only path (forced navigation)
  [ ] Unsure

How important was the job?
  [ ] Routine
  [ ] Important
  [ ] High-stakes (debugging/audit/recovery)

What friction occurred?
  [text]

(B-lite trial only) Was Runs nav hidden at this time?
  [ ] Yes — and I missed it
  [ ] Yes — but I found an alternative
  [ ] No
```

**Rules:**
- Do not turn the diary into product UI
- Do not require it for every routine click
- Complete within 2 minutes of the interaction
- If nothing meaningful happens for several days, that is itself data

---

## 2. Canonical Scenario Drills

Organic use may not naturally produce rare but important scenarios. Run these drills deliberately, in order, after the fairness baseline is in place.

### Drill 1: Find a specific older ad-hoc Run with partial memory
- **Starting state:** No Compare or Evaluation open; remember part of the task prompt but not the date
- **Success criterion:** Find the correct Run Detail within 3 minutes
- **Friction to record:** How many steps? Did you use search? Did you filter? Did you have to scan?
- **Primarily:** Single-record or corpus-level? (likely single-record with search)

### Drill 2: From Evaluation result, reach exact underlying Judge evidence
- **Starting state:** Open an Evaluation result (experiment results page)
- **Success criterion:** Land on the exact judge attempt evidence for a specific scored cell
- **Friction to record:** How many clicks? Was the path clear?
- **Primarily:** Single-record (contextual access)

### Drill 3: Inspect a failed or interrupted Run and determine what happened
- **Starting state:** Know a run failed but don't remember which one
- **Success criterion:** Find the failed run, read its error evidence, understand the cause
- **Friction to record:** How did you find it? Status filter? Corpus scan? Contextual link?
- **Primarily:** Could be either (contextual if from Evaluation; corpus if ad-hoc)

### Drill 4: Revisit a previous Run with intention to try a modified comparison
- **Starting state:** Remember a run from a previous session; want to change one model and re-run
- **Success criterion:** Successfully launch a new Compare with the old run's config, modified
- **Friction to record:** Did "Open in Compare" work? What was missing? Did you reconstruct manually?
- **Primarily:** Single-record → Compare bridge

### Drill 5: Start from a cold Run Detail deep link and understand its context
- **Starting state:** Open `#/runs/:runId` directly (simulate arriving via a shared link or bookmark)
- **Success criterion:** Understand what created this run, when, with what config, and from where
- **Friction to record:** Can you tell if it came from Compare or Evaluations? Can you reach the parent context?
- **Primarily:** Single-record (provenance inspection)

### Drill 6: Browse multiple historical records (corpus as object of investigation)
- **Starting state:** Want to compare approaches across several past runs on similar tasks
- **Success criterion:** Successfully browse, filter, and inspect 3+ runs in one session
- **Friction to record:** Did grouping help? Did search work? Was the corpus navigable?
- **Primarily:** Corpus-level

### Drill 7: Return after an extended gap and find relevant recent/unfinished work
- **Starting state:** Haven't used RSemble for several days; want to see what's recent and if anything needs attention
- **Success criterion:** Identify recent runs, any unfinished/failed/interrupted work, and what to do about it
- **Friction to record:** How did you find unfinished work? Status filter? Scanning? Did anything mislead you?
- **Primarily:** Corpus-level (status/recovery awareness)

---

## 3. B-lite Deprivation Trial

### Design
A **local feature flag** (or equivalently reversible mechanism) that temporarily hides the top-level Runs navigation item.

### Requirements
- Run routes (`/runs`, `/runs/:runId`) remain functional
- Existing deep links remain functional
- Contextual links (Compare → View record, Evaluation → View run) remain functional
- A known secondary escape hatch exists (command palette "Go to Runs" — already ships at `CommandPalette.tsx:90-96`)
- No data or authority changes occur
- Toggling the flag off immediately restores current navigation

### What B-lite is NOT
- It is NOT a polished Records drawer
- It is NOT a redesigned secondary access mechanism
- It is NOT Candidate B wholesale
- It does NOT change any routes, data, or semantics

### Escape hatch
The command palette "Go to Runs" command (already shipped) is the designated secondary access mechanism. Verify it works before starting the trial. Direct URL access (`#/runs`) also works (HashRouter).

### Purpose
> Experience RSemble without persistent Runs prominence and discover where that absence genuinely hurts.

This is a **deprivation trial**, not an A/B test. There is no "B surface" to test — only the absence of the Runs nav item, with all other access paths intact.

---

## 4. Predeclared B-lite Failure / Stranding Criteria

Because the Product Owner knows the experiment is active, subjective bias cannot be eliminated. Mitigate by predeclaring what counts as meaningful failure.

### Meaningful failure (counts toward weakening B)

- An important task cannot be completed without deliberately using the escape hatch
- Corpus access is needed repeatedly within ordinary workflows (not just drills)
- Recovery/debugging becomes meaningfully harder (not just slower)
- The user gives up or loses evidence context
- A corpus-level job repeatedly has no natural contextual entry
- The user repeatedly expects Runs to be visible and experiences **meaningful** — not merely habitual — friction

### NOT meaningful failure (do not count)

- Every instinctive click toward the old nav position (habit friction)
- First 3-5 days of adjustment (habituation period)
- Noticing the absence without it affecting task completion
- The escape hatch working as intended (that's the design, not a failure)

### Distinguish

| Type | What it means | Counts as |
|---|---|---|
| Habit friction | Hand reaches for old position; corrects quickly | Noise |
| Discoverability failure | Didn't know how to access Runs without the nav item | Data (fix discoverability, then retest) |
| Task failure | Could not complete the job at all | Meaningful failure |
| High-stakes recovery failure | Could not reach critical evidence during debugging/audit | Strong meaningful failure |

---

## 5. Optional Minimal Counters

If trivial local counters help correct diary recall, allow them. Do NOT build them if they require meaningful infrastructure.

### Allowed (if trivial)
- Number of Runs collection opens (`/runs` route visits)
- Run Detail entry source (referrer: Compare / Evaluation / Runs list / direct URL / command palette)
- Number of B-lite escape-hatch uses (command palette "Go to Runs" invocations)

### NOT allowed
- No analytics subsystem
- No complex event schema
- No analytics dashboard
- No remote telemetry
- No prompt/output content logging
- No large retention model
- No generalized tracking infrastructure

### Implementation constraint
If implementing counters requires more than a few lines of localStorage/IndexedDB event logging, do not use them. The diary is the primary decision mechanism; counters are secondary aids.

---

## 6. Recommended Experiment Sequence

### Step 1: Predeclare decision criteria (already done — see decision-protocol.md)
### Step 2: Executive Engineer fairness gate (Gate A)
### Step 3: (Later, authorized) Implement minimum fairness changes
### Step 4: Dogfood the improved baseline
- Use RSemble normally for 1-2 weeks with the fairness baseline in place
- Complete diary entries for meaningful Run-related interactions
- Do NOT hide Runs nav yet
- **Purpose:** establish post-fairness baseline behavior — does contextual access already reduce forced Runs visits?

### Step 5: Run canonical scenario drills (Drills 1-7)
- Complete all 7 drills with the fairness baseline in place
- Record friction for each
- **Purpose:** test both single-record and corpus-level jobs under fair conditions

### Step 6: Run B-lite deprivation trial
- Enable the local flag to hide Runs nav
- Continue normal use for 1-2 weeks
- Complete diary entries, noting B-lite status
- Run drills 1, 3, 4, 6, 7 again under B-lite conditions
- **Purpose:** experience the counterfactual — where does the absence of Runs prominence genuinely hurt?

### Step 7: Review evidence
- Review diary entries + drill friction records + any counters
- Apply predeclared criteria (decision-protocol.md §2)
- Apply ambiguity default if mixed (decision-protocol.md §3)

### Step 8: Product Owner decision
- Retain first-class Runs (A direction)
- Demote Runs (B direction)
- Retain current authority because evidence is mixed (ambiguity default)

### Timing
- Steps 4-6: 3-5 weeks total
- Step 7-8: 1 week
- Total experiment: 4-6 weeks
- If no meaningful friction events occur during B-lite (Step 6) within 2 weeks, apply the stopping rule
