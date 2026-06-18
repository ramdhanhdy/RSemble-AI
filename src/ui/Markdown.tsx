// =============================================================================
// Markdown — a tiny line-based Markdown renderer (no external dependency).
//
// UI.md §5.2 calls for the fused answer rendered as Markdown, prose-invert.
// Rather than pull react-markdown mid-phase, this handles the common shapes LLMs
// actually emit: headings, bold/italic/inline-code, unordered & ordered lists,
// blockquotes, fenced code blocks, and paragraphs. If it proves insufficient,
// swapping to react-markdown is a drop-in and stays in scope as polish.
// =============================================================================

import { type JSX } from "react";

function inline(text: string, keyBase: string): JSX.Element[] {
  // Render **bold**, *italic*, `code`. Order matters: bold before italic.
  const nodes: JSX.Element[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(<span key={`${keyBase}-t${i}`}>{text.slice(last, m.index)}</span>);
    const tok = m[0];
    if (tok.startsWith("**")) {
      nodes.push(
        <strong key={`${keyBase}-b${i}`} className="font-semibold text-zinc-100">
          {tok.slice(2, -2)}
        </strong>
      );
    } else if (tok.startsWith("`")) {
      nodes.push(
        <code key={`${keyBase}-c${i}`} className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[0.85em] text-cyan-300">
          {tok.slice(1, -1)}
        </code>
      );
    } else {
      nodes.push(
        <em key={`${keyBase}-i${i}`} className="italic">
          {tok.slice(1, -1)}
        </em>
      );
    }
    last = m.index + tok.length;
    i += 1;
  }
  if (last < text.length) nodes.push(<span key={`${keyBase}-t${i}`}>{text.slice(last)}</span>);
  return nodes;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: JSX.Element[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trimStart().startsWith("```")) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1; // skip closing fence
      blocks.push(
        <pre
          key={key++}
          className="my-3 overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-[13px] leading-relaxed text-zinc-300"
        >
          {buf.join("\n")}
        </pre>
      );
      continue;
    }

    // Blank line — paragraph separator
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Heading
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const cls =
        level === 1
          ? "mt-4 mb-2 text-lg font-semibold text-zinc-100"
          : level === 2
            ? "mt-4 mb-2 text-base font-semibold text-zinc-100"
            : "mt-3 mb-1 text-sm font-semibold text-zinc-200";
      blocks.push(
        <p key={key++} className={cls}>
          {inline(h[2], `h${key}`)}
        </p>
      );
      i += 1;
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">")) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={key++}
          className="my-2 border-l-2 border-cyan-500/40 pl-3 text-[13px] italic text-zinc-400"
        >
          {inline(buf.join(" "), `q${key}`)}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ul key={key++} className="my-2 list-disc space-y-1 pl-5 text-[13px] text-zinc-300">
          {items.map((it, idx) => (
            <li key={idx}>{inline(it, `ul${key}-${idx}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ol key={key++} className="my-2 list-decimal space-y-1 pl-5 text-[13px] text-zinc-300">
          {items.map((it, idx) => (
            <li key={idx}>{inline(it, `ol${key}-${idx}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Paragraph (gather consecutive non-empty, non-special lines)
    const buf: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trimStart().startsWith("```") &&
      !lines[i].trimStart().startsWith(">") &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={key++} className="my-2 text-[13px] leading-relaxed text-zinc-300">
        {inline(buf.join(" "), `p${key}`)}
      </p>
    );
  }

  return <div className="max-w-none">{blocks}</div>;
}
