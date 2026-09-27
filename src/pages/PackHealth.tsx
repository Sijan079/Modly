import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Activity, RefreshCw } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemedSelect } from "@/components/ui/themed-select";
import { useInstances } from "@/hooks/useInstances";
import { api } from "@/lib/api";
import { analyzePackHealth, type HealthCategory, type HealthFinding } from "@/lib/pack-health";
import { useAppStore } from "@/store/app";

const categories: HealthCategory[] = ["Compatibility", "Dependencies", "Integrity", "Updates", "Orphans", "Metadata"];
const certaintyLabel = {
  confirmed: "Confirmed locally",
  knownIncompatibility: "Known incompatibility",
  possible: "Possible relationship",
  unknown: "Insufficient evidence",
};

export function PackHealthPage() {
  const { data: instances = [] } = useInstances();
  const { selectedInstanceId, setSelectedInstance } = useAppStore();
  const instance = instances.find((item) => item.id === selectedInstanceId) ?? instances[0];
  const [category, setCategory] = useState<HealthCategory | "All">("All");
  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: ["pack-health", instance?.id, instance?.loader, instance?.mcVersion],
    enabled: !!instance,
    queryFn: async () => {
      const [truth, updates, archiveIssues] = await Promise.all([api.mods.truth(instance!.id), api.updates.latest(instance!.id), api.mods.healthIntegrity(instance!.id)]);
      return analyzePackHealth(truth, instance!, updates, archiveIssues);
    },
    staleTime: 0,
  });
  const visible = useMemo(() => data?.findings.filter((finding) => category === "All" || finding.category === category) ?? [], [data, category]);
  const counts = useMemo(() => ({
    errors: data?.findings.filter((finding) => finding.severity === "error").length ?? 0,
    warnings: data?.findings.filter((finding) => finding.severity === "warning").length ?? 0,
    unknown: data?.findings.filter((finding) => finding.certainty === "unknown").length ?? 0,
  }), [data]);

  return <div className="space-y-6">
    <PageShell title="Pack Health" description="Local evidence from enabled JARs, declared relationships, and the last saved provider update check."
      controls={<>
        <label className="text-sm" htmlFor="health-instance">Instance</label>
        <ThemedSelect id="health-instance" value={instance?.id ?? ""} options={instances.map((item) => ({ value: item.id, label: item.name }))} onValueChange={setSelectedInstance} />
        <Button variant="outline" onClick={() => void refetch()} disabled={!instance || isFetching}><RefreshCw aria-hidden="true" className="h-4 w-4" />{isFetching ? "Scanning..." : "Rescan"}</Button>
      </>}/>
    {!instance ? <Card><CardContent className="pt-6 text-sm">Add an instance to inspect its pack health.</CardContent></Card> :
      error ? <Card><CardContent className="pt-6 text-sm" role="alert">Could not scan this pack: {String(error)}</CardContent></Card> :
      isPending ? <p role="status" className="text-sm text-[var(--color-muted-foreground)]">Scanning local mod metadata...</p> : <>
        <Card><CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap items-center gap-2"><Activity aria-hidden="true" className="h-5 w-5 text-[var(--color-primary)]" /><strong className="text-base">{data.checkedMods} enabled mods checked</strong><Badge variant="destructive">{counts.errors} errors</Badge><Badge variant="warning">{counts.warnings} warnings</Badge><Badge variant="outline">{counts.unknown} unknowns</Badge></div>
          <p className="text-sm text-[var(--color-muted-foreground)]">No detected findings does not guarantee that a pack is safe or will launch. Unsupported metadata and unobserved runtime behavior remain unknown. Disabled JARs are excluded.</p>
        </CardContent></Card>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter health findings">
          {(["All", ...categories] as const).map((item) => <Button key={item} variant={category === item ? "secondary" : "outline"} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}{item !== "All" ? ` (${data.findings.filter((finding) => finding.category === item).length})` : ""}</Button>)}
        </div>
        {visible.length === 0 ? <Card><CardContent className="pt-6 text-sm text-[var(--color-muted-foreground)]">No findings in this category. This does not confirm compatibility.</CardContent></Card> :
          <div className="space-y-3">{visible.map((finding) => <FindingCard key={finding.id} finding={finding} instanceId={instance.id} />)}</div>}
      </>}
  </div>;
}

function FindingCard({ finding, instanceId }: { finding: HealthFinding; instanceId: string }) {
  const [showRelationships, setShowRelationships] = useState(false);
  const { data: relationships, error: relationshipError, isPending: relationshipsPending } = useQuery({
    queryKey: ["health-relationships", instanceId, finding.filePaths[0]],
    queryFn: () => api.mods.truthRelationships(instanceId, finding.filePaths[0]),
    enabled: showRelationships && finding.filePaths.length > 0,
  });
  const variant = finding.severity === "error" ? "destructive" : finding.severity === "warning" ? "warning" : "outline";
  return <Card><CardContent className="space-y-3 pt-5">
    <div className="flex flex-wrap items-center gap-2"><Badge variant={variant}>{finding.severity}</Badge><Badge variant="outline">{certaintyLabel[finding.certainty]}</Badge><span className="text-xs text-[var(--color-muted-foreground)]">{finding.category}</span></div>
    <div><h3 className="font-semibold">{finding.title}</h3><p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{finding.detail}</p></div>
    <div className="rounded-md bg-[var(--color-muted)] p-3 text-sm"><strong>Evidence</strong><ul className="mt-1 list-disc space-y-1 pl-5 break-all">{finding.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul></div>
    <p className="text-sm"><strong>Next step:</strong> {finding.remediation}</p>
    <div className="flex flex-wrap gap-3 text-sm">
      {finding.filePaths.map((path, index) => <Link className="text-[var(--color-primary)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]" key={path} to={`/mods?mod=${encodeURIComponent(path)}`}>View {index === 0 ? "mod" : "affected mod"}</Link>)}
      {finding.filePaths.length > 0 && <Button variant="outline" aria-expanded={showRelationships} onClick={() => setShowRelationships((value) => !value)}>{showRelationships ? "Hide" : "View"} declared relationships</Button>}
      {finding.category === "Updates" && <Link className="text-[var(--color-primary)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]" to="/updates">Review update</Link>}
    </div>
    {showRelationships && <div className="rounded-md border border-[var(--color-border)] p-3 text-sm">
      <strong>Declared relationships for {finding.filePaths[0]}</strong>
      {relationshipsPending ? <p role="status">Loading relationships...</p> : relationshipError ? <p role="alert">Could not load relationships: {String(relationshipError)}</p> : relationships ? <>
        <p className="mt-2 text-[var(--color-muted-foreground)]">Requires or references</p>
        <ul className="list-disc pl-5">{relationships.outgoing.length ? relationships.outgoing.map((edge, index) => <li key={index}>{edge.kind}: {edge.targetModId}{edge.versionRange ? ` (${edge.versionRange})` : ""} - {edge.resolution}</li>) : <li>None declared</li>}</ul>
        <p className="mt-2 text-[var(--color-muted-foreground)]">Referenced by</p>
        <ul className="list-disc pl-5">{relationships.incoming.length ? relationships.incoming.map((edge, index) => <li key={index}>{edge.kind}: {edge.sourceFilePath}</li>) : <li>None detected</li>}</ul>
      </> : null}
    </div>}
  </CardContent></Card>;
}
