import type { ReasoningEffort } from "../lib/providers/types";

const LABELS: Record<ReasoningEffort, string> = {
  "provider-default": "Provider default",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-high",
  max: "Max",
};

export function ReasoningEffortPicker({
  label,
  value,
  options,
  onChange,
  description,
}: {
  label: string;
  value: ReasoningEffort;
  options: readonly ReasoningEffort[];
  onChange: (value: ReasoningEffort) => void;
  description?: string;
}) {
  const effectiveValue = options.includes(value) ? value : "provider-default";
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="font-mono text-xs uppercase tracking-wide text-text-secondary">{label}</span>
      <select
        aria-label={label}
        value={effectiveValue}
        onChange={(event) => onChange(event.target.value as ReasoningEffort)}
        className="min-h-[44px] rounded-md border border-edge bg-card px-2.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {LABELS[option]}
          </option>
        ))}
      </select>
      {description ? <span className="text-xs text-text-secondary">{description}</span> : null}
    </label>
  );
}
