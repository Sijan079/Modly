import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { CheckCircle2, FolderOpen, Loader2, Plus, Import, XCircle } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { PageSearchBar } from "@/components/layout/PageSearchBar";
import { PageToolbar } from "@/components/layout/PageToolbar";
import { InstanceCard } from "@/components/instances/InstanceCard";
import { InstanceEditDialog } from "@/components/instances/InstanceEditDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useInstances,
  useCreateInstance,
  useDeleteInstance,
} from "@/hooks/useInstances";
import { useAppStore, filterInstances } from "@/store/app";
import { useConfigsStore } from "@/store/configsStore";
import { api } from "@/lib/api";
import { buildExportDefaultPath } from "@/lib/export-paths";
import type { Instance, LoaderType, UpdateInstanceInput } from "@/lib/types";

type PreloadState =
  | { status: "idle"; step: string; error: null }
  | { status: "loading"; step: string; error: null }
  | { status: "error"; step: string; error: string };

export function InstancesPage() {
  const queryClient = useQueryClient();
  const { data: instances = [], isLoading } = useInstances();
  const createMutation = useCreateInstance();
  const deleteMutation = useDeleteInstance();
  const { selectedInstanceId, setSelectedInstance } = useAppStore();
  const setConfigTree = useConfigsStore((state) => state.setConfigTree);
  const [instanceSearch, setInstanceSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editingInstance, setEditingInstance] = useState<Instance | null>(null);
  const [newName, setNewName] = useState("");
  const [newDir, setNewDir] = useState("");
  const [newLoader, setNewLoader] = useState<LoaderType>("fabric");
  const [newVersion, setNewVersion] = useState("");
  const [preload, setPreload] = useState<PreloadState>({
    status: "idle",
    step: "",
    error: null,
  });

  const filtered = useMemo(
    () => filterInstances(instances, instanceSearch),
    [instances, instanceSearch]
  );

  const updateMutation = useMutation({
    mutationFn: (input: UpdateInstanceInput) => api.instances.update(input),
    onSuccess: (instance) => {
      queryClient.invalidateQueries({ queryKey: ["instances"] });
      queryClient.invalidateQueries({ queryKey: ["instance", instance.id] });
    },
  });

  const exportMutation = useMutation({
    mutationFn: ({
      instanceId,
      outputPath,
    }: {
      instanceId: string;
      outputPath: string;
    }) => api.instances.exportZip(instanceId, outputPath),
  });

  const handleCreate = async () => {
    const missingFields = [
      !newName.trim() ? "Name" : null,
      !newDir.trim() ? "Game Directory" : null,
      !newVersion.trim() ? "Minecraft Version" : null,
    ].filter(Boolean);

    if (missingFields.length > 0) {
      window.alert(`Please fill in the required fields: ${missingFields.join(", ")}`);
      return;
    }

    const instance = await createMutation.mutateAsync({
      name: newName.trim(),
      gameDir: newDir.trim(),
      loader: newLoader,
      mcVersion: newVersion.trim(),
    });

    const settings = await api.settings.get();
    if (settings.autoScanOnInstanceAdd) {
      await preloadInstanceContent(instance, settings.autoAuditAfterScan);
    } else {
      setSelectedInstance(instance.id);
      queryClient.invalidateQueries({ queryKey: ["instances"] });
      setShowCreate(false);
      setNewName("");
      setNewDir("");
      setNewVersion("");
    }
  };

  const preloadInstanceContent = async (instance: Instance, auditAfterScan: boolean) => {
    setPreload({
      status: "loading",
      step: "Scanning mods, resource packs, shader packs, and config files...",
      error: null,
    });
    setSelectedInstance(instance.id);

    try {
      const [modsResult, resourcePacksResult, shaderPacksResult, configResult] =
        await Promise.allSettled([
          api.mods.scan(instance.id),
          api.packs.scan(instance.id, "resourcePack"),
          api.packs.scan(instance.id, "shaderPack"),
          api.configs.scanTree(instance.gameDir),
        ]);

      const failures = [
        preloadFailure("Mods", modsResult),
        preloadFailure("Resource packs", resourcePacksResult),
        preloadFailure("Shader packs", shaderPacksResult),
        preloadFailure("Configs", configResult),
      ].filter(Boolean);

      if (configResult.status === "fulfilled") {
        setConfigTree(configResult.value);
      }

      if (auditAfterScan && modsResult.status === "fulfilled") {
        await api.mods.checkIntegrity(instance.id);
      }

      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ["instances"] }),
        queryClient.invalidateQueries({ queryKey: ["mods", instance.id] }),
        queryClient.invalidateQueries({
          queryKey: ["mod-integrity-audit", instance.id],
        }),
        queryClient.invalidateQueries({ queryKey: ["logs"] }),
        queryClient.invalidateQueries({
          queryKey: ["packs", instance.id, "resourcePack"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["packs", instance.id, "shaderPack"],
        }),
        queryClient.invalidateQueries({ queryKey: ["categories", instance.id] }),
        queryClient.prefetchQuery({
          queryKey: ["mods", instance.id],
          queryFn: () => api.mods.list(instance.id),
        }),
        queryClient.prefetchQuery({
          queryKey: ["packs", instance.id, "resourcePack"],
          queryFn: () => api.packs.list(instance.id, "resourcePack"),
        }),
        queryClient.prefetchQuery({
          queryKey: ["packs", instance.id, "shaderPack"],
          queryFn: () => api.packs.list(instance.id, "shaderPack"),
        }),
      ]);

      if (failures.length > 0) {
        setPreload({
          status: "error",
          step: "The instance was created, but some content could not be pre-loaded.",
          error: failures.join("\n"),
        });
        return;
      }

      setPreload({ status: "idle", step: "", error: null });
      setShowCreate(false);
      setNewName("");
      setNewDir("");
      setNewVersion("");
    } catch (error) {
      setPreload({
        status: "error",
        step: "The instance was created, but content pre-loading failed.",
        error: String(error),
      });
    }
  };

  const handlePickCreateDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected && typeof selected === "string") {
      setNewDir(selected);
    }
  };

  const handleImport = async () => {
    const file = await open({
      multiple: false,
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    if (!file || typeof file !== "string") return;

    const settings = await api.settings.get();
    const dest =
      settings.instancesDir ??
      (await api.scan.defaultPath())?.replace(".minecraft", "modpacks") ??
      "";

    const name = prompt("Instance name:", "Imported Modpack");
    if (!name) return;

    await api.instances.importZip(name, file, dest);
    queryClient.invalidateQueries({ queryKey: ["instances"] });
  };

  const handleExport = async (instance: Instance) => {
    const settings = await api.settings.get();
    const exportPath = await save({
      defaultPath: buildExportDefaultPath(
        settings.exportModpackDir,
        `${instance.name}.zip`
      ),
      filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
    });
    if (!exportPath) return;

    await exportMutation.mutateAsync({
      instanceId: instance.id,
      outputPath: exportPath,
    });
  };

  const handleDelete = async (instance: Instance) => {
    const shouldDelete = await confirm(
      `Delete "${instance.name}" from the list?\n\nThis keeps the instance folder on disk unless you confirm file deletion in the next step.`,
      {
        title: "Delete Instance",
        kind: "warning",
        okLabel: "Remove from List",
        cancelLabel: "Cancel",
      }
    );
    if (!shouldDelete) return;

    const deleteFiles = await confirm(
      `Also delete the instance files for "${instance.name}" from disk?`,
      {
        title: "Delete Instance Files",
        kind: "warning",
        okLabel: "Delete Files Too",
        cancelLabel: "Keep Files",
      }
    );

    await deleteMutation.mutateAsync({
      id: instance.id,
      deleteFiles,
    });

    if (selectedInstanceId === instance.id) {
      setSelectedInstance(null);
    }
    if (editingInstance?.id === instance.id) {
      setEditingInstance(null);
    }
  };

  const description =
    instances.length > 0 ? (
      <>
        Manage modpack profiles and instance folders
        <span className="ml-1 text-[var(--color-foreground)]">
          - {filtered.length} of {instances.length} shown
        </span>
      </>
    ) : (
      "Manage modpack profiles and instance folders"
    );

  return (
    <div className="flex flex-col gap-5">
      <PageShell
        title="Instances"
        description={description}
        controls={
          <>
            <Button variant="outline" onClick={handleImport}>
              <Import className="h-4 w-4" />
              Import ZIP
            </Button>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" />
              New Instance
            </Button>
          </>
        }
      />

      <PageToolbar
        search={
          <PageSearchBar
            value={instanceSearch}
            onChange={setInstanceSearch}
            placeholder="Search instances by name, path, version..."
          />
        }
      />

      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle>Create Instance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="My Modpack"
                  aria-required="true"
                />
              </div>
              <div className="space-y-2">
                <Label>Game Directory *</Label>
                <div className="flex gap-2">
                  <Input
                    value={newDir}
                    onChange={(e) => setNewDir(e.target.value)}
                    placeholder="C:\\Games\\MyModpack"
                    aria-required="true"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={handlePickCreateDir}
                    aria-label="Select game directory"
                    title="Select game directory"
                  >
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Loader</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-muted)] px-3 text-sm"
                  value={newLoader}
                  onChange={(e) => setNewLoader(e.target.value as LoaderType)}
                >
                  <option value="vanilla">Vanilla</option>
                  <option value="fabric">Fabric</option>
                  <option value="forge">Forge</option>
                  <option value="neoforge">NeoForge</option>
                  <option value="quilt">Quilt</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Minecraft Version *</Label>
                <Input
                  value={newVersion}
                  onChange={(e) => setNewVersion(e.target.value)}
                  placeholder="1.20.1"
                  aria-required="true"
                />
              </div>
            </div>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Fields marked with * are required.
            </p>
            <div className="flex gap-2">
              <Button
                onClick={handleCreate}
                disabled={createMutation.isPending || preload.status === "loading"}
              >
                Create
              </Button>
              <Button
                variant="ghost"
                onClick={() => setShowCreate(false)}
                disabled={preload.status === "loading"}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <InstancePreloadOverlay
        state={preload}
        onClose={() => setPreload({ status: "idle", step: "", error: null })}
      />

      {isLoading ? (
        <p className="text-[var(--color-muted-foreground)]">Loading instances...</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex h-48 flex-col items-center justify-center gap-2 p-6">
            <p className="text-[var(--color-muted-foreground)]">
              {instances.length > 0
                ? "No instances match your search"
                : "No instances yet"}
            </p>
            {instances.length === 0 ? (
              <Button onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4" />
                Create your first instance
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setInstanceSearch("")}>
                Clear search
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((instance) => (
            <InstanceCard
              key={instance.id}
              instance={instance}
              selected={selectedInstanceId === instance.id}
              onClick={() => {
                setSelectedInstance(instance.id);
              }}
              onEdit={() => setEditingInstance(instance)}
              onOpenFolder={() => api.files.openInExplorer(instance.gameDir)}
              onDuplicate={async () => {
                const name = `${instance.name} (Copy)`;
                const dir = `${instance.gameDir}_copy`;
                await api.instances.duplicate(instance.id, name, dir);
                queryClient.invalidateQueries({ queryKey: ["instances"] });
              }}
              onDelete={() => {
                void handleDelete(instance);
              }}
            />
          ))}
        </div>
      )}
      <InstanceEditDialog
        instance={editingInstance}
        open={!!editingInstance}
        onOpenChange={(open) => !open && setEditingInstance(null)}
        onSave={async (input) => {
          const updated = await updateMutation.mutateAsync(input);
          setSelectedInstance(updated.id);
          setEditingInstance(null);
        }}
        saving={updateMutation.isPending}
        onExport={handleExport}
        exporting={exportMutation.isPending}
      />
    </div>
  );
}

function preloadFailure(
  label: string,
  result: PromiseSettledResult<unknown>
): string | null {
  if (result.status === "fulfilled") return null;
  return `${label}: ${String(result.reason)}`;
}

function InstancePreloadOverlay({
  state,
  onClose,
}: {
  state: PreloadState;
  onClose: () => void;
}) {
  if (state.status === "idle") return null;

  const loading = state.status === "loading";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 px-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="instance-preload-title"
      aria-describedby="instance-preload-description"
    >
      <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-6 shadow-2xl">
        <div className="flex items-start gap-4">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--color-muted)]">
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-[var(--color-primary)]" />
            ) : state.error ? (
              <XCircle className="h-5 w-5 text-[var(--color-destructive)]" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-[var(--color-accent)]" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="instance-preload-title" className="text-base font-semibold">
              {loading ? "Pre-loading instance content" : "Pre-load needs attention"}
            </h2>
            <p
              id="instance-preload-description"
              className="mt-2 text-sm text-[var(--color-muted-foreground)]"
            >
              {state.step}
            </p>
            {loading && (
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-[var(--color-muted)]">
                <div className="h-full w-1/2 animate-[splash-progress_1.15s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-accent)]" />
              </div>
            )}
            {state.error && (
              <pre className="mt-4 max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-xs text-[var(--color-muted-foreground)]">
                {state.error}
              </pre>
            )}
            {!loading && (
              <Button className="mt-5" onClick={onClose}>
                Close
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
