// =============================================================================
// Markdown — a tiny line-based Markdown renderer (no external dependency).
//
// UI.md §5.2 calls for the fused answer rendered as Markdown, prose-invert.
// Rather than pull react-markdown mid-phase, this handles the common shapes LLMs
// actually emit: headings, bold/italic/inline-code, unordered & ordered lists,
// blockquotes, fenced code blocks, and paragraphs. If it proves insufficient,
// swapping to react-markdown is a drop-in and stays in scope as polish.
//
// `blockDecorator` (optional) wraps each rendered block — used by FuseResult to
// attach a provenance gutter tick beside every paragraph. When omitted, blocks
// render bare (the CandidateAnswer path).
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
    if (m.index > last)
      nodes.push(<span key={`${keyBase}-t${i}`}>{text.slice(last, m.index)}</span>);
    const tok = m[0];
    if (tok.startsWith("**")) {
      nodes.push(
        <strong key={`${keyBase}-b${i}`} className="font-semibold text-text">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("`")) {
      nodes.push(
        <code
          key={`${keyBase}-c${i}`}
          className="rounded bg-card-hover px-1 py-1 font-mono text-xs text-accent"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(
        <em key={`${keyBase}-i${i}`} className="italic">
          {tok.slice(1, -1)}
        </em>,
      );
    }
    last = m.index + tok.length;
    i += 1;
  }
  if (last < text.length) nodes.push(<span key={`${keyBase}-t${i}`}>{text.slice(last)}</span>);
  return nodes;
}

export function Markdown({
  text,
  blockDecorator,
}: {
  text: string;
  blockDecorator?: (block: JSX.Element, plainText: string, index: number) => JSX.Element;
}) {
  const lines = text.split("\n");
  const blocks: { el: JSX.Element; text: string }[] = [];
  let i = 0;
  let key = 0;

  const push = (el: JSX.Element, plain: string) => blocks.push({ el, text: plain });

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
      push(
        <pre
          key={key++}
          className="my-3 overflow-x-auto rounded-lg border border-edge bg-canvas p-3 font-mono text-sm leading-relaxed text-text"
        >
          {buf.join("\n")}
        </pre>,
        buf.join("\n"),
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
          ? "mt-4 mb-2 text-base font-semibold text-text"
          : level === 2
            ? "mt-4 mb-2 text-sm font-semibold text-text"
            : "mt-3 mb-1 text-sm font-semibold text-text";
      push(
        <p key={key++} className={cls}>
          {inline(h[2], `h${key}`)}
        </p>,
        h[2],
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
      push(
        <blockquote
          key={key++}
          className="my-2 border-l-2 border-accent/40 pl-3 text-sm italic text-text-secondary"
        >
          {inline(buf.join(" "), `q${key}`)}
        </blockquote>,
        buf.join(" "),
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
      push(
        <ul key={key++} className="my-2 list-disc space-y-1 pl-5 text-sm text-text">
          {items.map((it, idx) => (
            <li key={idx}>{inline(it, `ul${key}-${idx}`)}</li>
          ))}
        </ul>,
        items.join(" "),
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
      push(
        <ol key={key++} className="my-2 list-decimal space-y-1 pl-5 text-sm text-text">
          {items.map((it, idx) => (
            <li key={idx}>{inline(it, `ol${key}-${idx}`)}</li>
          ))}
        </ol>,
        items.join(" "),
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
    push(
      <p key={key++} className="my-2 text-sm leading-relaxed text-text">
        {inline(buf.join(" "), `p${key}`)}
      </p>,
      buf.join(" "),
    );
  }

  return (
    <div className="max-w-none">
      {blocks.map(({ el, text: t }, idx) => (blockDecorator ? blockDecorator(el, t, idx) : el))}
    </div>
  );
}
