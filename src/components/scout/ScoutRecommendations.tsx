import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Plus, RefreshCw, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { assessRecommendation, type EvidenceDimension } from "@/lib/scout-evidence";
import type { Instance, PackTruth, Recommendation, ScoutAnalysis, ScoutRecommendationDecision } from "@/lib/types";
import type { PackHealthResult } from "@/lib/pack-health";

type Filter = "available" | "saved" | "rejected";

export function ScoutRecommendations({ query, onQueryChange, onSearch, loading, canSearch, error, result, truth, analysis, instance, decisions, savedProjects, health, truthError, canSave, addingProjectId, onSave, onDecision }: {
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  loading: boolean;
  canSearch: boolean;
  error: unknown;
  result: Recommendation[] | null;
  truth: PackTruth | null;
  analysis: ScoutAnalysis;
  instance: Instance | null;
  decisions: ScoutRecommendationDecision[];
  savedProjects: Set<string>;
  health: PackHealthResult | null;
  truthError: unknown;
  canSave: boolean;
  addingProjectId: string | null;
  onSave: (recommendation: Recommendation) => void;
  onDecision: (projectId: string, decision: "rejected" | "clear") => Promise<void>;
}) {
  const [filter, setFilter] = useState<Filter>("available");
  const [page, setPage] = useState(1);
  const [changingProject, setChangingProject] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const decisionsByProject = useMemo(() => new Map(decisions.map((item) => [item.projectId, item.decision])), [decisions]);
  const stateFor = (recommendation: Recommendation): Filter => {
    const { candidate } = recommendation;
    if (savedProjects.has(candidate.slug) || savedProjects.has(candidate.projectId)) return "saved";
    if (decisionsByProject.get(candidate.projectId) === "rejected") return "rejected";
    return "available";
  };
  const filtered = result?.filter((recommendation) => stateFor(recommendation) === filter) ?? [];
  const pageCount = Math.max(1, Math.ceil(filtered.length / 12));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * 12, currentPage * 12);
  const changeDecision = async (projectId: string, decision: "rejected" | "clear") => {
    setChangingProject(projectId);
    setDecisionError(null);
    try { await onDecision(projectId, decision); }
    catch (cause) { setDecisionError(String(cause)); }
    finally { setChangingProject(null); }
  };

  return <div className="space-y-4">
    <Card><CardContent className="space-y-3 p-4">
      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
        <label className="relative min-w-64 flex-1"><span className="sr-only">Search Modrinth projects</span><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" /><Input className="pl-9" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search by feature or pack goal" /></label>
        <Button type="submit" disabled={!canSearch || loading || query.trim().length < 2}>{loading && <RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin" />}{loading ? "Checking releases…" : "Search Modrinth"}</Button>
      </form>
      <p className="text-sm text-[var(--color-muted-foreground)]">Suggestions are exploratory. Release checks use Modrinth data; JAR manifest checks happen when you review an install plan.</p>
      {error != null && <p role="alert" className="text-sm text-[var(--color-destructive)]">{String(error)}</p>}
      {truthError != null && <p role="alert" className="text-sm text-[var(--color-destructive)]">Local pack evidence is unavailable: {String(truthError)}</p>}
    </CardContent></Card>
    {health && <Card><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"><div><strong>Pack Health is separate from suggestions</strong><p className="text-[var(--color-muted-foreground)]">{health.findings.filter((item) => item.severity === "error").length} errors and {health.findings.filter((item) => item.severity === "warning").length} warnings in the current local scan.</p></div><Button variant="outline" asChild><Link to="/health">Open Pack Health</Link></Button></CardContent></Card>}
    {result && <>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter Scout recommendations">
        {(["available", "saved", "rejected"] as const).map((value) => (
          <Button key={value} variant={filter === value ? "secondary" : "outline"} aria-pressed={filter === value}
            onClick={() => { setFilter(value); setPage(1); }}>
            {value === "available" ? "Explore" : value === "saved" ? "Saved in Suggestions" : "Rejected"} ({result.filter((item) => stateFor(item) === value).length})
          </Button>
        ))}
      </div>
      {decisionError && <p role="alert" className="text-sm text-[var(--color-destructive)]">{decisionError}</p>}
      {filtered.length === 0 ? <Card><CardContent className="p-5 text-sm text-[var(--color-muted-foreground)]">{result.length === 0 ? "No projects matched this search." : `No ${filter} projects in these results.`}</CardContent></Card> : <div className="grid gap-4 lg:grid-cols-2">{visible.map((recommendation) => <RecommendationCard key={recommendation.candidate.projectId} recommendation={recommendation} state={stateFor(recommendation)} truth={truth} analysis={analysis} instance={instance} canSave={canSave} adding={addingProjectId === recommendation.candidate.projectId} changing={changingProject === recommendation.candidate.projectId} onSave={onSave} onDecision={changeDecision} />)}</div>}
      {pageCount > 1 && <div className="flex items-center justify-center gap-3"><Button variant="outline" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</Button><span className="text-sm">Page {currentPage} of {pageCount}</span><Button variant="outline" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</Button></div>}
    </>}
  </div>;
}

function RecommendationCard({ recommendation, state, truth, analysis, instance, canSave, adding, changing, onSave, onDecision }: {
  recommendation: Recommendation; state: Filter; truth: PackTruth | null; analysis: ScoutAnalysis; instance: Instance | null; canSave: boolean; adding: boolean; changing: boolean;
  onSave: (recommendation: Recommendation) => void;
  onDecision: (projectId: string, decision: "rejected" | "clear") => void;
}) {
  const { candidate } = recommendation;
  const assessment = truth && instance ? assessRecommendation(recommendation, truth, analysis, instance) : null;
  return <Card className="flex flex-col"><CardContent className="flex h-full flex-col gap-3 p-5">
    <div className="flex items-start gap-3">{candidate.iconUrl ? <img src={candidate.iconUrl} alt="" className="h-12 w-12 rounded-md object-cover" /> : <div className="h-12 w-12 shrink-0 rounded-md bg-[var(--color-muted)]" />}<div className="min-w-0 flex-1"><h3 className="font-semibold">{candidate.title}</h3><p className="text-sm text-[var(--color-muted-foreground)]">by {candidate.author}</p></div><Badge variant={assessment?.blocked || recommendation.availability === "none" ? "destructive" : "outline"}>{assessment?.blocked || recommendation.availability === "none" ? "Known incompatibility" : recommendation.fit.label}</Badge></div>
    <p className="text-sm text-[var(--color-muted-foreground)]">{candidate.description}</p>
    <div className="rounded-md bg-[var(--color-muted)] p-3 text-sm"><strong>Why suggested</strong><p className="mt-1">{assessment?.reason ?? recommendation.fit.reason}</p></div>
    <div className="space-y-2 text-sm"><strong>Compatibility evidence</strong>
      <EvidenceRow label="Minecraft" value={assessment?.minecraft} />
      <EvidenceRow label="Loader" value={assessment?.loader} />
      <EvidenceRow label="Required dependencies" value={assessment?.dependencies} />
      <EvidenceRow label="Declared conflicts" value={assessment?.conflicts} />
    </div>
    {recommendation.evidenceWarning && <p className="text-sm text-[var(--color-destructive)]">{recommendation.evidenceWarning}</p>}
    <div className="border-t border-[var(--color-border)] pt-3 text-sm text-[var(--color-muted-foreground)]"><p><strong className="text-[var(--color-foreground)]">Maintenance:</strong> {assessment?.maintenance ?? `Modrinth project last changed ${candidate.dateModified.slice(0, 10)}; activity is not a quality guarantee.`}</p><p><strong className="text-[var(--color-foreground)]">Performance impact:</strong> Unknown</p>{recommendation.versionEvidence && <p>Release checked: {recommendation.versionEvidence.versionNumber} ({recommendation.versionEvidence.publishedAt.slice(0, 10)})</p>}</div>
    <div className="mt-auto flex flex-wrap gap-2 pt-2"><Button variant="outline" size="sm" onClick={() => void openUrl(candidate.projectUrl)}><ExternalLink aria-hidden="true" className="h-4 w-4" />View source</Button>{state === "saved" ? <Button variant="outline" size="sm" asChild><Link to="/mod-suggestions">Open Suggestions</Link></Button> : state === "rejected" ? <Button variant="outline" size="sm" disabled={changing} onClick={() => onDecision(candidate.projectId, "clear")}>Restore recommendation</Button> : <><Button size="sm" disabled={!canSave || !truth || adding || assessment?.blocked} onClick={() => onSave(recommendation)} title={assessment?.blocked ? "No compatible release or a known incompatibility" : undefined}>{adding ? <RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Plus aria-hidden="true" className="h-4 w-4" />}Save to Suggestions</Button><Button variant="ghost" size="sm" disabled={changing} onClick={() => onDecision(candidate.projectId, "rejected")}><X aria-hidden="true" className="h-4 w-4" />Reject</Button></>}</div>
  </CardContent></Card>;
}

function EvidenceRow({ label, value }: { label: string; value: EvidenceDimension | undefined }) {
  const status = value?.status ?? "unknown";
  const variant = status === "blocked" ? "destructive" : status === "compatible" ? "success" : "warning";
  return <div className="rounded-md border border-[var(--color-border)] px-3 py-2"><div className="flex items-center justify-between gap-2"><span className="font-medium">{label}</span><Badge variant={variant}>{status === "needsReview" ? "Review" : status}</Badge></div><p className="mt-1 text-[var(--color-muted-foreground)]">{value?.detail ?? "Local pack evidence is unavailable."}</p></div>;
}
