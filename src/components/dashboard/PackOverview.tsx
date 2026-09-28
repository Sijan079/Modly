import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { analyzePackHealth, type HealthCategory } from "@/lib/pack-health";
import type { Instance } from "@/lib/types";

const categories: HealthCategory[] = ["Compatibility", "Dependencies", "Integrity", "Updates", "Metadata"];

export function PackOverview({ instance }: { instance: Instance }) {
  const health = useQuery({
    queryKey: ["pack-health", instance.id, instance.loader, instance.mcVersion],
    queryFn: async () => {
      const [truth, updates, archiveIssues] = await Promise.all([api.mods.truth(instance.id), api.updates.latest(instance.id), api.mods.healthIntegrity(instance.id)]);
      return analyzePackHealth(truth, instance, updates, archiveIssues);
    },
    staleTime: 60_000,
  });
  const crash = useQuery({ queryKey: ["crash-latest", instance.id], queryFn: () => api.crash.latest(instance.id) });

  return <section aria-labelledby="pack-overview-heading" className="space-y-3">
    <div><h2 id="pack-overview-heading" className="text-lg font-semibold">Pack overview</h2><p className="text-sm text-[var(--color-muted-foreground)]">Local findings and the latest saved diagnostic. Counts are evidence to review, not a guarantee of pack safety.</p></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {categories.map((category) => {
        const findings = health.data?.findings.filter((finding) => finding.category === category) ?? [];
        const errors = findings.filter((finding) => finding.severity === "error").length;
        return <Card key={category}><CardHeader className="pb-2"><CardTitle className="text-sm"><Link className="hover:underline" to={`/health?category=${category}`}>{category}</Link></CardTitle></CardHeader><CardContent className="flex items-center gap-2 text-sm">{health.isPending ? "Checking..." : health.error ? "Scan unavailable" : <><Badge variant={errors ? "destructive" : findings.length ? "warning" : "outline"}>{findings.length} findings</Badge>{errors > 0 && <span>{errors} errors</span>}</>}</CardContent></Card>;
      })}
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm"><Link className="hover:underline" to="/logs">Recent Diagnostics</Link></CardTitle></CardHeader><CardContent className="text-sm">{crash.isPending ? "Loading..." : crash.error ? "Unavailable" : crash.data ? <><Badge variant="outline">Saved crash analysis</Badge><p className="mt-2 truncate text-[var(--color-muted-foreground)]">{crash.data.exceptionType ?? "Exception unknown"} · {crash.data.candidates.length} investigation leads</p></> : "No saved crash investigation"}</CardContent></Card>
    </div>
  </section>;
}
