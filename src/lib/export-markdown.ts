// =============================================================================
// Export helpers — extracted from rsemble.tsx for clarity and testability.
// =============================================================================

import { candidateFullText } from "./pipeline";
import type { StudioState } from "../studio-engine";
import { formatBytes } from "./attachments/limits";
import { resolveReasoningEffort } from "./providers/reasoning";

/**
 * Sanitize judge-provided or model-provided free text for safe Markdown export.
 * Prevents a rationale or comparison from injecting headings by escaping leading
 * Markdown control characters. (The export is auditable but not executable.)
 */
function mdSafe(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^(#{1,6})\s/, "\\$1 "))
    .join("\n");
}

/** Build a Markdown export of the current run state. */
export function buildExportMarkdown(s: StudioState): string | null {
  const done = s.candidates.filter((c) => c.status === "done");
  if (done.length === 0 && !s.fusedText) return null;

  const frozenTask = s.runContext?.task;
  const exportPrompt = frozenTask?.prompt ?? s.runContext?.prompt ?? s.prompt;
  const exportAttachments = s.runContext?.attachments ?? s.attachments;
  const exportMode = s.runContext?.mode ?? s.mode;
  const exportJudgeInstruction = s.runContext?.judgeInstruction ?? s.judgeInstruction;
  const lines: string[] = [`# RSemble AI — Export`, ``, `## Task`, ``, exportPrompt, ``];

  // Use the frozen run policy, not the mutable command pane. Effective levels
  // are resolved against the frozen candidate/Judge identities so an export
  // remains coherent with the persisted provenance shown in Run Detail.
  const frozenPolicy = s.runContext?.reasoningPolicy ?? s.reasoningPolicy;
  const frozenSlots = s.runContext?.slots ?? s.slots;
  const frozenCritic = s.runContext?.critic ?? s.critic;
  lines.push(`## Reasoning Policy`, ``);
  lines.push(`- Candidates: requested \`${frozenPolicy.candidates}\``);
  for (const slot of frozenSlots.filter((slot) => slot.enabled)) {
    const effective = resolveReasoningEffort(slot.providerId, slot.slug, frozenPolicy.candidates);
    lines.push(`  - ${mdSafe(slot.model)}: effective \`${effective.ok ? effective.effective : "provider-default"}\` (${effective.ok ? effective.capabilities.source : "unknown"})`);
  }
  const judgeEffective = resolveReasoningEffort(frozenCritic.providerId, frozenCritic.model, frozenPolicy.judge);
  lines.push(`- Judge: requested \`${frozenPolicy.judge}\`, effective \`${judgeEffective.ok ? judgeEffective.effective : "provider-default"}\` (${judgeEffective.ok ? judgeEffective.capabilities.source : "unknown"})`, ``);

  // Attachment metadata (spec §9, plan 7.7.3) — names/kinds/sizes only, the
  // record never contains the bytes or extracted text.
  if (exportAttachments.length > 0) {
    lines.push(`## Attachments`, ``);
    for (const a of exportAttachments) {
      lines.push(`- ${a.name} — ${a.kind}, ${formatBytes(a.bytes)}${a.truncated ? " (truncated)" : ""}`);
    }
    lines.push(``);
  }

  // Record how the result was judged when a custom judge instruction was
  // applied — enough context to understand the ranking/fusion afterwards.
  if (exportJudgeInstruction.trim().length > 0) {
    lines.push(`## Judge Instruction`, ``, exportJudgeInstruction.trim(), ``);
  }

  // Blind judge audit trail — the resolved post-judgment mapping and every
  // score explanation. Present only when a judge report exists (spec §11).
  const report = s.judgeReport;
  if (report) {
    const modelFor = (id: string): string => {
      const c = s.candidates.find((x) => x.id === id);
      return c ? c.model : id;
    };
    const providerFor = (id: string): string | null => {
      const c = s.candidates.find((x) => x.id === id);
      return c ? c.provider : null;
    };

    lines.push(`## Blind Evaluation Key`, ``);
    for (const m of report.labelMap) {
      const model = modelFor(m.candidateId);
      const provider = providerFor(m.candidateId);
      lines.push(`- Candidate ${m.label}: ${mdSafe(model)}${provider ? ` (${mdSafe(provider)})` : ""}`);
    }
    lines.push(``);

    // Ranked order: highest overall score first, blind labels preserved.
    const ranked = [...s.candidates]
      .filter((c) => c.status === "done")
      .sort((a, b) => b.weightedScore - a.weightedScore);
    lines.push(`## Score Explanations`, ``);
    for (const c of ranked) {
      const ev = report.evaluationsById[c.id];
      if (!ev) continue;
      lines.push(`### ${mdSafe(c.model)} (Candidate ${ev.blindLabel}) — ${ev.overallScore.toFixed(1)}/5`, ``);
      lines.push(`Position: ${mdSafe(ev.position)}`, ``);
      lines.push(`Why this score: ${mdSafe(ev.rationale)}`, ``);
      if (ev.strengths.length > 0) {
        lines.push(`Strengths:`, ...ev.strengths.map((t) => `- ${mdSafe(t)}`), ``);
      }
      if (ev.deductions.length > 0) {
        lines.push(
          `Deductions:`,
          ...ev.deductions.map((d) => `- ${d.severity === "major" ? "Major" : "Minor"}: ${mdSafe(d.reason)}`),
          ``,
        );
      }
      if (ev.missedRequirements.length > 0) {
        lines.push(`Missed requirements:`, ...ev.missedRequirements.map((t) => `- ${mdSafe(t)}`), ``);
      }
      if (ev.criterionScores.length > 0) {
        lines.push(
          `Criterion scores:`,
          ...ev.criterionScores.map((cs) => `- ${mdSafe(cs.label)}: ${cs.score.toFixed(1)}/5 — ${mdSafe(cs.rationale)}`),
          ``,
        );
      }
    }

    if (report.comparisons.length > 0) {
      lines.push(`## Same-Conclusion Comparisons`, ``);
      for (const cmp of report.comparisons) {
        const a = modelFor(cmp.candidateIds[0]);
        const b = modelFor(cmp.candidateIds[1]);
        lines.push(`- Candidate ${cmp.blindLabels[0]} (${mdSafe(a)}) vs Candidate ${cmp.blindLabels[1]} (${mdSafe(b)}): ${mdSafe(cmp.reason)}`);
      }
      lines.push(``);
    }
  }

  if (exportMode === "fuse" && s.fusedText) {
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
