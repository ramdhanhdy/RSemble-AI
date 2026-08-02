// =============================================================================
// Pagination — shared Previous/Next pager for bounded large surfaces (spec
// §12.5). PAGE_SIZE = 50. Buttons keep 44px targets and expose disabled state.
// The range text announces "start–end of total" in tabular numerals.
// =============================================================================

import type { ReactElement } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const PAGE_SIZE = 50;

export interface PaginationProps {
  /** 1-based current page. */
  page: number;
  /** Total number of pages. */
  pageCount: number;
  /** Total items across all pages (for the range announcement). */
  totalItems?: number;
  onPageChange: (page: number) => void;
}

function clampPage(page: number, pageCount: number): number {
  if (pageCount <= 1) return 1;
  return Math.min(Math.max(page, 1), pageCount);
}

export function Pagination({
  page,
  pageCount,
  totalItems,
  onPageChange,
}: PaginationProps): ReactElement {
  const current = clampPage(page, pageCount);
  const items = totalItems ?? pageCount * PAGE_SIZE;
  const start = (current - 1) * PAGE_SIZE + 1;
  const end = Math.min(current * PAGE_SIZE, items);
  const prevDisabled = current <= 1;
  const nextDisabled = current >= pageCount;

  return (
    <nav
      aria-label="Pagination"
      className="flex min-w-0 items-center justify-between gap-2"
    >
      <span className="min-w-0 text-xs tabular-nums text-text-muted">
        {start}–{end} of {totalItems}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          aria-label="Previous page"
          disabled={prevDisabled}
          onClick={() => onPageChange(current - 1)}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-edge bg-panel text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Next page"
          disabled={nextDisabled}
          onClick={() => onPageChange(current + 1)}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-edge bg-panel text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </span>
    </nav>
  );
}
