import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Download,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { PageSearchBar } from "@/components/layout/PageSearchBar";
import { PageToolbar } from "@/components/layout/PageToolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PlatformLinkButton } from "@/components/ui/platform-link-button";
import { Progress } from "@/components/ui/progress";
import { useInstances } from "@/hooks/useInstances";
import {
  useConfirmUpdateMatch,
  useUpdateModFromModrinth,
} from "@/hooks/useUpdates";
import { api } from "@/lib/api";
import { useAppStore } from "@/store/app";
import type {
  UpdateCandidate,
  UpdateItemType,
  UpdateRow,
  UpdateStatus,
  UpdateTarget,
} from "@/lib/types";

type StatusFilter = "all" | UpdateStatus;
type CheckProgress = {
  active: boolean;
  current: number;
  total: number;
  fileName: string;
};
type UpdateProgress = {
  active: boolean;
  current: number;
  total: number;
  fileName: string;
  label: string;
};

export function UpdatesPage() {
  const { data: instances = [] } = useInstances();
  const { selectedInstanceId, setSelectedInstance } = useAppStore();
  const instanceId = selectedInstanceId ?? instances[0]?.id ?? null;
  const selectedInstance = instances.find((instance) => instance.id === instanceId) ?? null;
  const confirmMatch = useConfirmUpdateMatch();
  const updateMod = useUpdateModFromModrinth();
  const cancelCheckRef = useRef(false);

  const [rows, setRows] = useState<UpdateRow[]>([]);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeRow, setActiveRow] = useState<UpdateRow | null>(null);
  const [checkProgress, setCheckProgress] = useState<CheckProgress>({
    active: false,
    current: 0,
    total: 0,
    fileName: "",
  });
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress>({
    active: false,
    current: 0,
    total: 0,
    fileName: "",
    label: "",
  });
  const [runError, setRunError] = useState<string | null>(null);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesStatus = statusFilter === "all" || row.status === statusFilter;
      const matchesSearch =
        !query ||
        [
          row.fileName,
          row.filePath,
          row.currentVersion,
          row.latestVersion,
          row.projectUrl,
          row.message,
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    });
  }, [rows, search, statusFilter]);

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.itemId) && row.latestFile),
    [rows, selectedIds]
  );
  const counts = useMemo(() => {
    return {
      updates: rows.filter((row) => row.status === "updateAvailable").length,
      unknown: rows.filter((row) => row.status === "unknown").length,
      errors: rows.filter((row) => row.status === "error").length,
    };
  }, [rows]);

  useEffect(() => {
    let mounted = true;
    setRows([]);
    setLastCheckedAt(null);
    setChecked(false);
    setSelectedIds(new Set());
    if (!instanceId) return;

    api.updates
      .latest(instanceId)
      .then((saved) => {
        if (!mounted || !saved) return;
        setRows(saved.rows);
        setLastCheckedAt(saved.checkedAt);
        setChecked(true);
      })
      .catch((error) => {
        if (mounted) {
          setRunError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      mounted = false;
    };
  }, [instanceId]);

  const handleCheck = async () => {
    if (!instanceId || checkProgress.active || updateProgress.active) return;

    cancelCheckRef.current = false;
    setRunError(null);
    setSelectedIds(new Set());

    let targets: UpdateTarget[] = [];
    try {
      targets = await api.updates.listTargets(instanceId);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
      return;
    }

    const nextRows: UpdateRow[] = [];
    setCheckProgress({
      active: true,
      current: 0,
      total: targets.length,
      fileName: targets[0]?.fileName ?? "",
    });

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      if (cancelCheckRef.current) {
        setCheckProgress({ active: false, current: 0, total: 0, fileName: "" });
        return;
      }
      setCheckProgress({
        active: true,
        current: index,
        total: targets.length,
        fileName: target.fileName,
      });
      try {
        nextRows.push(
          await api.updates.checkTarget({
            instanceId,
            itemId: target.itemId,
          })
        );
      } catch (error) {
        nextRows.push(buildErrorRow(target, error));
      }
    }

    if (!cancelCheckRef.current) {
      const saved = await api.updates.saveCheck(instanceId, nextRows);
      setRows(saved.rows);
      setLastCheckedAt(saved.checkedAt);
      setChecked(true);
    }
    setCheckProgress({ active: false, current: 0, total: 0, fileName: "" });
  };

  const handleCancelCheck = () => {
    cancelCheckRef.current = true;
  };

  const handleConfirm = (row: UpdateRow, candidate: UpdateCandidate) => {
    confirmMatch.mutate(
      {
        itemId: row.itemId,
        projectId: candidate.projectId,
        projectUrl: candidate.projectUrl,
      },
      {
        onSuccess: async () => {
          if (!instanceId) return;
          const updated = await api.updates.checkTarget({
            instanceId,
            itemId: row.itemId,
          });
          setRows((current) =>
            current.map((existing) => (existing.itemId === updated.itemId ? updated : existing))
          );
          setActiveRow(updated);
        },
      }
    );
  };

  const handleUpdateRows = async (targets: UpdateRow[]) => {
    const updateable = targets.filter(
      (row) => canReplaceArtifact(row)
    );
    if (updateable.length === 0) return;
    setRunError(null);
    setUpdateProgress({
      active: true,
      current: 0,
      total: updateable.length,
      fileName: updateable[0].fileName,
      label: updateable.length === 1 ? "Updating content" : "Updating selected content",
    });

    try {
      for (let index = 0; index < updateable.length; index += 1) {
        const row = updateable[index];
        if (!row.latestFile) continue;
        setUpdateProgress({
          active: true,
          current: index,
          total: updateable.length,
          fileName: row.fileName,
          label: updateable.length === 1 ? "Updating content" : "Updating selected content",
        });
        await updateMod.mutateAsync({
          modId: row.itemId,
          versionId: row.latestVersionId!,
          downloadUrl: row.latestFile.url,
          fileName: row.latestFile.fileName,
          expectedSha256: row.latestFile.sha256,
        });
      }

      if (instanceId && updateable.length > 1) {
        await api.updates.log(
          instanceId,
          "info",
          `Updated content: ${updateable.map((row) => row.fileName).join(", ")}`
        );
      }

      if (instanceId) {
        const freshTargets = await api.updates.listTargets(instanceId);
        const refreshed = await Promise.all(
          freshTargets.map((target) =>
            api.updates.checkTarget({
              instanceId,
              itemId: target.itemId,
            })
          )
        );
        const saved = await api.updates.saveCheck(instanceId, refreshed);
        setRows(saved.rows);
        setLastCheckedAt(saved.checkedAt);
      } else {
        setRows((current) => current.filter((row) => !selectedIds.has(row.itemId)));
      }
      setSelectedIds(new Set());
      setActiveRow(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRunError(message);
      if (instanceId) {
        await api.updates.log(instanceId, "error", `Content update failed: ${message}`);
      }
    } finally {
      setUpdateProgress({
        active: false,
        current: 0,
        total: 0,
        fileName: "",
        label: "",
      });
    }
  };

  const toggleSelected = (row: UpdateRow, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(row.itemId);
      } else {
        next.delete(row.itemId);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <PageShell
        title="Updates"
        description={
          rows.length > 0
            ? `${counts.updates} available, ${counts.unknown} unknown, ${counts.errors} errors${lastCheckedAt ? ` - last checked ${formatDateTime(lastCheckedAt)}` : ""}`
            : "Check selected-instance content against Modrinth"
        }
        controls={
          <>
            <select
              className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-muted)] px-3 text-sm"
              value={instanceId ?? ""}
              onChange={(e) => setSelectedInstance(e.target.value || null)}
              aria-label="Select instance"
              disabled={checkProgress.active || updateProgress.active}
            >
              <option value="">Select instance</option>
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.name}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              disabled={!selectedInstance || checkProgress.active || updateProgress.active}
              onClick={handleCheck}
            >
              <RefreshCw className={`h-4 w-4 ${checkProgress.active ? "animate-spin" : ""}`} />
              Check Updates
            </Button>
            {selectedRows.length > 0 && (
              <Button
                disabled={checkProgress.active || updateProgress.active}
                onClick={() => handleUpdateRows(selectedRows)}
              >
                <Download className="h-4 w-4" />
                Update Selected
              </Button>
            )}
          </>
        }
      />

      {runError && (
        <div className="rounded-md border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {runError}
        </div>
      )}

      <PageToolbar
        search={
          <PageSearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search updates by file, version, source..."
          />
        }
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-muted)] px-3 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              aria-label="Filter update status"
              disabled={checkProgress.active || updateProgress.active}
            >
              <option value="all">All statuses</option>
              <option value="updateAvailable">Update available</option>
              <option value="upToDate">Up to date</option>
              <option value="unknown">Unknown</option>
              <option value="error">Error</option>
            </select>
            <span className="text-sm text-[var(--color-muted-foreground)]">
              {filteredRows.length} of {rows.length} shown
            </span>
          </div>
        }
      />

      <UpdatesTable
        rows={filteredRows}
        checked={checked}
        selectedIds={selectedIds}
        busy={checkProgress.active || updateProgress.active}
        onToggle={toggleSelected}
        onConfirm={handleConfirm}
        onOpenDetails={setActiveRow}
      />

      <UpdateDetailsDialog
        row={activeRow}
        updating={updateProgress.active}
        onClose={() => setActiveRow(null)}
        onConfirm={handleConfirm}
        onUpdate={(row) => handleUpdateRows([row])}
      />

      <ProgressOverlay
        open={checkProgress.active}
        title="Checking updates"
        description="Looking up compatible Modrinth versions for the selected instance."
        current={checkProgress.current}
        total={checkProgress.total}
        fileName={checkProgress.fileName}
        cancelLabel="Cancel Check"
        onCancel={handleCancelCheck}
      />

      <ProgressOverlay
        open={updateProgress.active}
        title={updateProgress.label || "Updating content"}
        description="Downloading verified files and moving previous versions to backup. Keep the app open."
        current={updateProgress.current}
        total={updateProgress.total}
        fileName={updateProgress.fileName}
      />
    </div>
  );
}

function UpdatesTable({
  rows,
  checked,
  selectedIds,
  busy,
  onToggle,
  onConfirm,
  onOpenDetails,
}: {
  rows: UpdateRow[];
  checked: boolean;
  selectedIds: Set<string>;
  busy: boolean;
  onToggle: (row: UpdateRow, checked: boolean) => void;
  onConfirm: (row: UpdateRow, candidate: UpdateCandidate) => void;
  onOpenDetails: (row: UpdateRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex h-52 flex-col items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] text-[var(--color-muted-foreground)]">
        <ShieldAlert className="h-5 w-5" />
        <p>{checked ? "No update rows match the current filters." : "Choose an instance and run an update check."}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] bg-[var(--color-muted)]">
            <th className="w-10 px-4 py-3 text-left font-medium" />
            <th className="px-4 py-3 text-left font-medium">Content</th>
            <th className="px-4 py-3 text-left font-medium">Version</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-left font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selectable = canReplaceArtifact(row);
            return (
              <tr
                key={`${row.itemType}-${row.itemId}`}
                className="cursor-pointer border-b border-[var(--color-border)]/50 hover:bg-[var(--color-muted)]/50"
                onClick={() => onOpenDetails(row)}
              >
                <td className="px-4 py-3 align-top" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.fileName}`}
                    checked={selectedIds.has(row.itemId)}
                    disabled={!selectable || busy}
                    onChange={(event) => onToggle(row, event.target.checked)}
                  />
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{row.fileName}</span>
                      <Badge variant="secondary">{formatItemType(row.itemType)}</Badge>
                    </div>
                    <span className="max-w-[360px] truncate text-xs text-[var(--color-muted-foreground)]">
                      {row.filePath}
                    </span>
                    {row.matchConfidence === "candidate" && row.candidates[0] && (
                      <button
                        type="button"
                        className="mt-1 flex w-fit items-center gap-1 text-xs text-[var(--color-primary)] hover:underline"
                        onClick={(event) => {
                          event.stopPropagation();
                          onConfirm(row, row.candidates[0]);
                        }}
                      >
                        <Check className="h-3 w-3" />
                        Confirm {row.candidates[0].title}
                      </button>
                    )}
                    {row.message && (
                      <span className="text-xs text-[var(--color-muted-foreground)]">{row.message}</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex flex-col gap-1">
                    <span>{row.currentVersion || "Unknown"}</span>
                    <span className="text-xs text-[var(--color-muted-foreground)]">
                      Latest: {row.latestVersion || "Unknown"}
                    </span>
                    {row.releaseDate && (
                      <span className="text-xs text-[var(--color-muted-foreground)]">
                        {formatDate(row.releaseDate)}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 align-top">
                  <Badge variant={statusVariant(row.status)}>{formatStatus(row.status)}</Badge>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex items-center gap-2">
                    <span>{row.source}</span>
                    <PlatformLinkButton url={row.projectUrl} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function UpdateDetailsDialog({
  row,
  updating,
  onClose,
  onConfirm,
  onUpdate,
}: {
  row: UpdateRow | null;
  updating: boolean;
  onClose: () => void;
  onConfirm: (row: UpdateRow, candidate: UpdateCandidate) => void;
  onUpdate: (row: UpdateRow) => void;
}) {
  const canUpdate = row ? canReplaceArtifact(row) : false;

  return (
    <Dialog open={!!row} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        {row && (
          <>
            <DialogHeader>
              <div className="flex items-start justify-between gap-3 pr-8">
                <div>
                  <DialogTitle>{row.fileName}</DialogTitle>
                  <DialogDescription>
                    {formatItemType(row.itemType)} update details from {row.source}
                  </DialogDescription>
                </div>
                <div className="flex shrink-0 gap-2">
                  {row.projectUrl && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={row.projectUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-4 w-4" />
                        View
                      </a>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={!canUpdate || updating}
                    onClick={() => onUpdate(row)}
                  >
                    <Download className="h-4 w-4" />
                    Update
                  </Button>
                </div>
              </div>
            </DialogHeader>

            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <Detail label="Current" value={row.currentVersion || "Unknown"} />
              <Detail label="Latest compatible" value={row.latestVersion || "Unknown"} />
              <Detail label="Status" value={formatStatus(row.status)} />
              <Detail label="Match" value={formatMatch(row)} />
              <Detail label="Released" value={row.releaseDate ? formatDate(row.releaseDate) : "Unknown"} />
              <Detail label="File" value={row.filePath} wide />
            </div>

            {row.matchConfidence === "candidate" && row.candidates.length > 0 && (
              <div className="rounded-md border border-[var(--color-border)] p-3">
                <p className="mb-2 text-sm font-medium">Candidate match</p>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-[var(--color-muted-foreground)]">
                    {row.candidates[0].title}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => onConfirm(row, row.candidates[0])}>
                    <Check className="h-4 w-4" />
                    Confirm
                  </Button>
                </div>
              </div>
            )}

            <div>
              <p className="mb-2 text-sm font-medium">Changelog</p>
              <div className="max-h-72 overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm leading-6 text-[var(--color-muted-foreground)]">
                {row.changelog?.trim() || "No changelog was provided for this compatible version."}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Detail({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <p className="text-xs uppercase text-[var(--color-muted-foreground)]">{label}</p>
      <p className="mt-1 break-all text-[var(--color-foreground)]">{value}</p>
    </div>
  );
}

function ProgressOverlay({
  open,
  title,
  description,
  current,
  total,
  fileName,
  cancelLabel,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  current: number;
  total: number;
  fileName: string;
  cancelLabel?: string;
  onCancel?: () => void;
}) {
  if (!open) return null;
  const completed = total === 0 ? 0 : Math.min(current + 1, total);
  const value = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/75 p-4">
      <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{description}</p>
          </div>
          {onCancel && (
            <Button variant="ghost" size="icon" onClick={onCancel} aria-label={cancelLabel}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="space-y-3">
          <Progress value={value} />
          <div className="flex justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-[var(--color-foreground)]">{fileName || "Preparing..."}</span>
            <span className="shrink-0 text-[var(--color-muted-foreground)]">
              {completed} / {total}
            </span>
          </div>
          {onCancel && (
            <Button variant="outline" className="w-full" onClick={onCancel}>
              {cancelLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function buildErrorRow(target: UpdateTarget, error: unknown): UpdateRow {
  return {
    itemId: target.itemId,
    itemType: target.itemType,
    fileName: target.fileName,
    filePath: "",
    currentVersion: null,
    latestVersion: null,
    latestVersionId: null,
    source: "Modrinth",
    projectId: null,
    projectUrl: null,
    releaseDate: null,
    status: "error",
    matchConfidence: "unknown",
    confirmed: false,
    candidates: [],
    latestFile: null,
    changelog: null,
    message: error instanceof Error ? error.message : String(error),
  };
}

function formatItemType(value: UpdateItemType) {
  const labels: Record<UpdateItemType, string> = {
    mod: "Mod",
  };
  return labels[value];
}

function formatStatus(value: UpdateStatus) {
  const labels: Record<UpdateStatus, string> = {
    updateAvailable: "Update available",
    upToDate: "Up to date",
    unknown: "Unknown",
    error: "Error",
  };
  return labels[value];
}

function canReplaceArtifact(row: UpdateRow) {
  return (
    row.status === "updateAvailable" &&
    !!row.latestFile &&
    !!row.latestVersionId &&
    !!row.projectId &&
    row.itemType === "mod"
  );
}

function formatMatch(row: UpdateRow) {
  if (row.matchConfidence === "exact") return row.confirmed ? "Exact, confirmed" : "Exact";
  if (row.matchConfidence === "candidate") return "Candidate";
  return "Unknown";
}

function statusVariant(value: UpdateStatus) {
  if (value === "updateAvailable") return "warning";
  if (value === "upToDate") return "success";
  if (value === "error") return "destructive";
  return "secondary";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
