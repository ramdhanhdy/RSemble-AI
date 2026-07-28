// =============================================================================
// Export helpers — extracted from rsemble.tsx for clarity and testability.
// =============================================================================

import { candidateFullText } from "./pipeline";
import type { StudioState } from "../studio-engine";

/** Build a Markdown export of the current run state. */
export function buildExportMarkdown(s: StudioState): string | null {
  const done = s.candidates.filter((c) => c.status === "done");
  if (done.length === 0 && !s.fusedText) return null;

  const lines: string[] = [`# RSemble AI — Export`, ``, `## Task`, ``, s.prompt, ``];

  // Record how the result was judged when a custom judge instruction was
  // applied — enough context to understand the ranking/fusion afterwards.
  if (s.judgeInstruction.trim().length > 0) {
    lines.push(`## Judge Instruction`, ``, s.judgeInstruction.trim(), ``);
  }

  if (s.mode === "fuse" && s.fusedText) {
    lines.push(`## Fused Answer`, ``, s.fusedText, ``);
  } else {
    const ranked = [...done].sort((a, b) => b.weightedScore - a.weightedScore);
    lines.push(`## Ranked Candidates`, ``);
    ranked.forEach((c, i) => {
      lines.push(
        `### ${i + 1}. ${c.model} — ${c.weightedScore.toFixed(1)}/5`,
        ``,
        candidateFullText(c),
        ``,
      );
    });
  }

  if (s.consensus) {
    lines.push(`## Judge Consensus`, ``);
    if (s.consensus.consensus.length > 0) {
      lines.push(`**Agreement:**`, ...s.consensus.consensus.map((t) => `- ${t}`), ``);
    }
    if (s.consensus.contradictions.length > 0) {
      lines.push(`**Contradictions:**`, ...s.consensus.contradictions.map((t) => `- ${t}`), ``);
    }
  }

  return lines.join("\n");
}

/** Trigger a browser download of the given markdown text. */
export function downloadMarkdown(text: string, filenamePrefix = "rsemble-export"): void {
  const blob = new Blob([text], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
