import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, Loader2 } from "lucide-react";
import type { StudyRepository } from "../../lib/persistence/study-repository";
import { useStudyRepository } from "../../lib/persistence/repository-context";
import type { PolicyStudyRecord } from "../../lib/studies/policy/policy-study-types";
import { KindEyebrow } from "../../ui/KindEyebrow";

interface PolicyStudyPageProps {
  studyRepo?: StudyRepository | null;
}

export function PolicyStudyPage({ studyRepo: studyRepoProp }: PolicyStudyPageProps) {
  const ctx = useStudyRepository();
  const studyRepo = studyRepoProp !== undefined ? studyRepoProp : ctx;
  const { studyId = "" } = useParams<{ studyId: string }>();
  const [study, setStudy] = useState<PolicyStudyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!studyRepo) {
      setError("Study storage is unavailable.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    void studyRepo
      .getStudy(studyId)
      .then((row) => {
        if (!cancelled) setStudy(row);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load study.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studyId, studyRepo]);

  if (loading) {
    return (
      <div className="flex min-h-[140px] items-center justify-center gap-2 text-sm text-text-secondary">
        <Loader2 size={16} className="animate-spin-ease text-accent" aria-hidden="true" />
        Loading study…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 p-6 text-center">
        <AlertCircle className="text-error" size={18} aria-hidden="true" />
        <p className="text-sm text-error">{error}</p>
      </div>
    );
  }

  if (!study) {
    return (
      <div className="flex flex-col gap-3 p-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
          Unknown study
        </p>
        <h1 className="text-lg font-semibold text-text">Policy study not found</h1>
        <p className="text-sm text-text-secondary">
          No study <span className="font-mono">{studyId}</span> is stored in the Lab.
        </p>
        <Link
          to="/lab"
          className="flex min-h-[44px] items-center text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Back to Policy Studies
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <nav className="text-xs text-text-secondary">
        <Link to="/lab" className="text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          Lab
        </Link>
        {" / "}
        Policy Studies
      </nav>
      <KindEyebrow kind="study" />
      <h1 tabIndex={-1} className="text-lg font-semibold text-text">
        {study.title}
      </h1>
      {study.archivedAt !== null && (
        <p className="rounded-md border border-edge bg-panel px-3 py-2 text-sm text-text-secondary">
          Archived
        </p>
      )}
      <p className="text-sm text-text-secondary">
        Status <span className="font-mono text-text">{study.status}</span>
        {" · "}
        Claim <span className="font-mono text-text">{study.claimLevel}</span>
      </p>
      <p className="font-mono text-xs text-text-muted">
        Task Set {study.definition.workload.taskSetId} v{study.definition.workload.version}
      </p>
    </div>
  );
}
