import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/layout/PageShell";
import { PageSearchBar } from "@/components/layout/PageSearchBar";
import { PageToolbar } from "@/components/layout/PageToolbar";
import { ModTable } from "@/components/mods/ModTable";
import { ModEditDialog } from "@/components/mods/ModEditDialog";
import { ModFilters } from "@/components/mods/ModFilters";
import { CategoryManager } from "@/components/mods/CategoryManager";
import { useInstances } from "@/hooks/useInstances";
import {
  useCheckModIntegrity,
  useDeleteMod,
  useLatestModIntegrityAudit,
  useMods,
  useResetModMetadata,
  useScanMods,
  useToggleMod,
  useUpdateModMetadata,
} from "@/hooks/useMods";
import { useCategories } from "@/hooks/useCategories";
import { useAppStore, filterMods, type ModListFilters } from "@/store/app";
import { api } from "@/lib/api";
import { buildExportDefaultPath } from "@/lib/export-paths";
import type { ModFile, ModIntegrityAudit, ModIntegrityReport } from "@/lib/types";

const defaultFilters: ModListFilters = {
  categoryId: null,
  loader: "all",
  status: "all",
};

export function ModsPage() {
  const queryClient = useQueryClient();
  const { data: instances = [] } = useInstances();
  const { selectedInstanceId, setSelectedInstance } = useAppStore();
  const instanceId = selectedInstanceId ?? instances[0]?.id ?? null;

  const { data: mods = [], isLoading } = useMods(instanceId);
  const { data: categories = [] } = useCategories(instanceId);
  const scanMutation = useScanMods();
  const integrityMutation = useCheckModIntegrity();
  const { data: latestIntegrityAudit = null } = useLatestModIntegrityAudit(instanceId);
  const toggleMutation = useToggleMod();
  const deleteMutation = useDeleteMod();
  const updateMetaMutation = useUpdateModMetadata();
  const resetMetaMutation = useResetModMetadata();

  const [modSearch, setModSearch] = useState("");
  const [filters, setFilters] = useState<ModListFilters>(defaultFilters);
  const [dragOver, setDragOver] = useState(false);
  const [editingMod, setEditingMod] = useState<ModFile | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [activeIntegrityAudit, setActiveIntegrityAudit] = useState<ModIntegrityAudit | null>(null);
  const [dismissedAuditAt, setDismissedAuditAt] = useState<string | null>(null);

  const filteredMods = useMemo(
    () => filterMods(mods, modSearch, filters),
    [mods, modSearch, filters]
  );
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
    filters.status !== "all";

  const clearSearchAndFilters = () => {
    setModSearch("");
    setFilters(defaultFilters);
  };

  const handleAddMods = async () => {
    if (!instanceId) return;
    const files = await open({
      multiple: true,
      filters: [{ name: "Mod JAR", extensions: ["jar"] }],
    });
    if (!files) return;
    const paths = Array.isArray(files) ? files : [files];
    for (const path of paths) {
      if (typeof path === "string") {
        await api.mods.copyToInstance(path, instanceId);
      }
    }
    const settings = await api.settings.get();
    if (settings.autoScanAfterModAdd) {
      scanMutation.mutate(instanceId, {
        onSuccess: () => {
          if (settings.autoAuditAfterScan) {
            integrityMutation.mutate(instanceId, {
              onSuccess: setActiveIntegrityAudit,
            });
          }
        },
      });
    } else {
      queryClient.invalidateQueries({ queryKey: ["mods", instanceId] });
      queryClient.invalidateQueries({ queryKey: ["instances"] });
    }
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

  const handleDeleteMod = (mod: ModFile) => {
    const displayName = mod.metadata?.name ?? mod.fileName;
    const typedName = window.prompt(
      `Delete "${displayName}"?\n\nThis removes the mod file from disk and clears its saved metadata.\nType the mod name to confirm.`
    );
    if (typedName !== displayName) return;

    deleteMutation.mutate(
      { instanceId: mod.instanceId, modId: mod.id },
      {
        onSuccess: () => {
          if (editingMod?.id === mod.id) {
            setEditingMod(null);
          }
        },
      }
    );
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
            <select
              className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-muted)] px-3 text-sm"
              value={instanceId ?? ""}
              onChange={(e) => setSelectedInstance(e.target.value || null)}
              aria-label="Select instance"
            >
              <option value="">Select instance</option>
              {instances.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
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
                </div>
              )}
            </div>
          </>
        }
      />

      <CategoryManager instanceId={instanceId} />

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
          Drop .jar files here to add mods
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
          onDelete={handleDeleteMod}
        />
      </div>

      <ModEditDialog
        mod={editingMod}
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
                    : `Last audited ${formatAuditDate(audit?.auditedAt)} - ${audit?.corruptedMods ?? corrupted.length} of ${audit?.totalMods ?? reports.length} mod${(audit?.totalMods ?? reports.length) === 1 ? "" : "s"} need attention.`}
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
