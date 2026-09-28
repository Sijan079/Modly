import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { RefreshCw, ScanSearch, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageShell } from "@/components/layout/PageShell";
import { ThemedSelect } from "@/components/ui/themed-select";
import { ScoutRecommendations } from "@/components/scout/ScoutRecommendations";
import { useInstances } from "@/hooks/useInstances";
import { useModSuggestions, useUpsertModSuggestion } from "@/hooks/useMods";
import { useAnalyzeScoutTarget, useCreateScoutInstanceTarget, useDiscoverScoutCandidates, useScoutAnalysis, useScoutRecommendations, useScoutTargets, useSearchScoutCandidates } from "@/hooks/useScout";
import type { Recommendation, ScoutInstalledMod } from "@/lib/types";
import { api } from "@/lib/api";
import { isScoutAnalysisCurrent, scoutPackHealth } from "@/lib/scout-evidence";
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
  const queryClient = useQueryClient();
  const [candidateQuery, setCandidateQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"recommendations" | "installed">("recommendations");
  const [addingProjectId, setAddingProjectId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const selectedTarget = targets.find((target) => target.id === targetId) ?? null;
  const selectedInstance = instances.find((instance) => instance.id === selectedTarget?.instanceId) ?? null;
  const { data: suggestions = [] } = useModSuggestions(selectedTarget?.instanceId ?? null);
  const { data: decisions = [], refetch: refetchDecisions } = useQuery({
    queryKey: ["scout-decisions", targetId], enabled: !!targetId,
    queryFn: () => targetId ? api.scout.listDecisions(targetId) : [],
  });
  const { data: savedAnalysis = null, isLoading: analysisLoading } = useScoutAnalysis(targetId);
  const { data: savedRecommendations = null, isLoading: recommendationsLoading } = useScoutRecommendations(targetId);
  const analysis = analyze.data?.targetId === targetId ? analyze.data : savedAnalysis;
  const { data: truth, error: truthError } = useQuery({
    queryKey: ["scout-truth", selectedInstance?.id, analysis?.id], enabled: !!selectedInstance,
    queryFn: () => api.mods.truth(selectedInstance!.id),
  });
  const analysisCurrent = truth && analysis ? isScoutAnalysisCurrent(truth, analysis) : null;

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
  }, [targetId, analysis?.id]);

  useEffect(() => {
    if (!targetId || !analysis || analysisCurrent !== true || recommendationsLoading || savedRecommendations || discoverCandidates.isPending) return;
    discoverCandidates.mutate(targetId);
  }, [targetId, analysis?.id, analysisCurrent, recommendationsLoading, savedRecommendations]);

  const suggestedProjects = useMemo(
    () => new Set(suggestions.map((suggestion) => parseModSourceUrl(suggestion.sourceUrl)?.project).filter((project): project is string => !!project)),
    [suggestions],
  );
  const recommendationResult = candidateSearch.data ?? savedRecommendations;
  const visibleRecommendations = recommendationResult?.recommendations ?? null;
  const health = useMemo(() => truth && selectedInstance ? scoutPackHealth(truth, selectedInstance) : null, [truth, selectedInstance]);

  const selectInstance = (value: string) => {
    if (value === instanceId) return;
    targetRequestInstanceId.current = null;
    setTargetId(null);
    setSelectedInstance(value || null);
  };

  const searchCandidates = () => {
    if (!targetId || analysisCurrent !== true || candidateQuery.trim().length < 2) return;
    candidateSearch.mutate({ targetId, query: candidateQuery.trim() });
  };

  const addToSuggestions = async (recommendation: Recommendation) => {
    if (!selectedTarget?.instanceId) return;
    const { candidate } = recommendation;
    setAddingProjectId(candidate.projectId);
    setActionError(null);
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
    } catch (error) {
      setActionError(String(error));
    } finally {
      setAddingProjectId(null);
    }
  };

  const setDecision = async (projectId: string, decision: "rejected" | "clear") => {
    if (!targetId) return;
    await api.scout.setDecision(targetId, projectId, decision);
    await refetchDecisions();
    await queryClient.invalidateQueries({ queryKey: ["scout-recommendations", targetId] });
  };

  return (
    <div className="flex flex-col gap-5">
      <PageShell
        title="Discover"
        description="Analyze installed mods, find compatible additions, and save ideas for review."
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
            <Button variant="outline" asChild><Link to="/mod-suggestions">Saved suggestions</Link></Button>
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
            <ScoutRecommendations
              query={candidateQuery}
              onQueryChange={setCandidateQuery}
              onSearch={searchCandidates}
              loading={candidateSearch.isPending || discoverCandidates.isPending}
              canSearch={analysisCurrent === true}
              error={candidateSearch.error ?? discoverCandidates.error ?? upsertSuggestion.error ?? actionError}
              result={visibleRecommendations}
              truth={analysisCurrent ? truth ?? null : null}
              analysis={analysis}
              instance={selectedInstance}
              decisions={decisions}
              savedProjects={suggestedProjects}
              health={health}
              truthError={truthError ?? (analysisCurrent === false ? "The pack changed since this Scout analysis. Analyze Pack again to refresh recommendation evidence." : null)}
              canSave={!!selectedTarget?.instanceId && analysisCurrent === true}
              addingProjectId={addingProjectId}
              onSave={addToSuggestions}
              onDecision={setDecision}
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

function formatTag(tag: string): string {
  return tag.split(/[-_\s]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
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
