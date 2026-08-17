// =============================================================================
// RSemble AI — Comparison Task Binding Control (spec §7.1, §7.2)
//
// Child 05 (Contextual Compare Results) Milestone D — Task 7.
//
// Canonical Task selection, version pinning, draft detection, and pre-run
// boundary for the Compare command pane.
// =============================================================================

import React from "react";
import type { TaskRepository } from "../../lib/persistence/task-repository";
import type { TaskRecord, TaskVersion } from "../../lib/tasks/task-types";
import type { ComparisonTaskBinding } from "../../lib/compare/comparison-result-types";

export interface ComparisonTaskBindingControlProps {
  repo?: TaskRepository | null;
  binding: ComparisonTaskBinding | null;
  prompt: string;
  onSelectTask: (task: TaskRecord, version: TaskVersion) => void;
  onVersionChange?: (version: TaskVersion) => void;
  onClearBinding: () => void;
  onPromptChange?: (newPrompt: string) => void;
  onProceedRun?: (finalBinding: ComparisonTaskBinding | null) => void;
  isPreRunPromptOpen?: boolean;
  onPreRunPromptClose?: () => void;
  className?: string;
}

export function ComparisonTaskBindingControl(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  props: ComparisonTaskBindingControlProps,
): React.ReactElement | null {
  return (
    <div data-testid="comparison-task-binding-control">
      {/* Stub implementation for RED phase */}
    </div>
  );
}
