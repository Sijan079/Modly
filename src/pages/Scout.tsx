import { useEffect, useMemo, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Filter, Plus, RefreshCw, ScanSearch, Search, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageShell } from "@/components/layout/PageShell";
import { ThemedSelect } from "@/components/ui/themed-select";
import { Input } from "@/components/ui/input";
import { useInstances } from "@/hooks/useInstances";
import { useModSuggestions, useUpsertModSuggestion } from "@/hooks/useMods";
import { useAnalyzeScoutTarget, useCreateScoutInstanceTarget, useDiscoverScoutCandidates, useScoutAnalysis, useScoutRecommendations, useScoutTargets, useSearchScoutCandidates } from "@/hooks/useScout";
import type { Recommendation, RecommendationStatus, ScoutInstalledMod } from "@/lib/types";
import { parseModSourceUrl } from "@/lib/mod-source-url";
import { formatLoader } from "@/lib/utils";
import { useAppStore } from "@/store/app";

export function ScoutPage() {
  const { data: instances = [] } = useInstances();
  const { data: targets = [], isLoading: targetsLoading } = useScoutTargets();
  const { selectedInstanceId, setSelectedInstance } = useAppStore();
  const instanceId = selectedInstanceId ?? instances[0]?.id ?? null;
  const [targetId, setTargetId] = useState<string | null>(null);
  const createInstanceTarget = useCreateScoutInstanceTarget();
  const targetRequestInstanceId = useRef<string | null>(null);
  const analyze = useAnalyzeScoutTarget();
  const discoverCandidates = useDiscoverScoutCandidates();
  const candidateSearch = useSearchScoutCandidates();
  const upsertSuggestion = useUpsertModSuggestion();
  const [candidateQuery, setCandidateQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"recommendations" | "installed">("recommendations");
  const [addingProjectId, setAddingProjectId] = useState<string | null>(null);
  const [hiddenProjectIds, setHiddenProjectIds] = useState<Set<string>>(() => new Set());
  const selectedTarget = targets.find((target) => target.id === targetId) ?? null;
  const { data: suggestions = [] } = useModSuggestions(selectedTarget?.instanceId ?? null);
  const { data: savedAnalysis = null, isLoading: analysisLoading } = useScoutAnalysis(targetId);
  const { data: savedRecommendations = null, isLoading: recommendationsLoading } = useScoutRecommendations(targetId);
  const analysis = analyze.data?.targetId === targetId ? analyze.data : savedAnalysis;

  useEffect(() => {
    if (!selectedInstanceId && instances[0]) setSelectedInstance(instances[0].id);
  }, [instances, selectedInstanceId, setSelectedInstance]);

  useEffect(() => {
    if (!instanceId) {
      setTargetId(null);
      return;
    }
    const target = targets.find((candidate) => candidate.instanceId === instanceId);
    if (target) {
      setTargetId(target.id);
      return;
    }
    if (targetsLoading || targetRequestInstanceId.current === instanceId) return;
    targetRequestInstanceId.current = instanceId;
    void createInstanceTarget.mutateAsync(instanceId).then((created) => setTargetId(created.id)).catch(() => undefined);
  }, [instanceId, targets, targetsLoading]);

  useEffect(() => {
    candidateSearch.reset();
    setHiddenProjectIds(new Set());
  }, [targetId, analysis?.id]);

  useEffect(() => {
    if (!targetId || !analysis || recommendationsLoading || savedRecommendations || discoverCandidates.isPending) return;
    discoverCandidates.mutate(targetId);
  }, [targetId, analysis?.id, recommendationsLoading, savedRecommendations]);

  const suggestedProjects = useMemo(
    () => new Set(suggestions.map((suggestion) => parseModSourceUrl(suggestion.sourceUrl)?.project).filter((project): project is string => !!project)),
    [suggestions],
  );
  const recommendationResult = candidateSearch.data ?? savedRecommendations;
  const visibleRecommendations = useMemo(() => recommendationResult?.recommendations.filter(({ candidate }) =>
    !hiddenProjectIds.has(candidate.projectId) &&
    !suggestedProjects.has(candidate.slug) &&
    !suggestedProjects.has(candidate.projectId)
  ) ?? null, [hiddenProjectIds, recommendationResult, suggestedProjects]);

  const selectInstance = (value: string) => {
    if (value === instanceId) return;
    targetRequestInstanceId.current = null;
    setTargetId(null);
    setSelectedInstance(value || null);
  };

  const searchCandidates = () => {
    if (!targetId || candidateQuery.trim().length < 2) return;
    candidateSearch.mutate({ targetId, query: candidateQuery.trim() });
  };

  const addToSuggestions = async (recommendation: Recommendation) => {
    if (!selectedTarget?.instanceId) return;
    const { candidate } = recommendation;
    setAddingProjectId(candidate.projectId);
    try {
      await upsertSuggestion.mutateAsync({
        instanceId: selectedTarget.instanceId,
        fileName: candidate.title,
        filePath: "",
        enabled: true,
        hashSha256: null,
        sourceUrl: candidate.projectUrl,
        name: candidate.title,
        version: "?",
        authors: candidate.author ? [candidate.author] : [],
        loader: analysis?.loader ?? "unknown",
        side: "unknown",
        modIdField: candidate.slug,
        categoryIds: [],
      });
      setHiddenProjectIds((current) => new Set(current).add(candidate.projectId));
    } catch {
      // The mutation exposes its error in the recommendation panel.
    } finally {
      setAddingProjectId(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageShell
        title="Modpack Scout"
        description="Analyze a local Minecraft modpack without changing its files."
        controls={
          <>
            <ThemedSelect
              className="min-w-[11rem]"
              value={instanceId ?? ""}
              onValueChange={selectInstance}
              aria-label="Select instance"
              options={[{ value: "", label: "Select instance" }, ...instances.map((instance) => ({ value: instance.id, label: instance.name }))]}
            />
            <Button onClick={() => targetId && analyze.mutate(targetId)} disabled={!targetId || analyze.isPending}>
              {analyze.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
              {analyze.isPending ? "Analyzing..." : "Analyze Pack"}
            </Button>
          </>
        }
      />

      {(createInstanceTarget.error || analyze.error) && (
        <ErrorMessage error={createInstanceTarget.error ?? analyze.error} />
      )}
      {analysis && (
        <div className="space-y-4">
          <div className="flex gap-2 border-b border-[var(--color-border)]">
            <Button variant="ghost" className={activeTab === "recommendations" ? "rounded-none border-b-2 border-[var(--color-primary)]" : "rounded-none text-[var(--color-muted-foreground)]"} onClick={() => setActiveTab("recommendations")}>Recommendations</Button>
            <Button variant="ghost" className={activeTab === "installed" ? "rounded-none border-b-2 border-[var(--color-primary)]" : "rounded-none text-[var(--color-muted-foreground)]"} onClick={() => setActiveTab("installed")}>Installed Mods</Button>
          </div>
          {activeTab === "recommendations" ? (
            <CandidateSearch
              query={candidateQuery}
              onQueryChange={setCandidateQuery}
              onSearch={searchCandidates}
              loading={candidateSearch.isPending || discoverCandidates.isPending}
              error={candidateSearch.error ?? discoverCandidates.error ?? upsertSuggestion.error}
              result={visibleRecommendations}
              canAddToSuggestions={!!selectedTarget?.instanceId}
              addingProjectId={addingProjectId}
              onAddToSuggestions={addToSuggestions}
            />
          ) : (
            <InstalledMods analysis={analysis.mods} failures={analysis.failures} cacheHits={analysis.providerCacheHits} fetches={analysis.providerFetches} warning={analysis.providerWarning} />
          )}
        </div>
      )}
      {selectedTarget && !analysis && !analysisLoading && (
        <Card><CardContent className="p-8 text-center text-sm text-[var(--color-muted-foreground)]">No analysis yet. Scout reads mod JAR metadata only after you choose <strong>Analyze Pack</strong>.</CardContent></Card>
      )}
    </div>
  );
}

function CandidateSearch({ query, onQueryChange, onSearch, loading, error, result, canAddToSuggestions, addingProjectId, onAddToSuggestions }: {
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  loading: boolean;
  error: unknown;
  result: Recommendation[] | null;
  canAddToSuggestions: boolean;
  addingProjectId: string | null;
  onAddToSuggestions: (recommendation: Recommendation) => void;
}) {
  const pageSize = 20;
  const [scoreOrder, setScoreOrder] = useState<"desc" | "asc">("desc");
  const [statusFilters, setStatusFilters] = useState<Set<RecommendationStatus>>(() => new Set());
  const [page, setPage] = useState(1);
  const displayedResults = useMemo(() => {
    if (!result) return null;
    return result
      .filter((recommendation) => statusFilters.size === 0 || statusFilters.has(recommendation.status))
      .sort((left, right) => scoreOrder === "desc" ? right.score - left.score : left.score - right.score);
  }, [result, scoreOrder, statusFilters]);
  const pageCount = Math.max(1, Math.ceil((displayedResults?.length ?? 0) / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paginatedResults = displayedResults?.slice((currentPage - 1) * pageSize, currentPage * pageSize) ?? null;

  useEffect(() => setPage(1), [result, scoreOrder, statusFilters]);

  const toggleStatus = (status: RecommendationStatus) => {
    setStatusFilters((current) => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
            <div className="relative min-w-64 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
              <Input className="pl-9" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Try structures, farming, Create, performance..." aria-label="Candidate search" />
            </div>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button type="button" variant="outline" size="icon" aria-label="Filter recommendations" title="Filter recommendations">
                  <Filter className="h-4 w-4" />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-56 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-3 shadow-lg">
                  <DropdownMenu.Label className="text-xs font-medium text-[var(--color-muted-foreground)]">Score</DropdownMenu.Label>
                  <div className="mt-2 flex gap-2">
                    {[{ value: "desc", label: "Highest first" }, { value: "asc", label: "Lowest first" }].map((option) => (
                      <Button key={option.value} type="button" size="sm" variant={scoreOrder === option.value ? "default" : "outline"} className="h-7 rounded-full px-3 text-xs" onClick={() => setScoreOrder(option.value as "desc" | "asc")}>
                        {option.label}
                      </Button>
                    ))}
                  </div>
                  <DropdownMenu.Separator className="my-1 h-px bg-[var(--color-border)]" />
                  <DropdownMenu.Label className="mt-3 text-xs font-medium text-[var(--color-muted-foreground)]">Status</DropdownMenu.Label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(["ADD", "CONSIDER", "SKIP"] as RecommendationStatus[]).map((status) => (
                      <Button key={status} type="button" size="sm" variant={statusFilters.has(status) ? "default" : "outline"} className="h-7 rounded-full px-3 text-xs" onClick={() => toggleStatus(status)}>
                        {formatTag(status)}
                      </Button>
                    ))}
                  </div>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <Button type="submit" disabled={loading || query.trim().length < 2}>
              {loading && <RefreshCw className="h-4 w-4 animate-spin" />}
              {loading ? "Searching..." : "Search Modrinth"}
            </Button>
          </form>
          {error != null && <div className="mt-4"><ErrorMessage error={error} /></div>}
        </CardContent>
      </Card>
      {paginatedResults && displayedResults && (
        displayedResults.length === 0 ? (
          <Card><CardContent className="p-5 text-center text-sm text-[var(--color-muted-foreground)]">{result?.length === 0 ? "No compatible candidates matched this search." : "No recommendations match the selected filters."}</CardContent></Card>
        ) : (
          <>
            <div className="grid gap-3 lg:grid-cols-2">
              {paginatedResults.map((recommendation) => <RecommendationCard key={recommendation.candidate.projectId} recommendation={recommendation} canAddToSuggestions={canAddToSuggestions} adding={addingProjectId === recommendation.candidate.projectId} onAddToSuggestions={onAddToSuggestions} />)}
            </div>
            {pageCount > 1 && (
              <div className="flex items-center justify-center gap-3">
                <Button type="button" variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</Button>
                <span className="text-xs text-[var(--color-muted-foreground)]">Page {currentPage} of {pageCount}</span>
                <Button type="button" variant="outline" size="sm" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</Button>
              </div>
            )}
          </>
        )
      )}
    </>
  );
}

function RecommendationCard({ recommendation, canAddToSuggestions, adding, onAddToSuggestions }: { recommendation: Recommendation; canAddToSuggestions: boolean; adding: boolean; onAddToSuggestions: (recommendation: Recommendation) => void }) {
  const { candidate } = recommendation;
  const [warningsOpen, setWarningsOpen] = useState(false);
  const concerns = recommendation.concerns;
  return (
    <Card className="scout-recommendation-card group relative flex min-h-44 gap-4 rounded-md p-4 transition-[transform,border-color,box-shadow] duration-200">
      <div className="flex w-20 shrink-0 flex-col items-center gap-2 self-stretch text-center">
        {candidate.iconUrl ? <img src={candidate.iconUrl} alt="" className="h-16 w-16 rounded-md object-cover" /> : <div className="h-16 w-16 rounded-md bg-[var(--color-muted)]" />}
        <Badge variant={statusVariant(recommendation.status)} className={`w-16 justify-center !rounded-sm px-1 tracking-wide ${recommendation.status === "CONSIDER" ? "text-[9px]" : "text-[10px]"}`}>{recommendation.status}</Badge>
        <div className="flex flex-1 items-center justify-center text-4xl font-bold leading-none tracking-tight" style={{ fontFamily: '"Bahnschrift SemiCondensed", "Arial Narrow", sans-serif' }}>{recommendation.score}</div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="pr-24">
          <h3 className="font-medium">{candidate.title}</h3>
          <p className="text-xs text-[var(--color-muted-foreground)]">by {candidate.author}</p>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">{candidate.categories.slice(0, 4).map((category) => <Badge key={category} variant="secondary">{formatTag(category)}</Badge>)}</div>
        <p className="mt-3 flex-1 text-sm text-[var(--color-muted-foreground)]">{candidate.description}</p>
        <div className={`absolute right-3 top-3 flex gap-1 transition-opacity ${warningsOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"}`}>
          {concerns.length > 0 && <Button variant="ghost" size="icon" className="h-8 w-8 text-amber-300" onClick={() => setWarningsOpen((open) => !open)} aria-label={`${warningsOpen ? "Hide" : "Show"} concerns for ${candidate.title}`} aria-expanded={warningsOpen} title="Recommendation concerns"><TriangleAlert className="h-4 w-4" /></Button>}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openUrl(candidate.projectUrl)} aria-label={`View ${candidate.title} on Modrinth`} title="View on Modrinth"><ExternalLink className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={!canAddToSuggestions || adding} title={canAddToSuggestions ? "Add to Suggestions" : "Suggestions require a managed Modly instance"} onClick={() => onAddToSuggestions(recommendation)} aria-label={`Add ${candidate.title} to Suggestions`}>{adding ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}</Button>
        </div>
        {warningsOpen && <div className="absolute right-3 top-12 z-20 w-72 rounded-md border border-amber-400/35 bg-[var(--color-card)] p-3 shadow-xl"><p className="text-xs font-semibold text-amber-300">Concerns</p><ul className="mt-2 space-y-2 text-xs text-[var(--color-muted-foreground)]">{concerns.map((concern) => <li key={concern}>• {concern}</li>)}</ul></div>}
      </div>
    </Card>
  );
}

function statusVariant(status: RecommendationStatus): "success" | "warning" | "destructive" {
  if (status === "ADD") return "success";
  if (status === "CONSIDER") return "warning";
  return "destructive";
}

function formatTag(tag: string): string {
  const acronyms = new Set(["api", "qol", "rpg", "vr"]);
  return tag
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => acronyms.has(word.toLowerCase()) ? word.toUpperCase() : `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

function InstalledMods({ analysis, failures, cacheHits, fetches, warning }: { analysis: ScoutInstalledMod[]; failures: Array<{ fileName: string; message: string }>; cacheHits: number; fetches: number; warning: string | null }) {
  const mods = useMemo(() => [...analysis].sort((left, right) => left.metadata.name.localeCompare(right.metadata.name)), [analysis]);
  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3"><div><h2 className="font-semibold">Installed Mods</h2><p className="text-sm text-[var(--color-muted-foreground)]">JAR metadata enriched with exact-hash Modrinth categories. {cacheHits} cached, {fetches} fetched. No mod files were changed.</p></div><Badge variant="secondary">{mods.length} parsed</Badge></div>
        <div className="max-h-[34rem] overflow-auto">
          <table className="w-full text-left text-sm"><thead className="sticky top-0 bg-[var(--color-card)] text-xs text-[var(--color-muted-foreground)]"><tr><th className="px-4 py-3 font-medium">Mod</th><th className="px-4 py-3 font-medium">Version</th><th className="px-4 py-3 font-medium">Loader</th><th className="px-4 py-3 font-medium">Role</th><th className="px-4 py-3 font-medium">Modrinth categories</th><th className="px-4 py-3 font-medium">Dependencies</th></tr></thead><tbody>{mods.map((mod) => <tr key={mod.filePath} className="border-t border-[var(--color-border)]"><td className="px-4 py-3"><p className="font-medium">{mod.metadata.name}</p><p className="mt-0.5 font-mono text-xs text-[var(--color-muted-foreground)]">{mod.metadata.modId ?? mod.fileName}</p></td><td className="px-4 py-3">{mod.metadata.version}</td><td className="px-4 py-3">{formatLoader(mod.metadata.loader)}</td><td className="px-4 py-3"><Badge variant={mod.classification === "library" ? "secondary" : "default"}>{formatTag(mod.classification)}</Badge></td><td className="max-w-64 px-4 py-3 text-xs text-[var(--color-muted-foreground)]">{mod.providerMetadata?.categories.length ? mod.providerMetadata.categories.map(formatTag).join(", ") : "Not available"}</td><td className="max-w-72 px-4 py-3 text-xs text-[var(--color-muted-foreground)]">{mod.metadata.dependencies.length ? mod.metadata.dependencies.map((dependency) => dependency.modId).join(", ") : "—"}</td></tr>)}</tbody></table>
        </div>
        {warning && <div className="border-t border-yellow-500/30 bg-yellow-500/5 p-4 text-sm text-yellow-300">{warning}</div>}
        {failures.length > 0 && <div className="border-t border-yellow-500/30 bg-yellow-500/5 p-4"><div className="flex items-center gap-2 font-medium text-yellow-300"><TriangleAlert className="h-4 w-4" />{failures.length} JAR file{failures.length === 1 ? "" : "s"} could not be identified</div><ul className="mt-2 space-y-1 text-xs text-[var(--color-muted-foreground)]">{failures.map((failure) => <li key={failure.fileName}><span className="font-medium">{failure.fileName}:</span> {failure.message}</li>)}</ul></div>}
      </CardContent>
    </Card>
  );
}

function ErrorMessage({ error }: { error: unknown }) {
  return <Card className="border-red-500/40"><CardContent className="flex items-center gap-2 p-4 text-sm text-red-300"><TriangleAlert className="h-4 w-4" />{error instanceof Error ? error.message : String(error)}</CardContent></Card>;
}
