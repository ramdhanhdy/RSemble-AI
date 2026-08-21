import { SearchX } from "lucide-react";
import { Link } from "react-router-dom";
import { isRecordType, type RecordType } from "../../lib/records/record-reference";
import { HONESTY_COPY } from "../../ui/honesty-copy";
import { recordTypeLabel } from "../../ui/RecordTypeEyebrow";

export function RecordNotFound({
  recordType,
  id,
}: {
  recordType: RecordType | string;
  id: string;
}) {
  const typeLabel = isRecordType(recordType) ? recordTypeLabel(recordType).toLowerCase() : "record";
  return (
    <div
      data-record-not-found=""
      className="flex min-h-full flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <SearchX size={28} className="text-text-muted" aria-hidden="true" />
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">Not found</p>
      <h1 tabIndex={-1} className="max-w-xl text-lg font-semibold text-text focus:outline-none">
        No {typeLabel} record with ID <span className="break-all font-mono">{id}</span> exists in
        this database.
      </h1>
      <div className="flex flex-wrap justify-center gap-2">
        <Link
          to={`/records?text=${encodeURIComponent(id)}`}
          className="motion-state flex min-h-[44px] items-center rounded-md border border-edge px-4 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Search Records for similar IDs
        </Link>
        <Link
          to="/records"
          className="motion-state flex min-h-[44px] items-center rounded-md border border-edge px-4 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Open Records
        </Link>
        <Link
          to="/records#import-data"
          className="motion-state flex min-h-[44px] items-center rounded-md border border-edge px-4 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Import data
        </Link>
      </div>
      <p className="honesty-note max-w-lg text-[11px] text-text-secondary">
        {HONESTY_COPY.deviceLocalUnknown}
      </p>
    </div>
  );
}
