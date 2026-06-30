import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import {
  Activity,
  AlertTriangle,
  Archive,
  CheckCircle2,
  FolderOpen,
  FolderSearch,
  Image,
  ListChecks,
  Package,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Tags,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { PageShell } from "@/components/layout/PageShell";
import { useInstances } from "@/hooks/useInstances";
import { useCheckModIntegrity, useLatestModIntegrityAudit, useMods } from "@/hooks/useMods";
import { usePacks } from "@/hooks/usePacks";
import { useAppStore } from "@/store/app";
import { api } from "@/lib/api";
import { buildExportDefaultPath } from "@/lib/export-paths";
import { getResolvedConfigPath } from "@/lib/instance-paths";
import { formatDate, formatLoader } from "@/lib/utils";
import type {
  ConfigTreeNode,
  Instance,
  LogEntry,
  MinecraftScanResult,
  ModFile,
  ModIntegrityAudit,
} from "@/lib/types";

export function DashboardPage() {
  const queryClient = useQueryClient();
  const { selectedInstanceId } = useAppStore();
  const { data: instances = [] } = useInstances();
  const selectedInstance =
    instances.find((instance) => instance.id === selectedInstanceId) ??
    instances[0] ??
    null;

  const instanceId = selectedInstance?.id ?? null;
  const { data: mods = [] } = useMods(instanceId);
  const { data: latestIntegrityAudit = null } = useLatestModIntegrityAudit(instanceId);
  const { data: resourcePacks = [] } = usePacks(instanceId, "resourcePack");
  const { data: shaderPacks = [] } = usePacks(instanceId, "shaderPack");
  const { data: datapacks = [] } = usePacks(instanceId, "datapack");
  const integrityMutation = useCheckModIntegrity();
  const resolvedConfigPath = selectedInstance
    ? getResolvedConfigPath(selectedInstance)
    : null;

  const { data: scanSummary, isFetching: checkingFolders } = useQuery({
    queryKey: ["dashboard-scan-summary", selectedInstance?.gameDir],
    queryFn: () => api.scan.path(selectedInstance!.gameDir),
    enabled: !!selectedInstance,
    staleTime: 60_000,
  });

  const { data: configTree = [] } = useQuery({
    queryKey: ["dashboard-config-tree", resolvedConfigPath],
    queryFn: () => api.configs.scanTree(resolvedConfigPath!),
    enabled: !!resolvedConfigPath,
    staleTime: 60_000,
  });

  const { data: logs = [] } = useQuery({
    queryKey: ["logs"],
    queryFn: () => api.files.logs(500),
    staleTime: 10_000,
  });

  const scanAllMutation = useMutation({
    mutationFn: async (instance: Instance) => {
      const settings = await api.settings.get();
      await Promise.allSettled([
        api.mods.scan(instance.id),
        api.packs.scan(instance.id, "resourcePack"),
        api.packs.scan(instance.id, "shaderPack"),
        api.packs.scan(instance.id, "datapack"),
        api.configs.scanTree(getResolvedConfigPath(instance)),
        api.scan.path(instance.gameDir),
      ]);
      if (settings.autoAuditAfterScan) {
        await api.mods.checkIntegrity(instance.id);
      }
    },
    onSuccess: async (_, instance) => {
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ["instances"] }),
        queryClient.invalidateQueries({ queryKey: ["mods", instance.id] }),
        queryClient.invalidateQueries({ queryKey: ["packs", instance.id] }),
        queryClient.invalidateQueries({
          queryKey: ["dashboard-scan-summary", instance.gameDir],
        }),
        queryClient.invalidateQueries({
          queryKey: ["dashboard-config-tree", getResolvedConfigPath(instance)],
        }),
        queryClient.invalidateQueries({
          queryKey: ["mod-integrity-audit", instance.id],
        }),
        queryClient.invalidateQueries({ queryKey: ["logs"] }),
      ]);
    },
  });

  const exportZipMutation = useMutation({
    mutationFn: async (instance: Instance) => {
      const settings = await api.settings.get();
      const outputPath = await save({
        defaultPath: buildExportDefaultPath(
          settings.exportModpackDir,
          `${instance.name}.zip`
        ),
        filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
      });
      if (!outputPath) return;
      await api.instances.exportZip(instance.id, outputPath);
    },
  });

  const recentActivity = useMemo(() => logs.slice(0, 10), [logs]);
  const planningStats = useMemo(
    () =>
      getPlanningStats(
        mods,
        resourcePacks.length,
        shaderPacks.length,
        datapacks.length,
        configTree
      ),
    [mods, resourcePacks.length, shaderPacks.length, datapacks.length, configTree]
  );
  const attentionItems = useMemo(
    () =>
      selectedInstance
        ? getAttentionItems({
            instance: selectedInstance,
            scanSummary,
            configCount: planningStats.configCount,
            unknownMods: planningStats.unknownMods,
            disabledMods: planningStats.disabledMods,
            uncategorizedMods: planningStats.uncategorizedMods,
            duplicateFiles: planningStats.duplicateFiles,
            integrityAudit: latestIntegrityAudit,
          })
        : [],
    [latestIntegrityAudit, planningStats, scanSummary, selectedInstance]
  );

  return (
    <div className="space-y-5">
      <PageShell
        title="Dashboard"
        description="Plan, audit, and export the selected modpack"
      />

      {!selectedInstance ? (
        <EmptyDashboard />
      ) : (
        <>
          <Card>
            <CardContent className="grid gap-5 p-5 lg:grid-cols-[1.35fr_0.65fr]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-2xl font-semibold">
                    {selectedInstance.name}
                  </h2>
                  <Badge variant="secondary">{formatLoader(selectedInstance.loader)}</Badge>
                  {selectedInstance.mcVersion && (
                    <Badge variant="outline">{selectedInstance.mcVersion}</Badge>
                  )}
                </div>
                <p className="mt-2 truncate text-sm text-[var(--color-muted-foreground)]">
                  {selectedInstance.gameDir}
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric label="Mods" value={mods.length} detail={`${planningStats.enabledMods} enabled`} />
                  <Metric
                    label="DSR Packs"
                    value={resourcePacks.length + shaderPacks.length + datapacks.length}
                  />
                  <Metric label="Shader Packs" value={shaderPacks.length} />
                  <Metric label="Datapacks" value={datapacks.length} />
                  <Metric label="Config Files" value={planningStats.configCount} />
                </div>
              </div>

              <div className="flex flex-col justify-between gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/35 p-4">
                <div>
                  <p className="text-sm font-medium">Planning Actions</p>
                  <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                    Refresh the catalog before reviewing or exporting this modpack.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    onClick={() => scanAllMutation.mutate(selectedInstance)}
                    disabled={scanAllMutation.isPending}
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${scanAllMutation.isPending ? "animate-spin" : ""}`}
                    />
                    Scan All
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => api.files.openInExplorer(selectedInstance.gameDir)}
                  >
                    <FolderOpen className="h-4 w-4" />
                    Folder
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => integrityMutation.mutate(selectedInstance.id)}
                    disabled={integrityMutation.isPending || mods.length === 0}
                  >
                    <ShieldCheck
                      className={`h-4 w-4 ${
                        integrityMutation.isPending ? "animate-spin" : ""
                      }`}
                    />
                    Audit
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => exportZipMutation.mutate(selectedInstance)}
                    disabled={exportZipMutation.isPending}
                  >
                    <Archive className="h-4 w-4" />
                    Export ZIP
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldAlert className="h-4 w-4 text-[var(--color-primary)]" />
                  Needs Attention
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {checkingFolders && <Progress value={undefined} className="animate-pulse" />}
                {attentionItems.length === 0 ? (
                  <AttentionRow
                    tone="good"
                    title="Catalog looks clean"
                    detail="No obvious planning issues found for this instance."
                  />
                ) : (
                  attentionItems.map((item) => (
                    <AttentionRow
                      key={item.title}
                      tone={item.tone}
                      title={item.title}
                      detail={item.detail}
                    />
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ListChecks className="h-4 w-4 text-[var(--color-primary)]" />
                  Planning Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <BreakdownItem
                  icon={Tags}
                  label="Uncategorized Mods"
                  value={planningStats.uncategorizedMods}
                  total={mods.length}
                />
                <BreakdownItem
                  icon={AlertTriangle}
                  label="Unknown Metadata"
                  value={planningStats.unknownMods}
                  total={mods.length}
                />
                <BreakdownItem
                  icon={Package}
                  label="Disabled Mods"
                  value={planningStats.disabledMods}
                  total={mods.length}
                />
                <BreakdownItem
                  icon={Image}
                  label="Visual Add-ons"
                  value={resourcePacks.length + shaderPacks.length + datapacks.length}
                  total={resourcePacks.length + shaderPacks.length + datapacks.length + mods.length}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4 text-[var(--color-primary)]" />
                Recent Activity
              </CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link to="/logs">View logs</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {recentActivity.length === 0 ? (
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  No activity recorded yet.
                </p>
              ) : (
                <div className="divide-y divide-[var(--color-border)]">
                  {recentActivity.map((log) => (
                    <ActivityRow key={log.id} log={log} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function EmptyDashboard() {
  return (
    <Card>
      <CardContent className="flex min-h-72 flex-col items-center justify-center gap-3 p-6 text-center">
        <FolderSearch className="h-10 w-10 text-[var(--color-primary)]" />
        <div>
          <h2 className="text-lg font-semibold">No modpack selected</h2>
          <p className="mt-1 max-w-md text-sm text-[var(--color-muted-foreground)]">
            Create or select an instance to see planning stats, cleanup checks, and recent activity.
          </p>
        </div>
        <Button asChild>
          <Link to="/instances">Go to Instances</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail?: string;
}) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/35 p-3">
      <p className="text-xs text-[var(--color-muted-foreground)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {detail && <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{detail}</p>}
    </div>
  );
}

function AttentionRow({
  tone,
  title,
  detail,
}: {
  tone: "good" | "warn";
  title: string;
  detail: string;
}) {
  const Icon = tone === "good" ? CheckCircle2 : AlertTriangle;
  return (
    <div className="flex gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/25 p-3">
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${
          tone === "good" ? "text-[var(--color-accent)]" : "text-yellow-400"
        }`}
      />
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">{detail}</p>
      </div>
    </div>
  );
}

function BreakdownItem({
  icon: Icon,
  label,
  value,
  total,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  total: number;
}) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/25 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-[var(--color-primary)]" />
          <p className="truncate text-sm font-medium">{label}</p>
        </div>
        <span className="text-sm font-semibold">{value}</span>
      </div>
      <Progress value={percent} className="mt-3" />
      <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
        {total > 0 ? `${percent}% of related catalog` : "No catalog data yet"}
      </p>
    </div>
  );
}

function ActivityRow({ log }: { log: LogEntry }) {
  return (
    <div className="grid gap-2 py-3 sm:grid-cols-[150px_1fr_auto]">
      <span className="text-xs text-[var(--color-muted-foreground)]">
        {formatDate(log.createdAt)}
      </span>
      <span className="min-w-0 truncate text-sm">{log.message}</span>
      <Badge variant={log.level === "error" ? "destructive" : "secondary"}>
        {log.level}
      </Badge>
    </div>
  );
}

function getPlanningStats(
  mods: ModFile[],
  resourcePackCount: number,
  shaderPackCount: number,
  datapackCount: number,
  configTree: ConfigTreeNode[]
) {
  const fileNames = new Map<string, number>();
  for (const mod of mods) {
    fileNames.set(mod.fileName.toLowerCase(), (fileNames.get(mod.fileName.toLowerCase()) ?? 0) + 1);
  }

  return {
    enabledMods: mods.filter((mod) => mod.enabled).length,
    disabledMods: mods.filter((mod) => !mod.enabled).length,
    unknownMods: mods.filter((mod) => !mod.metadata || mod.metadata.loader === "unknown").length,
    uncategorizedMods: mods.filter((mod) => mod.categories.length === 0).length,
    duplicateFiles: Array.from(fileNames.values()).filter((count) => count > 1).length,
    resourcePackCount,
    shaderPackCount,
    datapackCount,
    configCount: countConfigFiles(configTree),
  };
}

function getAttentionItems({
  instance,
  scanSummary,
  configCount,
  unknownMods,
  disabledMods,
  uncategorizedMods,
  duplicateFiles,
  integrityAudit,
}: {
  instance: Instance;
  scanSummary: MinecraftScanResult | undefined;
  configCount: number;
  unknownMods: number;
  disabledMods: number;
  uncategorizedMods: number;
  duplicateFiles: number;
  integrityAudit: ModIntegrityAudit | null;
}) {
  const items: Array<{ tone: "good" | "warn"; title: string; detail: string }> = [];
  const detectedKinds = new Set(scanSummary?.detectedPaths.map((path) => path.kind) ?? []);

  if (!integrityAudit) {
    items.push({
      tone: "warn",
      title: "Security audit not run",
      detail: "Run an audit before trusting this modpack plan.",
    });
  } else if (integrityAudit.corruptedMods > 0) {
    items.push({
      tone: "warn",
      title: `${integrityAudit.corruptedMods} corrupted mod${integrityAudit.corruptedMods === 1 ? "" : "s"} detected`,
      detail: `Last audited ${formatDate(integrityAudit.auditedAt)}. Open Mods for the affected files.`,
    });
  } else {
    items.push({
      tone: "good",
      title: "Security audit clean",
      detail: `Last audited ${formatDate(integrityAudit.auditedAt)}.`,
    });
  }

  if (scanSummary && !scanSummary.minecraftDir) {
    items.push({
      tone: "warn",
      title: "Instance folder missing",
      detail: instance.gameDir,
    });
  }
  if (scanSummary && !detectedKinds.has("mods")) {
    items.push({
      tone: "warn",
      title: "Mods folder not detected",
      detail: "Run Scan All after checking the instance path.",
    });
  }
  if (unknownMods > 0) {
    items.push({
      tone: "warn",
      title: `${unknownMods} mod${unknownMods === 1 ? "" : "s"} need metadata review`,
      detail: "Open Mods to fill in missing names, loaders, or IDs.",
    });
  }
  if (uncategorizedMods > 0) {
    items.push({
      tone: "warn",
      title: `${uncategorizedMods} uncategorized mod${uncategorizedMods === 1 ? "" : "s"}`,
      detail: "Categories make planning and export review easier.",
    });
  }
  if (disabledMods > 0) {
    items.push({
      tone: "warn",
      title: `${disabledMods} disabled mod${disabledMods === 1 ? "" : "s"} in this pack`,
      detail: "Review whether these should stay in the planning catalog.",
    });
  }
  if (duplicateFiles > 0) {
    items.push({
      tone: "warn",
      title: "Duplicate mod filenames detected",
      detail: "Check for accidental duplicate files before exporting.",
    });
  }
  if (configCount === 0) {
    items.push({
      tone: "warn",
      title: "No config files found",
      detail: "This may be expected for a fresh pack, but review configs before release.",
    });
  }

  return items;
}

function countConfigFiles(nodes: ConfigTreeNode[]): number {
  return nodes.reduce((count, node) => {
    if (!node.isDir) return count + 1;
    return count + countConfigFiles(node.children);
  }, 0);
}
