# Evaluation Workbench Roadmap

> **Status:** Separate Compare, Runs, and Evaluations workspaces are approved. Sequencing and later exploratory phases remain proposed, not implementation commitments.
>
> **Purpose:** Record a general path from one-off model comparisons toward inspectable run history, reusable evaluation suites, and potentially semantic analysis of accumulated evidence.
>
> **Authority:** `PRODUCT.md` remains the product source of truth. This roadmap explores capabilities that currently cross its scope fence, including datasets and benchmarks. No implementation phase should begin until the relevant product and UI decisions are explicitly amended.

## 1. Motivation

RSemble currently compares multiple model responses to one task, judges them blindly, and produces either a ranking or a fused answer. It also retains enough summary history to derive model win rates and recent-run hints.

After several runs, two needs emerge:

1. A completed run should remain inspectable. A user should be able to reopen the task, candidate outputs, Judge evidence, scores, and exact configuration rather than seeing only aggregate telemetry.
2. Related tasks should be runnable and analyzable as a coherent evaluation. Different tasks may require different Judge instructions and criteria, while their results still need a defensible suite-level summary.

A further exploratory idea is to use semantic retrieval and clustering to find related historical tasks and results. A natural-language question such as “Which model is best at business decision-making?” could retrieve relevant evidence, identify comparable subsets, and help form a reusable benchmark. This is promising but unvalidated; semantic similarity alone cannot make heterogeneous scores statistically comparable.

## 2. Product principles

### 2.1 Preserve the per-task pipeline

Each task continues to use RSemble's existing spine:

```text
Task → Candidate fanout → blind Judge → Rank / Fuse
```

An evaluation suite orchestrates multiple executions of this pipeline. It does not introduce user-facing model roles or replace Rank/Fuse.

### 2.2 Evidence before aggregation

Every aggregate must remain traceable to:

- the task and candidate outputs;
- model and provider configuration;
- Judge model and exact evaluation protocol;
- criterion-level scores and explanations;
- failures, exclusions, and missing coverage.

Averages must not conceal incompatible score scales, failed runs, sparse task coverage, or Judge disagreement.

### 2.3 Separate candidate instructions from evaluation instructions

The candidate-visible task describes what the tested models should do. The evaluator-only profile describes how outputs should be assessed. These may overlap deliberately, but they must not be conflated by default.

### 2.4 Structured evaluation before semantic inference

Named tasks, versioned evaluation profiles, and explicit suite membership provide comparability. Embeddings may later improve discovery, but they should not silently define a benchmark or its denominator.

### 2.5 Local and personal first

The roadmap should preserve RSemble as a focused local tool. Multi-user collaboration, hosted evaluation infrastructure, public APIs, and organizational governance are not implied.

## 3. Conceptual model

The intended hierarchy is:

```text
Evaluation suite
├── versioned suite configuration
├── task 1
│   ├── candidate-visible instructions
│   └── task evaluation profile
├── task 2
│   ├── candidate-visible instructions
│   └── task evaluation profile
├── selected candidate models
└── experiment
    ├── task executions
    │   ├── trials
    │   ├── candidate outputs
    │   └── Judge observations
    └── aggregate results
```

The key concepts are:

- **Run:** One execution of the existing RSemble pipeline for one task.
- **Evaluation profile:** Versioned Judge instructions, criteria, score types, anchors, weights, and aggregation rules.
- **Task:** Candidate-visible instructions plus its evaluation profile and optional reference material.
- **Suite:** A named, versioned collection of tasks intended to test a broader capability.
- **Experiment:** A frozen execution of one suite version against a selected model set.
- **Trial:** A repeated model/task execution used to observe output variability.
- **Judge observation:** One auditable evaluation of one output, including its criterion scores and evidence.

## 4. Roadmap

### Phase 0 — Product decision gate

**Goal:** Formalize the approved expansion from a focused comparison tool into a small evaluation workbench.

Before implementation:

- amend the `PRODUCT.md` scope fence if datasets and benchmarks become intentional product capabilities;
- establish the approved `Compare | Runs | Evaluations` navigation while preserving Compare as the focused Rank/Fuse workflow;
- update `UI.md` and record the architectural decision in `DECISIONS.md`;
- preserve Rank/Fuse as the per-task finish rather than adding competing top-level execution modes.

**Validation:** Product authority documents describe the same product and no roadmap item relies on a silent scope exception.

### Phase 1 — Inspectable run history

**Goal:** Make completed work durable and reviewable.

General capabilities:

- persist a complete, versioned run snapshot;
- browse and filter previous runs;
- open a run to inspect prompts, outputs, Judge evidence, scores, configuration, and failures;
- distinguish new complete records from legacy summary-only history;
- export and restore local history;
- derive telemetry only from clearly defined cohorts.

This phase addresses an observed need independently of bulk evaluation and creates the evidence base required by every later phase.

**Validation:** A completed run can be reopened and audited without relying on the current in-memory state.

### Phase 2 — Evaluation profiles

**Goal:** Replace the generic optional-rubric metaphor with reusable, task-appropriate scoring protocols.

General capabilities:

- separate candidate-visible instructions from evaluator-only criteria;
- replace `goal | metric | gap` with operational score types and explicit anchors;
- support task-specific Judge guidance;
- version evaluation profiles and snapshot the exact version used by each run;
- preserve concise Judge evidence and blind evaluation;
- allow a suite-level default profile with deliberate task overrides.

Generic response-quality presets should not define specialized capabilities such as business judgment. Templates may later assist authoring, but task-specific definitions and score anchors remain authoritative.

**Validation:** Two tasks in the same capability suite can use meaningfully different Judge instructions while producing interpretable, normalized results.

### Phase 3 — Evaluation suites and experiments

**Goal:** Run several tasks as one reproducible evaluation and inspect the result as a whole.

Initial scope:

- create and version a named suite;
- add several tasks and their evaluation profiles;
- select candidate models;
- use one Judge configuration for the experiment;
- execute one trial per task initially;
- isolate task failures rather than discarding the full experiment;
- show per-model, per-task, and criterion-level results;
- compute an explicit equal-task aggregate when score protocols are compatible;
- report model coverage, exclusions, and failures;
- reopen every underlying run from the experiment result.

The first suite runner should avoid multiple Judges, complex weighting, clustering, and advanced statistics. It should prove that a small capability evaluation is operationally useful.

**Validation:** A small business-decision evaluation can run across several tasks, each with suitable Judge guidance, and produce an auditable comparison matrix.

### Phase 4 — Reliability and repeated trials

**Goal:** Distinguish a stable capability signal from one sampled answer or one Judge decision.

Potential capabilities:

- repeat selected model/task combinations;
- aggregate trials at the task level before aggregating tasks;
- report mean, median, variation, sample count, and missingness;
- support explicit failure policies;
- compare experiment versions;
- optionally use more than one Judge while preserving individual observations and disagreement;
- calibrate evaluators against a small human-reviewed anchor set.

Repeated runs of one task must not accidentally give that task more suite weight. A single average must never replace the underlying distribution and coverage information.

**Validation:** The UI makes unstable results and Judge disagreement visible rather than presenting false precision.

### Phase 5 — Semantic history intelligence (exploratory)

**Goal:** Investigate whether natural-language retrieval can make accumulated evaluation evidence easier to discover and organize.

Possible workflow:

```text
Natural-language question
→ retrieve semantically related tasks and runs
→ apply structured comparability checks
→ show included, related-but-incompatible, and excluded evidence
→ summarize only defensible cohorts
→ optionally promote a reviewed cohort into a versioned suite
```

Potential uses:

- find related historical tasks;
- suggest capability labels or clusters;
- answer questions with citations to supporting runs;
- discover gaps in model or task coverage;
- draft a suite from a user-reviewed semantic cohort;
- optionally rescore retrieved outputs under one approved evaluation profile.

Embeddings determine relevance. Protocol metadata determines comparability. Aggregation operates only on an auditable cohort.

Embeddings and clustering are discovery mechanisms, not statistical authorities. The system must not average arbitrary retrieved scores, silently invent a scorer, or present an unstable cluster as a validated benchmark.

**Research risks:**

- small archives may produce unstable or trivial clusters;
- lexical similarity may be mistaken for capability similarity;
- historical scores may use incompatible Judges, scales, and criteria;
- model coverage may be sparse or unbalanced;
- repeated tasks may bias an aggregate;
- query-generated evaluation profiles may encode unreviewed assumptions;
- a precise-looking ranking may overstate limited evidence.

**Validation:** Test semantic retrieval against a small manually labelled query set. Proceed only if it improves discovery over metadata and lexical search, and if users can understand why each run was included or excluded.

## 5. Intended build order

```text
Product-authority update
→ Inspectable run history
→ Evaluation profiles
→ Evaluation suites
→ Reliability and repetitions
→ Semantic retrieval and clustering research
```

The semantic feature remains a useful product north star: “ask my evaluation history” can become the approachable interface, while “build a reproducible benchmark from this evidence” provides the durable value. It should not be built before the structured records and comparability rules it depends on.

## 6. Aggregation guardrails

Any suite-level ranking should follow these general rules:

1. Aggregate trials within each model/task pair first.
2. Aggregate task-level scores second, using an explicit policy.
3. Default to equal task weighting unless a defensible alternative is documented.
4. Normalize only where score semantics are compatible.
5. Report task coverage, sample count, failures, and variation beside the aggregate.
6. Do not silently treat missing results as zero.
7. Keep Judge-specific observations available even when a panel summary is shown.
8. Avoid a global model ranking across unrelated suites and evaluation-profile versions.

Pairwise strength models may later complement score averages when enough overlapping comparisons exist, but they are exploratory and require uncertainty reporting.

## 7. Non-goals for the initial evolution

- Hosted or multi-user evaluation infrastructure.
- Public benchmark publishing.
- Automatic benchmark generation without review.
- Fine-tuning or dataset curation for training.
- A general workflow canvas.
- User-facing model-role orchestration.
- Silently replacing Rank/Fuse with a separate execution paradigm.
- Advanced clustering before basic history retrieval is useful.
- A single universal rubric for every task type.

## 8. Approved UI direction and remaining questions

Approved information architecture:

```text
Compare | Runs | Evaluations
```

Compare retains the focused two-pane Rank/Fuse workflow. Runs is the durable evidence workspace. Evaluations contains Profiles, Suites, Experiments, progress, and results.

Remaining design questions for later phases:

1. How task-specific evaluation profiles remain understandable without recreating a large inspector UI.
2. Which global telemetry should be removed, qualified, or scoped once heterogeneous suites exist.
3. How a future “Ask history” entry point exposes provenance and uncertainty without presenting exploratory retrieval as a benchmark.

## 9. Reference patterns

This direction borrows conceptual separation, not product scope, from established evaluation systems:

- [LangSmith evaluation concepts](https://docs.langchain.com/langsmith/evaluation-concepts): datasets, examples, experiments, evaluators, and comparative analysis.
- [Braintrust evaluations](https://www.braintrust.dev/docs/evaluate/run-evaluations): datasets, tasks, scorers, experiments, and repeated trials.
- [Langfuse evaluation concepts](https://langfuse.com/docs/evaluation/core-concepts): typed scores, datasets, experiments, and item/run-level evaluators.
- [Promptfoo test cases](https://www.promptfoo.dev/docs/configuration/test-cases/): per-test assertions, grader configuration, thresholds, and metadata.
- [Inspect AI tasks](https://inspect.aisi.org.uk/tasks.html): tasks composed from datasets, solvers, scorers, epochs, and metrics.
