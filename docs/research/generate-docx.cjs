// LLM Fusion Research Report — professional DOCX generator
// Uses docx-js to produce a client-facing Word document from the research.
// The `docx` package is a devDependency: this generator is a standalone offline
// research tool, never imported by app source or bundled into the app. Moving
// it out of `dependencies` keeps it off the production dependency surface while
// preserving the generator (run with node docs/research/generate-docx.cjs).

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  Header, Footer, PageNumber, convertInchesToTwip,
} = require("docx");
const fs = require("fs");
const path = require("path");

// ---- Design constants ----
const ACCENT = "2D6CDF";       // blue accent
const DARK = "1A1A2E";         // dark text
const MUTED = "6B7280";         // muted text
const LIGHT_BG = "F0F4FA";     // light blue background for callouts
const TABLE_BORDER = "D1D5DB";

const FONT = "Calibri";
const MONO = "Consolas";

// ---- Helpers ----
function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 120, before: opts.before ?? 0, line: 320 },
    alignment: opts.align ?? AlignmentType.LEFT,
    indent: opts.indent,
    children: [
      new TextRun({
        text,
        font: FONT,
        size: opts.size ?? 22, // 11pt
        color: opts.color ?? DARK,
        bold: opts.bold ?? false,
        italics: opts.italics ?? false,
      }),
    ],
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160, line: 320 },
    pageBreakBefore: true,
    children: [
      new TextRun({ text, font: FONT, size: 32, color: ACCENT, bold: true }),
    ],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120, line: 320 },
    children: [
      new TextRun({ text, font: FONT, size: 26, color: DARK, bold: true }),
    ],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 100, line: 320 },
    children: [
      new TextRun({ text, font: FONT, size: 23, color: ACCENT, bold: true }),
    ],
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    spacing: { after: 80, line: 300 },
    indent: { left: convertInchesToTwip(0.25 + level * 0.25) },
    children: [
      new TextRun({ text: `\u2022  `, font: FONT, size: 22, color: ACCENT }),
      new TextRun({ text, font: FONT, size: 22, color: DARK }),
    ],
  });
}

function richBullet(runs, level = 0) {
  return new Paragraph({
    spacing: { after: 80, line: 300 },
    indent: { left: convertInchesToTwip(0.25 + level * 0.25) },
    children: [
      new TextRun({ text: `\u2022  `, font: FONT, size: 22, color: ACCENT }),
      ...runs,
    ],
  });
}

function code(text) {
  return new Paragraph({
    spacing: { after: 120, before: 80, line: 280 },
    indent: { left: convertInchesToTwip(0.3) },
    shading: { type: ShadingType.CLEAR, fill: "F3F4F6" },
    children: [
      new TextRun({ text, font: MONO, size: 19, color: "374151" }),
    ],
  });
}

function callout(title, body) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [9000],
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      left: { style: BorderStyle.SINGLE, size: 24, color: ACCENT },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 100, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, fill: LIGHT_BG },
            margins: { top: 120, bottom: 120, left: 200, right: 200 },
            children: [
              new Paragraph({
                spacing: { after: 60, line: 300 },
                children: [
                  new TextRun({ text: title, font: FONT, size: 22, color: ACCENT, bold: true }),
                ],
              }),
              new Paragraph({
                spacing: { after: 0, line: 300 },
                children: [
                  new TextRun({ text: body, font: FONT, size: 21, color: DARK }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function tableCell(text, opts = {}) {
  return new TableCell({
    width: { size: opts.width ?? 2500, type: WidthType.DXA },
    shading: opts.header ? { type: ShadingType.CLEAR, fill: ACCENT } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [
      new Paragraph({
        spacing: { after: 0, line: 280 },
        children: [
          new TextRun({
            text,
            font: FONT,
            size: 20,
            color: opts.header ? "FFFFFF" : DARK,
            bold: opts.header ?? false,
          }),
        ],
      }),
    ],
  });
}

function makeTable(headers, rows, colWidths) {
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths: colWidths,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER },
      left: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER },
      right: { style: BorderStyle.SINGLE, size: 4, color: TABLE_BORDER },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: TABLE_BORDER },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: TABLE_BORDER },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => tableCell(h, { header: true, width: colWidths[i] })),
      }),
      ...rows.map((row) =>
        new TableRow({
          children: row.map((cell, i) => tableCell(cell, { width: colWidths[i] })),
        }),
      ),
    ],
  });
}

function spacer() {
  return new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: "" })] });
}

function tr(text, bold = false, italics = false) {
  return new TextRun({ text, font: FONT, size: 22, color: DARK, bold, italics });
}

// ---- Document content ----
const sections = [];

// Title page
sections.push({
  properties: {
    page: {
      size: { width: 12240, height: 15840 },
      margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
    },
  },
  headers: {
    default: new Header({
      children: [new Paragraph({ children: [new TextRun({ text: "" })] })],
    }),
  },
  footers: {
    default: new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "RSemble AI Research  |  July 2026  |  Page ", font: FONT, size: 18, color: MUTED }),
            new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: MUTED }),
          ],
        }),
      ],
    }),
  },
  children: [
    new Paragraph({ spacing: { before: 3000 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({ text: "LLM Answer Fusion", font: FONT, size: 52, color: ACCENT, bold: true }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [
        new TextRun({ text: "A Research Report on Model Pairing, Synthesis Mechanisms, and Optimal Configuration Discovery", font: FONT, size: 28, color: DARK }),
      ],
    }),
    new Paragraph({ spacing: { before: 600 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [
        new TextRun({ text: "Prepared for: RSemble AI Development Roadmap", font: FONT, size: 22, color: MUTED }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [
        new TextRun({ text: "Date: July 31, 2026", font: FONT, size: 22, color: MUTED }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [
        new TextRun({ text: "Classification: Internal Research", font: FONT, size: 22, color: MUTED }),
      ],
    }),
  ],
});

// Content sections
const contentChildren = [
  // Executive Summary
  h1("Executive Summary"),
  p("LLM answer fusion, the practice of generating responses from multiple models and synthesizing them into one output, has moved from academic curiosity to production feature in under two years. OpenRouter's Fusion API, Nous Research's Hermes MoA 2.0, and a wave of open-source self-hostable alternatives all implement the same core pipeline: fan out a prompt to a panel of models in parallel, have a judge analyze their responses structurally, then have a synthesizer write a final answer grounded in that analysis."),
  p("The evidence is bifurcated. On one hand, fusion consistently produces outputs that beat individual panelists on instruction-following and deep-research benchmarks. OpenRouter reports that a budget panel of Gemini 3 Flash, Kimi K2.6, and DeepSeek V4 Pro beats solo GPT-5.5 and solo Opus 4.8 outright, landing within 1% of Claude Fable 5 at half the cost. On the other hand, rigorous academic studies find that one-shot synthesis over final answers loses to judge-based selection 82% of the time, that mixing different models often drags quality down compared to sampling one strong model repeatedly, and that on open-ended tasks the best models increasingly fail alike, capping the gains any combination can deliver."),
  spacer(),
  callout(
    "Critical Finding",
    "Roughly three-quarters of fusion's lift comes from the synthesis step itself, not from model diversity (OpenRouter's own ablation). The synthesizer model and its prompt are the highest-leverage variables. The path to discovering optimal model pairs per task class runs through error-overlap analysis, quality-matched selection, and task-typed evaluation.",
  ),
  spacer(),

  // Section 1
  h1("1. What Fusion Is and How It Works"),
  h2("1.1 Definition and Taxonomy"),
  p("LLM answer fusion is the process of combining outputs from multiple language models into a single response that aims to be better than any individual input. It exists at three levels of abstraction:"),
  h3("Response-Level Fusion (Inference-Time)"),
  p("Multiple models generate answers to the same prompt independently, then an aggregator combines them. This is the most common production approach and the one RSemble implements. No model weights change. Variants include:"),
  bullet("Mixture of Agents (MoA): Layered architecture where each layer's agents see the previous layer's outputs. The original MoA uses 3 layers of 6 proposers with a final aggregator."),
  bullet("Self-MoA: Sample one strong model multiple times instead of mixing different models. Often beats heterogeneous MoA."),
  bullet("Rank-then-fuse: A ranker scores candidates pairwise, then a fuser merges the top-K. LLM-Blender's PairRanker + GenFuser."),
  bullet("Judge-then-synthesize: A judge extracts structured analysis (consensus, contradictions, unique insights, blind spots), then a synthesizer writes the final answer from that analysis. This is OpenRouter Fusion's architecture."),
  bullet("Selection (not fusion): A judge picks the best candidate without synthesizing. Empirically the strongest aggregator in diverse-team settings."),
  h3("Weight-Level Fusion (Training-Time)"),
  p("Merge model weights or probability distributions into a single model. FuseLLM and FuseChat transfer knowledge from multiple source LLMs into one target through continual training. ProFuser extends this with a progressive inference-to-training curriculum. These are not inference-time fusion and are out of scope for RSemble, but they inform the taxonomy."),
  h3("Latent-Level Fusion"),
  p("Mixture of Thoughts (MoT) projects hidden states from heterogeneous experts into a shared latent space where a primary expert cross-attends to its peers. Single-pass, routing-like efficiency, but requires training interaction layers. Also out of scope for RSemble but relevant to understanding the design space."),

  h2("1.2 The Core Pipeline"),
  p("Every production fusion system implements a variant of this pipeline:"),
  code("Prompt\n  |\n  v\nFan-out (panel) --> Model A --+\n                --> Model B --+  (parallel, each optionally tool-enabled)\n                --> Model C --+\n                               |\n                               v\n                    Judge / Analyst\n                    (structured analysis: consensus, contradictions,\n                     partial coverage, unique insights, blind spots)\n                               |\n                               v\n                    Synthesizer\n                    (writes final answer grounded in analysis)\n                               |\n                               v\n                    Final answer + cost/latency metadata"),
  spacer(),
  p("Key design decisions at each stage:", { bold: true }),
  makeTable(
    ["Stage", "Decision", "Options"],
    [
      ["Fan-out", "Panel composition", "Diverse models vs same model sampled N times"],
      ["Fan-out", "Temperature", "Same for all vs spread (diversity jitter)"],
      ["Fan-out", "Tools", "Panelists get web search/fetch or not"],
      ["Judge", "Analysis format", "Structured JSON vs free-form"],
      ["Judge", "Blindness", "Anonymized sources or model-attributed"],
      ["Synthesize", "Model", "Same as judge, separate, or panel member"],
      ["Synthesize", "Grounding", "From structured analysis vs raw responses"],
      ["Router", "When to fuse", "Always vs model-decides vs heuristic gate"],
    ],
    [1500, 2200, 5300],
  ),

  // Section 2
  h1("2. The Academic Landscape"),
  h2("2.1 Foundational Papers"),

  h3("Mixture-of-Agents (Wang et al., 2024)"),
  p("The original MoA paper. Layered architecture: 3 layers, 6 proposers per layer, Qwen1.5-110B as final aggregator. Achieved 65.1% on AlpacaEval 2.0 vs GPT-4o's 57.5% using only open-source models. Key insight: models exhibit collaborativeness where an aggregator produces better responses when given access to other models' outputs, even inferior ones. MoA outperformed an LLM-ranker baseline, suggesting the aggregator performs sophisticated aggregation, not mere selection."),

  h3("Self-MoA (Li et al., 2025)"),
  p("The critical rebuttal. Sampling one top-performing model multiple times outperforms mixing different models in most scenarios. Self-MoA beat standard MoA by 6.6 points on AlpacaEval 2.0. The mechanism: MoA is very sensitive to proposer quality, and mixing different models often lowers the average quality of the proposer pool. The quality-diversity trade-off is real: diversity helps only when models are of similar quality."),

  h3("Selection Bottleneck (2026)"),
  p("The strongest finding against synthesis. Across 42 tasks in 7 categories, judge-based selection beat MoA-style synthesis every single time. Synthesis lost to a single-model baseline 82% of the time (BT-WR 0.179). The mechanism: synthesis averages, selection picks. A diverse team's value lies in the variance of its candidate pool. Selection captures this value; synthesis destroys it by blending all candidates into a compromise output that can be worse than any individual."),

  h3("Trace-Level Synthesis (2026)"),
  p("The counterexample showing when synthesis does win. When the aggregator reads full reasoning traces rather than just final answers, it can assemble solutions no individual chain produced. The aggregation paradox: trace-level synthesis improves accuracy even at unanimous consensus, exceeding the voting ceiling. Different chains contain different correct intermediate steps, and the aggregator assembles them. This requires verification and trace access."),

  h3("Co-Failure Ceiling (2026)"),
  p("The fundamental limit. Across 67 frontier models, accuracy is capped by the rate at which all models fail simultaneously (beta). On open-ended math, beta is 0.052; on execution-graded code, 0.079. No selection policy can exceed the ceiling 1 minus beta. Co-failure tracks open-endedness, not subject matter: the same GPQA questions flip from beta approximately 0 (multiple-choice) to beta 0.127 (free-response) when only the format changes."),

  h3("LLM-Blender (Jiang et al., 2023)"),
  p("The rank-then-fuse ancestor. PairRanker jointly encodes input + candidate pairs using cross-attention, producing a ranking matrix. GenFuser then merges the top-K. Outperforms individual LLMs on MixInstruct. The key structural difference from MoA: ranking is a separate trained model, not an LLM prompt."),

  h3("Balancing Diversity and Consistency (ICLR 2025)"),
  p("Introduces DMoA (Dynamic Mixture of Agents). Three findings: (1) aggregation and synthesis outperform ranking and self-consistency on open-ended tasks, (2) higher semantic diversity degrades performance across reasoning tasks, (3) task-specific skills reside in different subspaces. DMoA achieves SOTA on Big Bench Hard by dynamically selecting models based on required skills."),

  h2("2.2 The Quality-Diversity Trade-off"),
  p("The central tension in fusion, confirmed across multiple papers:"),
  bullet("Quality matters more than diversity. Self-MoA beats Mixed-MoA when quality varies. MoA is rather sensitive to proposer quality."),
  bullet("Diversity helps only at matched quality. Low-correlation heterogeneous ensembles beat high-correlation Self-MoA by +0.027 at k=3, positive in all 60 resamplings, but small."),
  bullet("Naive diversity is a liability. On 455 three-model triplets, the mean majority-vote gain over the best member is negative."),
  bullet("Error correlation is the right metric, not diversity. Diversity metrics are substantially entangled with capability."),

  h2("2.3 When Mixing Different Models Actually Helps"),
  p("The Self-MoA paper identifies the narrow regime where heterogeneous mixing wins:"),
  bullet("Specialized models on specialized tasks. When each model excels at a different subtask, mixed MoA can outperform Self-MoA, but even then only 2 of 13 mixed configurations slightly outperformed."),
  bullet("Similar-quality models. When all panelists are approximately equally strong, their different error modes complement each other."),
  bullet("Open-ended, subjective tasks. Deep research, multi-domain critique, and compare-and-contrast prompts benefit from genuinely different perspectives."),

  // Section 3
  h1("3. Production Fusion Systems"),
  h2("3.1 OpenRouter Fusion"),
  p("The most mature production fusion feature. Launched 2025, benchmarked on the DRACO deep research benchmark (100 tasks across 10 domains, graded against ~39 weighted criteria per task)."),
  p("Architecture: (1) Prompt dispatched to 1-8 models in parallel with web search and fetch. (2) Analyst model produces structured analysis JSON: consensus, contradictions, partial coverage, unique insights, blind spots. (3) Calling model writes the final answer from the analysis."),
  spacer(),
  callout(
    "OpenRouter Fusion Benchmark Results (DRACO, 100 deep research tasks)",
    "Fable 5 + GPT-5.5 synthesized by Opus 4.8: 69.0%. Budget panel (Gemini 3 Flash + Kimi K2.6 + DeepSeek V4 Pro) synthesized by Opus 4.8: 64.7%, beating solo GPT-5.5 (60.0%) and solo Opus 4.8 (58.8%). Self-fusion (Opus + Opus): 65.5%, a 6.7-point jump from synthesis alone.",
  ),
  spacer(),
  p("Key ablation finding: Running Opus 4.8 paired with itself (no diversity) lifted its score from 58.8% to 65.5%. OpenRouter attributes roughly three-quarters of Fusion's lift to synthesis and one-quarter to diversity.", { bold: true }),

  h2("3.2 Hermes MoA 2.0 (Nous Research)"),
  p("Released June 2025 as a core feature of Hermes Agent v0.17.0. User configures a preset: several reference models plus a single aggregator. Reference models analyze independently; aggregator synthesizes and handles tool calls. Presets appear as selectable virtual models. Design choices: prompt caching preserved by appending reference outputs at end of context; nested MoA banned; full tool access reserved for aggregator; each reference model's output displayed for auditability."),
  p("Reported HermesBench (not yet public): GPT-5.5 + DeepSeek with Opus 4.8 aggregator scored 0.8202 vs Opus 4.8 alone at 0.7607 (~8% improvement) and GPT-5.5 alone at 0.7412 (~11% improvement). Cost: each call multiplies token usage by roughly the number of reference models."),

  h2("3.3 Open-Source Self-Hostable Alternatives"),
  p("A cluster of open-source projects replicate the Fusion pipeline as self-hostable services:"),
  bullet("fusionHarness: OpenAI-compatible MoA server with budget and frontier presets, quality knobs (refine, layers, samples, diversity), graceful degradation."),
  bullet("openfusion: FastAPI proxy with React playground, supports self_fusion, panel, debate, and pipeline strategies, per-prompt Auto Router."),
  bullet("chorus: Rust-based MoA gateway with hardened aggregation (source anonymization, length normalization, mandatory critical dissent, single-source domination cap)."),
  bullet("fusion-engine: Python framework with panel configs in JSON, specialized judge templates (deep_research, code_review, creative, tool_synthesis)."),

  h2("3.4 OpenPipe MoA"),
  p("OpenPipe ships productized MoA models as drop-in GPT-4 replacements: moa-gpt-4-v1, moa-gpt-4-turbo-v1, moa-gpt-4o-v1. OpenAI-compatible endpoint, base-model-agnostic. Performance: 84.8 on Arena Hard Auto, 68.4 LC on AlpacaEval 2.0, MoA outputs preferred over GPT-4 59.5% of the time (Claude 3 Opus judge). Primary use case: synthetic training data generation."),

  h2("3.5 Other Provider Activity"),
  bullet("9Router: 3-tier fallback routing (subscription, cheap, free). Not fusion. RTK token compression (20-40%), Caveman Mode (65%)."),
  bullet("RouteLLM (LMSYS): Open-source routing. 85% cost reduction at 95% GPT-4 quality. >40% cheaper than commercial routers."),
  bullet("NotDiamond: Pre-trained model routing API. Powers OpenRouter Auto. Custom router training on user data."),
  bullet("Anthropic parallel TTC (research): Claude 3.7 Sonnet 84.8% on GPQA with 256 samples + learned scoring model. Internal ensemble, not productized."),
  bullet("OpenAI o-series: Single model with RL chain-of-thought. NOT ensemble. Planner+doer pattern is user-side composition."),
  bullet("Sakana AI: Evolutionary weight merging (weight-level). SOTA Japanese LLM/VLM from merging. Research + open models."),

  // Section 4
  h1("4. When Fusion Helps and When It Hurts"),
  h2("4.1 Fusion Helps When"),
  bullet("The task is open-ended and subjective (deep research, multi-domain critique)."),
  bullet("Panelists are individually strong and approximately quality-matched."),
  bullet("The synthesizer model is strong (three-quarters of the lift comes from synthesis)."),
  bullet("The task benefits from structured analysis before synthesis."),
  bullet("Panelists have access to tools (web search) for independent research."),
  bullet("Problems are hard enough to justify the 4-5x cost."),

  h2("4.2 Fusion Hurts When"),
  bullet("The task is verifiable (math, code). Selection or self-consistency outperforms."),
  bullet("Panelists vary widely in quality. Weak models drag the synthesis down."),
  bullet("The synthesizer is weak or the synthesis prompt is shallow (stylistic remix)."),
  bullet("Models are highly correlated (co-failure ceiling caps gains)."),
  bullet("The task is easy. Fusion's cost is not justified. Route to a single model."),
  bullet("The output needs to be an independent answer, not a committee edit."),

  h2("4.3 The Format Effect"),
  p("Co-failure tracks answer format, not subject matter. The same GPQA questions have beta approximately 0 when asked as multiple-choice but beta 0.127 when asked as free-response. Mean accuracy falls from 0.66 to 0.51 just by stripping options. RSemble's tasks (open-ended candidate answers judged against criteria) are in the ceiling-bound regime. Fusion gains will be limited by co-failure, not by panel composition."),

  // Section 5
  h1("5. The Pair Selection Problem"),
  p("The user's core question: which model pairs fuse best for a particular task class? The literature offers several signals, none sufficient alone."),

  h2("5.1 Error-Overlap Analysis (Jaccard Similarity)"),
  p("For each model pair, compute the Jaccard similarity of their error sets (instances where both fail). Low-overlap pairs are candidates for routing or ensembling; high-overlap pairs indicate redundant coverage. Error-overlap values vary substantially across model pairs and scenarios. Within a model family, overlap ranges from 56% to 62%. Cross-family pairs show lower overlap."),
  spacer(),
  callout("For RSemble", "Run each candidate model on a task suite, record per-instance success/failure, compute pairwise Jaccard. Pairs with low overlap AND high individual quality are the best fusion candidates. This is exactly the kind of analysis RSemble's evaluation suite can automate."),

  h2("5.2 Accuracy-Adjusted Correlation (phi-adj)"),
  p("Raw correctness correlation (phi) has almost no predictive power for ensemble lift (R-squared <= 0.09). But accuracy-adjusted phi (phi-adj) is markedly superior (R-squared = 0.67 on SuperGPQA). A compact heuristic combining phi-adj + accuracy gap + collective accuracy predicts ensemble lift with Spearman rho = 0.84 on a calibration set, and transfers with frozen coefficients. The key decomposition: ensemble lift = rescue mass (correct answers gained) minus damage mass (correct answers lost)."),
  spacer(),
  callout("For RSemble", "Use phi-adj, not raw phi, as the correlation metric. The heuristic (phi-adj + accuracy gap + collective accuracy) can be computed from a small calibration set and then applied to predict which pairs will lift, without running full fusion on every candidate pair."),

  h2("5.3 Complementary-MoA: Greedy Selection Algorithms"),
  p("Complementary-MoA reframes proposer selection as feature selection with a black-box objective. Three algorithms span the accuracy-efficiency tradeoff: (1) Model-first greedy: keeps summarizer in loop, ~16,000 calls, highest accuracy. (2) Truth-prediction greedy: label-level statistics, zero summarizer calls, consistently robust. (3) Oracle-surrogate greedy: simple surrogate, ~1,200 calls, sample-efficient. Key finding: the most complementary proposer is sometimes weak on its own. Optimal teams cannot be inferred from individual performance alone."),

  h2("5.4 The EU Reversal"),
  p("A counterintuitive finding: the naive intuition 'more disagreement means more epistemic utility' is wrong. Epistemic uncertainty (EU) correlates +0.72 with redundancy and -0.72 with complementarity. More disagreement between models predicts less ensemble value, not more. The operative signal is pairwise co-failure (do they fail on the same instances?), not pairwise disagreement (do they produce different outputs?)."),

  h2("5.5 Quality-Matched Pool Selection"),
  p("At matched quality, low-correlation heterogeneous ensembles beat high-correlation Self-MoA. Practical rule: (1) Filter to a quality band. (2) Within that band, prefer pairs with low error correlation. (3) Avoid mixing quality tiers."),

  h2("5.3 Task-Skill Matching (DMoA)"),
  p("DMoA identifies required skills per query, then selects models predicted to perform well. Mixtures optimized for one task type underperform on others. Task-specific skills reside in different subspaces. For RSemble: tag each task with required skills, build a lookup from skill tag to best model pair."),

  h2("5.4 DPP-Inspired Diversity (CORE)"),
  p("CORE uses a Determinantal Point Process to explicitly reduce error overlap between collaborators. The cross-model complementarity reward discourages both models from converging to the same reasoning mode. Removing it consistently harms performance on MATH, AIME, and GPQA."),

  h2("5.5 Practical Pair Selection Heuristic"),
  p("Synthesizing the literature into a decision procedure for RSemble:", { bold: true }),
  bullet("Establish a task class as an evaluation suite."),
  bullet("Run each candidate model individually. Record per-instance correctness and quality scores."),
  bullet("Compute pairwise error overlap (Jaccard). Identify low-overlap pairs."),
  bullet("Filter to quality-matched pairs. Drop pairs where one model is significantly weaker."),
  bullet("Compute semantic diversity (Vendi Score or cosine distance). Prefer moderate diversity."),
  bullet("Run fusion on the top-K pairs. Score fused output with an independent judge."),
  bullet("Compare fused score vs best single-model score. If fusion does not beat selection, recommend Rank mode."),
  bullet("Record the optimal pair + synthesizer + judge configuration per task class."),

  // Section 6
  h1("6. Failure Modes and Quality Risks"),
  h2("6.1 Stylistic Remix (Copy-Paste Synthesis)"),
  p("The user's observed failure: the fused answer is a polished remix of candidate phrases, not an independent synthesis. The judge detects contamination and copying because the fused output reproduces distinctive language from multiple candidates and may confabulate authority."),
  p("Mechanism: One-shot synthesis over final answers, with no scores, no traces, and no verification instruction, takes the lowest-energy path. The Selection Bottleneck paper finds synthesis loses to single-model baseline 82% of the time, consistent with zero selection capacity."),
  p("Mitigation: Feed judge scores into the fusion prompt. Instruct verification. Use judge-then-synthesize pipeline. Consider refine-the-winner instead of blend-all."),

  h2("6.2 Confabulation and Phantom Citations"),
  p("The fused answer invents citations to justify the blend. A 2026 study found approximately 146,932 hallucinated citations in scientific papers in 2025 alone, concentrated in AI-assisted writing. In fusion, the model confabulates authority to sound synthesized. Mitigation: make fusion blind, instruct the synthesizer to resolve contradictions rather than cite frameworks, do not give permission to reference unverified external authorities."),

  h2("6.3 Incoherence and Diluted Arguments"),
  p("Blending candidates with different framing produces incoherence. The synthesis is not the average of qualities but something potentially worse. Mitigation: use structured analysis to instruct which position to take, weight by judge scores, consider debate-style fusion."),

  h2("6.4 Weak-Model Drag"),
  p("Including a weak model drags the synthesis down. Self-MoA outperforms mixed MoA when quality varies. Mitigation: filter to quality-matched models, use router gate, weight by judge scores."),

  h2("6.5 Social and Herding Bias"),
  p("Naive MoA can be worse than a single model due to social and herding biases. Mitigation (from chorus): source anonymization, length normalization, mandatory critical dissent, cap on single-source domination."),

  // Section 7
  h1("7. Evaluation Methodology"),
  h2("7.1 The Independent Judge Approach"),
  p("The user's planned approach (score fused output with an independent judge and compare to candidates) is well-supported. The Selection Bottleneck paper used decoupled evaluation with independent judges and confirmed all directional findings (Spearman rho 0.90). Best practices: use a different model family for the judge, blind the judge to which output is fused, use pairwise comparison, use multiple judges and report kappa."),

  h2("7.2 Contamination Detection"),
  p("The judge should be explicitly instructed to check for: distinctive phrases reproduced verbatim from multiple candidates, confabulated citations, internally inconsistent positions, and arithmetic or factual errors introduced by blending."),

  h2("7.3 Multi-Agent Debate for Judges"),
  p("A 2025 NeurIPS paper introduces a multi-agent debate framework for LLM judges with adaptive stopping via Beta-Binomial mixture modeling. Outperforms majority voting on complex tasks. Ensemble size of 7 is optimal. For RSemble: consider a multi-judge panel for high-stakes fusion evaluation."),

  h2("7.4 Benchmark Evidence: Fusion vs Selection vs Routing"),
  p("Three large-scale benchmarks provide empirical context:", { bold: true }),
  richBullet([
    tr("LLMRouterBench (ACL 2026). ", true),
    tr("400K+ instances, 21 datasets, 33 models. Top routers achieve 4% gain over Best Single and 31.7% cost reduction. Critical: several commercial routers fail to reliably outperform a simple baseline. OpenRouter showed -24.7% vs Best Single."),
  ]),
  richBullet([
    tr("LLMFusionBench (2025). ", true),
    tr("14 tasks, 5 domains, 20 OSS LLMs. Thought-level fusion achieves best overall performance; model-level fusion performs worst (overfitting). Query-level fusion surpasses best single by 2-16%."),
  ]),
  richBullet([
    tr("RouterEval (EMNLP 2025). ", true),
    tr("8,500+ LLMs, 12 benchmarks. Even all-weak groups can reach oracle 0.95 with m=10. Performance grows most rapidly at m in {2, 3, 5} — small pools are most cost-effective."),
  ]),

  // Section 8
  h1("8. Task-Dependent Fusion"),
  h2("8.1 Task Type Determines Optimal Strategy"),
  makeTable(
    ["Task Type", "Best Strategy", "Evidence"],
    [
      ["Verifiable (math, code)", "Selection or self-consistency", "Synthesis loses 82%; self-consistency sufficient"],
      ["Open-ended research", "Judge-then-synthesize", "OpenRouter Fusion: 69% on DRACO"],
      ["Instruction following", "Aggregation and synthesis", "DMoA: AS outperforms ranking"],
      ["Commonsense reasoning", "Consensus protocols", "Consensus improves 2.8% on knowledge"],
      ["Strategic reasoning", "Voting protocols", "Voting improves 13.2% on reasoning"],
      ["Safety reasoning", "Diverse debate", "MAD with diverse agents reduces attacks"],
      ["Factual accuracy", "Multi-model refinement", "MAMM-Refine: G+C effective for detection"],
    ],
    [2500, 2800, 3700],
  ),
  spacer(),
  h2("8.2 Pareto-Optimal MoA Configuration"),
  p("MoA dominates the Pareto front across benchmarks. At comparable compute, MoA gains +2.7 points over self-consistency. Design guideline: MoA is most efficient when the number of parallel generations exceeds the number of sequential aggregations by one. Gains persist on harder tasks (+9 pp at 15-20x CoT budget) but diminish on easy tasks."),

  h2("8.3 Debate vs Vote vs Synthesis"),
  p("Voting improves 13.2% on reasoning tasks. Consensus improves 2.8% on knowledge tasks. More agents improves; more rounds before voting reduces. All-Agents Drafting improves 3.3%. Collective Improvement improves 7.4%. For RSemble: the current Rank/Fuse toggle maps to selection vs synthesis. A third option (Debate) could be valuable for task classes where contradictions need resolution."),

  // Section 9
  h1("9. Implications for RSemble AI"),
  h2("9.1 Current State Assessment"),
  p("RSemble's current Fusion mode implements the simplest form of response-level fusion: one-shot synthesis over final answers with no scores, no traces, and no verification instruction. The synthesizer sees full candidate text labeled by model name and is told to merge the strongest material. This is exactly the configuration the literature identifies as weakest."),
  spacer(),
  callout(
    "Current Fusion Weaknesses",
    "No judge scores fed to synthesizer (equal weighting). No verification instruction (confabulation risk). Non-blind fusion (source-attribution confabulation). One-shot, not iterative (no contradiction resolution).",
  ),
  spacer(),

  h2("9.2 The Rank/Fuse Spine"),
  p("The evidence strongly supports RSemble's Rank mode (judge-based selection). Selection is the empirically winning move in diverse-team settings. The Fusion mode needs redesign to justify its cost."),

  h2("9.3 The User's Vision: Pair Discovery"),
  p("RSemble's evaluation suite infrastructure is well-suited for pair discovery: (1) Define a task class as a suite. (2) Run all candidates individually. (3) Compute pairwise error overlap. (4) Run fusion on quality-matched, low-overlap pairs. (5) Score fused outputs with an independent judge. (6) Compare fused score vs best single-model score. (7) Record optimal pair + synthesizer + judge per task class."),

  h2("9.4 Recommended Fusion Improvements"),
  p("Based on the evidence, in priority order:", { bold: true }),
  richBullet([
    tr("Feed judge scores into the fusion prompt. ", true),
    tr("The synthesizer should know which candidates scored highest and why. This is the single highest-leverage change."),
  ]),
  richBullet([
    tr("Make fusion blind. ", true),
    tr("Candidates as A/B/C, no model names. Prevents source-attribution confabulation and herding bias."),
  ]),
  richBullet([
    tr("Use the judge-then-synthesize pipeline. ", true),
    tr("Use the judge's structured analysis as synthesis input instead of raw responses."),
  ]),
  richBullet([
    tr("Add a verification instruction. ", true),
    tr("Tell the synthesizer to verify arithmetic, check claims, and flag unconfirmable reasoning."),
  ]),
  richBullet([
    tr("Consider refine-the-winner. ", true),
    tr("Take the judge's top candidate and improve it against the rubric, using others as reference."),
  ]),
  richBullet([
    tr("Add a router gate. ", true),
    tr("Reserve fusion for prompts that benefit from multiple perspectives. Route easy prompts."),
  ]),

  // Section 10
  h1("10. Recommended Research Program"),
  h2("Phase 1: Baseline Validation"),
  p("Run the user's planned experiment: score fused outputs vs candidate outputs with an independent judge across a representative task suite. Confirm whether current fusion produces outputs at or below the best candidate."),
  p("Deliverable: Empirical evidence of current fusion quality vs selection quality on the user's task class.", { italics: true }),

  h2("Phase 2: Error-Overlap Mapping"),
  p("For each task in the evaluation suite, record per-instance success/failure for every candidate model. Compute pairwise Jaccard similarity. Produce a heatmap of model-pair error overlap per task class."),
  p("Deliverable: Error-overlap matrix identifying complementary vs redundant model pairs.", { italics: true }),

  h2("Phase 3: Score-Aware Fusion"),
  p("Implement the highest-leverage improvement: feed judge scores and explanations into the fusion prompt. Re-run the Phase 1 experiment with score-aware fusion. Compare to score-blind fusion and to selection."),
  p("Deliverable: Empirical evidence of score-aware fusion vs score-blind fusion vs selection.", { italics: true }),

  h2("Phase 4: Blind Fusion + Judge-Then-Synthesize"),
  p("Make fusion blind and use the judge's structured analysis as the synthesis input. Re-run experiments."),
  p("Deliverable: Empirical evidence of structured-analysis fusion vs raw-response fusion.", { italics: true }),

  h2("Phase 5: Pair Discovery"),
  p("Using the error-overlap matrix from Phase 2 and the best fusion configuration from Phases 3-4, run fusion on quality-matched, low-overlap pairs across the task suite. Score each pair's fused output with the independent judge. Produce a ranked list of best fusion pairs per task class."),
  p("Deliverable: A lookup table from task class to optimal fusion pair + synthesizer + judge configuration.", { italics: true }),

  h2("Phase 6: Refine-the-Winner Comparison"),
  p("Implement refine-the-winner as an alternative to blend-all. Compare its quality to fusion and selection on the same task suite."),
  p("Deliverable: Empirical comparison of three finish modes: Rank (selection), Fuse (blend-all), Refine (improve-the-winner).", { italics: true }),

  // References
  h1("11. References"),
  h2("Academic Papers"),
  bullet("Wang, J. et al. \"Mixture-of-Agents Enhances Large Language Model Capabilities.\" arXiv:2406.04692, 2024."),
  bullet("Li, Z. et al. \"Rethinking Mixture-of-Agents: Is Mixing Different LLMs Beneficial?\" arXiv:2502.00674, 2025."),
  bullet("\"When Agents Disagree: The Selection Bottleneck in Multi-Agent LLM Pipelines.\" arXiv:2603.20324, 2026."),
  bullet("\"Beyond Consensus: Trace-Level Synthesis in Mixture of Agents.\" arXiv:2605.29116, 2026."),
  bullet("\"When Does Combining Language Models Help? A Co-Failure Ceiling.\" arXiv:2606.27288, 2026."),
  bullet("Jiang, D. et al. \"LLM-Blender: Ensembling LLMs with Pairwise Ranking and Generative Fusion.\" ACL 2023."),
  bullet("\"Balancing Diversity and Consistency in LLM Ensembles.\" ICLR 2025. (DMoA)"),
  bullet("Wan, F. et al. \"Knowledge Fusion of Large Language Models.\" ICLR 2024. (FuseLLM)"),
  bullet("Shi, T. et al. \"ProFuser: Progressive Fusion of Large Language Models.\" AAAI 2026."),
  bullet("\"Mixture of Thoughts.\" arXiv:2509.21164, 2025."),
  bullet("\"Task-Aware Evaluation and Error-Overlap Analysis for LLMs.\" ACL 2025 CHoMPS."),
  bullet("\"Are Diversity Metrics Measuring Diversity?\" arXiv:2607.20768, 2026."),
  bullet("\"State-dependent error correlations shape voting thresholds.\" arXiv:2607.23931, 2026."),
  bullet("\"How Much of the Routing Gap Is Real?\" arXiv:2607.03436, 2026."),
  bullet("\"CORE: Collaborative Reasoning via Cross Teaching.\" arXiv:2601.21600, 2026."),
  bullet("\"Adaptive Heterogeneous Multi-Agent Debate.\" Springer 2025. (A-HMAD)"),
  bullet("\"Multi-Agent Debate for LLM Judges with Adaptive Stability Detection.\" NeurIPS 2025."),
  bullet("\"Voting or Consensus? Decision-Making in Multi-Agent Debate.\" Findings ACL 2025."),
  bullet("\"MAMM-Refine.\" arXiv:2503.15272, 2025."),
  bullet("\"Multi-LLM Collaborative Search for Complex Problem Solving.\" Findings ACL 2026. (MOSA)"),
  bullet("\"ModeX: Evaluator-Free Best-of-N Selection.\" ACL 2026."),
  bullet("\"Collective Test-Time Scaling.\" arXiv:2508.03333, 2025. (CTTS-MM)"),
  bullet("\"Multi-Agent Reasoning Improves Compute Efficiency.\" ACL 2026 SRW."),
  bullet("Smoothie: Label-Free LLM Routing. arXiv:2412.04692, 2024."),
  bullet("LLM hallucinations in the wild. arXiv:2605.07723, 2026."),
  bullet("Kim et al. Correlated Errors in LLMs. arXiv:2506.07962, 2025."),
  bullet("Predictive Law of Ensemble Lift. arXiv:2607.17384, 2026. (phi-adj)"),
  bullet("Complementary-MoA. arXiv:2605.24048, 2026. (Greedy selection)"),
  bullet("LLMRouterBench. ACL 2026 Findings. (400K+ instances)"),
  bullet("LLMFusionBench / FusionFactory. 2025. (Thought-level wins)"),
  bullet("RouterEval. EMNLP 2025 Findings. (8,500+ LLMs)"),
  bullet("Friedman & Dieng. The Vendi Score. arXiv:2210.02410, 2023."),

  h2("Production Systems"),
  bullet("OpenRouter. \"Fusion | Multi-model AI Analysis.\" Documentation and blog, 2025-2026."),
  bullet("Nous Research. \"Hermes Mixture of Agents 2.0.\" Hermes Agent v0.17.0-v0.18.0, June-July 2025."),
  bullet("Together AI. \"Together Mixture-Of-Agents.\" GitHub: togethercomputer/MoA."),
  bullet("fusionHarness. GitHub: jackulau/fusionHarness."),
  bullet("openfusion. GitHub: shrdgn/openfusion."),
  bullet("chorus. GitHub: paperclipinc/chorus."),
  bullet("fusion-engine. GitHub: luckeyfaraday/fusion-engine."),
  bullet("mixture-llm. PyPI: mixture-llm v0.1.5."),
  bullet("OpenPipe. Mixture of Agents Models. 2025."),
  bullet("RouteLLM (LMSYS). GitHub: lm-sys/RouteLLM."),
  bullet("NotDiamond. AI Model Routing API. 2025."),
  bullet("Sakana AI. Evolutionary Model Merge. 2024-2025."),
  bullet("Distilabel (Argilla). MixtureOfAgentsLLM. 2025."),

  spacer(),
  p("This document was prepared as a research foundation for RSemble AI's Fusion mode evolution. All claims are grounded in the cited literature and production system documentation. The recommended research program is designed to be executable within RSemble's existing evaluation suite infrastructure.", { italics: true, color: MUTED }),
];

sections.push({
  properties: {
    page: {
      size: { width: 12240, height: 15840 },
      margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
    },
  },
  headers: {
    default: new Header({
      children: [
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [
            new TextRun({ text: "LLM Answer Fusion Research  |  RSemble AI", font: FONT, size: 16, color: MUTED, italics: true }),
          ],
        }),
      ],
    }),
  },
  footers: {
    default: new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "Page ", font: FONT, size: 18, color: MUTED }),
            new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: MUTED }),
          ],
        }),
      ],
    }),
  },
  children: contentChildren,
});

// ---- Build and save ----
const doc = new Document({
  sections,
  styles: {
    default: {
      document: {
        run: { font: FONT, size: 22, color: DARK },
        paragraph: { spacing: { line: 320 } },
      },
    },
  },
});

const outputPath = path.resolve(__dirname, "llm-fusion-research.docx");
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outputPath, buffer);
  console.log(`DOCX written to: ${outputPath}`);
  console.log(`Size: ${(buffer.length / 1024).toFixed(1)} KB`);
});
