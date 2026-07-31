# Evaluation Fixtures — Business Analytics Suite

Importable archive fixtures for testing RSemble's data import (Workbench Archive v1) with
real, discriminating evaluation content. Import via **Evaluations → archive actions →
Import**, or validate mechanically with:

```bash
npx tsx scripts/validate-archive-fixture.ts
```

## `pulsefit-business-analytics.archive.json`

One suite (**Business Analytics — PulseFit Suite**, 3 tasks, 6 enabled models) plus its
pinned evaluation profile (**Business Analytics Discrimination**, 4 weighted criteria).
The suite is Fusion-Study-ready: six enabled models satisfy the 6–8 core-pool bound.

### What it measures

The suite discriminates three competencies that fluent models routinely fake:

| Competency | Weight | Isolated by |
|---|---|---|
| Statistical rigor & trap avoidance | 2.0 | Tasks 1 & 2 |
| Business judgment & decisiveness | 1.5 | All tasks |
| Market & competitive awareness | 1.5 | Tasks 1 & 3 |
| Executive communication | 1.0 | All tasks |

- **Task 1 — PulseFit board deck (integrative).** Three planted traps: a channel
  mix-shift hidden inside stable blended CAC, retention decaying exactly where spend
  grew, and a peeked/early-stopped pricing test whose +12% lift is not valid evidence.
- **Task 2 — Fable & Fern cohort economics (statistical isolation).** A textbook
  Simpson's-paradox case: blended churn *improves* (9.5% → 8.1%) while every cohort's
  churn *worsens* — the mix shifted toward low-churn annual plans. The correct answer
  is arithmetic, not rhetoric.
- **Task 3 — The free-tier question (strategy isolation).** A funded competitor's
  ad-supported free tier; requires reasoning about willingness-to-pay compression,
  churn concentration (months 2–4), and annual-plan retention as a defensive lever.

### Ground truth used for calibration

The fixture's numbers were recomputed so the "right answers" are benchmark-consistent:

- **Churn shape.** Task 1's 6-month retentions (29%–48%) imply ~12–18% monthly churn —
  the median-to-bottom fitness-subscription band, which *is* the story (quiet decline).
  Task 2's monthly-plan churn (12%→14%) sits at the same band's bad end.
- **Unit economics (Task 1, 6-month window, geometric survival, $19.99 × 75% margin):**
  Search ≈ **3.5:1** (healthy), Referral ≈ **6:1** (scale), Paid Social ≈ **2.5 → 1.8:1**
  (decaying through the 3:1 bar), Influencer ≈ **1.2:1** (underwater). The planted
  correct verdict: fix or cut paid social, kill or re-test influencer, scale referral.
- **ATT cost inflation.** The paid-social CAC drift (+25% YoY) is deliberately below the
  ~50% cost-per-purchase rise measured for heavily exposed campaigns — a partially
  mitigated company, so the model must *connect* context to numbers rather than recite a
  headline figure.

### Sources

1. Evan Miller — *How Not to Run an A/B Test* (optional stopping inflates false
   positives; nominal α=5% becomes ~30–40% under repeated peeking).
   <https://www.evanmiller.org/how-not-to-run-an-ab-test.html>
2. Johari, Pekelis, Walsh — *Peeking at A/B Tests: Why it matters, and what to do
   about it* (KDD 2017, Optimizely Stats Engine; always-valid p-values).
   <http://library.usc.edu.ph/ACM/KKD%202017/pdfs/p1517.pdf>
3. Aridor, Che, Salz — *Privacy Regulation and Targeted Advertising: Evidence from
   Apple's App Tracking Transparency* (post-ATT CAC +~0.54–0.58 log points, CTR −37%).
   <https://www.tse-fr.eu/sites/default/files/TSE/documents/sem2024/eco_platforms/aridor2024.pdf>
4. *Evaluating the Impact of Privacy Regulation on E-Commerce Firms — Evidence from
   Apple's ATT* (Management Science 2024; cost-per-purchase ≈ +50%, small/DTC firms hit
   hardest). <https://pubsonline.informs.org/doi/10.1287/mnsc.2024.06600>
5. David Skok — *SaaS Metrics 2.0* (For Entrepreneurs): gross-margin-adjusted LTV,
   LTV:CAC ≥ 3:1, CAC payback < 12 months; use channel-level, not blended, ratios.
   <https://www.forentrepreneurs.com/saas-metrics-2-definitions-2/>
6. Business of Apps — *Health & Fitness App Benchmarks* (Day-30 retention ~3%,
   annual-subscription retention ~33%, subscription shift).
   <https://www.businessofapps.com/data/health-fitness-app-benchmarks/>
7. Lifecycle Architect — *Fitness Apps Churn Rate Benchmarks* (median monthly churn
   10–13%, top quartile 4–6%; annual plans reduce churn ~40–50%; early-engagement
   activation predicts churn 3–4×).
   <https://lifecyclearchitect.com/benchmarks/fitness-apps-churn-rate-benchmarks/>
8. Andreessen Horowitz — *Why Do Investors Care So Much About LTV:CAC?* (context and
   limits of the 3:1 heuristic). <https://a16z.com/why-do-investors-care-so-much-about-ltvcac/>

### What a discriminating run looks like

- **Score ≈1 on statistical rigor:** "mostly fine, watch CAC" or "ship Variant B,
  p=0.03." Both are wrong; the fixture is built so these fluent answers fail.
- **Score ≈3:** catches the mix shift *or* the peeking problem, not both; LTV computed
  without retention adjustment.
- **Score ≈5:** names Simpson's paradox in Task 2 unprompted; derives channel LTV:CAC
  and compares to the ~3:1 bar in Task 1; demands refund-adjusted conversion and a churn
  holdout for Variant B; ties ATT inflation to the stale lookalike audiences and
  FitStream's free tier to willingness-to-pay compression at the low end.

### Notes

- Archive envelope is Workbench Archive v1 (`schemaVersion: 1`). `runs`/`experiments`
  are empty by design — the fixture tests suite+profile import, not history import.
- Import is idempotent: a second import of the same file skips all 3 records (verified
  by `scripts/validate-archive-fixture.ts`).
- Tasks inherit the suite's pinned profile (`profile-biz-analytics` v1); edit criteria
  by creating a new profile version, not by mutating v1.
