// =============================================================================
// FusionStudyView — the Fusion Study surface under a suite (spec §9).
//
// Read-only views over sealed study records:
//   Baseline (Stage A)  — stratified pairs, per-family results, elimination
//   Pair shortlist (B)  — the FULL screened-pair table, losers included
//   Fusion trials (B–C) — trial list with provenance drill-in, per-trial cost
//   Playbook            — policy table with claim-level badge, pool-adequacy
//                         qualifier, and "do not fuse" as a first-class verdict
//
// No navigation outside Evaluations is added; the back link returns to the
// suite editor.
// =============================================================================

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, ChevronDown, ChevronRight, FlaskConical } from "lucide-react";
import type { FusionStudyRepository } from "../../lib/persistence/fusion-study-repository";
import type {
  EvaluationObservation,
  FusionPlaybook,
  FusionStudy,
  FusionTrial,
  StageBResult,
} from "../../lib/evaluations/fusion-study-types";

// --- Small helpers ---------------------------------------------------------------

function fmt(n: number, digits = 2): string {
  return n.toFixed(digits);
}

function signed(n: number, digits = 2): string {
  return n >= 0 ? `+${n.toFixed(digits)}` : n.toFixed(digits);
}

function tokens(cost: { tokensIn: number; tokensOut: number }): string {
  return `${cost.tokensIn + cost.tokensOut}`;
}

export function ClaimBadge({ level }: { level: "exploratory" | "confirmed" }) {
  const confirmed = level === "confirmed";
  return (
    <span
      data-testid="claim-badge"
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
        confirmed ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"
      }`}
    >
      {confirmed ? "Confirmed" : "Exploratory"}
    </span>
  );
}

// --- Route wrapper ------------------------------------------------------------------

export function FusionStudyRoute({ fusionRepo }: { fusionRepo: FusionStudyRepository | null }) {
  const { suiteId, studyId } = useParams<{ suiteId: string; studyId: string }>();
  if (!suiteId || !studyId) {
    return <div className="text-sm text-text-muted">Missing suite or study id.</div>;
  }
  return <FusionStudyView fusionRepo={fusionRepo} suiteId={suiteId} studyId={studyId} />;
}

// --- Main view -----------------------------------------------------------------------

export interface FusionStudyViewProps {
  fusionRepo: FusionStudyRepository | null;
  suiteId: string;
  studyId: string;
}

export function FusionStudyView({ fusionRepo, suiteId, studyId }: FusionStudyViewProps) {
  const [study, setStudy] = useState<FusionStudy | null>(null);
  const [trials, setTrials] = useState<FusionTrial[]>([]);
  const [playbook, setPlaybook] = useState<FusionPlaybook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (!fusionRepo) {
      setError("Storage is unavailable.");
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const loadedStudy = await fusionRepo.getStudy(studyId);
        if (cancelled) return;
        if (!loadedStudy) {
          setError(`Fusion study ${studyId} not found.`);
          setLoading(false);
          return;
        }
        setStudy(loadedStudy);
        const [loadedTrials, loadedPlaybook] = await Promise.all([
          fusionRepo.listTrials(studyId),
          loadedStudy.playbookRef ? fusionRepo.getPlaybook(loadedStudy.playbookRef) : null,
        ]);
        if (cancelled) return;
        setTrials(loadedTrials);
        setPlaybook(loadedPlaybook ?? null);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load the study.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fusionRepo, studyId]);

  if (loading) return <div className="text-sm text-text-muted">Loading Fusion Study…</div>;
  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-400">
        <AlertCircle size={16} /> {error}
      </div>
    );
  }
  if (!study) return null;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="fusion-study-view">
      {/* Header */}
      <header className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Link to={`/evaluations/${suiteId}`} className="text-accent hover:underline">
            Suite
          </Link>
          <span>/</span>
          <span>Fusion Study</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FlaskConical size={18} className="text-accent" />
          <h1 className="text-lg font-semibold text-text">Fusion Study</h1>
          <ClaimBadge level={study.claimLevel} />
          <span className="rounded-full bg-panel px-2 py-0.5 text-xs text-text-secondary">
            {study.status === "completed" ? "Completed" : "In progress"}
          </span>
        </div>
        <p className="text-xs text-text-muted">
          Suite v{study.suiteRef.suiteVersion} · fingerprint {study.suiteRef.protocolFingerprint.slice(0, 19)}… ·
          pool {study.poolRef.id} v{study.poolRef.version} · Judge 1 {study.judge1.providerId}:{study.judge1.model} ·
          Judge 2 {study.judge2.providerId}:{study.judge2.model}
        </p>
      </header>

      <BaselineSection study={study} />
      <ShortlistSection stageB={study.stageResults.stageB} />
      <TrialSection fusionRepo={fusionRepo} trials={trials} />
      <PlaybookSection playbook={playbook} />
    </div>
  );
}

// --- Baseline (Stage A) -----------------------------------------------------------------

function BaselineSection({ study }: { study: FusionStudy }) {
  const stageA = study.stageResults.stageA;
  return (
    <section aria-label="Baseline (Stage A)" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-text">Baseline — recipe elimination (Stage A)</h2>
      {!stageA ? (
        <p className="text-sm text-text-muted">Stage A has not run yet.</p>
      ) : (
        <>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-xs text-text-muted">
                <th className="py-1 pr-2 font-medium">Pair</th>
                <th className="py-1 pr-2 font-medium">Stratum</th>
                <th className="py-1 pr-2 font-medium">BlindRaw</th>
                <th className="py-1 pr-2 font-medium">AnalysisFed</th>
                <th className="py-1 pr-2 font-medium">AnalysisScores</th>
                <th className="py-1 pr-2 font-medium">Refine (control)</th>
              </tr>
            </thead>
            <tbody>
              {stageA.pairs.map((p) => (
                <tr key={p.pair.join("|")} className="border-b border-edge/50">
                  <td className="py-1 pr-2 text-text">{p.pair.join(" + ")}</td>
                  <td className="py-1 pr-2 text-text-secondary">{p.stratum}</td>
                  {(["BlindRaw", "AnalysisFed", "AnalysisScores"] as const).map((family) => (
                    <td key={family} className="py-1 pr-2 text-text-secondary">
                      {p.familyScores[family] !== undefined ? fmt(p.familyScores[family]!) : "—"}
                    </td>
                  ))}
                  <td className="py-1 pr-2 text-text-secondary">
                    {p.refineWinnerScore !== null ? fmt(p.refineWinnerScore) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-text-muted">Survivors:</span>
            {stageA.survivors.map((s) => (
              <span key={s} className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                {s}
              </span>
            ))}
          </div>
          {stageA.eliminated.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-text-secondary" data-testid="stage-a-eliminations">
              {stageA.eliminated.map((e) => (
                <li key={e.family}>
                  <span className="font-medium text-text">{e.family}</span> eliminated — {e.reason}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

// --- Pair shortlist (Stage B) -------------------------------------------------------------

export function ShortlistSection({ stageB }: { stageB: StageBResult | null }) {
  return (
    <section aria-label="Pair shortlist (Stage B)" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-text">Pair shortlist (Stage B)</h2>
      {!stageB ? (
        <p className="text-sm text-text-muted">Stage B has not run yet.</p>
      ) : (
        <>
          <p className="text-xs text-text-muted">
            Rule: {stageB.shortlistRule}
            {stageB.frozenRecipe ? ` · frozen recipe: ${stageB.frozenRecipe}` : ""}
          </p>
          {/* The full screened-pair table — losers included (winner's-curse transparency). */}
          <table className="w-full border-collapse text-sm" data-testid="screened-pair-table">
            <thead>
              <tr className="border-b border-edge text-left text-xs text-text-muted">
                <th className="py-1 pr-2 font-medium">Pair</th>
                <th className="py-1 pr-2 font-medium">H_select</th>
                <th className="py-1 pr-2 font-medium">H_synth</th>
                <th className="py-1 pr-2 font-medium">Per-criterion</th>
                <th className="py-1 pr-2 font-medium">Cost</th>
                <th className="py-1 pr-2 font-medium">Shortlisted</th>
              </tr>
            </thead>
            <tbody>
              {stageB.screenedPairs.map((row) => (
                <tr
                  key={row.pair.join("|")}
                  className={`border-b border-edge/50 ${row.shortlisted ? "bg-accent/5" : ""}`}
                >
                  <td className="py-1 pr-2 text-text">{row.pair.join(" + ")}</td>
                  <td className="py-1 pr-2 text-text-secondary">{fmt(row.selectionHeadroom, 3)}</td>
                  <td className="py-1 pr-2 text-text-secondary">{fmt(row.synthesisHeadroom, 3)}</td>
                  <td className="py-1 pr-2 text-xs text-text-muted">
                    {row.perCriterionHeadroom
                      .filter((c) => Math.abs(c.headroom) > 1e-9)
                      .slice(0, 2)
                      .map((c) => `${c.criterionId} ${signed(c.headroom)}`)
                      .join(", ") || "—"}
                  </td>
                  <td className="py-1 pr-2 text-text-secondary">{fmt(row.costMultiplier, 1)}×</td>
                  <td className="py-1 pr-2 text-text-secondary">{row.shortlisted ? "✓" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {stageB.recipeEliminationLog.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-text-secondary">
              {stageB.recipeEliminationLog.map((e, i) => (
                <li key={i}>
                  <span className="font-medium text-text">{e.dropped}</span> dropped — {e.reason}
                </li>
              ))}
            </ul>
          )}
          {stageB.poolAdequacy.probed && (
            <p className="text-xs text-text-secondary" data-testid="pool-adequacy-note">
              Pool adequacy probe: {stageB.poolAdequacy.outcome ?? "no challengers run"}. {stageB.poolAdequacy.note}
            </p>
          )}
        </>
      )}
    </section>
  );
}

// --- Fusion trials (Stages B–C) ------------------------------------------------------------

function TrialSection({
  fusionRepo,
  trials,
}: {
  fusionRepo: FusionStudyRepository | null;
  trials: FusionTrial[];
}) {
  const [openTrialId, setOpenTrialId] = useState<string | null>(null);
  return (
    <section aria-label="Fusion trials" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-text">Fusion trials (Stages B–C)</h2>
      {trials.length === 0 ? (
        <p className="text-sm text-text-muted">No trials recorded yet.</p>
      ) : (
        <table className="w-full border-collapse text-sm" data-testid="fusion-trial-table">
          <thead>
            <tr className="border-b border-edge text-left text-xs text-text-muted">
              <th className="py-1 pr-2 font-medium" aria-label="expand" />
              <th className="py-1 pr-2 font-medium">Trial</th>
              <th className="py-1 pr-2 font-medium">Stage</th>
              <th className="py-1 pr-2 font-medium">Policy</th>
              <th className="py-1 pr-2 font-medium">Sample</th>
              <th className="py-1 pr-2 font-medium">Status</th>
              <th className="py-1 pr-2 font-medium">Policy cost</th>
              <th className="py-1 pr-2 font-medium">Experimental cost</th>
            </tr>
          </thead>
          <tbody>
            {trials.map((trial) => (
              <TrialRow
                key={trial.id}
                fusionRepo={fusionRepo}
                trial={trial}
                open={openTrialId === trial.id}
                onToggle={() => setOpenTrialId(openTrialId === trial.id ? null : trial.id)}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function TrialRow({
  fusionRepo,
  trial,
  open,
  onToggle,
}: {
  fusionRepo: FusionStudyRepository | null;
  trial: FusionTrial;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-b border-edge/50">
        <td className="py-1 pr-2">
          <button
            type="button"
            onClick={onToggle}
            aria-label={`Provenance for trial ${trial.id}`}
            aria-expanded={open}
            className="text-text-muted hover:text-text"
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </td>
        <td className="py-1 pr-2 font-mono text-xs text-text">{trial.id.slice(0, 12)}</td>
        <td className="py-1 pr-2 text-text-secondary">{trial.stage}</td>
        <td className="py-1 pr-2 text-text-secondary">{trial.policy}</td>
        <td className="py-1 pr-2 text-text-secondary">{trial.sampleIndex}</td>
        <td className="py-1 pr-2 text-text-secondary">{trial.status}</td>
        <td className="py-1 pr-2 text-text-secondary">{tokens(trial.cost.policy)} tok</td>
        <td className="py-1 pr-2 text-text-secondary">{tokens(trial.cost.experimental)} tok</td>
      </tr>
      {open && (
        <tr className="border-b border-edge/50 bg-panel/40">
          <td colSpan={8} className="px-3 py-2">
            <TrialProvenance fusionRepo={fusionRepo} trial={trial} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Read-only provenance chain for a sealed trial (spec §6.3, acceptance 8). */
function TrialProvenance({
  fusionRepo,
  trial,
}: {
  fusionRepo: FusionStudyRepository | null;
  trial: FusionTrial;
}) {
  const [observations, setObservations] = useState<EvaluationObservation[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!fusionRepo) return;
    void fusionRepo.listObservations(trial.id).then((list) => {
      if (!cancelled) setObservations(list);
    });
    return () => {
      cancelled = true;
    };
  }, [fusionRepo, trial.id]);

  return (
    <div className="flex flex-col gap-1 text-xs text-text-secondary" data-testid={`provenance-${trial.id}`}>
      <div>
        Suite v{trial.suiteRef.suiteVersion} ({trial.suiteRef.protocolFingerprint.slice(0, 19)}…) · pool{" "}
        {trial.poolRef.id} v{trial.poolRef.version} · candidates{" "}
        {trial.candidateConfig.slots.map((s) => `${s.providerId}:${s.slug}`).join(" + ")}
      </div>
      <div>
        Judge 1 {trial.judge1.providerId}:{trial.judge1.model} · Judge 2 {trial.judge2.providerId}:
        {trial.judge2.model}
        {trial.recipe ? ` · recipe ${trial.recipe.id} v${trial.recipe.version}` : ""}
        {trial.synthesizer ? ` · synthesizer ${trial.synthesizer.providerId}:${trial.synthesizer.model}` : ""}
      </div>
      <div>
        Children: candidates {trial.children.candidateRunId ?? "—"} · dev judge{" "}
        {trial.children.devJudgeRunId ?? "—"} · artifact{" "}
        {trial.children.synthesisArtifact
          ? `${trial.children.synthesisArtifact.fusionAttemptId} (${trial.children.synthesisArtifact.contentHash.slice(0, 19)}…)`
          : "—"}
      </div>
      <div>
        Observations:{" "}
        {observations.length === 0
          ? "none"
          : observations
              .map(
                (o) =>
                  `${o.judge.providerId}:${o.judge.model} ${o.status}${o.overallScore !== null ? ` ${fmt(o.overallScore)}` : ""}${o.error ? ` (${o.error.message})` : ""}`,
              )
              .join(" · ")}
      </div>
      <div>
        Cost: policy {tokens(trial.cost.policy)} tok · experimental {tokens(trial.cost.experimental)} tok
        {trial.sealedAt !== null ? ` · sealed ${new Date(trial.sealedAt).toLocaleString()}` : ""}
      </div>
    </div>
  );
}

// --- Playbook ------------------------------------------------------------------------------

function PlaybookSection({ playbook }: { playbook: FusionPlaybook | null }) {
  return (
    <section aria-label="Playbook" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-text">Playbook</h2>
      {!playbook ? (
        <p className="text-sm text-text-muted">The playbook is built when the study completes.</p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <ClaimBadge level={playbook.claimLevel} />
            {playbook.poolAdequacy.probed && (
              <span className="text-xs text-text-muted">
                Pool adequacy: {playbook.poolAdequacy.outcome ?? "unconfirmed"}
              </span>
            )}
          </div>
          <table className="w-full border-collapse text-sm" data-testid="playbook-table">
            <thead>
              <tr className="border-b border-edge text-left text-xs text-text-muted">
                <th className="py-1 pr-2 font-medium">Policy</th>
                <th className="py-1 pr-2 font-medium">Configuration</th>
                <th className="py-1 pr-2 font-medium">Score</th>
                <th className="py-1 pr-2 font-medium">Lift</th>
                <th className="py-1 pr-2 font-medium">Cost</th>
                <th className="py-1 pr-2 font-medium">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {playbook.rows.map((row) => (
                <tr key={row.policy} className="border-b border-edge/50">
                  <td className="py-1 pr-2 font-medium text-text">{row.policy}</td>
                  <td className="py-1 pr-2 text-text-secondary">{row.configuration}</td>
                  <td className="py-1 pr-2 text-text-secondary">{fmt(row.score)}</td>
                  <td className="py-1 pr-2 text-text-secondary">
                    {row.policy === "best_fixed" ? "baseline" : signed(row.lift)}
                  </td>
                  <td className="py-1 pr-2 text-text-secondary">{fmt(row.costMultiplier, 1)}×</td>
                  <td className="py-1 pr-2 text-text-secondary">{row.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* "Do not fuse" is a first-class verdict, not an error state. */}
          <div
            data-testid="playbook-verdict"
            className={`rounded-md border px-3 py-2 text-sm ${
              playbook.recommendation.kind === "do_not_fuse"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            }`}
          >
            {playbook.recommendation.kind === "do_not_fuse" ? (
              <>
                <span className="font-semibold">Verdict: do not fuse.</span> {playbook.recommendation.rationale}
              </>
            ) : (
              <>
                <span className="font-semibold">
                  Recommendation: {playbook.recommendation.policy} — {playbook.recommendation.configuration}.
                </span>{" "}
                {playbook.recommendation.rationale}
              </>
            )}
          </div>
          <p className="text-sm text-text-secondary" data-testid="playbook-conclusion">
            {playbook.conclusion}
          </p>
        </>
      )}
    </section>
  );
}
