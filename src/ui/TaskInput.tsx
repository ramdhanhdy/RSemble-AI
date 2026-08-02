// =============================================================================
// TaskInput — the task prompt textarea. Bound to state.prompt.
// Per UI.md §3.1. Multi-line, fixed 4 rows, autosize deferred.
//
// Includes a one-click "Try an example" control that loads a curated,
// comparison-ready test case from lib/test-cases.ts without spending a provider
// call. Behaviour:
//   - Empty task           → single click fills the first example.
//   - Unedited example      → single click rotates to the next example (no
//     immediate repeat), so the user can browse the catalog with repeated clicks.
//   - User-typed text       → first click arms a "Replace" confirmation (mirrors
//     the ResetButton affordance); a second click within the timeout window
//     replaces the text. This never silently destroys meaningful input.
//
// A11y: explicit <label htmlFor> + id linkage; eyebrow uses text-xs (reserved
// strictly for uppercase metadata labels, DESIGN.md). The example control is a
// real <button> with an aria-label so keyboard/AT users can reach and activate
// it. Its armed state is announced via aria-label and title.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import { Paperclip, Sparkles } from "lucide-react";
import type { Action } from "../studio-engine";
import { estimateAttachmentTokens, estimateTokens } from "../lib/cost";
import { EXAMPLE_TASKS } from "../lib/test-cases";
import type { Attachment } from "../lib/attachments/types";

/** Accepted picker types for the hidden input (spec §3). HEIC is offered; a
 *  browser that cannot decode it rejects at extraction with a named reason. */
const ATTACH_ACCEPT = [
  "image/png", "image/jpeg", "image/webp", "image/gif", "image/heic",
  "application/pdf",
  ".md", ".mdx", ".txt", ".csv", ".json",
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".sql", ".yml", ".yaml", ".toml",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
].join(",");

export function TaskInput({
  prompt,
  exampleIndex,
  dispatch,
  attachments,
  onAddFiles,
}: {
  prompt: string;
  exampleIndex: number;
  dispatch: React.Dispatch<Action>;
  attachments: Attachment[];
  onAddFiles: (files: File[]) => void;
}) {
  const hasText = prompt.trim().length > 0;
  // True when the prompt is still exactly the last-loaded curated example — the
  // user has not edited it, so repeated clicks should rotate, not arm.
  const isUneditedExample =
    exampleIndex >= 0 && EXAMPLE_TASKS[exampleIndex]?.prompt === prompt;
  const [armed, setArmed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drag & drop onto the whole task field. Depth counter so child elements do
  // not flicker the overlay (spec §8.1); Escape cancels the drop (spec §8.2).
  const [dragDepth, setDragDepth] = useState(0);
  const dragging = dragDepth > 0;

  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDragDepth(0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dragging]);

  // Disarm whenever the prompt leaves the "user text that needs confirmation"
  // state — i.e. it became empty, or it became an unedited example again.
  useEffect(() => {
    if (!hasText || isUneditedExample) setArmed(false);
  }, [hasText, isUneditedExample]);

  // Auto-dismiss the armed confirmation after a short window, like ResetButton.
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(id);
  }, [armed]);

  const onClick = () => {
    // Empty task or unedited example: load/rotate immediately, no confirmation.
    if (!hasText || isUneditedExample) {
      setArmed(false);
      dispatch({ type: "LOAD_EXAMPLE" });
      return;
    }
    // User-typed text: require a second click to confirm replacement.
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    dispatch({ type: "LOAD_EXAMPLE", force: true });
  };

  // Static (SSR + initial) affordance text. When the task already holds
  // user-typed text, surface "replace" up front so the user knows clicking arms
  // a confirmation rather than silently overwriting.
  const label = armed ? "Replace current task with an example" : "Try an example";
  const title = armed
    ? "Click again to replace your task with a curated example"
    : hasText && !isUneditedExample
      ? "Replace your task with a curated example (click to confirm)"
      : "Try an example — fill the task with a ready-made comparison case";

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor="prompt"
          className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted"
        >
          Task
        </label>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach files to this task"
            title="Attach files — images, PDF, Markdown, .docx"
            className="pressable flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-text-secondary transition-colors hover:border-edge-bright hover:text-text"
          >
            <Paperclip size={12} aria-hidden="true" />
            Attach
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ATTACH_ACCEPT}
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) onAddFiles(files);
              // Reset so re-selecting the same file fires change again.
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={title}
            className={`pressable flex min-h-[44px] items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
              armed
                ? "border-warning/60 bg-warning/10 text-warning"
                : "border-edge text-text-secondary hover:border-edge-bright hover:text-text"
            }`}
          >
            <Sparkles size={12} aria-hidden="true" />
            {armed ? "Replace" : "Try an example"}
          </button>
        </div>
      </div>
      <div
        className="relative mt-2"
        onDragEnter={(e) => {
          e.preventDefault();
          setDragDepth((d) => d + 1);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setDragDepth((d) => Math.max(0, d - 1))}
        onDrop={(e) => {
          e.preventDefault();
          setDragDepth(0);
          const files = Array.from(e.dataTransfer?.files ?? []);
          if (files.length > 0) onAddFiles(files);
        }}
      >
        <textarea
          id="prompt"
          aria-label="Task"
          rows={4}
          value={prompt}
          onChange={(e) => dispatch({ type: "SET_PROMPT", value: e.target.value })}
          onPaste={(e) => {
            // Screenshot → Ctrl+V is the single most common attach path (spec
            // §8.1): a paste carrying files attaches instead of inserting text.
            const pasted = Array.from(e.clipboardData?.files ?? []);
            if (pasted.length > 0) {
              e.preventDefault();
              onAddFiles(pasted);
            }
          }}
          placeholder="Describe the task — e.g. write a 600-word article on…"
          className="w-full resize-y rounded-md border border-edge bg-card px-3 py-3 pb-7 text-sm text-text placeholder-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <Counter value={prompt} attachments={attachments} />
        {dragging && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-accent bg-accent/[0.06] font-mono text-sm text-accent"
          >
            Drop files — images, PDF, Markdown, .docx
          </div>
        )}
      </div>
    </div>
  );
}

function Counter({ value, attachments }: { value: string; attachments: Attachment[] }) {
  const tokens = estimateTokens(value);
  const fromFiles = attachments.length > 0 ? estimateAttachmentTokens(attachments) : 0;
  return (
    <span className="pointer-events-none absolute bottom-2.5 right-3 font-mono text-xs tabular-nums text-text-muted">
      ~{tokens} tokens{fromFiles > 0 ? ` · +${fromFiles} from files` : ""}
    </span>
  );
}
