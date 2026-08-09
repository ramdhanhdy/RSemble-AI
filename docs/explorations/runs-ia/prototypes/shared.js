/* RSemble shared data - wrapped in IIFE to avoid global scope collisions with page scripts */
(function () {
/* RSemble AI — Shared Prototype Data + JS
   Synthetic dataset exposing the real IA problem: mixed grains, multiple sources,
   failed/completed/partial states, old/recent records, several model combinations.
   No real user data. */

// ===== Synthetic Run Dataset =====

const RUNS = [
  // Recent ad-hoc runs
  {
    id: "run-20260809-001",
    source: "adhoc",
    status: "completed",
    mode: "rank",
    taskTitle: "Explain transformer attention mechanism",
    taskPrompt: "Write a clear explanation of how multi-head self-attention works in transformers, including the mathematical formulation and intuitive explanation...",
    taskPromptFull: "Write a clear explanation of how multi-head self-attention works in transformers, including the mathematical formulation and intuitive explanation. Cover: (1) Query/Key/Value projections, (2) Scaled dot-product attention, (3) Multi-head mechanism, (4) Positional encoding interaction. Target audience: ML practitioners who know basic neural networks.",
    systemPrompt: "You are a technical writer specializing in ML.",
    temperature: 0.7,
    createdAt: "2026-08-09T08:15:00Z",
    completedAt: "2026-08-09T08:02:34Z",
    duration: "47s",
    candidates: [
      { id: "cand-slot-0", modelKey: "deepseek-chat", providerId: "deepseek", model: "DeepSeek V4 Flash", slug: "deepseek-v4-flash", status: "done", score: 8.5, rank: 1 },
      { id: "cand-slot-1", modelKey: "umans-glm-5.2", providerId: "umans", model: "GLM-5.2", slug: "glm-5.2", status: "done", score: 7.2, rank: 2 },
      { id: "cand-slot-2", modelKey: "umans-qwen3.6-35b", providerId: "umans", model: "Qwen 3.6 35B", slug: "qwen-3.6-35b", status: "done", score: 6.8, rank: 3 },
    ],
    judge: { providerId: "umans", model: "Qwen 3.6 35B", instruction: "Rank by clarity, accuracy, and completeness", consensus: { clarity: 0.85, accuracy: 0.90, completeness: 0.78 } },
    rankResult: "cand-slot-0",
    cost: { tokensIn: 1240, tokensOut: 3850, totalUsd: 0.014 },
  },
  {
    id: "run-20260809-002",
    source: "adhoc",
    status: "partial",
    mode: "fuse",
    taskTitle: "Design a REST API for a todo app",
    taskPrompt: "Design a RESTful API for a todo application with support for lists, items, tags, and due dates...",
    taskPromptFull: "Design a RESTful API for a todo application with support for lists, items, tags, and due dates. Include endpoint definitions, request/response schemas, error handling, pagination, and authentication strategy. Consider rate limiting and versioning.",
    systemPrompt: "",
    temperature: 0.3,
    createdAt: "2026-08-09T07:42:00Z",
    completedAt: "2026-08-09T07:39:12Z",
    duration: "2m 48s",
    candidates: [
      { id: "cand-slot-0", modelKey: "deepseek-chat", providerId: "deepseek", model: "DeepSeek V4 Flash", slug: "deepseek-v4-flash", status: "done", score: null, rank: null },
      { id: "cand-slot-1", modelKey: "umans-glm-5.2", providerId: "umans", model: "GLM-5.2", slug: "glm-5.2", status: "error", score: null, rank: null, error: "Provider timeout after 45s" },
      { id: "cand-slot-2", modelKey: "umans-kimi-k3", providerId: "umans", model: "Kimi K3", slug: "kimi-k3", status: "done", score: null, rank: null },
    ],
    judge: { providerId: "umans", model: "Qwen 3.6 35B", instruction: "Evaluate API design quality", consensus: null },
    fusionStatus: "no_accept",
    cost: { tokensIn: 980, tokensOut: 2100, totalUsd: 0.009 },
  },
  {
    id: "run-20260808-014",
    source: "adhoc",
    status: "failed",
    mode: "rank",
    taskTitle: "Compare sorting algorithm implementations",
    taskPrompt: "Compare bubble sort, quicksort, and merge sort in terms of time complexity, space complexity, and stability...",
    taskPromptFull: "Compare bubble sort, quicksort, and merge sort in terms of time complexity, space complexity, and stability. Include code examples in Python and discuss when to use each algorithm.",
    systemPrompt: "You are a computer science educator.",
    temperature: 0.5,
    createdAt: "2026-08-08T16:30:00Z",
    completedAt: "2026-08-08T16:28:45Z",
    duration: "1m 15s",
    candidates: [
      { id: "cand-slot-0", modelKey: "deepseek-chat", providerId: "deepseek", model: "DeepSeek V4 Flash", slug: "deepseek-v4-flash", status: "done", score: null, rank: null },
      { id: "cand-slot-1", modelKey: "umans-glm-5.2", providerId: "umans", model: "GLM-5.2", slug: "glm-5.2", status: "done", score: null, rank: null },
    ],
    judge: { providerId: "umans", model: "Qwen 3.6 35B", instruction: "Rank by accuracy and clarity", consensus: null, error: "Judge request failed: 429 Too Many Requests" },
    cost: { tokensIn: 850, tokensOut: 1900, totalUsd: 0.007 },
  },
  {
    id: "run-20260808-009",
    source: "adhoc",
    status: "completed",
    mode: "fuse",
    taskTitle: "Write a product launch announcement",
    taskPrompt: "Write a product launch announcement for a new open-source local-first LLM comparison tool called RSemble AI...",
    taskPromptFull: "Write a product launch announcement for a new open-source local-first LLM comparison tool called RSemble AI. Highlight: local-first privacy, multi-model comparison, blind judging, rank/fuse modes, evaluation suites. Target: developers and AI practitioners on Hacker News.",
    systemPrompt: "You are a technical marketing writer.",
    temperature: 0.8,
    createdAt: "2026-08-08T11:20:00Z",
    completedAt: "2026-08-08T11:18:02Z",
    duration: "1m 58s",
    candidates: [
      { id: "cand-slot-0", modelKey: "deepseek-chat", providerId: "deepseek", model: "DeepSeek V4 Flash", slug: "deepseek-v4-flash", status: "done", score: 8.8, rank: 1 },
      { id: "cand-slot-1", modelKey: "umans-glm-5.2", providerId: "umans", model: "GLM-5.2", slug: "glm-5.2", status: "done", score: 8.2, rank: 2 },
      { id: "cand-slot-2", modelKey: "umans-kimi-k3", providerId: "umans", model: "Kimi K3", slug: "kimi-k3", status: "done", score: 7.5, rank: 3 },
    ],
    judge: { providerId: "umans", model: "Qwen 3.6 35B", instruction: "Rank by persuasiveness and technical accuracy", consensus: { persuasiveness: 0.88, accuracy: 0.92 } },
    fusionResult: "Combined: DeepSeek's technical precision + GLM-5.2's narrative flow...",
    cost: { tokensIn: 1450, tokensOut: 4200, totalUsd: 0.016 },
  },
  // Older ad-hoc runs
  {
    id: "run-20260805-003",
    source: "adhoc",
    status: "completed",
    mode: "rank",
    taskTitle: "Implement binary search tree in TypeScript",
    taskPrompt: "Implement a generic binary search tree in TypeScript with insert, delete, search, and traversal methods...",
    taskPromptFull: "Implement a generic binary search tree in TypeScript with insert, delete, search, and traversal methods (in-order, pre-order, post-order). Include type safety, edge case handling, and JSDoc comments.",
    systemPrompt: "",
    temperature: 0.2,
    createdAt: "2026-08-05T09:15:00Z",
    completedAt: "2026-08-05T09:12:44Z",
    duration: "2m 16s",
    candidates: [
      { id: "cand-slot-0", modelKey: "umans-glm-5.2", providerId: "umans", model: "GLM-5.2", slug: "glm-5.2", status: "done", score: 9.1, rank: 1 },
      { id: "cand-slot-1", modelKey: "deepseek-chat", providerId: "deepseek", model: "DeepSeek V4 Flash", slug: "deepseek-v4-flash", status: "done", score: 8.4, rank: 2 },
    ],
    judge: { providerId: "umans", model: "Qwen 3.6 35B", instruction: "Rank by type safety, correctness, and completeness", consensus: { typeSafety: 0.91, correctness: 0.95, completeness: 0.88 } },
    rankResult: "cand-slot-0",
    cost: { tokensIn: 920, tokensOut: 2800, totalUsd: 0.011 },
  },
  {
    id: "run-20260801-007",
    source: "adhoc",
    status: "completed",
    mode: "rank",
    taskTitle: "Explain database normalization",
    taskPrompt: "Explain the first three normal forms of database design with examples...",
    taskPromptFull: "Explain the first three normal forms of database design with examples. Include: 1NF (atomic values), 2NF (no partial dependencies), 3NF (no transitive dependencies). Show a before/after example for each form.",
    systemPrompt: "You are a database instructor.",
    temperature: 0.6,
    createdAt: "2026-08-01T14:30:00Z",
    completedAt: "2026-08-01T14:27:18Z",
    duration: "2m 42s",
    candidates: [
      { id: "cand-slot-0", modelKey: "umans-qwen3.6-35b", providerId: "umans", model: "Qwen 3.6 35B", slug: "qwen-3.6-35b", status: "done", score: 7.9, rank: 1 },
      { id: "cand-slot-1", modelKey: "deepseek-chat", providerId: "deepseek", model: "DeepSeek V4 Flash", slug: "deepseek-v4-flash", status: "done", score: 7.1, rank: 2 },
      { id: "cand-slot-2", modelKey: "umans-kimi-k3", providerId: "umans", model: "Kimi K3", slug: "kimi-k3", status: "done", score: 6.5, rank: 3 },
    ],
    judge: { providerId: "deepseek", model: "DeepSeek V4 Flash", instruction: "Rank by pedagogical clarity and example quality", consensus: { clarity: 0.82, examples: 0.76 } },
    rankResult: "cand-slot-0",
    cost: { tokensIn: 1100, tokensOut: 3400, totalUsd: 0.013 },
  },
  // Experiment child runs
  {
    id: "run-20260807-exp1-t1",
    source: "experiment",
    experimentId: "exp-20260807-001",
    suiteId: "suite-coding-v2",
    suiteName: "Coding Tasks Benchmark v2",
    taskId: "task-01",
    taskName: "Binary Search Implementation",
    trial: 1,
    status: "completed",
    mode: "rank",
    taskTitle: "Binary Search Implementation",
    taskPrompt: "Implement binary search with proper edge case handling...",
    taskPromptFull: "Implement binary search with proper edge case handling. Must handle: empty array, single element, not found, duplicates (return first occurrence). Include comprehensive tests.",
    systemPrompt: "",
    temperature: 0.1,
    createdAt: "2026-08-07T10:05:00Z",
    completedAt: "2026-08-07T10:03:22Z",
    duration: "1m 38s",
    candidates: [
      { id: "cand-slot-0", modelKey: "umans-glm-5.2", providerId: "umans", model: "GLM-5.2", slug: "glm-5.2", status: "done", score: 9.2, rank: 1 },
      { id: "cand-slot-1", modelKey: "deepseek-chat", providerId: "deepseek", model: "DeepSeek V4 Flash", slug: "deepseek-v4-flash", status: "done", score: 8.7, rank: 2 },
      { id: "cand-slot-2", modelKey: "umans-kimi-k3", providerId: "umans", model: "Kimi K3", slug: "kimi-k3", status: "done", score: 7.8, rank: 3 },
      { id: "cand-slot-3", modelKey: "umans-coder", providerId: "umans", model: "Umans Coder", slug: "umans-coder", status: "done", score: 8.9, rank: 2 },
      { id: "cand-slot-4", modelKey: "umans-qwen3.6-35b", providerId: "umans", model: "Qwen 3.6 35B", slug: "qwen-3.6-35b", status: "done", score: 7.0, rank: 4 },
    ],
    judge: { providerId: "umans", model: "Qwen 3.6 35B", instruction: "Rank by correctness, edge case coverage, and code quality", consensus: { correctness: 0.95, edgeCases: 0.88, codeQuality: 0.90 } },
    rankResult: "cand-slot-0",
    cost: { tokensIn: 1600, tokensOut: 4800, totalUsd: 0.019 },
  },
  {
    id: "run-20260807-exp1-t2",
    source: "experiment",
    experimentId: "exp-20260807-001",
    suiteId: "suite-coding-v2",
    suiteName: "Coding Tasks Benchmark v2",
    taskId: "task-02",
    taskName: "Linked List Reversal",
    trial: 1,
    status: "completed",
    mode: "rank",
    taskTitle: "Linked List Reversal",
    taskPrompt: "Reverse a singly linked list both iteratively and recursively...",
    taskPromptFull: "Reverse a singly linked list both iteratively and recursively. Include time/space analysis and handle: empty list, single node, and cycles (detect before reversing).",
    systemPrompt: "",
    temperature: 0.1,
    createdAt: "2026-08-07T10:12:00Z",
    completedAt: "2026-08-07T10:10:08Z",
    duration: "1m 52s",
    candidates: [
      { id: "cand-slot-0", modelKey: "umans-glm-5.2", providerId: "umans", model: "GLM-5.2", slug: "glm-5.2", status: "done", score: 8.8, rank: 1 },
      { id: "cand-slot-1", modelKey: "umans-coder", providerId: "umans", model: "Umans Coder", slug: "umans-coder", status: "done", score: 8.5, rank: 2 },
      { id: "cand-slot-2", modelKey: "deepseek-chat", providerId: "deepseek", model: "DeepSeek V4 Flash", slug: "deepseek-v4-flash", status: "done", score: 8.0, rank: 3 },
      { id: "cand-slot-3", modelKey: "umans-kimi-k3", providerId: "umans", model: "Kimi K3", slug: "kimi-k3", status: "done", score: 7.2, rank: 4 },
      { id: "cand-slot-4", modelKey: "umans-qwen3.6-35b", providerId: "umans", model: "Qwen 3.6 35B", slug: "qwen-3.6-35b", status: "done", score: 6.8, rank: 5 },
    ],
    judge: { providerId: "umans", model: "Qwen 3.6 35B", instruction: "Rank by correctness, clarity, and cycle detection", consensus: { correctness: 0.92, clarity: 0.85, cycleDetection: 0.78 } },
    rankResult: "cand-slot-0",
    cost: { tokensIn: 1400, tokensOut: 4200, totalUsd: 0.017 },
  },
  {
    id: "run-20260807-exp1-t3",
    source: "experiment",
    experimentId: "exp-20260807-001",
    suiteId: "suite-coding-v2",
    suiteName: "Coding Tasks Benchmark v2",
    taskId: "task-03",
    taskName: "Merge K Sorted Lists",
    trial: 1,
    status: "interrupted",
    mode: "rank",
    taskTitle: "Merge K Sorted Lists",
    taskPrompt: "Merge K sorted linked lists into one sorted list...",
    taskPromptFull: "Merge K sorted linked lists into one sorted list. Analyze time complexity for different approaches: brute force, heap-based, divide-and-conquer.",
    systemPrompt: "",
    temperature: 0.1,
    createdAt: "2026-08-07T10:18:00Z",
    completedAt: null,
    duration: null,
    candidates: [
      { id: "cand-slot-0", modelKey: "umans-glm-5.2", providerId: "umans", model: "GLM-5.2", slug: "glm-5.2", status: "done", score: null, rank: null },
      { id: "cand-slot-1", modelKey: "deepseek-chat", providerId: "deepseek", model: "DeepSeek V4 Flash", slug: "deepseek-v4-flash", status: "done", score: null, rank: null },
      { id: "cand-slot-2", modelKey: "umans-coder", providerId: "umans", model: "Umans Coder", slug: "umans-coder", status: "done", score: null, rank: null },
      { id: "cand-slot-3", modelKey: "umans-kimi-k3", providerId: "umans", model: "Kimi K3", slug: "kimi-k3", status: "pending", score: null, rank: null },
      { id: "cand-slot-4", modelKey: "umans-qwen3.6-35b", providerId: "umans", model: "Qwen 3.6 35B", slug: "qwen-3.6-35b", status: "pending", score: null, rank: null },
    ],
    judge: { providerId: "umans", model: "Qwen 3.6 35B", instruction: "Rank by correctness and complexity analysis", consensus: null },
    cost: { tokensIn: 800, tokensOut: 1800, totalUsd: 0.007 },
  },
  {
    id: "run-20260807-exp1-t3-r2",
    source: "experiment",
    experimentId: "exp-20260807-001",
    suiteId: "suite-coding-v2",
    suiteName: "Coding Tasks Benchmark v2",
    taskId: "task-03",
    taskName: "Merge K Sorted Lists",
    trial: 2,
    status: "completed",
    mode: "rank",
    taskTitle: "Merge K Sorted Lists (retry)",
    taskPrompt: "Merge K sorted linked lists into one sorted list...",
    taskPromptFull: "Merge K sorted linked lists into one sorted list. Analyze time complexity for different approaches: brute force, heap-based, divide-and-conquer.",
    systemPrompt: "",
    temperature: 0.1,
    createdAt: "2026-08-07T10:25:00Z",
    completedAt: "2026-08-07T10:23:15Z",
    duration: "1m 45s",
    candidates: [
      { id: "cand-slot-0", modelKey: "umans-glm-5.2", providerId: "umans", model: "GLM-5.2", slug: "glm-5.2", status: "done", score: 9.0, rank: 1 },
      { id: "cand-slot-1", modelKey: "umans-coder", providerId: "umans", model: "Umans Coder", slug: "umans-coder", status: "done", score: 8.8, rank: 2 },
      { id: "cand-slot-2", modelKey: "deepseek-chat", providerId: "deepseek", model: "DeepSeek V4 Flash", slug: "deepseek-v4-flash", status: "done", score: 8.2, rank: 3 },
      { id: "cand-slot-3", modelKey: "umans-kimi-k3", providerId: "umans", model: "Kimi K3", slug: "kimi-k3", status: "done", score: 7.5, rank: 4 },
      { id: "cand-slot-4", modelKey: "umans-qwen3.6-35b", providerId: "umans", model: "Qwen 3.6 35B", slug: "qwen-3.6-35b", status: "done", score: 6.9, rank: 5 },
    ],
    judge: { providerId: "umans", model: "Qwen 3.6 35B", instruction: "Rank by correctness and complexity analysis", consensus: { correctness: 0.93, complexity: 0.88 } },
    rankResult: "cand-slot-0",
    reusedFrom: { sourceRunId: "run-20260807-exp1-t3", sourceCandidateId: "cand-slot-0", sourceAttemptId: "att-001" },
    cost: { tokensIn: 1500, tokensOut: 4500, totalUsd: 0.018 },
  },
  // Legacy run
  {
    id: "run-20260715-legacy-001",
    source: "legacy",
    status: "completed",
    mode: "rank",
    taskTitle: "SQL JOIN types explanation",
    taskPrompt: "Explain different types of SQL JOINs with examples...",
    taskPromptFull: null,
    systemPrompt: null,
    temperature: 0.5,
    createdAt: "2026-07-15T12:00:00Z",
    completedAt: "2026-07-15T11:58:00Z",
    duration: "2m 00s",
    candidates: [],
    judge: null,
    cost: null,
  },
];

// ===== Dataset normalization =====
// Timestamp hygiene (CC-2): completedAt must follow createdAt. Where the dataset
// has completedAt earlier than createdAt, recompute completedAt = createdAt + duration.
function durationToMs(d) {
  if (!d) return 0;
  const h = /(\d+)h/.exec(d);
  const m = /(\d+)m/.exec(d);
  const s = /(\d+)s/.exec(d);
  return ((h ? parseInt(h[1], 10) : 0) * 3600 + (m ? parseInt(m[1], 10) : 0) * 60 + (s ? parseInt(s[1], 10) : 0)) * 1000;
}
RUNS.forEach(r => {
  if (r.completedAt && r.createdAt && r.duration) {
    const created = new Date(r.createdAt).getTime();
    if (new Date(r.completedAt).getTime() <= created) {
      r.completedAt = new Date(created + durationToMs(r.duration)).toISOString();
    }
  }
});

// ===== Experiments =====

const EXPERIMENTS = [
  {
    id: "exp-20260807-001",
    suiteId: "suite-coding-v2",
    suiteName: "Coding Tasks Benchmark v2",
    status: "completed_with_failures",
    createdAt: "2026-08-07T10:00:00Z",
    tasks: [
      { taskId: "task-01", name: "Binary Search Implementation", runId: "run-20260807-exp1-t1", status: "completed", bestModel: "GLM-5.2", score: 9.2 },
      { taskId: "task-02", name: "Linked List Reversal", runId: "run-20260807-exp1-t2", status: "completed", bestModel: "GLM-5.2", score: 8.8 },
      { taskId: "task-03", name: "Merge K Sorted Lists", runId: "run-20260807-exp1-t3-r2", status: "completed", bestModel: "GLM-5.2", score: 9.0, retryOf: "run-20260807-exp1-t3" },
    ],
    models: ["GLM-5.2", "DeepSeek V4 Flash", "Umans Coder", "Kimi K3", "Qwen 3.6 35B"],
  },
];

// ===== Helper functions =====

function getStatusLabel(status) {
  const labels = { completed: "Completed", failed: "Failed", partial: "Partial", running: "Running", interrupted: "Interrupted", aborted: "Aborted" };
  return labels[status] || status;
}

function getSourceLabel(source) {
  const labels = { adhoc: "Ad hoc", experiment: "Experiment", legacy: "Legacy" };
  return labels[source] || source;
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function timeAgo(iso) {
  if (!iso) return "—";
  const now = new Date("2026-08-09T09:00:00Z");
  const then = new Date(iso);
  const diffH = Math.floor((now - then) / 3600000);
  if (diffH < 1) return "just now";
  if (diffH < 24) return diffH + "h ago";
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return "yesterday";
  if (diffD < 7) return diffD + "d ago";
  return Math.floor(diffD / 7) + "w ago";
}

function getRunById(id) { return RUNS.find(r => r.id === id); }

// A run is superseded when a later run reused its candidate output (retry child).
function isSuperseded(run) { return RUNS.some(x => x.reusedFrom && x.reusedFrom.sourceRunId === run.id); }

function groupRunsBySource(runs) {
  const groups = { adhoc: [], experiment: [], legacy: [] };
  runs.forEach(r => { if (groups[r.source]) groups[r.source].push(r); });
  return groups;
}

function groupRunsByStatus(runs) {
  const groups = {};
  runs.forEach(r => { if (!groups[r.status]) groups[r.status] = []; groups[r.status].push(r); });
  return groups;
}

// Expose globally
if (typeof window !== "undefined") {
  window.RSEMBLE_DATA = { RUNS, EXPERIMENTS, getStatusLabel, getSourceLabel, formatDate, timeAgo, getRunById, isSuperseded, groupRunsBySource, groupRunsByStatus };
}

})();
