import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { PageSearchBar } from "@/components/layout/PageSearchBar";
import { Button } from "@/components/ui/button";
import { ConfigEditor } from "@/components/configs/ConfigEditor";
import { ConfigTree } from "@/components/configs/ConfigTree";
import { FileTabs } from "@/components/configs/FileTabs";
import { useInstances } from "@/hooks/useInstances";
import { api } from "@/lib/api";
import { getResolvedConfigPath } from "@/lib/instance-paths";
import type { ConfigTreeNode } from "@/lib/types";
import { useAppStore } from "@/store/app";
import { useConfigsStore } from "@/store/configsStore";

export default function ConfigsPage() {
  const [configSearch, setConfigSearch] = useState("");
  const { data: instances = [] } = useInstances();
  const { selectedInstanceId, setSelectedInstance } = useAppStore();
  const {
    configTree,
    openTabs,
    activeTabPath,
    setConfigTree,
    openFile,
    closeFile,
    setActiveTabPath,
    reset,
  } = useConfigsStore();
  const instanceId = selectedInstanceId ?? instances[0]?.id ?? null;
  const selectedInstance = useMemo(
    () => instances.find((instance) => instance.id === instanceId) ?? null,
    [instances, instanceId]
  );
  const filteredConfigTree = useMemo(
    () => filterConfigTree(configTree, configSearch),
    [configTree, configSearch]
  );
  const resolvedConfigPath = selectedInstance
    ? getResolvedConfigPath(selectedInstance)
    : null;

  const scanConfigs = async () => {
    if (!resolvedConfigPath) return;
    try {
      const tree = await api.configs.scanTree(resolvedConfigPath);
      setConfigTree(tree);
    } catch (e) {
      console.error(e);
      setConfigTree([]);
    }
  };

  useEffect(() => {
    reset();
    void scanConfigs();
  }, [resolvedConfigPath]);

  return (
    <div className="flex h-full min-h-[calc(100vh-3rem)] flex-col gap-5">
      <PageShell
        title="Configs"
        description="Browse and edit config files for the selected instance"
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
              type="button"
              variant="outline"
              disabled={!selectedInstance}
              onClick={scanConfigs}
            >
              <RefreshCw className="h-4 w-4" />
              Scan
            </Button>
          </>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
        <aside className="min-h-0 border-r border-[var(--color-border)]">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="text-sm font-medium">Config Files</h2>
            <p className="mt-1 truncate text-xs text-[var(--color-muted-foreground)]">
              {resolvedConfigPath ?? "Select an instance"}
            </p>
            <PageSearchBar
              value={configSearch}
              onChange={setConfigSearch}
              placeholder="Search config files..."
              className="mt-3 sm:max-w-none"
            />
          </div>
          <ConfigTree
            nodes={filteredConfigTree}
            activePath={activeTabPath}
            onOpenFile={openFile}
            searchActive={configSearch.trim().length > 0}
          />
        </aside>

        <main className="flex min-h-0 flex-col overflow-hidden">
          <FileTabs
            activePath={activeTabPath}
            openTabs={openTabs}
            onSelect={setActiveTabPath}
            onClose={closeFile}
          />
          {activeTabPath ? (
            <ConfigEditor filePath={activeTabPath} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-muted-foreground)]">
              Select a config file to view or edit.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function filterConfigTree(
  nodes: ConfigTreeNode[],
  search: string
): ConfigTreeNode[] {
  const query = search.trim().toLowerCase();

  if (!query) {
    return nodes;
  }

  return nodes.flatMap((node) => {
    const selfMatches =
      node.name.toLowerCase().includes(query) ||
      node.path.toLowerCase().includes(query);
    const children = filterConfigTree(node.children, query);

    if (node.isDir) {
      return selfMatches || children.length > 0
        ? [{ ...node, children: selfMatches ? node.children : children }]
        : [];
    }

    return selfMatches ? [node] : [];
  });
}
