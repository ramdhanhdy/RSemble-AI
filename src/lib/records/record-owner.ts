import type { HistoricalOwnerCrosswalk, RecordReference } from "./record-reference";

export interface OwningContextResolution {
  ownerKind: "compare" | "evaluation" | "task" | "model" | "lab" | "legacy";
  ownerHref: string | null;
  ownerLabel: string;
  confidence: "exact" | "crosswalk" | "unresolved";
  reason: string | null;
}

function resolveCrosswalk(
  crosswalk: HistoricalOwnerCrosswalk | null | undefined,
): OwningContextResolution | null {
  if (!crosswalk) return null;
  return {
    ownerKind: crosswalk.ownerKind,
    ownerHref: crosswalk.ownerHref,
    ownerLabel: crosswalk.ownerLabel,
    confidence: "crosswalk",
    reason: crosswalk.reason,
  };
}

const UNRESOLVED: OwningContextResolution = {
  ownerKind: "legacy",
  ownerHref: null,
  ownerLabel: "Origin unresolved",
  confidence: "unresolved",
  reason: "No exact owner or historical crosswalk is stored for this record.",
};

export function resolveRecordOwner(reference: RecordReference): OwningContextResolution {
  switch (reference.recordType) {
    case "comparison":
      return {
        ownerKind: "compare",
        ownerHref: `/compare/results/${encodeURIComponent(reference.id)}`,
        ownerLabel: "Comparison result in Compare",
        confidence: "exact",
        reason: null,
      };
    case "evaluation":
      return {
        ownerKind: "evaluation",
        ownerHref: `/evaluations/results/${encodeURIComponent(reference.id)}`,
        ownerLabel: "Evaluation execution",
        confidence: "exact",
        reason: null,
      };
    case "policy-study":
      return {
        ownerKind: "lab",
        ownerHref: `/lab/studies/${encodeURIComponent(reference.id)}`,
        ownerLabel: "Policy Study in the Lab",
        confidence: "exact",
        reason: null,
      };
    case "observation":
      return reference.sourceKind === "comparison"
        ? {
            ownerKind: "compare",
            ownerHref: `/compare/results/${encodeURIComponent(reference.sourceResultId)}`,
            ownerLabel: "Source comparison in Compare",
            confidence: "exact",
            reason: null,
          }
        : {
            ownerKind: "evaluation",
            ownerHref: `/evaluations/results/${encodeURIComponent(reference.sourceResultId)}`,
            ownerLabel: "Source evaluation execution",
            confidence: "exact",
            reason: null,
          };
    case "task-execution": {
      if (reference.runSource.kind === "adhoc" && reference.runSource.comparisonId) {
        return {
          ownerKind: "compare",
          ownerHref: `/compare/results/${encodeURIComponent(reference.runSource.comparisonId)}`,
          ownerLabel: "Comparison result in Compare",
          confidence: "exact",
          reason: null,
        };
      }
      if (reference.runSource.kind === "experiment") {
        return {
          ownerKind: "evaluation",
          ownerHref: `/evaluations/results/${encodeURIComponent(
            reference.runSource.evaluationExecutionId,
          )}`,
          ownerLabel: "Evaluation execution",
          confidence: "exact",
          reason: null,
        };
      }
      if (reference.runSource.kind === "policy-study") {
        return {
          ownerKind: "lab",
          ownerHref: `/lab/studies/${encodeURIComponent(reference.runSource.studyId)}`,
          ownerLabel: "Policy Study in the Lab",
          confidence: "exact",
          reason: null,
        };
      }
      return resolveCrosswalk(reference.ownerCrosswalk) ?? UNRESOLVED;
    }
    case "legacy":
      return resolveCrosswalk(reference.ownerCrosswalk) ?? UNRESOLVED;
  }
}

export function recordDetailHref(reference: RecordReference): string {
  return `/records/${reference.recordType}/${encodeURIComponent(reference.id)}`;
}

export function recordOpenHref(reference: RecordReference): string {
  if (
    reference.recordType === "comparison" ||
    reference.recordType === "evaluation" ||
    reference.recordType === "policy-study"
  ) {
    return resolveRecordOwner(reference).ownerHref ?? recordDetailHref(reference);
  }
  return recordDetailHref(reference);
}
