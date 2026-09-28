import { Link } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { CrashAnalysis, CommunitySearchResult } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export function CrashResult({ analysis, current }: { analysis: CrashAnalysis; current: boolean }) {
  return <div className="space-y-4">
    <Card><CardContent className="space-y-3 pt-5">
      <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">Local analysis</Badge><span className="text-xs text-[var(--color-muted-foreground)]">{formatDate(analysis.analyzedAt)}</span></div>
      <p className="break-all text-sm text-[var(--color-muted-foreground)]">Report: {analysis.sourcePath}</p>
      <p className="text-xs text-[var(--color-muted-foreground)]">Saved snapshot. Choose the report again to check it against the current pack.</p>
      <div><h3 className="font-semibold">{analysis.exceptionType ?? "Exception type unknown"}</h3><p className="break-words text-sm">{analysis.exceptionMessage ?? "No exception message extracted."}</p></div>
      <div className="flex flex-wrap gap-2 text-xs"><Badge variant="secondary">Minecraft {analysis.minecraftVersion ?? "unknown"}</Badge><Badge variant="secondary">Loader {analysis.loader ?? "unknown"}{analysis.loaderVersion ? ` ${analysis.loaderVersion}` : ""}</Badge><Badge variant="outline">{analysis.stackFrames.length} stack frames</Badge></div>
      {analysis.mentionedModIds.length > 0 && <p className="text-xs">Explicit mod IDs: {analysis.mentionedModIds.join(", ")}</p>}
      {analysis.stackNamespaces.length > 0 && <p className="break-all text-xs text-[var(--color-muted-foreground)]">Stack namespaces: {analysis.stackNamespaces.slice(0, 8).join(", ")}{analysis.stackNamespaces.length > 8 ? "…" : ""}</p>}
      {analysis.environment.length > 0 && <dl className="grid gap-2 text-xs sm:grid-cols-2">{analysis.environment.map((item) => <div key={item.label}><dt className="text-[var(--color-muted-foreground)]">{item.label}</dt><dd className="break-all">{item.value}</dd></div>)}</dl>}
    </CardContent></Card>
    <div className="space-y-2"><h3 className="font-semibold">Worth investigating ({analysis.candidates.length})</h3>
      {analysis.candidates.length === 0 ? <Card><CardContent className="pt-5 text-sm">Insufficient evidence to connect the report to an installed mod.</CardContent></Card> :
        analysis.candidates.map((candidate) => <Card key={candidate.filePath}><CardContent className="space-y-2 pt-5">
          <div className="flex flex-wrap justify-between gap-2"><h4 className="font-medium">{candidate.name}</h4><div className="flex flex-wrap gap-3 text-sm"><Link className="text-[var(--color-primary)] hover:underline" to={`/mods?mod=${encodeURIComponent(candidate.filePath)}`}>View mod</Link>{current && <><Link className="text-[var(--color-primary)] hover:underline" to={`/mods?mod=${encodeURIComponent(candidate.filePath)}&plan=remove&crash=${encodeURIComponent(analysis.fingerprint)}`}>Review removal impact</Link><Link className="text-[var(--color-primary)] hover:underline" to={`/updates?mod=${encodeURIComponent(candidate.filePath)}&crash=${encodeURIComponent(analysis.fingerprint)}`}>Check updates</Link></>}</div></div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-muted-foreground)]">{candidate.evidence.map((reason) => <li key={reason} className="break-all">{reason}</li>)}</ul>
        </CardContent></Card>)}
    </div>
    {analysis.recentChanges.length > 0 && <Card><CardContent className="space-y-2 pt-5 text-sm"><h3 className="font-semibold">Recent Modly changes · context only</h3><ul className="list-disc pl-5">{analysis.recentChanges.map((item) => <li key={item} className="break-all">{item}</li>)}</ul></CardContent></Card>}
    <Card><CardContent className="space-y-2 pt-5 text-sm"><h3 className="font-semibold">Unmapped stack frames ({analysis.unmappedFrames.length})</h3>
      {analysis.unmappedFrames.length ? <ul className="max-h-40 list-disc space-y-1 overflow-auto pl-5 font-mono text-xs">{analysis.unmappedFrames.map((frame, index) => <li key={`${frame}-${index}`} className="break-all">{frame}</li>)}</ul> : <p className="text-[var(--color-muted-foreground)]">No unmapped frames in the extracted trace.</p>}
    </CardContent></Card>
  </div>;
}

export function CommunityResults({ result, analysis, current }: { result: CommunitySearchResult; analysis: CrashAnalysis; current: boolean }) {
  const authorityLabel = {
    maintainerLabeled: "Repository-labeled issue",
    duplicate: "Marked duplicate",
    similar: "Similar community report",
    unverified: "Unverified report",
  };
  return <div className="space-y-3">
    <p className="text-sm" role="status">{result.reports.length} similar {result.reports.length === 1 ? "report" : "reports"} found · {result.fromCache ? "cached results" : "checked now"}. Open the original issue to verify context.</p>
    {result.warnings.length > 0 && <Card><CardContent className="space-y-1 pt-5 text-sm" role="status">{result.warnings.map((warning) => <p key={warning}>{warning}</p>)}</CardContent></Card>}
    {result.reports.length === 0 && <Card><CardContent className="pt-5 text-sm text-[var(--color-muted-foreground)]">No matching GitHub issues were found. You can review the issue trackers below or continue with the local crash evidence.</CardContent></Card>}
    {result.reports.map((issue) => {
      const candidate = analysis.candidates.find((item) => item.filePath === issue.candidateFilePath);
      return <Card key={`${issue.candidateFilePath}-${issue.url}`}><CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{authorityLabel[issue.authority]}</Badge><span className="text-xs text-[var(--color-muted-foreground)]">{candidate?.name ?? "Candidate"} · #{issue.number} · {issue.state}</span></div>
        <h4 className="font-medium">{issue.title}</h4>
        <div className="grid gap-3 text-sm sm:grid-cols-2"><div><strong>Similarities</strong><ul className="mt-1 list-disc pl-5">{issue.similarities.map((value) => <li key={value}>{value}</li>)}</ul></div>
          <div><strong>Differences</strong>{issue.differences.length ? <ul className="mt-1 list-disc pl-5">{issue.differences.map((value) => <li key={value}>{value}</li>)}</ul> : <p className="mt-1 text-[var(--color-muted-foreground)]">None detected in the issue text.</p>}</div></div>
        <p className="text-xs text-[var(--color-muted-foreground)]">Similarity does not confirm the cause of this crash.</p>
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void openUrl(issue.url)}>View original issue</Button>{issue.duplicateOf && <Button variant="ghost" onClick={() => void openUrl(issue.duplicateOf!)}>View referenced report</Button>}{current && issue.authority === "maintainerLabeled" && <Button variant="outline" asChild><Link to={`/updates?mod=${encodeURIComponent(issue.candidateFilePath)}&crash=${encodeURIComponent(analysis.fingerprint)}`}>Check compatible update</Link></Button>}</div>
      </CardContent></Card>;
    })}
    {result.sources.filter((source) => source.issueUrl).length > 0 && <div className="space-y-1 text-sm"><h4 className="font-medium">Issue sources checked</h4>{result.sources.filter((source) => source.issueUrl).map((source) => <div key={source.filePath} className="flex flex-wrap items-center gap-2"><span>{analysis.candidates.find((item) => item.filePath === source.filePath)?.name ?? source.filePath}</span><Badge variant="outline">{source.status}</Badge><Button variant="ghost" onClick={() => void openUrl(source.issueUrl!)}>Open issue tracker</Button></div>)}</div>}
  </div>;
}
