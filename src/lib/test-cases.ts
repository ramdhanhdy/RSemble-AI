// =============================================================================
// Curated comparison test cases for the one-click "Try an example" control.
//
// These are offline, self-contained prompts designed to expose meaningful
// differences between models: each carries explicit constraints (length,
// structure, tone, audience, forbidden elements) so that weak models produce
// generic slop while strong models honour the spec. They are NOT toy greetings.
//
// Families are deliberately diverse so repeated clicks rotate through different
// task shapes (writing, coding, reasoning, planning, summarization, creative,
// math/logic) instead of repeating the same flavour.
// =============================================================================

export interface ExampleTask {
  /** Stable slug, unique within the catalog. */
  id: string;
  /** Broad task family — used for diversity checks, not display. */
  family: string;
  /** Short human label shown in the control's title/tooltip. */
  title: string;
  /** The full prompt text loaded into the Task input. */
  prompt: string;
}

export const EXAMPLE_TASKS: readonly ExampleTask[] = [
  {
    id: "explain-to-audience",
    family: "writing",
    title: "Explain a concept for a specific audience",
    prompt:
      "Explain how public-key cryptography secures a web browsing session, written for a non-technical small-business owner who has never heard of a certificate. The answer must be no longer than 250 words, use at most one analogy, avoid the words 'math', 'algorithm', and 'modular', and end with exactly three concrete things the owner should do to verify their own site is safe. Do not include a greeting or closing.",
  },
  {
    id: "debug-triangular-loop",
    family: "coding",
    title: "Debug a small program and explain the fix",
    prompt:
      "The following Python function is meant to print a centered triangle of height n, but its spacing is off and it prints an extra blank line. Diagnose every bug, then provide a corrected version. The fix must preserve the function signature and not import any library. Explain each change in one sentence, and include the expected output for n = 4 as a code block. Do not suggest alternative approaches.\n\ndef triangle(n):\n    for i in range(1, n + 1):\n        print(' ' * (n - i) + '*' * (2 * i - 1))\n    print()",
  },
  {
    id: "reason-tradeoffs",
    family: "reasoning",
    title: "Weigh a trade-off and recommend with caveats",
    prompt:
      "A startup must choose between shipping a minimal feature now to win an early customer, or waiting six weeks to ship a more complete version that risks losing the deal. Recommend one option and justify it in under 200 words. The answer must state the single assumption that most drives your recommendation, name one situation where your recommendation would be wrong, and avoid generic business platitudes. Do not present a balanced 'it depends' conclusion — commit to one option.",
  },
  {
    id: "plan-with-constraints",
    family: "planning",
    title: "Plan a project under hard constraints",
    prompt:
      "Draft a one-week plan to migrate a 50-service monolith to containerized deployment without any customer-facing downtime. The plan must be structured as five ordered phases, each with a name, a one-line goal, and a list of concrete exit criteria. No phase may exceed two days. The plan must explicitly state which phase carries the highest rollback risk and why. Do not include introductory or concluding paragraphs — start directly with Phase 1.",
  },
  {
    id: "summarize-with-limits",
    family: "summarization",
    title: "Summarize a dense passage under strict limits",
    prompt:
      "Summarize the following passage into exactly five bullet points. Each bullet must be a single sentence of no more than 25 words. The summary must preserve the author's core argument, omit all examples and anecdotes, and use neutral tone regardless of the original's stance. Do not add any commentary, heading, or closing line outside the five bullets.\n\nPassage: Contemporary diets that eliminate entire food groups promise rapid weight loss but rarely address why people overeat. Restriction creates a psychological scarcity that, once the diet ends, drives rebound consumption. Sustained change instead comes from identifying the environmental and emotional triggers that precede eating — the commute home, the open snack cupboard, the stressful deadline — and redesigning those contexts so the healthier choice is the default. Willpower is a depleting resource; environment design is not.",
  },
  {
    id: "creative-with-form",
    family: "creative",
    title: "Write to a strict form and tone",
    prompt:
      "Write a 12-line poem, in rhyming couplets, about a lighthouse keeper who realizes the light has been dark for a week. The tone must be understated and eerie — no exclamation marks, no words longer than three syllables, and no direct mention of death. The final couplet must recontextualize something mentioned in the first two lines. Provide only the poem; do not add a title or explanation.",
  },
  {
    id: "logic-constraint-puzzle",
    family: "math/logic",
    title: "Solve a constrained logic problem step by step",
    prompt:
      "Five people (A, B, C, D, E) sit in a row. A refuses to sit next to B. C must sit to the left of D but not necessarily adjacent. E sits at one of the ends. List every valid seating arrangement from left to right, show the step-by-step elimination that produces the list, and state the total count. Do not use a truth table; reason by constraint propagation. Format each arrangement on its own line as A-B-C-D-E.",
  },
  {
    id: "data-into-structure",
    family: "data",
    title: "Restructure raw data with rules",
    prompt:
      "Convert the following raw log lines into a JSON array of objects, where each object has fields 'timestamp' (ISO 8601), 'level' (one of 'info'|'warn'|'error'), and 'message' (the text after the level, trimmed). Drop any line whose level is 'debug'. If a line cannot be parsed, omit it and report the omitted count in a separate line at the end starting with 'Unparsable: N'. Do not wrap the JSON in markdown fences, and do not add any prose.\n\n2026-03-01T09:12:04Z info service started\n2026-03-01T09:12:05Z debug cache warmed\n2026-03-01T09:12:40Z warn retrying upstream after timeout\n2026-03-01T09:13:02Z error connection refused by host\n2026-03-01T09:13:10Z -- malformed entry --",
  },
];

/**
 * Choose the next example index, starting from the first when nothing has been
 * loaded yet (`currentIndex < 0`). Always advances and wraps, guaranteeing no
 * immediate repeat: the returned index is never equal to `currentIndex`.
 */
export function nextExampleIndex(currentIndex: number): number {
  const n = EXAMPLE_TASKS.length;
  if (n === 0) return 0;
  if (currentIndex < 0 || currentIndex >= n) return 0;
  return (currentIndex + 1) % n;
}
