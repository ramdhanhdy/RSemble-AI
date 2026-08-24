import { Link } from "react-router-dom";
import {
  ATTENTION_REASON_COPY,
  type AttentionItem,
  type AttentionKind,
} from "../../lib/attention/attention-types";
import type { AttentionQueryResult } from "../../lib/attention/attention-query";

const GROUP_ORDER: AttentionKind[] = [
  "evaluation_recovery",
  "comparison_recovery",
  "storage_preservation",
];

const GROUP_LABEL: Record<AttentionKind, string> = {
  evaluation_recovery: "Evaluations",
  comparison_recovery: "Compare",
  storage_preservation: "Storage",
};

function ownerHash(item: AttentionItem): string {
  return `${item.ownerHref}#attention`;
}

export function AttentionWorkspace({
  snapshot,
  loading = false,
  error = null,
}: {
  snapshot?: AttentionQueryResult;
  loading?: boolean;
  error?: string | null;
}) {
  if (loading) {
    return <div className="p-6 text-sm text-text-muted">Loading attention…</div>;
  }
  if (error) {
    return (
      <div role="alert" className="p-6 text-sm text-error">
        {error}
      </div>
    );
  }
  const items = snapshot?.items ?? [];
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text">Attention</h1>
          <p className="text-sm text-text-secondary">
            Unfinished work that already has a recovery action. Attention never retries for you.
          </p>
        </div>
        <Link
          to="/records"
          data-attention-records
          className="min-h-[44px] text-sm text-text-secondary hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Open Records
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-text-secondary">Nothing needs attention.</p>
      ) : (
        GROUP_ORDER.map((kind) => {
          const group = items.filter((row) => row.kind === kind);
          if (group.length === 0) return null;
          return (
            <section key={kind}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                {GROUP_LABEL[kind]}
              </h2>
              <ul className="flex flex-col gap-2">
                {group.map((row) => (
                  <li key={row.key}>
                    <Link
                      to={ownerHash(row)}
                      data-attention-item
                      className="block rounded-md border border-edge bg-panel px-3 py-3 text-sm hover:border-edge-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <div className="font-medium text-text">
                        {ATTENTION_REASON_COPY[row.reasonCode].label}
                      </div>
                      <div className="text-text-secondary">{row.summary}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
