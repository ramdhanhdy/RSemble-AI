# Generalist Advisor Evaluation Program

A difficulty-first evaluation program measuring whether frontier models are reliable
**general-purpose thinking and advisory partners** — not an academic knowledge or trivia
benchmark. The practical question: *"If I routinely bring this model difficult problems I
don't fully understand, can I rely on it to frame the problem correctly, reason through
evidence, resist misleading framing, recommend soundly, recognize uncertainty, and avoid
confidently leading me in the wrong direction?"*

Successor to the PulseFit suites. Key differences: domain-diverse cases (PulseFit was one
D2C subscription business), a program-wide reasoning rubric instead of a subscription-analytics
rubric, current suite-package features (explicit five-anchor `graded` criteria, `binary`
compliance checks with requirement groups, `complianceInfluence`), and an explicit
superficial-smart-failure design discipline for every task.

## Program architecture

Six Task Sets (one importable `.suite.json` each), 6 tasks per set. **Wave 1 (this
delivery): Task Sets 1–2.** Task Sets 3–6 follow the same conventions.

| # | Task Set | File | Status |
|---|---|---|---|
| 1 | Problem Framing & Relevance | `generalist-advisor-01-problem-framing.suite.json` | Delivered |
| 2 | Quantitative & Aggregation Reasoning | `generalist-advisor-02-quantitative-aggregation.suite.json` | Delivered |
| 3 | Causal & Evidence Reasoning | — | Planned |
| 4 | Decision & Strategic Judgment | — | Planned |
| 5 | Planning & Adaptive Reasoning | — | Planned |
| 6 | Independent Judgment & Synthesis | — | Planned |

**Core Generalist Challenge** (selected, not newly authored): ~12 of the strongest tasks,
2 per family, assembled as a seventh package once all six families exist. Wave-1 core
candidates are marked below. Holdout tasks are never core tasks.

Validate any package mechanically:

```bash
npx tsx scripts/validate-suite-package.ts docs/evaluations/generalist-advisor-01-problem-framing.suite.json
```

(No args validates every `docs/evaluations/*.suite.json`.)

## Design rules (applied to every task)

- **Self-contained**: no outside facts required; any specialized concept is supplied.
  Difficulty comes from reasoning, not jargon.
- **Superficial-smart failure**: every case supports an articulate, professional-sounding
  answer that reaches a materially inferior conclusion because it misses the hidden
  structure. Documented per task below (obvious story / superficial-smart failure /
  hidden structure / strong inference / overreach boundary).
- **Traps are orthogonal annotations**, never named in the candidate prompt, and the
  candidate is never told the case is adversarial.
- **Arithmetic is real**: all quantitative traps were recomputed independently before
  commit (blended means, standardizations, PPV, compounding, payback). The calibration
  keys carry the correct numbers.
- **Judge keys reward demonstrated reasoning, not vocabulary**: naming "Simpson's
  paradox" or "survivorship bias" earns nothing without the case-specific reasoning.
- **Multiple defensible conclusions are allowed** where genuine (each key's ACCEPTABLE
  CONCLUSIONS section); critical failures cap affected criteria at 2.
- **Epistemic shape**: the ideal answer is often "we can decide X now, but the evidence
  does not establish Y" — keys contain explicit OVERREACH BOUNDARIES, and excessive
  hedging is scored as a decision-quality failure where the key says evidence supports action.

## Common rubric

`rubric-generalist-advisor` (embedded identically in every package; the importer mints a
fresh instance per import — pin one imported copy if running multiple sets against the
same rubric identity matters to you).

Graded criteria (five authored anchors each; strict scale — 3 = competent professional
baseline, 5 = rare, affirmative evidence required):

| Criterion | Weight |
|---|---|
| Problem framing & relevance | 1.5 |
| Analytical correctness | 2.0 |
| Evidence & causal discipline | 2.0 |
| Decision quality | 2.0 |
| Tradeoffs & second-order effects | 1.5 |
| Communication & auditability | 1.0 |

Binary compliance checks (requirement groups, `complianceInfluence = 1.0`, so
`rankValue = Q − (1 − C)`; failing one of the two equal-weight groups costs 0.5 rank
points, both cost 1.0):

- **Grounded in supplied evidence** — fails on invented data/benchmarks relied on for the conclusion.
- **Commits to a decision** — fails on option-listing without a position (staged/conditional commitments pass).

Task-specific critical failures (in each `judgeInstructionOverride`) additionally cap the
named criteria at 2 — the "both where useful" enforcement model.

## Program map (wave 1)

| ID | Title | Primary family | Secondary capabilities | Domain | Hidden trap(s) | Deterministic checks | Holdout | Core candidate |
|---|---|---|---|---|---|---|---|---|
| ga1-01 | Support ticket volume just fell 38% | Framing | Evidence discipline, decision quality | B2B software ops | Proxy substitution; selection (CSAT on resolved only); wrong objective | Segment usage/flag deltas | — | Yes |
| ga1-02 | The 95%-utilized machine and the $240k request | Framing | Planning/constraints, decision quality | Manufacturing | Wrong bottleneck; inflated salient metric; buried constraint (permit) | Utilization decomposition, booth-hour headroom | — | — |
| ga1-03 | We are losing because we don't have the AI planner | Framing | Independent judgment, evidence discipline | Consumer software strategy | False premise; competitor anchor; salient distractor | Platform-split churn arithmetic | — | — |
| ga1-04 | Two proposals to cut the ER wait average | Framing | Quantitative, decision quality | Health operations | Average vs harm distribution; wrong unit of analysis; correct-math-wrong-objective | Weighted means, LWBS counts | — | Yes |
| ga1-05 | Mortgage prepayment or index fund? | Framing | Decision quality, quantitative | Personal finance | Missing decisive variables; answering the stated question; horizon mismatch | Card interest, match value, buffer months | — | — |
| ga1-06 | RouteWiz or PathPilot: sign this week | Framing | Quantitative, second-order effects | Logistics/retail | Precision theater; stated question vs decisive problem; vendor self-measurement | Fuel-savings netting, failure-cause shares | **Holdout** | — |
| ga2-01 | Guided Setup lifted conversion 53% — or did it? | Quantitative | Evidence discipline, framing | B2B SaaS product | Simpson/composition reversal; no-control attribution; OKR incentive | Mix standardizations (1,200 / 656) | — | Yes |
| ga2-02 | 92% retention versus 74% | Quantitative | Evidence discipline, decision quality | Hiring/HR analytics | Denominator mismatch; survivorship; conditioned ratings | Denominator ladder, cost-per-retained, parity fee | — | — |
| ga2-03 | The screening program that pays for itself | Quantitative | Evidence discipline, decision quality | Health-evidence / benefits | Base-rate neglect; relative vs absolute; observational participant comparison | PPV, false-positive count, cost stack | — | Yes |
| ga2-04 | Cumulative savings keep climbing | Quantitative | Framing, decision quality | Public sector / energy | Cumulative vs marginal; best-first selection; payback vs asset life | Marginal table, paybacks, breakeven $/MWh | — | — |
| ga2-05 | Average ticket is up 5.5% and margin is down | Quantitative | Framing, second-order effects | Retail/food service | Mix shift; false pricing-power premise; untested promo attribution | Blended decomposition, substitution bound | — | — |
| ga2-06 | Beat the benchmark over five years | Quantitative | Evidence discipline, independent judgment | Investing | Regime/window aggregation; dollar-weighted vs time-weighted; family survivorship | Compounding verification, 3-yr shortfall | **Holdout** | — |

Holdout rule: ga1-06 and ga2-06 must not be used to tune judge instructions, scoring
thresholds, prompting, or routing. Use them as clean confirmation after calibration.

## Adversarial review (five-part, per task)

### ga1-01 Support tickets
- **Obvious story**: self-service revamp cut support demand 38%; harvest the savings, replicate.
- **Superficial-smart failure**: polished endorsement — "deflection worked, release the contractors, extend to onboarding."
- **Hidden structure**: ticket volume = incidence × propensity to report; the change raised reporting friction simultaneously; abandonment 22%, failed searches +30%, usage −9% in the failed-search-no-ticket segment, at-risk flags 62→81; CSAT conditioned on resolved tickets.
- **Strong inference**: suppression and deflection are confounded; measure resolution directly before cutting capacity or replicating.
- **Overreach boundary**: portal not proven to cause the usage decline or renewal risk; revamp not proven to have failed.

### ga1-02 CNC bottleneck
- **Obvious story**: the 95%-utilized CNC is the constraint; buy the second machine.
- **Superficial-smart failure**: ROI model for the CNC purchase with payback math.
- **Hidden structure**: finishing is the constraint (9-day queue, 31/40 late orders there, permit-capped booth hours, 14% rework recycling booth time); CNC utilization inflated by 20% reschedulable retail work (demand utilization ≈ 76%).
- **Strong inference**: reject/defer capex; exploit the constraint (booth hours +3h/day within permit, rework retrofit test, order-release control).
- **Overreach boundary**: exact lead-time recovery not computable; retrofit effect is a vendor claim.

### ga1-03 Competitor AI planner
- **Obvious story**: competitor shipped AI, their downloads doubled, our churn is up — parity now.
- **Superficial-smart failure**: strategic-sounding competitive-response roadmap.
- **Hidden structure**: churn spike is all Android (+38.1%, iOS flat) and coincides with TrailKit's own crash regression (0.8%→3.9%); exit surveys rank crashes 41% vs planner ≈3%; Summit's downloads confounded by free pivot + featuring.
- **Strong inference**: fix the crash (3 weeks), finish maps; AI planner is a researched bet, not an emergency.
- **Overreach boundary**: crashes not proven to cause all 800 incremental cancels; "AI planners don't matter" not established.

### ga1-04 ER wait average
- **Obvious story**: Option A moves the system average most per the CFO's (correct) math.
- **Superficial-smart failure**: verify the arithmetic, endorse A as the efficient choice.
- **Hidden structure**: visit-weighted mean is dominated by the biggest, already-best site; harm (LWBS 4.8%/7.9% vs ~2% benchmark, P90 118/154 min, 79% of walkaways) concentrates at the satellites.
- **Strong inference**: fund B; replace the headline metric with tail- and harm-based measures.
- **Overreach boundary**: 72-hour returns not causally attributed to waits; modeled effects are assumptions.

### ga1-05 Mortgage vs index fund
- **Obvious story**: 10% expected stock return beats a 3.1% mortgage; invest.
- **Superficial-smart failure**: an articulate expected-return-vs-rate essay answering only the asked question.
- **Hidden structure**: unlisted dominant uses — 22.9% card (~$1,557/yr), unclaimed 100% match (~$4,400/yr), 0.4-month buffer with ±30% contractor income, 2–3-year sale horizon.
- **Strong inference**: card + match + buffer first; the stated dichotomy is secondary and horizon-constrained.
- **Overreach boundary**: 10% is a long-run average, not a 2–3-year expectation; relocation not certain.

### ga1-06 Routing vendors (holdout)
- **Obvious story**: PathPilot's 4.9% beats RouteWiz's 4.3%; pick the better optimizer.
- **Superficial-smart failure**: thorough feature-matrix comparison choosing PathPilot.
- **Hidden structure**: fuel is 11% of cost; savings differ by $20.4k against a $55k price gap; failures (8.2%, $1.9M) are 83% picking/readiness vs 12% routing; vans idle 26 vs 10 scheduled minutes; pilots vendor-self-measured.
- **Strong inference**: the vendor decision is second-order (RouteWiz on net math, or quantified PathPilot case); the decisive problem is order-readiness.
- **Overreach boundary**: reorder-rate gap is observational; pilot projections unverified.

### ga2-01 Guided Setup
- **Obvious story**: conversion 7.2%→11.0% right when the feature shipped; +53%.
- **Superficial-smart failure**: "clear win — roll into renewals, count the OKR."
- **Hidden structure**: both segments fell (4.0→3.6, 20.0→18.4); enterprise share 20%→50%; Q2 mix at Q1 rates = 12.0% > observed 11.0%; universal exposure identifies nothing.
- **Strong inference**: aggregate is composition; the tool's effect is unidentified in either direction; holdout before any rollout.
- **Overreach boundary**: segment declines don't prove harm (lead quality shifted with the webinar pivot).

### ga2-02 Bootcamp retention
- **Obvious story**: 92% vs 74% retention and better ratings; shift the budget.
- **Superficial-smart failure**: accept the headline, argue culture fit, endorse the shift.
- **Hidden structure**: 92% conditions on a month-6 performance screen; day-one comparison is 57.5% vs 74%; fee accrues per start → cost per 2-yr-retained $20,870 vs $10,811; ratings measured on screened survivors.
- **Strong inference**: reject as stated; the legitimate nuance (converted apprentices retain 92% vs 81.3% of 6-month uni survivors) answers a different question; negotiate fee structure or track a cohort.
- **Overreach boundary**: nothing shows bootcamp graduates are worse engineers; non-conversion causes unknown.

### ga2-03 Cardiac screening
- **Obvious story**: 90% sensitivity + "40% fewer events" + $2.4M savings ≥ $1.8M cost.
- **Superficial-smart failure**: wellness-ROI endorsement quoting sensitivity and savings.
- **Hidden structure**: 0.5% prevalence → PPV 4.8% (90 true vs 1,791 false positives); workups alone $2.26M > license; the 40% is participant-vs-decliner selection; 40% relative = 0.32pp absolute.
- **Strong inference**: decline as offered; risk-stratified pilot or outcome-based pricing with real effect evidence could pass.
- **Overreach boundary**: screening not proven worthless as a category.

### ga2-04 Retrofit program
- **Obvious story**: cumulative savings climb every year; the program accelerates; double it.
- **Superficial-smart failure**: sustainability-forward endorsement using average program economics.
- **Hidden structure**: increments fell (4.1/5.7/3.8 GWh); marginal cost $1,512→$2,737 per annual MWh; Y3 payback 17.1 yrs > 15-yr life; best-first selection makes Y4 worse; LED alternative pays back in 5.6 yrs.
- **Strong inference**: don't double; fund LED to capacity; per-project $/MWh cutoff (~$2,400 breakeven).
- **Overreach boundary**: one-year true-up uncertainty; remaining 220 buildings not condemned as a class.

### ga2-05 Average ticket
- **Obvious story**: ticket +5.5% proves pricing power; raise prices, double promos.
- **Superficial-smart failure**: momentum narrative endorsing all three claims.
- **Hidden structure**: no prices changed; pure mix shift to the higher-ticket/lower-contribution channel; contribution/order $3.05→$2.97, total contribution −1.8% (−$0.94M incl. extra promo spend); +502k delivery vs +50k total orders ⇒ mostly substitution.
- **Strong inference**: correct the letter; promo doubling needs an incrementality holdout; price increase is a separate, untested question.
- **Overreach boundary**: cannibalization strongly suggested, not proven; promo causality open in both directions.

### ga2-06 Fund pitch (holdout)
- **Obvious story**: +54.2% vs +53.9% net of fees over five years; allocate.
- **Superficial-smart failure**: verify the (accurate) compounding and endorse.
- **Hidden structure**: the edge is entirely years 1–2 at $20–60M under an abandoned strategy; at scale (years 3–5): −5.1% vs +29.5% (−34.6pp); most dollars experienced the loss; two sibling funds merged away.
- **Strong inference**: decline; the transportable record (current strategy, current scale) underperforms badly — while honestly noting 3 years is a small sample: "no evidence of skill at scale," not "proven bad."
- **Overreach boundary**: manager not proven unskilled; no future-return forecasts.

## Structural-transfer map

Pairs/triples sharing a latent structure across unrelated surface domains (surface
narratives intentionally non-parallel). Members marked *(planned)* land in Task Sets 3–6.

| Latent structure | Members |
|---|---|
| Composition/mix reversal | ga2-01 (trial funnel) · ga2-05 (ticket economics) · *(planned: portfolio or workforce variant, TS6 synthesis framing)* |
| Wrong objective / proxy optimization | ga1-01 (tickets) · ga1-02 (utilization) · ga1-04 (average wait) |
| Selection / survivorship | ga2-02 (screened cohort) · ga2-06 (fund family) · ga1-01 (CSAT on resolved) — *(planned: TS3 medical/campaign eligibility variant)* |
| Salient precision vs decisive relevance | ga1-06 (pilot decimals) · ga1-03 (competitor downloads) · ga2-03 (sensitivity headline) |
| Stated question ≠ decisive problem | ga1-05 (mortgage dichotomy) · ga1-06 (vendor pick) |
| Correct arithmetic, wrong inference | ga1-04 (CFO's means) · ga2-06 (consultant's compounding) |

Anti-pattern-matching note: ga2-01 and ga2-05 are both mix-shift cases but reward
different resolutions (standardization vs contribution decomposition + substitution
bound), and ga1-04/ga2-06 both plant *correct* opposing arithmetic so "find the math
error" heuristics fail.

## Coverage audit (wave 1)

- **Families**: framing 6, quantitative 6 (by design; secondary coverage of evidence
  discipline in 9/12, decision quality 12/12, second-order 4/12, independent judgment 2/12).
- **Domains** (12 tasks, 12 distinct): B2B software ops, manufacturing, consumer software
  strategy, health operations, personal finance, logistics/retail, B2B SaaS product,
  hiring/HR, health-evidence/benefits, public-sector energy, retail/food service, investing.
  No domain repeats within wave 1; subscription-economics (PulseFit's territory) deliberately avoided.
- **Trap families used**: proxy substitution ×3, false premise ×2, wrong unit/objective ×3,
  salient distractor/precision theater ×3, composition/mix ×2, denominator/survivorship ×3,
  base-rate ×1, cumulative-vs-marginal ×1, horizon mismatch ×2, selection/conditioning ×4,
  authority/competitor anchor ×2, buried constraint ×1. **Overrepresented so far**:
  selection-type traps (expected — TS3 will shift weight to experimental-validity traps;
  keep watching). **Not yet covered** (planned for TS3–6): collider conditioning, regression
  to mean, peeking/early stopping, sunk cost, option value/irreversibility (primary),
  dependency/rollback planning, consensus-from-shared-source, definitional contradiction.
- **Quantitative vs qualitative**: 8 tasks with decisive computable subchecks, 4 primarily
  judgment-weighted (ga1-01, ga1-02, ga1-03 partially, ga1-05 partially).
- **Deterministic vs judged**: all tasks judge-scored against calibration keys containing
  deterministic subchecks; no external verifiers (`verification` unset — rubric-only by design).
- **Holdouts**: 2/12 (one per family).

## Execution notes

- **Model slots**: six OpenRouter slots (GLM 5.2, DeepSeek V4 Flash, MiniMax M2.5,
  GPT-5.6 Sol, Gemini 3.1 Pro, Kimi K3) — satisfies the 6–8 fusion core-pool bound.
  **Default judge: `google/gemini-3.1-pro`**. Gemini is also a candidate slot;
  the rubric's absolute-standard instruction mitigates but does not eliminate
  self-preference — swap the judge to a non-candidate model if that matters for your run.
- Judge-visible content is `judgeInstruction` (rubric) + criteria + `judgeInstructionOverride`
  (per-task calibration key). Candidates see only `systemPrompt` + `prompt`. Never move key
  content into the task prompt.
- Both packages embed the same rubric content under id `rubric-generalist-advisor`;
  importing both creates two independent rubric instances (suite-package identity semantics).

## Diagnostic contrasts this wave supports

- Aggregation-trap skill vs framing skill (TS2 vs TS1 primaries).
- "Analytically strong but premise-deferential" (ga1-03, ga2-05: does the model check
  the executive's factual premise before optimizing?).
- "Notices uncertainty but won't decide" (every key states where evidence supports
  action; the commitment binary check plus decision-quality anchors punish hiding in caveats).
- "Correct math, wrong inference" (ga1-04, ga2-06 separate calculators from reasoners).

## Plan for Task Sets 3–6 (not yet authored)

Same conventions (6 tasks, 1 holdout, 2 core candidates, five-part adversarial review,
verified arithmetic, same embedded rubric):

- **TS3 Causal & Evidence**: eligibility-conditioned campaign cohort; peeking/early-stop
  experiment; regression to mean in an intervention; collider/conditioning case;
  measurement-proxy mismatch; mechanism contradicted by one supplied fact.
- **TS4 Decision & Strategic Judgment**: asymmetric-downside choice with cheap staged
  information; sunk-cost pressure; growth-quality/concentration risk; cannibalization;
  local-vs-system optimization; irreversibility with option value.
- **TS5 Planning & Adaptive**: buried hard constraint invalidating an attractive plan;
  step-2-destroys-step-6 dependency; circular fallback; missing verification step;
  stale-state adaptation; resource bottleneck appearing downstream.
- **TS6 Independent Judgment & Synthesis**: anchored/neutral paired variants on identical
  evidence; three experts sharing one dataset; denominator-driven "contradiction";
  population/horizon reconciliation; prestige-source-weak-evidence; structural-transfer
  completion of the pairs table above.
