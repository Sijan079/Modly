import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { FileSearch } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/layout/PageShell";
import { CrashResult, CommunityResults } from "@/components/crash/CrashInvestigationResult";
import { Card, CardContent } from "@/components/ui/card";
import { ThemedSelect } from "@/components/ui/themed-select";
import { useInstances } from "@/hooks/useInstances";
import { useAppStore } from "@/store/app";
import { api } from "@/lib/api";
import type { CrashAnalysis, CommunitySearchResult } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export function LogsPage() {
  const queryClient = useQueryClient();
  const { data: instances = [] } = useInstances();
  const { selectedInstanceId, setSelectedInstance } = useAppStore();
  const instance = instances.find((item) => item.id === selectedInstanceId) ?? instances[0];
  const [active, setActive] = useState<CrashAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [community, setCommunity] = useState<CommunitySearchResult | null>(null);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const [searchingCommunity, setSearchingCommunity] = useState(false);
  const { data: saved, isPending: loadingSaved, error: savedError, refetch: reloadSaved } = useQuery({
    queryKey: ["crash-latest", instance?.id],
    enabled: !!instance,
    queryFn: () => api.crash.latest(instance!.id),
  });
  const analysis = active?.instanceId === instance?.id ? active : saved;
  const chooseReport = async () => {
    if (!instance || analyzing) return;
    try {
      const path = await open({ multiple: false, filters: [{ name: "Minecraft crash report or log", extensions: ["txt", "log"] }] });
      if (!path || typeof path !== "string") return;
      setAnalyzing(true);
      setAnalysisError(null);
      const result = await api.crash.analyze(instance.id, path);
      setActive(result);
      setCommunity(null);
      setCommunityError(null);
      await queryClient.invalidateQueries({ queryKey: ["crash-latest", instance.id] });
    } catch (error) {
      setAnalysisError(String(error));
    } finally {
      setAnalyzing(false);
    }
  };
  const findCommunityReports = async () => {
    if (!instance || !analysis || searchingCommunity) return;
    setSearchingCommunity(true);
    setCommunityError(null);
    try {
      setCommunity(await api.crash.community(instance.id, analysis.fingerprint));
    } catch (error) {
      setCommunityError(String(error));
    } finally {
      setSearchingCommunity(false);
    }
  };
  const { data: logs = [], isLoading, refetch } = useQuery({
    queryKey: ["logs"],
    queryFn: () => api.files.logs(2000),
    refetchInterval: 5000,
  });
  const weeklyLogs = useMemo(() => {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return logs.filter((log) => {
      const timestamp = new Date(log.createdAt).getTime();
      return Number.isFinite(timestamp) && timestamp >= oneWeekAgo;
    });
  }, [logs]);

  return (
    <div className="space-y-6">
      <PageShell
        title="Logs"
        description="Investigate a Minecraft crash locally and review Modly activity."
      />

      <section aria-labelledby="crash-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 id="crash-heading" className="text-lg font-semibold">Crash investigation</h2>
            <p className="text-sm text-[var(--color-muted-foreground)]">Select a crash report or log. Analysis stays on this device and identifies leads to investigate, not a root cause.</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="crash-instance" className="text-sm">Instance</label>
            <ThemedSelect id="crash-instance" value={instance?.id ?? ""} options={instances.map((item) => ({ value: item.id, label: item.name }))} onValueChange={setSelectedInstance} />
            <Button onClick={() => void chooseReport()} disabled={!instance || analyzing}><FileSearch aria-hidden="true" className="h-4 w-4" />{analyzing ? "Analyzing..." : "Choose report"}</Button>
          </div>
        </div>
        {analysisError && <Card><CardContent className="pt-5 text-sm" role="alert">Could not analyze this file: {analysisError} Select a valid report and try again.</CardContent></Card>}
        {analyzing ? <p role="status" aria-busy="true" className="text-sm text-[var(--color-muted-foreground)]">Reading the report and checking the local pack...</p> : !instance ?
          <Card><CardContent className="pt-5 text-sm">Add an instance before investigating a crash.</CardContent></Card> :
          loadingSaved ? <p role="status" className="text-sm text-[var(--color-muted-foreground)]">Loading saved investigation...</p> :
          savedError ? <Card><CardContent className="flex flex-wrap items-center gap-3 pt-5 text-sm" role="alert">Could not load the saved investigation. <Button variant="outline" onClick={() => void reloadSaved()}>Try again</Button></CardContent></Card> :
          analysis ? <><CrashResult analysis={analysis} />
            <section aria-labelledby="community-heading" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 id="community-heading" className="font-semibold">Community reports</h3><p className="text-sm text-[var(--color-muted-foreground)]">Search issue trackers for up to five local investigation candidates. Reports are supporting evidence only.</p></div>
                <Button variant="outline" onClick={() => void findCommunityReports()} disabled={searchingCommunity || analysis.candidates.length === 0}>{searchingCommunity ? "Searching..." : "Search community reports"}</Button></div>
              {communityError && <Card><CardContent className="pt-5 text-sm" role="alert">Could not search community reports: {communityError} Reanalyze the report if the pack changed, then try again.</CardContent></Card>}
              {searchingCommunity && <p role="status" aria-busy="true" className="text-sm text-[var(--color-muted-foreground)]">Checking provider issue links and relevant GitHub issues...</p>}
              {community?.fingerprint === analysis.fingerprint && <CommunityResults result={community} analysis={analysis} />}
            </section>
          </> :
          <Card><CardContent className="pt-5 text-sm text-[var(--color-muted-foreground)]">No saved investigation for this instance. Choose a Minecraft crash report or latest.log to begin.</CardContent></Card>}
      </section>

      <section aria-labelledby="activity-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-2"><h2 id="activity-heading" className="text-lg font-semibold">Modly activity · last 7 days</h2>
          <Button variant="outline" onClick={() => void refetch()}>Refresh activity</Button></div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
        <ScrollArea className="h-[calc(100vh-220px)]">
          {isLoading ? (
            <LogSkeleton />
          ) : weeklyLogs.length === 0 ? (
            <p className="p-4 text-[var(--color-muted-foreground)]">
              No activity in the last 7 days
            </p>
          ) : (
            <div className="divide-y divide-[var(--color-border)] font-mono text-xs">
              {weeklyLogs.map((log) => (
                <div key={log.id} className="flex gap-3 px-4 py-2 hover:bg-[var(--color-muted)]/30">
                  <span className="shrink-0 text-[var(--color-muted-foreground)]">
                    {formatDate(log.createdAt)}
                  </span>
                  <LevelBadge level={log.level} />
                  <span className="flex-1 break-all">{log.message}</span>
                  {log.context && (
                    <span className="text-[var(--color-muted-foreground)]">
                      [{log.context}]
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
      </section>
    </div>
  );
}

function LogSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading logs" className="divide-y divide-[var(--color-border)] p-1">
      {Array.from({ length: 12 }, (_, index) => (
        <div key={index} className="flex gap-3 px-3 py-3"><Skeleton className="h-3 w-28 shrink-0" /><Skeleton className="h-5 w-12 shrink-0" /><Skeleton className="h-3 flex-1" /></div>
      ))}
    </div>
  );
}

function LevelBadge({ level }: { level: string }) {
  const variant =
    level === "error"
      ? "destructive"
      : level === "warn"
        ? "warning"
        : level === "info"
          ? "default"
          : "secondary";

  return (
    <Badge variant={variant as "default"} className="shrink-0 uppercase">
      {level}
    </Badge>
  );
}
