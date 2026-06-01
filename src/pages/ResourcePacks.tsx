import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { PageSearchBar } from "@/components/layout/PageSearchBar";
import { PageShell } from "@/components/layout/PageShell";
import { PageToolbar } from "@/components/layout/PageToolbar";
import { PackEditDialog } from "@/components/mods/PackEditDialog";
import { Button } from "@/components/ui/button";
import { PlatformLinkButton } from "@/components/ui/platform-link-button";
import { useInstances } from "@/hooks/useInstances";
import {
  usePacks,
  useUpdatePackMetadata,
} from "@/hooks/usePacks";
import { api } from "@/lib/api";
import type { DirectoryEntry, PackItem, PackType } from "@/lib/types";
import { useAppStore } from "@/store/app";

type DisplayRow =
  | { kind: "pack"; item: PackItem }
  | { kind: "file"; file: DirectoryEntry };

export function ResourcePacksPage() {
  const { data: instances = [] } = useInstances();
  const { selectedInstanceId, setSelectedInstance } = useAppStore();
  const instanceId = selectedInstanceId ?? instances[0]?.id ?? null;
  const selectedInstance =
    instances.find((instance) => instance.id === instanceId) ?? null;

  const [packTypeFilter, setPackTypeFilter] = useState<PackType>("resourcePack");
  const [search, setSearch] = useState("");
  const [editingItem, setEditingItem] = useState<PackItem | null>(null);

  const { data: packs = [] } = usePacks(instanceId, packTypeFilter);
  const updatePackMutation = useUpdatePackMetadata();

  const { data: scan, refetch, isFetching } = useQuery({
    queryKey: ["scan-resourcepacks", instanceId, selectedInstance?.gameDir],
    queryFn: () => api.scan.path(selectedInstance!.gameDir),
    enabled: !!selectedInstance?.gameDir,
  });

  const pathKind =
    packTypeFilter === "resourcePack" ? "resourcePacks" : "shaderPacks";
  const packPath = scan?.detectedPaths.find((path) => path.kind === pathKind);

  const { data: fileEntries = [] } = useQuery({
    queryKey: ["pack-files", packPath?.path],
    queryFn: () => (packPath?.path ? api.files.listDirectory(packPath.path) : []),
    enabled: !!packPath?.path,
  });

  const listRows = useMemo<DisplayRow[]>(() => {
    if (packs.length === 0) {
      return fileEntries.map((file) => ({ kind: "file", file }));
    }

    const knownPaths = new Set(packs.map((item) => item.filePath));
    return [
      ...packs.map((item) => ({ kind: "pack", item }) as DisplayRow),
      ...fileEntries
        .filter((file) => !knownPaths.has(file.path))
        .map((file) => ({ kind: "file", file }) as DisplayRow),
    ];
  }, [fileEntries, packs]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return listRows;
    }

    return listRows.filter((row) => {
      if (row.kind === "pack") {
        const item = row.item;
        return [
          item.metadata?.displayName,
          item.metadata?.author,
          item.fileName,
          item.filePath,
          item.metadata?.notes,
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query));
      }

      return [row.file.name, row.file.path]
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [listRows, search]);

  const listTitle =
    packTypeFilter === "resourcePack" ? "Resource Packs" : "Shader Packs";
  const emptyMessage = selectedInstance
    ? search.trim()
      ? `No ${packTypeFilter === "resourcePack" ? "resource" : "shader"} packs match your search.`
      : `No ${packTypeFilter === "resourcePack" ? "resource" : "shader"} packs found for this instance.`
    : `Select an instance to view its ${packTypeFilter === "resourcePack" ? "resource" : "shader"} packs.`;

  return (
    <div className="flex flex-col gap-5">
      <PageShell
        title="Resource Packs"
        description="Browse, toggle, and organize resource packs and shader packs per instance"
        controls={
          <>
            <select
              className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-muted)] px-3 text-sm"
              value={instanceId ?? ""}
              onChange={(e) => setSelectedInstance(e.target.value || null)}
              aria-label="Select instance"
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
              onClick={() => refetch()}
              disabled={isFetching || !selectedInstance}
            >
              <RefreshCw
                className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </>
        }
      />

      <PageToolbar
        search={
          <PageSearchBar
            value={search}
            onChange={setSearch}
            placeholder={`Search ${listTitle.toLowerCase()} by name, author, file...`}
          />
        }
        filters={
          <div className="text-sm text-[var(--color-muted-foreground)]">
            {filteredRows.length} of {listRows.length} shown
          </div>
        }
      />

      <PackListPanel
        rows={filteredRows}
        packTypeFilter={packTypeFilter}
        instanceId={instanceId}
        loading={isFetching && !packPath?.path}
        onSelectType={setPackTypeFilter}
        onEditItem={setEditingItem}
        emptyMessage={emptyMessage}
      />

      <PackEditDialog
        item={editingItem}
        open={!!editingItem}
        onOpenChange={(open) => !open && setEditingItem(null)}
        onSave={async (input) => {
          if (!editingItem) {
            throw new Error("No item to save");
          }

          const isFileEntry = editingItem.id === editingItem.filePath;
          if (!isFileEntry) {
            await updatePackMutation.mutateAsync(input);
            setEditingItem(null);
            return;
          }

          if (!instanceId) {
            throw new Error("No instance selected");
          }

          await api.packs.scan(instanceId, packTypeFilter);
          const list = await api.packs.list(instanceId, packTypeFilter);
          const found = list.find(
            (item) =>
              item.filePath === editingItem.filePath ||
              item.fileName === editingItem.fileName
          );

          if (!found) {
            throw new Error("Could not create pack record from file; try rescanning.");
          }

          await updatePackMutation.mutateAsync({ ...input, itemId: found.id });
          setEditingItem(null);
        }}
        saving={updatePackMutation.isPending}
      />
    </div>
  );
}

function PackListPanel({
  rows,
  packTypeFilter,
  instanceId,
  loading,
  onSelectType,
  onEditItem,
  emptyMessage,
}: {
  rows: DisplayRow[];
  packTypeFilter: PackType;
  instanceId: string | null;
  loading: boolean;
  onSelectType: (type: PackType) => void;
  onEditItem: (item: PackItem) => void;
  emptyMessage: string;
}) {
  return (
    <div className="relative rounded-lg border-2 border-dashed border-[var(--color-border)] p-2 pt-8">
      <div className="absolute left-4 top-0 -translate-y-1/2 rounded-full border border-[var(--color-border)] bg-[var(--color-background)] p-1 shadow-sm">
        <div className="flex items-center gap-1">
          <RibbonTab
            active={packTypeFilter === "resourcePack"}
            onClick={() => onSelectType("resourcePack")}
          >
            Resource Packs
          </RibbonTab>
          <RibbonTab
            active={packTypeFilter === "shaderPack"}
            onClick={() => onSelectType("shaderPack")}
          >
            Shader Packs
          </RibbonTab>
        </div>
      </div>

      <PackTable
        rows={rows}
        loading={loading}
        instanceId={instanceId}
        packTypeFilter={packTypeFilter}
        onEditItem={onEditItem}
        emptyMessage={emptyMessage}
      />
    </div>
  );
}

function RibbonTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-[var(--color-primary)] text-white"
          : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
      }`}
    >
      {children}
    </button>
  );
}

function PackTable({
  rows,
  loading,
  instanceId,
  packTypeFilter,
  onEditItem,
  emptyMessage,
}: {
  rows: DisplayRow[];
  loading: boolean;
  instanceId: string | null;
  packTypeFilter: PackType;
  onEditItem: (item: PackItem) => void;
  emptyMessage: string;
}) {
  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center text-[var(--color-muted-foreground)]">
        Loading packs...
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 text-[var(--color-muted-foreground)]">
        <p>{emptyMessage}</p>
        <p className="text-xs">
          Toggle between tabs or refresh after scanning the instance folders.
        </p>
      </div>
    );
  }

  const handleEditFile = (file: DirectoryEntry) => {
    onEditItem({
      id: file.path,
      instanceId: instanceId ?? "",
      packType: packTypeFilter,
      fileName: file.name,
      filePath: file.path,
      isDir: file.isDir,
          enabled: false,
          metadata: {
        displayName: file.name,
        author: "",
        websiteUrl: null,
        notes: "",
      },
    });
  };

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] bg-[var(--color-muted)]">
            <th className="px-4 py-3 text-left font-medium">Name</th>
            <th className="px-4 py-3 text-left font-medium">Author</th>
            <th className="px-4 py-3 text-left font-medium">Link</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            if (row.kind === "pack") {
              const item = row.item;
              return (
                <tr
                  key={item.id}
                  className="cursor-pointer border-b border-[var(--color-border)]/50 hover:bg-[var(--color-muted)]/50"
                  onClick={() => onEditItem(item)}
                >
                  <td className="px-4 py-3 font-medium">
                    <div className="flex flex-col gap-1">
                      <span>{item.metadata?.displayName || item.fileName}</span>
                      <span className="max-w-[260px] truncate text-xs text-[var(--color-muted-foreground)]">
                        {item.fileName}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-muted-foreground)]">
                    {item.metadata?.author || "-"}
                  </td>
                  <td className="px-4 py-3">
                    <PlatformLinkButton url={item.metadata?.websiteUrl ?? null} />
                  </td>
                </tr>
              );
            }

            const file = row.file;
            return (
              <tr
                key={file.path}
                className="cursor-pointer border-b border-[var(--color-border)]/50 hover:bg-[var(--color-muted)]/50"
                onClick={() => handleEditFile(file)}
              >
                <td className="px-4 py-3 font-medium">
                  <div className="flex flex-col gap-1">
                    <span>{file.name}</span>
                    <span className="max-w-[260px] truncate text-xs text-[var(--color-muted-foreground)]">
                      {file.path}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-[var(--color-muted-foreground)]">
                  -
                </td>
                <td className="px-4 py-3 text-[var(--color-muted-foreground)]">
                  -
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
