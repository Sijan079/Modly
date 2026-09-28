import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  CheckCircle2,
  FileDown,
  Menu,
  Plus,
  RefreshCw,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThemedSelect } from "@/components/ui/themed-select";
import { ChangePlanDialog } from "@/components/mods/ChangePlanDialog";
import { PageShell } from "@/components/layout/PageShell";
import { PageSearchBar } from "@/components/layout/PageSearchBar";
import { PageToolbar } from "@/components/layout/PageToolbar";
import { ModTable } from "@/components/mods/ModTable";
import { ExportZipDialog, type ExportZipDialogOptions } from "@/components/instances/ExportZipDialog";
import { ModEditDialog } from "@/components/mods/ModEditDialog";
import { BulkModEditDialog } from "@/components/mods/BulkModEditDialog";
import { ModFilters } from "@/components/mods/ModFilters";
import { CategoryManager } from "@/components/mods/CategoryManager";
import { useInstances } from "@/hooks/useInstances";
import {
  useCheckModIntegrity,
  useLatestModIntegrityAudit,
  useMods,
  useResetModMetadata,
  useScanMods,
  useToggleMod,
  useUpdateModMetadata,
  useBulkUpdateModMetadata,
} from "@/hooks/useMods";
import { useCategories } from "@/hooks/useCategories";
import { useAppStore, filterMods, type ModListFilters } from "@/store/app";
import { api } from "@/lib/api";
import { buildExportDefaultPath } from "@/lib/export-paths";
import type {
  ExportModsZipInput,
  ChangeRequest,
  Instance,
  ModFile,
  ModIntegrityAudit,
  ModIntegrityReport,
} from "@/lib/types";

const defaultFilters: ModListFilters = {
  categoryId: null,
  loader: "all",
  side: "all",
  status: "all",
  sort: "nameAsc",
};

export function ModsPage() {
  const { data: instances = [] } = useInstances();
  const { selectedInstanceId, setSelectedInstance } = useAppStore();
  const instanceId = selectedInstanceId ?? instances[0]?.id ?? null;

  // Selecting from this page keeps the route mounted. Reset the complete
  // instance-scoped workspace so it behaves like returning from Instances.
  return (
    <ModsWorkspace
      key={instanceId ?? "no-instance"}
      instances={instances}
      instanceId={instanceId}
      setSelectedInstance={setSelectedInstance}
    />
  );
}

function ModsWorkspace({
  instances,
  instanceId,
  setSelectedInstance,
}: {
  instances: Instance[];
  instanceId: string | null;
  setSelectedInstance: (id: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedPath = searchParams.get("mod");
  const linkedPlan = searchParams.get("plan");
  const selectedInstance = instances.find((instance) => instance.id === instanceId) ?? null;

  const { data: mods = [], isLoading } = useMods(instanceId);
  const { data: categories = [] } = useCategories(instanceId);
  const scanMutation = useScanMods();
  const integrityMutation = useCheckModIntegrity();
  const { data: latestIntegrityAudit = null } = useLatestModIntegrityAudit(instanceId);
  const toggleMutation = useToggleMod();
  const updateMetaMutation = useUpdateModMetadata();
  const bulkUpdateMetaMutation = useBulkUpdateModMetadata();
  const resetMetaMutation = useResetModMetadata();
  const exportZipMutation = useMutation({
    mutationFn: (input: ExportModsZipInput) => api.instances.exportModsZip(input),
  });

  const [modSearch, setModSearch] = useState("");
  const [filters, setFilters] = useState<ModListFilters>(defaultFilters);
  const [dragOver, setDragOver] = useState(false);
  const [editingMod, setEditingMod] = useState<ModFile | null>(null);
  const [linkedNotice, setLinkedNotice] = useState<string | null>(null);
  const [selectedModIds, setSelectedModIds] = useState<string[]>([]);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [backups, setBackups] = useState<import("@/lib/types").ChangeBackup[]>([]);
  const [restoreTarget, setRestoreTarget] = useState<import("@/lib/types").ChangeBackup | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [activeIntegrityAudit, setActiveIntegrityAudit] = useState<ModIntegrityAudit | null>(null);
  const [dismissedAuditAt, setDismissedAuditAt] = useState<string | null>(null);
  useEffect(() => {
    if (!linkedPath || isLoading) return;
    const mod = mods.find((item) => item.filePath === linkedPath);
    setModSearch(mod?.fileName ?? linkedPath.split(/[\\/]/).pop() ?? linkedPath);
    if (mod) {
      setLinkedNotice(null);
      if (linkedPlan === "remove") setChangeRequests([{ kind: "remove", instanceId: mod.instanceId, targetModId: mod.id }]);
      else setEditingMod(mod);
    } else setLinkedNotice("This mod is no longer in the selected instance. Rescan the pack or choose its current file from the list.");
    setSearchParams((params) => { params.delete("mod"); params.delete("plan"); return params; }, { replace: true });
  }, [linkedPath, linkedPlan, isLoading, mods, setSearchParams]);

  const filteredMods = useMemo(
    () => filterMods(mods, modSearch, filters),
    [mods, modSearch, filters]
  );
  useEffect(() => {
    const availableIds = new Set(mods.map((mod) => mod.id));
    setSelectedModIds((current) => current.filter((id) => availableIds.has(id)));
  }, [mods]);
  useEffect(() => {
    setSelectedModIds([]);
    setBulkEditOpen(false);
  }, [instanceId]);
  const exportableMods = useMemo(
    () => filteredMods.filter((mod) => mod.enabled),
    [filteredMods]
  );
  const visibleIntegrityAudit = activeIntegrityAudit ?? latestIntegrityAudit;
  const showIntegrityAudit =
    integrityMutation.isPending ||
    (!!visibleIntegrityAudit && visibleIntegrityAudit.auditedAt !== dismissedAuditAt);

  const hasActiveFilters =
    filters.categoryId !== null ||
    filters.loader !== "all" ||
    filters.side !== "all" ||
    filters.status !== "all";

  const clearSearchAndFilters = () => {
    setModSearch("");
    setFilters(defaultFilters);
  };

  const handleCategoryDeleted = (categoryId: string) => {
    setFilters((current) =>
      current.categoryId === categoryId
        ? { ...current, categoryId: null }
        : current
    );
  };

  const handleAddMods = async () => {
    if (!instanceId) return;
    const files = await open({
      multiple: true,
      filters: [{ name: "Mod JAR", extensions: ["jar"] }],
    });
    if (!files) return;
    const paths = Array.isArray(files) ? files : [files];
    setChangeRequests(paths.filter((path): path is string => typeof path === "string")
      .map((sourcePath) => ({ kind: "add", instanceId, sourcePath })));
  };

  const handleExportModList = async () => {
    if (!instanceId) return;

    const selectedInstance = instances.find((instance) => instance.id === instanceId);
    if (!selectedInstance) return;

    const settings = await api.settings.get();
    const exportPath = await save({
      defaultPath: buildExportDefaultPath(
        settings.exportModlistDir,
        `${selectedInstance.name}-modlist.html`
      ),
      filters: [{ name: "HTML Document", extensions: ["html"] }],
    });

    if (!exportPath) return;

    const activeCategory =
      categories.find((category) => category.id === filters.categoryId)?.name ?? null;

    const exportedMods = settings.includeDisabledModsInExports ? filteredMods : exportableMods;

    await api.mods.exportHtml({
      instanceName: selectedInstance.name,
      appliedSearch: modSearch,
      statusFilter: filters.status,
      loaderFilter: filters.loader,
      sideFilter: filters.side,
      categoryFilter: activeCategory,
      totalCount: mods.length,
      mods: exportedMods,
      outputPath: exportPath,
    });

    alert(`Exported ${exportedMods.length} mods to:\n${exportPath}\n\nA matching CSS file was created beside it.`);
  };

  const handleIntegrityAudit = () => {
    if (!instanceId) return;
    setToolsOpen(false);
    setActiveIntegrityAudit(null);
    setDismissedAuditAt(null);
    integrityMutation.mutate(instanceId, {
      onSuccess: setActiveIntegrityAudit,
    });
  };

  const handleScan = () => {
    if (!instanceId) return;
    setToolsOpen(false);
    scanMutation.mutate(instanceId, {
      onSuccess: async () => {
        const settings = await api.settings.get();
        if (settings.autoAuditAfterScan) {
          integrityMutation.mutate(instanceId, {
            onSuccess: setActiveIntegrityAudit,
          });
        }
      },
    });
  };

  const handleMenuExportModList = async () => {
    setToolsOpen(false);
    await handleExportModList();
  };

  const handleOpenExportModsZip = () => {
    if (!selectedInstance) return;
    setToolsOpen(false);
    setExportDialogOpen(true);
  };

  const handleConfirmExportModsZip = async (
    instance: NonNullable<typeof selectedInstance>,
    options: ExportZipDialogOptions
  ) => {
    const settings = await api.settings.get();
    const exportPath = await save({
      defaultPath: buildExportDefaultPath(
        settings.exportModpackDir,
        `${instance.name}-mods.zip`
      ),
      filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
    });
    if (!exportPath) return;

    await exportZipMutation.mutateAsync({
      instanceId: instance.id,
      outputPath: exportPath,
      modAudience: options.modAudience,
      modCategoryId: options.modCategoryId,
      modState: options.modState,
    });
    setExportDialogOpen(false);
  };

  const confirmDeleteMod = (mod: ModFile) => {
    setEditingMod(null);
    setChangeRequests([{ kind: "remove", instanceId: mod.instanceId, targetModId: mod.id }]);
  };
  const replaceMod = async (mod: ModFile) => {
    const sourcePath = await open({ multiple: false, filters: [{ name: "Mod JAR", extensions: ["jar"] }] });
    if (typeof sourcePath === "string") setChangeRequests([{ kind: "replace", instanceId: mod.instanceId, targetModId: mod.id, sourcePath }]);
  };
  const showBackups = async () => {
    if (!instanceId) return;
    setToolsOpen(false);
    setBackupError(null);
    setRestoreTarget(null);
    try { setBackups(await api.changes.backups(instanceId)); setBackupsOpen(true); }
    catch (error) { setBackupError(String(error)); setBackupsOpen(true); }
  };
  const restoreBackup = async (id: string) => {
    if (!instanceId) return;
    setBackupError(null);
    try {
      const result = await api.changes.restore(instanceId, id);
      if (!result.verified) throw new Error("Restore verification failed");
      setBackups(await api.changes.backups(instanceId));
      setRestoreTarget(null);
      await queryClient.invalidateQueries();
      setBackupError(result.warnings.join(" ") || null);
    } catch (error) { setBackupError(String(error)); }
  };

  const description =
    mods.length > 0 ? (
      <>
        View and manage mod JARs with extracted metadata
        <span className="ml-1 text-[var(--color-foreground)]">
          - {filteredMods.length} of {mods.length} shown
        </span>
      </>
    ) : (
      "View and manage mod JARs with extracted metadata"
    );

  return (
    <div className="flex flex-col gap-5">
      <PageShell
        title="Mods"
        description={description}
        controls={
          <>
            <ThemedSelect
              className="min-w-[11rem]"
              value={instanceId ?? ""}
              onValueChange={(value) => setSelectedInstance(value || null)}
              aria-label="Select instance"
              options={[{ value: "", label: "Select instance" }, ...instances.map((instance) => ({ value: instance.id, label: instance.name }))]}
            />
            <Button
              variant="outline"
              disabled={!instanceId}
              onClick={handleAddMods}
            >
              <Plus className="h-4 w-4" />
              Add Mods
            </Button>
            <div className="relative">
              <Button
                variant="outline"
                onClick={() => setToolsOpen((open) => !open)}
                disabled={!instanceId}
                aria-expanded={toolsOpen}
                aria-haspopup="menu"
                aria-label="Open mod tools"
              >
                <Menu className="h-4 w-4" />
                Tools
              </Button>
              {toolsOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-11 z-40 w-56 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-1 shadow-xl"
                >
                  <ToolMenuItem
                    icon={RefreshCw}
                    label={scanMutation.isPending ? "Scanning..." : "Scan Mods"}
                    disabled={!instanceId || scanMutation.isPending}
                    spinning={scanMutation.isPending}
                    onClick={handleScan}
                  />
                  <ToolMenuItem
                    icon={ShieldCheck}
                    label={integrityMutation.isPending ? "Auditing..." : "Security Audit"}
                    disabled={!instanceId || integrityMutation.isPending || mods.length === 0}
                    spinning={integrityMutation.isPending}
                    onClick={handleIntegrityAudit}
                  />
                  <ToolMenuItem
                    icon={FileDown}
                    label="Export Modlist"
                    disabled={!instanceId || exportableMods.length === 0}
                    onClick={handleMenuExportModList}
                  />
                  <ToolMenuItem
                    icon={FileDown}
                    label="Export ZIP"
                    disabled={!instanceId || mods.length === 0 || exportZipMutation.isPending}
                    onClick={handleOpenExportModsZip}
                  />
                  <ToolMenuItem icon={RefreshCw} label="Restore mod change" disabled={!instanceId} onClick={showBackups} />
                </div>
              )}
            </div>
          </>
        }
      />
      {linkedNotice && <p role="status" className="rounded-md border border-[var(--color-border)] p-3 text-sm">{linkedNotice}</p>}

      <CategoryManager
        instanceId={instanceId}
        onCategoryDeleted={handleCategoryDeleted}
      />

      {showIntegrityAudit && (
        <IntegrityAuditPanel
          audit={visibleIntegrityAudit}
          loading={integrityMutation.isPending}
          onClose={() => setDismissedAuditAt(visibleIntegrityAudit?.auditedAt ?? "pending")}
        />
      )}

      <PageToolbar
        search={
          <PageSearchBar
            value={modSearch}
            onChange={setModSearch}
            placeholder="Search mods by name, file, version, category..."
            activityLabel="mods"
            activityContext={selectedInstance?.name}
          />
        }
        filters={
          <ModFilters
            filters={filters}
            onChange={setFilters}
            categories={categories}
            instanceId={instanceId}
            onClear={clearSearchAndFilters}
            showClear={hasActiveFilters || modSearch.trim().length > 0}
          />
        }
      />

      {selectedModIds.length > 0 && (
        <div className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2 text-sm">
          <span>{selectedModIds.length} mod{selectedModIds.length === 1 ? "" : "s"} selected</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelectedModIds([])}>Clear selection</Button>
            <Button size="sm" onClick={() => setBulkEditOpen(true)}>Bulk edit</Button>
          </div>
        </div>
      )}

      <div
        className={`rounded-lg border-2 border-dashed p-2 transition-colors ${
          dragOver
            ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5"
            : "border-[var(--color-border)]"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
      >
        <div className="mb-2 flex items-center justify-center gap-2 py-3 text-sm text-[var(--color-muted-foreground)]">
          <Upload className="h-4 w-4" />
          Drop .jar files here
        </div>
        <ModTable
          mods={filteredMods}
          totalCount={mods.length}
          loading={isLoading || scanMutation.isPending}
          onEdit={setEditingMod}
          onToggle={(modId, enabled) => {
            if (instanceId) {
              toggleMutation.mutate({ instanceId, modId, enabled });
            }
          }}
          onDelete={confirmDeleteMod}
          onReplace={replaceMod}
          selectedModIds={selectedModIds}
          onSelectionChange={(modId, selected) => {
            setSelectedModIds((current) =>
              selected ? [...new Set([...current, modId])] : current.filter((id) => id !== modId)
            );
          }}
          onSelectAll={(selected) => {
            const visibleIds = filteredMods.map((mod) => mod.id);
            setSelectedModIds((current) =>
              selected
                ? [...new Set([...current, ...visibleIds])]
                : current.filter((id) => !visibleIds.includes(id))
            );
          }}
        />
      </div>

      {changeRequests.length > 0 && <ChangePlanDialog requests={changeRequests} instance={selectedInstance} onClose={() => setChangeRequests([])} onApplied={() => { void queryClient.invalidateQueries(); }} />}
      <Dialog open={backupsOpen} onOpenChange={(open) => { setBackupsOpen(open); if (!open) setRestoreTarget(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Restore mod change</DialogTitle><DialogDescription>Choose an applied change to restore its original JAR and saved metadata.</DialogDescription></DialogHeader>
          {backupError && <p role="alert" className="text-sm text-[var(--color-destructive)]">{backupError}</p>}
          {backups.length === 0 && <p className="text-sm text-[var(--color-muted-foreground)]">No restorable changes.</p>}
          {backups.map((backup) => <div key={backup.id} className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] py-2 text-sm"><span>{backup.kind} · {backup.oldMod?.fileName ?? backup.newMod?.fileName}<br />{new Date(backup.createdAt).toLocaleString()}</span><Button variant="outline" onClick={() => setRestoreTarget(backup)}>Review</Button></div>)}
          {restoreTarget && <div className="space-y-2 rounded-md border border-[var(--color-border)] p-3 text-sm"><strong>Restore {restoreTarget.oldMod?.fileName ?? restoreTarget.newMod?.fileName}</strong>{restoreTarget.newFilePath && <p>Remove current file: <code className="break-all">{restoreTarget.newFilePath}</code></p>}{restoreTarget.oldFilePath && <p>Restore original file: <code className="break-all">{restoreTarget.oldFilePath}</code></p>}<p className="text-[var(--color-muted-foreground)]">Current files must still match this backup. Dependency and world safety require review after restoration.</p><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setRestoreTarget(null)}>Cancel</Button><Button onClick={() => restoreBackup(restoreTarget.id)}>Restore original</Button></div></div>}
        </DialogContent>
      </Dialog>

      <ModEditDialog
        mod={editingMod}
        mods={mods}
        categories={categories}
        open={editingMod !== null}
        onOpenChange={(open) => !open && setEditingMod(null)}
        saving={updateMetaMutation.isPending}
        resetting={resetMetaMutation.isPending}
        onSave={(input) => {
          updateMetaMutation.mutate(input, {
            onSuccess: () => setEditingMod(null),
          });
        }}
        onReset={(modId) => {
          resetMetaMutation.mutate(modId, {
            onSuccess: (updated) => setEditingMod(updated),
          });
        }}
      />
      <BulkModEditDialog
        instanceId={instanceId}
        selectedCount={selectedModIds.length}
        categories={categories}
        open={bulkEditOpen}
        saving={bulkUpdateMetaMutation.isPending}
        onOpenChange={setBulkEditOpen}
        onSave={(input) => {
          bulkUpdateMetaMutation.mutate(
            { ...input, modIds: selectedModIds },
            {
              onSuccess: () => {
                setBulkEditOpen(false);
                setSelectedModIds([]);
              },
            }
          );
        }}
      />
      <ExportZipDialog
        instance={selectedInstance}
        open={exportDialogOpen}
        mode="mods"
        mods={mods}
        categories={categories}
        exporting={exportZipMutation.isPending}
        onOpenChange={setExportDialogOpen}
        onConfirm={handleConfirmExportModsZip}
      />
    </div>
  );
}

function ToolMenuItem({
  icon: Icon,
  label,
  disabled,
  spinning = false,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  disabled?: boolean;
  spinning?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-[var(--color-foreground)] hover:bg-[var(--color-muted)] disabled:pointer-events-none disabled:opacity-50"
    >
      <Icon className={`h-4 w-4 ${spinning ? "animate-spin" : ""}`} />
      {label}
    </button>
  );
}

function IntegrityAuditPanel({
  audit,
  loading,
  onClose,
}: {
  audit: ModIntegrityAudit | null;
  loading: boolean;
  onClose: () => void;
}) {
  const reports = audit?.reports ?? [];
  const corrupted = reports.filter((report) => !report.healthy);
  const statusClean = !audit || audit.status === "clean";

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {statusClean ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-[var(--color-accent)]" />
            ) : (
              <AlertTriangle className="mt-0.5 h-5 w-5 text-yellow-400" />
            )}
            <div>
              <h3 className="font-semibold">Security Audit</h3>
              <p className="text-sm text-[var(--color-muted-foreground)]">
                {loading
                  ? "Checking mod archives..."
                  : statusClean
                    ? `Last audited ${formatAuditDate(audit?.auditedAt)} - checked ${audit?.totalMods ?? reports.length} mod${(audit?.totalMods ?? reports.length) === 1 ? "" : "s"} with no corrupted archives found.`
                    : `Last audited ${formatAuditDate(audit?.auditedAt)} - ${audit?.corruptedMods ?? corrupted.length} of ${audit?.totalMods ?? reports.length} mod${(audit?.totalMods ?? reports.length) === 1 ? "" : "s"} failed.`}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close audit results">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {corrupted.length > 0 && (
          <div className="max-h-56 overflow-auto rounded-md border border-[var(--color-border)]">
            {corrupted.map((report) => (
              <div
                key={`${report.modId}-${report.status}`}
                className="grid gap-2 border-b border-[var(--color-border)] p-3 last:border-b-0 sm:grid-cols-[1fr_auto]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{report.fileName}</p>
                  <p className="mt-1 break-all text-xs text-[var(--color-muted-foreground)]">
                    {report.message}
                  </p>
                </div>
                <Badge variant="warning" className="h-fit justify-self-start sm:justify-self-end">
                  {formatIntegrityStatus(report.status)}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatIntegrityStatus(status: ModIntegrityReport["status"]) {
  const labels: Record<ModIntegrityReport["status"], string> = {
    ok: "OK",
    missing: "Missing",
    unreadable: "Unreadable",
    invalidArchive: "Invalid archive",
    emptyArchive: "Empty archive",
    corruptEntry: "Corrupt entry",
  };
  return labels[status];
}

function formatAuditDate(value?: string) {
  if (!value) return "just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
