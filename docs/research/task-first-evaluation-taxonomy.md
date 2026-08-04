# Task-First Evaluation Storage and Taxonomy Research

**Status:** Research synthesis for design review  
**Date:** 2026-08-01  
**Scope:** RSemble evaluation storage, task taxonomy, evidence lineage, and task-level statistical analysis  
**Implementation status:** No implementation proposed by this document

## Executive summary

RSemble should move toward **task-first storage**, but should not remove suites. The recommended architecture is:

```text
Task Catalog
└── immutable Task Versions

Suite / Workload Manifest
└── references selected Task Versions and defines a protocol

Experiment
└── freezes a Suite Version and execution configuration

Task Observations
└── records one model/policy/replicate measured on one Task Version or Instance
```

The central design rule is:

> Store tasks and evidence at the smallest reproducible unit available, but aggregate only at the unit justified by the statistical question.

For RSemble this normally means:

```text
raw evidence: observation or attempt
statistical generalization unit: task
comparison unit: paired task-level delta
workload/protocol unit: suite version
study unit: experiment or trial
```

A single universal skill hierarchy is not appropriate. RSemble should use **orthogonal, versioned facets** with graph relations. A task can simultaneously have a domain, operation, cognitive demand, modality, interface, skill demand, verification method, difficulty profile, and risk context.

A task’s skill demand is not the same as a model’s capability. The task declares or receives annotations about what it requires. A model’s capability profile must be derived from observations and reported with evidence and uncertainty.

## Decision summary

### Recommended

1. Introduce canonical task identity and immutable task versions.
2. Keep suites as versioned workload manifests and experimental protocol containers.
3. Keep experiment snapshots for reproducibility, even after tasks become canonical.
4. Add task-level observation indexing without immediately rewriting detailed run storage.
5. Represent taxonomy metadata as versioned, many-to-many facet assignments.
6. Store intended task structure separately from observed model/tool traces.
7. Preserve verifier results, rubric scores, raw outputs, artifacts, and provenance as first-class evidence.
8. Aggregate Fusion Study comparisons at the task level, not at the raw generation or suite-total level.

### Do not implement first

1. A single global skill tree.
2. A single scalar difficulty field.
3. Global model rankings across unrelated suites.
4. Full latent ability or IRT modeling before enough cross-task data exists.
5. Automatic skill inference treated as ground truth.
6. Wholesale import of ESCO, O*NET, SFIA, ADeLe, or SkillsBench vocabularies.

## Current RSemble diagnosis

The current code already treats task-level execution as important, but task definition storage remains suite-owned.

### Task-level execution already exists

`RunRecordV2` represents one task execution with candidate outputs, judge results, fusion results, and winner information. Experiment orchestration also records task IDs, attempts, retries, and selected attempts.

The current experiment state machine preserves useful task-level invariants:

- one active task attempt at a time;
- retries append attempts instead of mutating prior terminal attempts;
- selected attempts point to accepted evidence;
- experiments retain stable snapshots;
- delayed writes are rejected through epochs and execution fences.

### Definition storage is still suite-owned

`EvaluationSuite` embeds `tasks: EvaluationTask[]`. `ExperimentSnapshot` copies task definitions into an experiment. The persistence layer stores complete suite and experiment records rather than canonical reusable task records.

This creates several limitations:

- the same task is duplicated across suites;
- task identity is effectively suite-local;
- cross-suite task analytics require reconstruction;
- taxonomy assignments would be copied into suite blobs;
- task revision and suite revision are difficult to distinguish;
- a task cannot naturally accumulate observations across workloads;
- imported tasks and task variants lack explicit lineage.

The current Fusion Study design already identifies the task as the generalization unit and stores per-task results. Moving task definitions toward canonical task versions would complete an existing conceptual distinction rather than replace the current product thesis.

Relevant files:

- `src/lib/evaluations/evaluation-types.ts`
- `src/lib/evaluations/experiment-engine.ts`
- `src/lib/evaluations/fusion-study-types.ts`
- `src/lib/persistence/database.ts`
- `docs/specs/archive/fusion-study/fusion-study-spec.md`

## What “task”, “skill”, and “capability” should mean

These concepts are often conflated across external frameworks. RSemble should define them explicitly.

| Concept | RSemble meaning |
|---|---|
| Task | A concrete objective or executable workload at the chosen evaluation granularity |
| Task family | A reusable class of related task instances |
| Task instance | A concrete prompt, input, file set, dataset snapshot, or environment state |
| Skill demand | A knowledge or procedure requirement associated with a task |
| Capability | An ability inferred from performance across related observations |
| Competency | Demonstrated ability under a defined context, standard, and evidence protocol |
| Procedure | A method or sequence that can be reused to solve a task |
| Outcome | A property expected from the result, such as correctness or completeness |
| Evidence | Output, trace, artifact, verifier result, score, or judge observation |
| Suite | A versioned collection of task versions plus an evaluation protocol |

The main invariant is:

> A task has demands. A model produces evidence. Capability is inferred from evidence.

A successful execution path does not necessarily reveal every skill required by the task. A model may use extra tools, take an inefficient route, or exploit an incidental affordance.

## Taxonomy research

No reviewed framework is sufficient as RSemble’s complete taxonomy. The sources fall into several different classes.

### Cognitive and educational taxonomies

#### Revised Bloom taxonomy

Bloom’s revised taxonomy is two-dimensional:

- knowledge type: factual, conceptual, procedural, metacognitive;
- cognitive process: remember, understand, apply, analyze, evaluate, create.

Use it for intended cognitive demand and knowledge type. Do not treat Bloom level as empirical difficulty or measured model capability.

Sources:

- [Anderson and Krathwohl reference](https://books.google.com/books/about/A_Taxonomy_for_Learning_Teaching_and_Ass.html?id=EMQlAQAAIAAJ)
- [Revised Bloom taxonomy table](https://www.wcu.edu/WebFiles/PDFs/BloomsRevisedTaxonomyTable.pdf)

#### Webb’s Depth of Knowledge

Depth of Knowledge describes the complexity of cognitive engagement required by a task. It explicitly differs from difficulty and is not a grading rubric.

Implication: store `cognitive_complexity` separately from `difficulty`.

Source:

- [Webb’s Depth of Knowledge](https://www.webbalign.org/dok-primer)

### Occupational and competency frameworks

#### O*NET

O*NET separates worker characteristics, knowledge, skills, abilities, tasks, work activities, work context, experience, and occupational requirements. Its task records also carry source, date, population, importance, level, and relevance context.

Implication: model task-to-skill links as many-to-many relations with provenance and population context rather than as a single undifferentiated importance value.

Sources:

- [O*NET Content Model](https://www.onetcenter.org/content.html)
- [O*NET task statements](https://www.onetcenter.org/dictionary/30.0/text/task_statements.html)
- [O*NET scales](https://www.onetonline.org/help/online/scales)

#### ESCO

ESCO provides versioned, machine-readable, multilingual concepts with preferred labels, aliases, URIs, hierarchy, and relations. It separates knowledge, skills, attitudes, values, and language skills, but does not make a strong internal distinction between skills and competences.

Implication: if RSemble imports external concepts, store:

```text
taxonomyNamespace
conceptUri
taxonomyVersion
preferredLabel
aliases
relationType
```

Do not flatten an external taxonomy into unversioned local strings.

Sources:

- [What ESCO is](https://esco.ec.europa.eu/en/about-esco/what-esco)
- [ESCO skills hierarchy](https://esco.ec.europa.eu/en/classification/skill-main)
- [ESCO API](https://esco.ec.europa.eu/en/use-esco/use-esco-services-api)

#### SFIA

SFIA separates professional skills from responsibility levels, autonomy, influence, complexity, knowledge, and behavior.

Implication: proficiency is not only “knows more.” It can also involve autonomy, complexity, judgment, and responsibility. SFIA is a useful conceptual reference for agent autonomy but should not become a direct RSemble model score scale.

Sources:

- [How SFIA works](https://sfia-online.org/en/about-sfia/how-sfia-works)
- [SFIA responsibility levels](https://sfia-online.org/en/sfia-9/responsibilities)

#### DigComp and UNESCO AI Competency Framework

DigComp models digital competence as knowledge, skills, and attitudes across information/data literacy, communication, content creation, safety, and problem solving. UNESCO’s AI Competency Framework for Students combines human-centeredness, ethics, AI techniques, and system design with Understand, Apply, and Create progression levels.

Implication: cross-cutting concerns such as safety, ethics, privacy, human-centeredness, and source evaluation should be represented as independent facets or desiderata, not hidden inside a general technical skill label.

Sources:

- [DigComp framework](https://joint-research-centre.ec.europa.eu/oldpage-digcomp/digcomp-framework_en)
- [UNESCO AI Competency Framework for Students](https://www.unesco.org/en/articles/ai-competency-framework-students)

### AI benchmark and agent-evaluation taxonomies

#### HELM

HELM separates scenarios from metrics and measures several desiderata, including accuracy, calibration, robustness, fairness, bias, toxicity, and efficiency. A scenario is contextual rather than merely a task name.

Implication: task, domain, language, metric, adaptation/scaffold, and risk desideratum should remain separate entities. A result should exist per task/metric pair where appropriate, and “not measured” should be representable.

Sources:

- [HELM overview](https://crfm.stanford.edu/2022/11/17/helm.html)
- [HELM paper](https://doi.org/10.48550/arxiv.2211.09110)

#### BIG-bench

BIG-bench uses overlapping keywords for capabilities, domains, interaction mechanics, formats, stressors, out-of-distribution behavior, and execution requirements. Its public task count has changed between paper and repository releases.

Implication: use many-to-many tags with `tag_type`, and version both the taxonomy and the benchmark release. Never treat a keyword count or benchmark roster as permanent.

Sources:

- [BIG-bench paper](https://arxiv.org/abs/2206.04615v3)
- [BIG-bench keyword ontology](https://github.com/google/BIG-bench/blob/main/keywords.md)

#### Super-NaturalInstructions

Super-NaturalInstructions provides task type, language, and domain annotations across a large collection of expert-written NLP tasks. It uses task type to study generalization to unseen tasks.

Implication: task type, language, domain, input/output granularity, and split role should be separate facets.

Source:

- [Super-NaturalInstructions](https://aclanthology.org/2022.emnlp-main.340/)

#### GAIA

GAIA combines reasoning, browsing, coding, tool use, and file or multimodal handling. Its difficulty levels are based partly on annotator estimates of steps and tools, but the benchmark avoids claiming that one successful path reveals a complete capability decomposition.

Implication: store intended capabilities and observed execution paths separately. Record step count and tool count as path observations, not as universal task requirements.

Source:

- [GAIA benchmark](https://arxiv.org/html/2311.12983)

#### SkillsBench

SkillsBench separates primary domain, subcategory, task type, modality, interface, skill type, difficulty, and annotation confidence.

Implication: this is a strong practical pattern for RSemble’s first taxonomy implementation. Reuse the separation of axes, not the benchmark’s exact category labels.

Sources:

- [SkillsBench taxonomy](https://github.com/benchflow-ai/skillsbench/blob/main/taxonomy.md)
- [SkillsBench controlled vocabulary](https://github.com/benchflow-ai/skillsbench/blob/main/taxonomy.yaml)
- [SkillsBench paper](https://doi.org/10.48550/arxiv.2602.12670)

#### ADeLe

ADeLe distinguishes task-demand profiles from model ability profiles. Its demand dimensions include reasoning, information selection, calibration, knowledge domains, atypicality, volume, and unguessability.

Implication: demand annotation belongs to tasks. Model capability estimates belong to derived analysis over observations and require uncertainty and provenance.

Sources:

- [ADeLe project](https://kinds-of-intelligence-cfi.github.io/ADELE/)
- [ADeLe evaluation toolkit](https://github.com/Kinds-of-Intelligence-CFI/ADeLe-AIEvaluation)
- [ADeLe Nature paper](https://www.nature.com/articles/s41586-026-10303-2)

#### Agent Skills specification

The Agent Skills specification packages procedural knowledge as a directory containing instructions, scripts, references, and assets. This is a skill artifact format, not a taxonomy of model capability.

Implication: distinguish skill packages supplied to an agent from skill demands annotated on tasks and capabilities inferred from model performance.

Sources:

- [Agent Skills specification](https://agentskills.io/specification)
- [Anthropic Skills repository](https://github.com/anthropics/skills)

## Proposed RSemble facets

The initial taxonomy should be faceted rather than a single hierarchy.

### Domain

What subject-matter or professional area is involved?

Examples:

```text
software engineering
research
finance
mathematics
natural science
cybersecurity
product strategy
document production
```

### Task operation

What does the model have to do?

```text
retrieve
summarize
classify
extract
calculate
analyze
debug
implement
transform
plan
verify
rank
critique
design
generate
```

### Cognitive demand

How must the task be solved?

```text
recall
comprehension
application
analysis
evaluation
creation
quantitative reasoning
logical reasoning
critical thinking
uncertainty calibration
information selection
planning
stakeholder reasoning
```

### Procedural skill type

What reusable procedure would help?

```text
domain procedure
tool workflow
library/API usage
debugging heuristic
data-cleaning procedure
mathematical method
verification protocol
research/citation procedure
document-production workflow
```

### Modality and artifact

What materials are handled?

```text
text
source code
JSON
CSV
spreadsheet
PDF
document
presentation
image
audio
video
database
time series
scientific data
```

### Interface and environment

Where does the work happen?

```text
chat
terminal
Python
browser
GUI
spreadsheet application
compiler/toolchain
database
formal prover
sandbox
multi-agent environment
```

### Verification and observability

How can success be determined?

```text
exact match
numeric tolerance
schema validation
unit tests
custom checker
reference comparison
human rubric
LLM judge
mixed verifier/rubric
```

### Difficulty and demand

Store separate values for:

```text
declared difficulty
cognitive complexity
operational complexity
human completion time
human success rate
model-relative difficulty
reliability threshold
uncertainty
```

### Outcome and risk desiderata

Keep quality and risk dimensions separate from skill labels:

```text
correctness
completeness
factuality
citation integrity
constraint adherence
clarity
robustness
safety
privacy
fairness
latency
cost
format compliance
maintainability
```

### Relations

Useful task relations include:

```text
variant_of
derived_from
duplicate_of
instance_of
composes_with
requires
prerequisite_of
holdout_of
calibration_pair_for
replacement_for
```

## Proposed storage model

### Task catalog

```text
Task
├── taskId
├── lifecycle status
├── aliases
└── currentVersion

TaskVersion
├── taskId
├── version
├── contentHash
├── title
├── prompt
├── systemPrompt
├── input/output contract
├── verification configuration
├── evaluation profile reference
├── taxonomy assignments
├── difficulty metadata
├── source and author metadata
├── supersedes
└── createdAt
```

Task identity should not be derived solely from prompt text. The same text can be used with different environments, scoring protocols, or source snapshots. A content hash is an integrity and deduplication aid, not necessarily the semantic identity.

### Task instances and families

The current `EvaluationTask` is closest to a concrete executable task. A later model can distinguish:

```text
TaskFamily
└── reusable class of related workloads

TaskInstance
└── concrete prompt/input/files/data/environment snapshot
```

This distinction should be reserved in the data model even if the first migration treats current tasks as both task versions and concrete instances.

### Suite as workload manifest

```text
Suite
├── suiteId
├── name
└── lifecycle state

SuiteVersion
├── suiteId
├── version
├── task memberships
├── model pool
├── judge configuration
├── evaluation profile
├── aggregation protocol
└── protocol fingerprint
```

A membership should carry context rather than only a task ID:

```text
TaskMembership
├── taskVersionId
├── order
├── stratum
├── weight
├── role
├── inclusion rationale
└── holdout/calibration designation
```

The UI can continue calling this a suite. Internally, it is a reproducible selection and protocol over canonical task versions.

### Experiment

```text
Experiment
├── experimentId
├── suiteVersionRef
├── frozen task manifest
├── protocol fingerprint
├── model/policy configuration
├── status
└── lifecycle metadata
```

The experiment must retain a materialized snapshot even after canonical task records evolve. This preserves reproducibility and makes historical results independent of later catalog edits.

### Observation

```text
TaskObservation
├── observationId
├── taskVersionRef
├── taskInstanceRef
├── suiteVersionRef
├── experimentId
├── policy/treatment
├── model configuration
├── sample index
├── attempt index
├── output/artifact references
├── score vector
├── verifier result
├── judge references
├── cost
├── latency
├── status
└── provenance
```

Attempts, retries, and remeasurements should remain inspectable. A retry is not automatically a new independent treatment.

### Intended graph and observed trace

For multi-step tasks, keep separate structures:

```text
intended_graph
├── author-defined steps
├── dependencies
├── branches
├── loops
└── expected artifacts

observed_trace
├── model actions
├── tool calls
├── intermediate artifacts
├── failures
└── actual timing
```

This prevents one model’s solution path from becoming the assumed task decomposition.

## Skill relation shape

A task may have multiple skill relations:

```text
task_skill(
  task_id,
  taxonomy_namespace,
  concept_uri,
  taxonomy_version,
  role,                 -- target / required / supporting / constraint / observed
  level_or_demand,
  annotation_source,
  annotator,
  confidence,
  rationale,
  evidence_ref,
  created_at
)
```

The distinction between `required` and `observed` is important. A tool or skill appearing in one successful trace is not necessarily required by the task.

External labels should remain references:

```text
taxonomy_namespace + concept_uri + taxonomy_version
```

They should not replace RSemble’s own stable task identity.

## Evidence and provenance

W3C PROV provides a useful mapping for RSemble:

```text
Entities
├── task definition
├── input files
├── source documents
├── model output
├── tool output
├── score
└── report

Activities
├── task execution
├── model generation
├── tool call
├── judge evaluation
├── verifier execution
└── aggregation

Agents
├── model
├── provider
├── human annotator
├── judge model
└── software version
```

Every score should be traceable to:

- exact task/version and input snapshot;
- model/provider/version;
- prompt, scaffold, and tool configuration;
- raw output and permitted trace artifacts;
- scoring method and evaluator version;
- human/reference answer or rubric;
- provenance and timestamp;
- uncertainty and known limitations.

Sources:

- [W3C PROV-O](https://www.w3.org/TR/prov-o/)
- [W3C PROV-DM](https://www.w3.org/TR/prov-dm/)

## Statistical implications

### Task-level independence

A suite with 20 tasks and three generations per task is not automatically 60 independent observations. Repeated generations estimate within-task variability. They do not create 60 independent workload draws.

For paired policy comparisons:

1. keep repeated generations linked to their task;
2. aggregate within task where appropriate;
3. calculate paired policy deltas per task;
4. bootstrap or permutation-test the task-level delta vector;
5. report wins, ties, losses, uncertainty, cost, and practical thresholds.

### Generalized accuracy

Fixed-benchmark accuracy and expected performance over a population of similar items are different claims. Item-level records allow later estimation of item difficulty, task-family effects, model effects, and repeated-trial variance.

The database should preserve enough structure to distinguish:

```text
performance on this exact suite version
versus
estimated performance on a broader task population
```

Sources:

- [NIST AI 800-3](https://www.nist.gov/publications/expanding-ai-evaluation-toolbox-statistical-models)
- [Statistical uncertainty quantification for aggregate benchmark metrics](https://arxiv.org/html/2501.04234)
- [Confidence and stability of global and pairwise scores](https://aclanthology.org/2025.acl-srw.3.pdf)
- [Can We Trust Item Response Theory for AI Evaluation?](https://arxiv.org/html/2607.15190)

### Fusion Study implications

The task remains the generalization unit for Fusion Study. Candidate generation, ranking, fusion, and refinement should be compared on shared task evidence where possible.

Report at least:

```text
per-task policy score
per-task paired delta
criterion-level score vector
verifier result where available
cost and latency
wins/ties/losses
uncertainty
claim level
```

Do not treat a suite aggregate as sufficient evidence for a policy recommendation. The existing Fusion Study specification’s separation of selection headroom and synthesis headroom remains appropriate.

## Migration strategy

The safest migration is incremental.

### Phase 1: canonical task identity

Add task catalog records and immutable task versions while retaining the current embedded task representation.

### Phase 2: suite membership references

Allow suite versions to reference canonical task versions. Continue materializing full task snapshots for existing experiments and imports.

### Phase 3: task-level observation index

Index existing run records by task version, suite version, experiment, model, policy, sample, and attempt. Keep detailed artifacts in the existing run store.

### Phase 4: initial faceted metadata

Start with a small controlled vocabulary:

```text
domain
taskType
modality
interface
skillType
verification
difficulty
```

Add detailed cognitive-demand annotation only after the identity and observation layers are stable.

### Phase 5: task analytics

Add task-level views for:

- model scores;
- policy wins, ties, and losses;
- criterion-level error patterns;
- complementarity;
- synthesis headroom;
- taxonomy coverage;
- difficulty and uncertainty;
- suite membership comparisons.

### Phase 6: capability analysis

Only after sufficient cross-task observations exist should RSemble estimate broader capability profiles. These should remain derived, versioned analyses rather than mutable fields on model records.

## Risks and safeguards

| Risk | Safeguard |
|---|---|
| One giant skill hierarchy becomes unmaintainable | Use independent facets and typed relations |
| Taxonomy labels are mistaken for ground truth | Store annotation source, confidence, rationale, and taxonomy version |
| Difficulty collapses into one misleading number | Store cognitive, operational, human, model-relative, and reliability dimensions separately |
| Observed tools are treated as required skills | Keep intended requirements separate from observed traces |
| Retries are counted as independent evidence | Model attempts, treatments, and remeasurements explicitly |
| Historical benchmark results silently change | Version task rosters, taxonomies, suite manifests, and protocol fingerprints |
| Aggregate scores hide heterogeneous task behavior | Preserve task/item observations and report task-level uncertainty |
| External occupational taxonomies are over-applied | Use external schemes as references and mappings, not as the RSemble core ontology |
| Latent ability estimates are overinterpreted | Defer IRT-style modeling until coverage and sample size justify it |

## Recommended next specification

The next reviewed design artifact should be:

> **Task Catalog and Workload Manifest Specification**

It should define:

1. task and task-version identity;
2. task-family and task-instance boundaries;
3. suite-version membership references;
4. experiment snapshot rules;
5. task observation indexing;
6. taxonomy namespace and facet assignment contracts;
7. verifier, judge, and score provenance;
8. intended task graphs and observed traces;
9. migration compatibility with current suite blobs and experiment snapshots;
10. acceptance tests for reproducibility and task-level aggregation.

The broader skill taxonomy and capability inference layer should follow this foundation rather than precede it.

## Source map

- [Revised Bloom taxonomy](https://www.wcu.edu/WebFiles/PDFs/BloomsRevisedTaxonomyTable.pdf)
- [Webb’s Depth of Knowledge](https://www.webbalign.org/dok-primer)
- [O*NET Content Model](https://www.onetcenter.org/content.html)
- [ESCO classification](https://esco.ec.europa.eu/en/classification)
- [DigComp](https://joint-research-centre.ec.europa.eu/oldpage-digcomp/digcomp-framework_en)
- [UNESCO AI Competency Framework](https://www.unesco.org/en/articles/ai-competency-framework-students)
- [Super-NaturalInstructions](https://aclanthology.org/2022.emnlp-main.340/)
- [BIG-bench](https://arxiv.org/abs/2206.04615v3)
- [HELM](https://doi.org/10.48550/arxiv.2211.09110)
- [GAIA](https://arxiv.org/html/2311.12983)
- [METR methodology](https://arxiv.org/html/2503.14499v3)
- [SkillsBench taxonomy](https://github.com/benchflow-ai/skillsbench/blob/main/taxonomy.md)
- [ADeLe](https://kinds-of-intelligence-cfi.github.io/ADELE/)
- [Agent Skills specification](https://agentskills.io/specification)
- [Inspect AI](https://inspect.aisi.org.uk/)
- [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness)
- [BPMN 2.0.1](https://www.omg.org/spec/BPMN/2.0.1/PDF)
- [W3C PROV-O](https://www.w3.org/TR/prov-o/)
- [NIST AI 800-3](https://www.nist.gov/publications/expanding-ai-evaluation-toolbox-statistical-models)
- [NIST AI Risk Management Framework](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)
