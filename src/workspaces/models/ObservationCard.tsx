// =============================================================================
// ObservationCard — Fable §5.11 (≤390 stacked-row transform).
//
// The mobile transformation of an evidence-table row: the same narrowing chips
// sit above, and the row becomes a stacked list of labeled rows (role="list")
// so no desktop table is squeezed onto a 390px viewport. Canonical Task,
// Version, and Instance are links; every target is ≥44×44.
// =============================================================================

import type { ReactNode } from "react";
import { COPY } from "./copy";

interface ObservationCardProps {
  observationId: string;
  task: string;
  version: number;
  instance: string;
  eligibility: string;
  evidenceClass: string;
  source: string;
  /** Canonical link targets; default to "#" so the parent can wire real routes. */
  taskHref?: string;
  versionHref?: string;
  instanceHref?: string;
}

const LINK_CLASS =
  "min-h-[44px] inline-flex items-center text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent";

function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <li role="listitem" data-observation-row className="flex flex-col gap-0.5 py-1">
      <span data-row-label className="text-xs text-text-secondary">
        {label}
      </span>
      <span className="text-sm text-text">{children}</span>
    </li>
  );
}

export function ObservationCard({
  observationId,
  task,
  version,
  instance,
  eligibility,
  evidenceClass,
  source,
  taskHref = "#",
  versionHref = "#",
  instanceHref = "#",
}: ObservationCardProps): ReactNode {
  return (
    <article
      data-observation-card-wrapper
      data-observation-id={observationId}
      className="rounded-sm border border-edge bg-card p-3"
    >
      <ul role="list" data-observation-card className="divide-y divide-edge">
        <Row label={COPY.observationCard.rowLabels.task}>
          <a data-canonical-link href={taskHref} className={LINK_CLASS}>
            {task}
          </a>
        </Row>
        <Row label={COPY.observationCard.rowLabels.version}>
          <a data-canonical-link href={versionHref} className={LINK_CLASS}>
            v{version}
          </a>
        </Row>
        <Row label={COPY.observationCard.rowLabels.instance}>
          <a data-canonical-link href={instanceHref} className={LINK_CLASS}>
            {instance}
          </a>
        </Row>
        <Row label={COPY.observationCard.rowLabels.eligibility}>{eligibility}</Row>
        <Row label={COPY.observationCard.rowLabels.evidenceClass}>{evidenceClass}</Row>
        <Row label={COPY.observationCard.rowLabels.source}>{source}</Row>
      </ul>
    </article>
  );
}
