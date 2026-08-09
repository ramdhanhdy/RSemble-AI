«Status: Exploratory — non-authoritative. Does not authorize application changes or modify current product authority.»

# Runs IA — Next Step

**Repository:** `/opt/data/projects/RSemble-AI` · master @ `0b01e69`
**Date:** 2026-08-09
**Executive verdict:** Gate A PASS · Gate B PASS

---

## 1. What exact changes are required to create a fair baseline?

Five S-class connective-tissue changes. All are presentation/navigation only — no schema, lifecycle, lineage, retention, or provenance changes.

| # | Change | Where it lives | What it fixes |
|---|---|---|---|
| 1 | Compare → "View record" link on live result | Compare (OutputPane/RankResult) | User must hunt in Runs for the run they just watched |
| 2 | Run Detail → "Open in Compare" (no lineage) | Run Detail | User must manually reconstruct config to relaunch |
| 3 | Copy-link UI ("this device") | Run Detail + Runs list | User must hand-copy URL from address bar |
| 4 | URL-persistent filters | Runs list (RunFilters) | Filter state lost on navigation/reload |
| 5 | Grouping by source + counts | Runs list (RunList) | Mixed grains in flat feed; user can't tell what they're looking at |

**Not in the baseline** (frozen or deferred):
- Provider filter, full-prompt search, virtualization — S-class but destination-improving → frozen
- Badges, attention surfaces, segmented views — N-class (navigation-dependent) → parked
- Lineage (`rebasedFrom`), archive/delete/retention — P-class (product-semantic) → deferred
- Reconciliation — X-class: **already ships at HEAD** (`recoverInterruptedRuns` via `ExperimentControllerProvider`)

## 2. Which proposed changes remain frozen?

All of these are frozen until the navigation decision is made:

- New segmentation or smart views
- Advanced filtering (provider filter, full-prompt search)
- New browsing modes or virtualization
- Dashboard-like counts (beyond simple group counts in the baseline)
- "Needs Attention" redesigns
- Corpus-management tools (archive/delete/retention)
- Major grouping architecture
- Destination-specific badges
- Renaming/repositioning

**Reason:** Improving the Runs destination during the experiment would progressively implement Candidate A and contaminate the comparison.

## 3. Which changes require explicit product decisions?

| Change | Classification | What decision is needed |
|---|---|---|
| Record-level `rebasedFrom` lineage for ad-hoc relaunches | **P** | New persisted field — product-authority decision |
| Archive/delete/retention policy | **P** | New authority (no `deleteRun` exists; no retention policy anywhere) |
| Nav badges / attention surfaces | **N** | Depends on placement (A's nav badge vs B's action-zone button); #10.4 amendment |
| Segmented views (D-Presentation) | **N** | Absorbable into A or B as views; parked pending compression-diagnosis measurement |
| "Needs Attention" semantics (D-Semantics) | **P** | What counts as needs-attention, when work is abandoned — product rules |
| `interrupted` extension to ad-hoc | **X** | Already ships at HEAD via `recoverInterruptedRuns` — no decision needed |

## 4. Is the B-lite experiment ready to implement?

**Not yet — two readiness items remain:**

1. **Spec the reversible flag mechanism.** The B-lite deprivation trial requires a local feature flag that hides the Runs nav item. The mechanism is specified as a requirement (reversible, routes stay functional, escape hatch exists) but not yet specced at the code level. It must be implemented and its reversibility verified before Step 6.

2. **Smoke-test the escape hatch.** Before the B-lite trial starts, verify the command palette "Go to Runs" command (CommandPalette.tsx:91-95, already shipped) works and is discoverable enough for the Product Owner to use as the secondary access mechanism.

**The fairness baseline itself is ready to implement** — both Executive gates passed. The B-lite flag is needed only for Step 6 (deprivation trial), not for Steps 3-5 (fairness baseline + dogfooding + drills).

## 5. What evidence will end the experiment?

The experiment ends when one of these is true:

1. **Clear direction:** Multiple observations on one side, with at least one disconfirming observation on the same side tested and failed to hold
2. **Clear stalemate:** 2+ weeks of B-lite with no meaningful friction events and no corpus-seeking behavior → ambiguity default (keep current navigation)
3. **Decision deadline:** Product Owner declares the experiment concluded

**Predeclared observations** (from decision-protocol.md):

| Strengthening A | Weakening A | Strengthening B | Weakening B |
|---|---|---|---|
| Still deliberately opens corpus after contextual links exist | Most Runs visits disappear after contextual links | Contextual routes satisfy most record jobs | Hiding Runs causes retrieval/recovery failure |
| Tasks begin with "I need to browse Runs" | Destination is plumbing for known records | Removing nav causes little meaningful friction | Product Owner repeatedly seeks the corpus |
| Corpus-level recovery/audit repeatedly difficult when Runs hidden | Corpus browsing rarely provides independent value | Secondary escape hatch adequate | Corpus-level jobs can't be surfaced contextually |
| Secondary path strands important work | | Runs is occasional known-record retrieval | Secondary access frustrating during high-stakes work |

**B-lite caveat:** B-lite is a *stricter* deprivation than Candidate B's drawer (no visible affordance at all, only palette + URL). Observed friction may overstate real-B friction. The evidence review must discount friction attributable to the missing visible affordance vs. the missing prominence. This errs conservatively toward the ambiguity default (keep authority), which is the correct bias direction.

## 6. What is the default if evidence remains mixed?

> **Keep the existing navigation.**

This does NOT mean Candidate A wins. It means there is insufficient evidence to supersede current product authority. Compare / Runs / Evaluations remains the product authority only because no replacement has been approved.

If ambiguity remains after the planned experiment, stop and revisit only if concrete recurring pain later appears.

---

## Experiment sequence (reference)

| Step | What | When |
|---|---|---|
| 1 | Revalidate/classify changes | ✅ Done (fairness-boundary.md) |
| 2 | Freeze destination enhancements | ✅ Done (fairness-boundary.md §3) |
| 3 | Predeclare decision criteria | ✅ Done (decision-protocol.md) |
| 4 | Define minimum fairness changes | ✅ Done (fairness-boundary.md §2) |
| 5 | Executive fairness gate | ✅ Done — PASS |
| 6 | *(Later, authorized)* Implement minimum fairness changes | Pending authorization |
| 7 | Dogfood improved baseline | 1-2 weeks post-baseline |
| 8 | Run scenario drills | 7 drills, ~1 week |
| 9 | B-lite deprivation trial | 1-2 weeks |
| 10 | Review evidence | 1 week |
| 11 | Product Owner decision | A / B / ambiguity default |

**Total experiment: 4-6 weeks after fairness baseline ships.**

Steps 6-11 are NOT executed during this task. This task designs and validates the protocol only.

---

## Deliverables

| File | Content |
|---|---|
| `fairness-boundary.md` | S/P/N/X classification, fairness baseline, Runs freeze, A-by-accretion test, D split |
| `decision-protocol.md` | Decision question, evidence observations, ambiguity default, stopping rule |
| `dogfooding-protocol.md` | Diary template, 7 drills, B-lite design, failure criteria, experiment sequence |
| `next-step.md` | This document — Executive synthesis |

All documents carry the non-authoritative status label. No application code was modified. No authoritative documents were changed.
