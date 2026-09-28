import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { changeFindings } from "@/lib/change-plan";
import type { ChangePlan, ChangeRequest, Instance } from "@/lib/types";

export function ChangePlanDialog({ requests, instance, onClose, onApplied }: {
  requests: ChangeRequest[];
  instance: Instance | null;
  onClose: () => void;
  onApplied?: () => void;
}) {
  const queryClient = useQueryClient();
  const [index, setIndex] = useState(0);
  const [plan, setPlan] = useState<ChangePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(0);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const request = requests[index];
  const findings = useMemo(() => plan && instance ? changeFindings(plan, instance) : [], [plan, instance]);

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    api.changes.preview(request).then((result) => {
      if (cancelled) void api.changes.discard(result.id);
      else setPlan(result);
    }).catch((cause) => {
      if (!cancelled) setError(String(cause));
    }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [request, index]);

  const close = () => {
    if (busy) return;
    if (plan) void api.changes.discard(plan.id);
    onClose();
  };
  const apply = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.changes.apply(plan.id);
      if (!result.verified) throw new Error("Post-change verification did not complete.");
      setLastBackup(result.backupId);
      setCompleted((count) => count + 1);
      await queryClient.invalidateQueries();
      onApplied?.();
      setPlan(null);
      setIndex((current) => current + 1);
    } catch (cause) {
      setError(String(cause));
      setPlan(null);
    } finally {
      setBusy(false);
    }
  };
  const restore = async () => {
    if (!instance || !lastBackup) return;
    setBusy(true);
    try {
      const result = await api.changes.restore(instance.id, lastBackup);
      if (!result.verified) throw new Error("Restore could not be verified.");
      await queryClient.invalidateQueries();
      setLastBackup(null);
      setError(result.warnings.join(" ") || null);
      onApplied?.();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  const name = (path: string) => path.split(/[\\/]/).pop() ?? path;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review mod change</DialogTitle>
          <DialogDescription>
            {request ? `Change ${index + 1} of ${requests.length}. Review the exact file operation and dependency impact.` : `${completed} change${completed === 1 ? "" : "s"} applied and verified.`}
          </DialogDescription>
        </DialogHeader>
        {busy && <p className="text-sm text-[var(--color-muted-foreground)]">{plan ? "Applying and rescanning…" : "Validating candidate and preparing review…"}</p>}
        {error && <div role="alert" className="rounded-md border border-[var(--color-destructive)] p-3 text-sm text-[var(--color-destructive)]">{error}{completed > 0 && <p>{completed} earlier change(s) succeeded; review the pack before retrying.</p>}{error.includes("Backup ID") && <p className="mt-2">Open Mods → Tools → Restore mod change to inspect the saved recovery point.</p>}</div>}
        {plan && <div className="space-y-4 text-sm">
          <div className="rounded-md border border-[var(--color-border)] p-3">
            <div className="mb-2 flex items-center gap-2"><Badge>{plan.kind}</Badge><strong>{plan.candidate?.name ?? (plan.oldFilePath ? name(plan.oldFilePath) : "Mod")}</strong></div>
            {plan.oldFilePath && <p>Remove from pack: <code className="break-all">{plan.oldFilePath}</code></p>}
            {plan.newFilePath && <p>Install in pack: <code className="break-all">{plan.newFilePath}</code></p>}
            {plan.backupPath && <p>Original backup: <code className="break-all">{plan.backupPath}</code></p>}
            {plan.sourceSha256 && <p>Candidate SHA-256: <code className="break-all">{plan.sourceSha256}</code></p>}
          </div>
          {plan.candidate && <p>Manifest: {plan.candidate.modId ?? "unknown ID"} · {plan.candidate.version} · {plan.candidate.loader} loader</p>}
          {plan.directDependents.length > 0 && <div><strong>Direct dependents</strong><ul className="ml-5 list-disc">{plan.directDependents.map((path) => <li key={path}>{name(path)}</li>)}</ul></div>}
          {plan.transitiveDependents.length > 0 && <div><strong>Transitive dependency paths</strong><ul className="ml-5 list-disc">{plan.transitiveDependents.map((path) => <li key={path.join("|")}>{path.map(name).join(" → ")}</li>)}</ul></div>}
          <div><strong>Candidate and newly introduced findings</strong>
            {findings.length ? <ul className="mt-2 space-y-2">{findings.map((finding) => <li key={finding.id} className="rounded-md border border-[var(--color-border)] p-2"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{finding.title} <Badge variant="outline">{finding.severity}</Badge></span><p className="text-[var(--color-muted-foreground)]">{finding.detail}</p></li>)}</ul> : <p className="mt-1 text-[var(--color-muted-foreground)]">No static compatibility or dependency findings for this change.</p>}
          </div>
          <p className="rounded-md border border-[var(--color-border)] p-2 text-[var(--color-muted-foreground)]">Dependency checks use local manifests and instance settings. World and save safety cannot be determined here. Review your world backup before continuing.</p>
        </div>}
        {!request && !error && <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4" />Pack files were rescanned and verified.</p>}
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={close}>{request ? "Cancel" : "Close"}</Button>{lastBackup && <Button variant="outline" disabled={busy} onClick={restore}>Restore last change</Button>}{plan && <Button disabled={busy} onClick={apply}>Apply {plan.kind}</Button>}</div>
      </DialogContent>
    </Dialog>
  );
}
