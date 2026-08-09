«Status: Exploratory — non-authoritative. Does not authorize application changes or modify current product authority.»

# Runs IA — Decision Protocol

**Repository:** `/opt/data/projects/RSemble-AI` · master @ `0b01e69`
**Date:** 2026-08-09

---

## 1. Decision question

> After contextual connective tissue is in place (fairness baseline), does the Product Owner still need Runs as a persistent top-level navigation destination — or is secondary access sufficient?

This is NOT "is Candidate A better than Candidate B." It is: "when forced navigation through Runs is removed, does the Product Owner still deliberately seek the corpus?"

## 2. Observations

### Evidence strengthening A (keep first-class Runs)

- After contextual links exist, the Product Owner still deliberately opens the corpus to inspect multiple records (not a single known record)
- Meaningful tasks begin with "I need to browse/search across Runs" rather than from a known Compare or Evaluation context
- Corpus-level recovery/audit jobs repeatedly become difficult when Runs prominence is removed
- A secondary path repeatedly strands important work during the B-lite trial
- Multiple-record scanning or searching is itself the object of the session

### Evidence weakening A

- Most previous Runs visits disappear once contextual links exist
- The destination is primarily used as plumbing to reach a known Run Detail
- Corpus-level browsing rarely provides independent value beyond what contextual links offer

### Evidence strengthening B (secondary access is sufficient)

- Contextual routes satisfy most record-inspection jobs
- Removing the primary Runs nav causes little meaningful friction (not just habit friction)
- The remaining corpus needs are adequately served by a secondary escape hatch
- Runs is mostly used for occasional known-record retrieval, not corpus-level work

### Evidence weakening B

- Hiding Runs repeatedly causes important retrieval/recovery failure
- The Product Owner repeatedly seeks the corpus itself (not just a known record)
- Corpus-level jobs cannot be predicted or surfaced contextually
- Secondary access becomes frustrating during high-stakes debugging/audit work

## 3. Ambiguity default

> **If evidence remains genuinely mixed, keep the existing navigation.**

This does NOT mean Candidate A wins. It means:

> There is insufficient evidence to supersede current product authority.

If ambiguity remains after the planned experiment, stop and revisit only if concrete recurring pain later appears.

## 4. Stopping rule

The experiment ends when one of these is true:

1. **Clear direction:** multiple observations on one side with at least one disconfirming observation on the same side tested and failed to hold
2. **Clear stalemate:** 2+ weeks of B-lite with no meaningful friction events and no corpus-seeking behavior (default to current authority)
3. **Decision deadline:** Product Owner declares the experiment concluded

Do not continue measuring indefinitely. If ambiguity remains after the planned experiment period, the default (keep current navigation) applies and the experiment is closed.

## 5. Known limitations of n=1 dogfooding

- **Self-knowledge bias:** the Product Owner knows the experiment is active; subjective bias cannot be eliminated. Mitigated by predeclared criteria and distinguishing habit friction from task failure.
- **Single user:** no statistical inference; this is a product judgment informed by experience, not a study.
- **Frequency ≠ importance:** audit/recovery surfaces may be infrequently visited but high-stakes. Low frequency does not prove low importance.
- **Habit friction:** initial adjustment to the removed nav item will produce friction that is habitual, not meaningful. The first 3-5 days are a habituation period — friction events during this window require explicit classification.
- **Architecture constraints:** the current product's forced paths mean some behaviors are unobservable until the fairness baseline is in place. The experiment measures post-fairness-baseline behavior only.

## 6. What remains a Product Owner judgment (not an empirical question)

- Whether the corpus is a "core product asset" or "byproduct" — this is a product-identity judgment, not measurable
- Whether the three-workspace authority should be superseded — this is a product-authority decision, not a telemetry question
- Whether aesthetic/conceptual preference for two-item vs three-item nav is load-bearing — this is a design judgment
- Whether the cost of authority reversal (amending PRODUCT.md §1, DECISIONS #7, CLAUDE.md) is justified — this is a product-governance decision
