import type {
  EvaluationTask,
  TaskEvaluationSelection,
  EvaluationSelection,
  EvaluationProfileRef,
  ProfileRecord,
} from "../../lib/evaluations/evaluation-types";

interface SuiteTaskEditorProps {
  task: EvaluationTask;
  /** Default evaluation from the suite, used to describe the "inherit" option. */
  suiteDefaultEvaluation: EvaluationSelection;
  onChange: (patch: Partial<EvaluationTask>) => void;
  /** Available profile records for the pinned-profile picker. */
  profileRecords: ProfileRecord[];
  /** Resolve a pinned profile ref to a display label. */
  resolveProfileLabel: (ref: EvaluationProfileRef) => string;
}

export function SuiteTaskEditor({
  task,
  suiteDefaultEvaluation,
  onChange,
  profileRecords,
  resolveProfileLabel,
}: SuiteTaskEditorProps) {
  const inheritDescription =
    suiteDefaultEvaluation.kind === "holistic"
      ? "Inherits the suite default: holistic judgment"
      : `Inherits the suite default: pinned profile ${resolveProfileLabel(suiteDefaultEvaluation.profile)}`;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto scroll-thin p-1">
      {/* Title */}
      <div>
        <label
          htmlFor="task-title"
          className="block font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted"
        >
          Task title
        </label>
        <input
          id="task-title"
          type="text"
          value={task.title}
          onChange={(e) => onChange({ title: e.target.value })}
          aria-invalid={!task.title.trim()}
          placeholder="e.g. Pricing diagnosis"
          className="mt-1 min-h-[44px] w-full rounded-sm border border-edge bg-input px-2 py-1.5 text-sm text-text placeholder-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {!task.title.trim() && (
          <p className="mt-1 text-xs text-error">Task title is required.</p>
        )}
      </div>

      {/* Candidate-visible prompt */}
      <div>
        <label
          htmlFor="task-prompt"
          className="block font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted"
        >
          Prompt <span className="normal-case tracking-normal">· candidate-visible</span>
        </label>
        <textarea
          id="task-prompt"
          value={task.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
          aria-invalid={!task.prompt.trim()}
          rows={6}
          placeholder="The task every candidate model receives. This is the only instruction candidates see."
          className="mt-1 min-h-[44px] w-full resize-y rounded-sm border border-edge bg-input px-2 py-1.5 text-sm text-text placeholder-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {!task.prompt.trim() && (
          <p className="mt-1 text-xs text-error">Task prompt is required.</p>
        )}
      </div>

      {/* Candidate-visible system prompt */}
      <div>
        <label
          htmlFor="task-system-prompt"
          className="block font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted"
        >
          System prompt <span className="normal-case tracking-normal">· candidate-visible</span>
        </label>
        <textarea
          id="task-system-prompt"
          value={task.systemPrompt}
          onChange={(e) => onChange({ systemPrompt: e.target.value })}
          rows={3}
          placeholder="Optional system prompt applied to every candidate. Sent to generation only — never to the judge."
          className="mt-1 min-h-[44px] w-full resize-y rounded-sm border border-edge bg-input px-2 py-1.5 text-sm text-text placeholder-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>

      {/* Evaluation — visibly separate section */}
      <fieldset className="rounded-md border border-edge bg-panel p-3">
        <legend className="px-1 font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
          How this task is judged
        </legend>
        <TaskEvaluationPicker
          selection={task.evaluation}
          inheritDescription={inheritDescription}
          profileRecords={profileRecords}
          resolveProfileLabel={resolveProfileLabel}
          onChange={(sel) => onChange({ evaluation: sel })}
        />
      </fieldset>

      {/* Judge instruction override — visibly separate from candidate instructions */}
      <div className="rounded-md border border-edge bg-panel p-3">
        <label
          htmlFor="task-judge-override"
          className="block font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted"
        >
          Judge instruction override <span className="normal-case tracking-normal">· evaluator-only</span>
        </label>
        <textarea
          id="task-judge-override"
          value={task.judgeInstructionOverride}
          onChange={(e) => onChange({ judgeInstructionOverride: e.target.value })}
          rows={3}
          placeholder="Optional guidance applied to the judge for this task only, on top of the suite/profile judge instruction. Never sent to candidates."
          className="mt-1 min-h-[44px] w-full resize-y rounded-sm border border-edge bg-input px-2 py-1.5 text-sm text-text placeholder-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <p className="mt-1 text-xs text-text-muted">
          This is evaluator-only guidance. It is visually and semantically separate from the
          candidate-visible prompt above.
        </p>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// TaskEvaluationPicker — tagged choice: inherit | holistic | pin profile.
// -----------------------------------------------------------------------------

function TaskEvaluationPicker({
  selection,
  inheritDescription,
  profileRecords,
  resolveProfileLabel,
  onChange,
}: {
  selection: TaskEvaluationSelection;
  inheritDescription: string;
  profileRecords: ProfileRecord[];
  resolveProfileLabel: (ref: EvaluationProfileRef) => string;
  onChange: (sel: TaskEvaluationSelection) => void;
}) {
  const mode =
    selection.kind === "inherit" ? "inherit"
    : selection.kind === "holistic" ? "holistic"
    : "profile";

  const pinnedRef = selection.kind === "profile" ? selection.profile : null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
        <button
          type="button"
          aria-pressed={mode === "inherit"}
          onClick={() => onChange({ kind: "inherit" })}
          className={`min-h-[44px] rounded-sm px-2 py-1.5 text-left font-mono text-xs uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            mode === "inherit"
              ? "bg-accent/15 font-semibold text-accent"
              : "text-text-secondary hover:text-text"
          }`}
        >
          Inherit suite default
        </button>
        <button
          type="button"
          aria-pressed={mode === "holistic"}
          onClick={() => onChange({ kind: "holistic" })}
          className={`min-h-[44px] rounded-sm px-2 py-1.5 text-left font-mono text-xs uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            mode === "holistic"
              ? "bg-accent/15 font-semibold text-accent"
              : "text-text-secondary hover:text-text"
          }`}
        >
          Holistic judgment
        </button>
        <button
          type="button"
          aria-pressed={mode === "profile"}
          onClick={() => {
            const first = profileRecords[0];
            const ref = first
              ? { id: first.id, version: first.latestVersion }
              : pinnedRef ?? { id: "", version: 0 };
            onChange({ kind: "profile", profile: ref });
          }}
          className={`min-h-[44px] rounded-sm px-2 py-1.5 text-left font-mono text-xs uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            mode === "profile"
              ? "bg-accent/15 font-semibold text-accent"
              : "text-text-secondary hover:text-text"
          }`}
        >
          Pin profile version
        </button>
      </div>

      {mode === "inherit" && (
        <p className="text-xs text-text-muted">{inheritDescription}</p>
      )}

      {mode === "holistic" && (
        <p className="text-xs text-text-muted">
          The judge receives no explicit criteria and uses the strict overall evaluation contract.
        </p>
      )}

      {mode === "profile" && (
        <div>
          {profileRecords.length === 0 ? (
            <p className="text-xs text-text-muted">
              No profiles available. Create a profile under the Profiles tab first.
            </p>
          ) : (
            <label className="block">
              <span className="sr-only">Pinned profile version for this task</span>
              <select
                value={pinnedRef ? `${pinnedRef.id}:${pinnedRef.version}` : ""}
                onChange={(e) => {
                  const [id, ver] = e.target.value.split(":");
                  onChange({ kind: "profile", profile: { id, version: Number(ver) } });
                }}
                aria-label="Pinned profile version for this task"
                className="min-h-[44px] w-full rounded-sm border border-edge bg-input px-2 py-1.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {profileRecords.map((r) => (
                  <option key={`${r.id}:${r.latestVersion}`} value={`${r.id}:${r.latestVersion}`}>
                    {resolveProfileLabel({ id: r.id, version: r.latestVersion })}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
