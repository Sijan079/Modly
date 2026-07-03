import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Expand, ExternalLink, Minus, Network, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PageShell } from "@/components/layout/PageShell";
import { PageSearchBar } from "@/components/layout/PageSearchBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useInstances } from "@/hooks/useInstances";
import {
  useInstanceRelationshipGraph,
  useMods,
  useUpdateModMetadata,
} from "@/hooks/useMods";
import { useQuery } from "@tanstack/react-query";
import type {
  ModFile,
  ModRelationshipEdge,
  ModRelationshipGraphNode,
  ModRelationshipType,
  UpdateModRelationshipInput,
} from "@/lib/types";
import { useAppStore } from "@/store/app";

type EdgeFilter = "all" | ModRelationshipType;
type LayoutMode = "force" | "radial";
type GraphNodeRole = "dependency" | "mod" | "addon";

type GraphNodeData = {
  label: string;
  color: string;
  degree: number;
  size: number;
  role: GraphNodeRole;
  iconUrl: string | null;
  showLabel: boolean;
  dimmed: boolean;
  highlighted: boolean;
  selected: boolean;
};

const GRAPH_COLORS = [
  "#6f7bf7",
  "#ff9f43",
  "#ef5da8",
  "#15aabf",
  "#ffd43b",
  "#845ef7",
  "#4dabf7",
  "#63e6be",
];

function GraphBubbleNode({ data, selected }: NodeProps<Node<GraphNodeData>>) {
  const [hovered, setHovered] = useState(false);
  const labelVisible =
    hovered || selected || data.selected || data.highlighted || data.showLabel;
  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!-translate-y-3 !h-2 !w-2 !border-0 !bg-transparent"
      />
      <div
        className="flex items-center justify-center rounded-full text-center transition-transform duration-150"
        style={{
          width: data.size,
          height: data.size,
          background: data.color,
          color: "white",
          opacity: data.dimmed ? 0.2 : 1,
          boxShadow: selected || data.selected
            ? `0 0 0 4px color-mix(in srgb, ${data.color} 20%, white), 0 18px 30px rgba(0,0,0,0.25)`
            : data.highlighted
              ? `0 0 0 2px color-mix(in srgb, ${data.color} 14%, white), 0 14px 22px rgba(0,0,0,0.2)`
            : "0 10px 24px rgba(0,0,0,0.18)",
          transform: selected || data.selected ? "scale(1.05)" : hovered ? "scale(1.03)" : "scale(1)",
        }}
        title={data.label}
      >
        {data.iconUrl ? (
          <img
            src={data.iconUrl}
            alt=""
            className="h-full w-full rounded-full object-cover"
            draggable={false}
          />
        ) : (
          <span
            className="text-sm font-semibold uppercase"
            style={{ fontSize: Math.max(10, Math.min(18, data.size / 3.2)) }}
          >
            {getNodeMonogram(data.label)}
          </span>
        )}
        {labelVisible ? (
          <div className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 min-w-max -translate-x-1/2 rounded-md border border-white/10 bg-black/75 px-2 py-1 shadow-lg backdrop-blur">
            <p className="text-[11px] font-semibold leading-tight">{data.label}</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.18em] opacity-70">
              {data.role === "dependency"
                ? "Dependency Hub"
                : data.role === "addon"
                  ? "Add-on Branch"
                  : "Connected Mod"}
            </p>
            <p className="mt-1 text-[10px] opacity-80">{data.degree} links</p>
          </div>
        ) : null}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!translate-y-3 !h-2 !w-2 !border-0 !bg-transparent"
      />
    </div>
  );
}

const nodeTypes = {
  bubble: GraphBubbleNode,
};

function GraphControlsRail() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  return (
    <Panel position="bottom-right">
      <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#11151c]/90 shadow-[0_18px_40px_rgba(0,0,0,0.32)] backdrop-blur">
        <button
          type="button"
          className="flex h-[42px] w-[42px] items-center justify-center border-0 border-b border-white/6 bg-transparent text-[rgba(232,234,237,0.84)] transition-colors hover:bg-white/6 hover:text-[var(--color-foreground)]"
          onClick={() => void zoomIn()}
          aria-label="Zoom in"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="flex h-[42px] w-[42px] items-center justify-center border-0 border-b border-white/6 bg-transparent text-[rgba(232,234,237,0.84)] transition-colors hover:bg-white/6 hover:text-[var(--color-foreground)]"
          onClick={() => void zoomOut()}
          aria-label="Zoom out"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="flex h-[42px] w-[42px] items-center justify-center border-0 bg-transparent text-[rgba(232,234,237,0.84)] transition-colors hover:bg-white/6 hover:text-[var(--color-foreground)]"
          onClick={() => void fitView({ padding: 0.18 })}
          aria-label="Fit view"
        >
          <Expand className="h-4 w-4" />
        </button>
      </div>
    </Panel>
  );
}

export function RelationshipsPage() {
  const { data: instances = [] } = useInstances();
  const { selectedInstanceId, setSelectedInstance } = useAppStore();
  const instanceId = selectedInstanceId ?? instances[0]?.id ?? null;
  const selectedInstance =
    instances.find((instance) => instance.id === instanceId) ?? null;
  const { data: mods = [] } = useMods(instanceId);
  const { data: graph = null, isLoading: graphLoading } =
    useInstanceRelationshipGraph(instanceId);

  const [edgeFilter, setEdgeFilter] = useState<EdgeFilter>("all");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("force");
  const [activeModId, setActiveModId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const searchedMod = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return null;
    return (
      mods.find((mod) =>
        [mod.metadata?.name ?? "", mod.fileName, mod.metadata?.modId ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(query)
      ) ?? null
    );
  }, [mods, search]);

  const modrinthProjectByModId = useMemo(() => {
    const entries = mods
      .map((mod) => [
        mod.id,
        extractModrinthProjectId(mod.metadata?.modrinthUrl ?? mod.sourceUrl ?? null),
      ] as const)
      .filter((entry): entry is readonly [string, string] => !!entry[1]);
    return new Map(entries);
  }, [mods]);

  const { data: modIconByModId = new Map<string, string | null>() } = useQuery({
    queryKey: [
      "modrinth-graph-icons",
      Array.from(modrinthProjectByModId.entries()).sort(([a], [b]) => a.localeCompare(b)),
    ],
    enabled: modrinthProjectByModId.size > 0,
    queryFn: async () => {
      const results = await Promise.all(
        Array.from(modrinthProjectByModId.entries()).map(async ([modId, projectId]) => {
          try {
            const response = await fetch(`https://api.modrinth.com/v2/project/${projectId}`);
            if (!response.ok) return [modId, null] as const;
            const project = (await response.json()) as { icon_url?: string | null };
            return [modId, project.icon_url ?? null] as const;
          } catch {
            return [modId, null] as const;
          }
        })
      );
      return new Map(results);
    },
    staleTime: 1000 * 60 * 30,
  });

  const focusModId = activeModId ?? searchedMod?.id ?? null;
  const selectedMod = mods.find((mod) => mod.id === focusModId) ?? null;

  const filteredEdges = useMemo(() => {
    const edges = graph?.edges ?? [];
    return edgeFilter === "all"
      ? edges
      : edges.filter((edge) => edge.relationshipType === edgeFilter);
  }, [edgeFilter, graph?.edges]);

  const connectedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const edge of filteredEdges) {
      ids.add(edge.sourceModId);
      ids.add(edge.targetModId);
    }
    return ids;
  }, [filteredEdges]);

  const highlightedNodeIds = useMemo(() => {
    if (!focusModId) return new Set<string>();
    const ids = new Set<string>([focusModId]);
    for (const edge of filteredEdges) {
      if (edge.sourceModId === focusModId) ids.add(edge.targetModId);
      if (edge.targetModId === focusModId) ids.add(edge.sourceModId);
    }
    return ids;
  }, [filteredEdges, focusModId]);

  const flowNodes = useMemo<Node<GraphNodeData>[]>(() => {
    const nodes = graph?.nodes ?? [];
    return buildFlowNodes(
      nodes,
      filteredEdges,
      connectedNodeIds,
      layoutMode,
      modIconByModId,
      focusModId,
      highlightedNodeIds
    );
  }, [
    connectedNodeIds,
    filteredEdges,
    graph?.nodes,
    layoutMode,
    modIconByModId,
    focusModId,
    highlightedNodeIds,
  ]);

  const flowEdges = useMemo<Edge[]>(() => {
    return filteredEdges.map((edge) => ({
      id: edge.id,
      source: edge.sourceModId,
      target: edge.targetModId,
      animated: false,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: {
        stroke:
          focusModId &&
          !highlightedNodeIds.has(edge.sourceModId) &&
          !highlightedNodeIds.has(edge.targetModId)
            ? "rgba(148, 163, 184, 0.10)"
            : "rgba(148, 163, 184, 0.34)",
        strokeWidth: edge.relationshipType === "addon_for" ? 1.8 : 1.4,
        opacity:
          focusModId &&
          !highlightedNodeIds.has(edge.sourceModId) &&
          !highlightedNodeIds.has(edge.targetModId)
            ? 0.15
            : 1,
      },
      className: edge.relationshipType === "addon_for" ? "relationship-edge-addon" : "relationship-edge-dependency",
    }));
  }, [filteredEdges, focusModId, highlightedNodeIds]);

  const handleNodeClick = useMemo<NodeMouseHandler<Node<GraphNodeData>>>(
    () => (_event, node) => setActiveModId(node.id),
    []
  );

  return (
    <div className="flex flex-col gap-5">
      <PageShell
        title="Relationships"
        description={
          selectedInstance
            ? `Explore the manual relationship graph for ${selectedInstance.name}.`
            : "Explore manual dependency and add-on relationships for the selected instance."
        }
        controls={
          <>
            <PageSearchBar
              value={search}
              onChange={setSearch}
              placeholder="Search mods in graph..."
              className="sm:max-w-xs"
            />
            <select
              className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-muted)] px-3 text-sm"
              value={instanceId ?? ""}
              onChange={(event) => setSelectedInstance(event.target.value || null)}
              aria-label="Select instance"
            >
              <option value="">Select instance</option>
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.name}
                </option>
              ))}
            </select>
            <FilterTabs value={edgeFilter} onChange={setEdgeFilter} />
          </>
        }
      />

      {!instanceId ? (
        <Card>
          <CardContent className="flex h-56 items-center justify-center text-[var(--color-muted-foreground)]">
            Select an instance to inspect relationships.
          </CardContent>
        </Card>
      ) : graphLoading ? (
        <Card>
          <CardContent className="flex h-[36rem] items-center justify-center text-[var(--color-muted-foreground)]">
            Loading relationship graph...
          </CardContent>
        </Card>
      ) : !graph || graph.edges.length === 0 ? (
        <EmptyGraphState
          mods={mods}
          selectedInstanceName={selectedInstance?.name ?? "this instance"}
          onOpenFirst={() => setActiveModId(mods[0]?.id ?? null)}
        />
      ) : filteredEdges.length === 0 ? (
        <Card>
          <CardContent className="flex h-[32rem] items-center justify-center text-[var(--color-muted-foreground)]">
            No connected mods match the current relationship filter.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-[var(--color-border)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Network className="h-5 w-5 text-[var(--color-primary)]" />
                  Manual Relationship Graph
                </CardTitle>
                <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
                  Hover for names, search to focus a mod, click to inspect and edit its manual links.
                </p>
              </div>
              <GraphStats
                nodeCount={flowNodes.length}
                edgeCount={filteredEdges.length}
                layoutMode={layoutMode}
                onLayoutChange={setLayoutMode}
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="relationships-graph h-[calc(100vh-15rem)] min-h-[38rem] bg-[radial-gradient(circle_at_50%_40%,rgba(255,255,255,0.08),transparent_24%),linear-gradient(180deg,#11151c,#0b0e13)]">
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.18 }}
                minZoom={0.2}
                maxZoom={1.4}
                onNodeClick={handleNodeClick}
                nodesDraggable
                nodesConnectable={false}
                elementsSelectable
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={30} size={1} color="rgba(255,255,255,0.04)" />
                <GraphControlsRail />
              </ReactFlow>
            </div>
          </CardContent>
        </Card>
      )}

      <RelationshipModal
        mod={selectedMod}
        mods={mods}
        open={!!selectedMod}
        onOpenChange={(open) => {
          if (!open) setActiveModId(null);
        }}
      />
    </div>
  );
}

function FilterTabs({
  value,
  onChange,
}: {
  value: EdgeFilter;
  onChange: (value: EdgeFilter) => void;
}) {
  const items: { value: EdgeFilter; label: string }[] = [
    { value: "all", label: "All Links" },
    { value: "dependency", label: "Dependencies" },
    { value: "addon_for", label: "Add-ons" },
  ];

  return (
    <div className="flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-1">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={`rounded px-3 py-1.5 text-sm ${
            value === item.value
              ? "bg-[var(--color-primary)] text-white"
              : "text-[var(--color-muted-foreground)]"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function EmptyGraphState({
  mods,
  selectedInstanceName,
  onOpenFirst,
}: {
  mods: ModFile[];
  selectedInstanceName: string;
  onOpenFirst: () => void;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex min-h-[32rem] flex-col items-center justify-center gap-5 bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.12),transparent_28%),linear-gradient(180deg,rgba(20,24,32,0.98),rgba(13,15,18,1))] p-10 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)]">
          <Sparkles className="h-8 w-8 text-[var(--color-accent)]" />
        </div>
        <div className="max-w-2xl space-y-2">
          <h2 className="text-2xl font-semibold">No manual relationships yet</h2>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Relationships only visualizes the manual links you create for {selectedInstanceName}.
            Add the first dependency or add-on relationship to bring the graph to life.
          </p>
        </div>
        <Button type="button" onClick={onOpenFirst} disabled={mods.length === 0}>
          <Plus className="h-4 w-4" />
          {mods.length === 0 ? "No mods available" : "Open a mod to add links"}
        </Button>
      </CardContent>
    </Card>
  );
}

function GraphStats({
  nodeCount,
  edgeCount,
  layoutMode,
  onLayoutChange,
}: {
  nodeCount: number;
  edgeCount: number;
  layoutMode: LayoutMode;
  onLayoutChange: (mode: LayoutMode) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
      <Badge variant="secondary">{nodeCount} mods</Badge>
      <Badge variant="secondary">{edgeCount} links</Badge>
      <div className="ml-2 flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-1">
        <button
          type="button"
          onClick={() => onLayoutChange("force")}
          className={`rounded px-2.5 py-1 text-xs ${
            layoutMode === "force"
              ? "bg-[var(--color-primary)] text-white"
              : "text-[var(--color-muted-foreground)]"
          }`}
        >
          Force
        </button>
        <button
          type="button"
          onClick={() => onLayoutChange("radial")}
          className={`rounded px-2.5 py-1 text-xs ${
            layoutMode === "radial"
              ? "bg-[var(--color-primary)] text-white"
              : "text-[var(--color-muted-foreground)]"
          }`}
        >
          Radial
        </button>
      </div>
    </div>
  );
}

function RelationshipModal({
  mod,
  mods,
  open,
  onOpenChange,
}: {
  mod: ModFile | null;
  mods: ModFile[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateModMutation = useUpdateModMetadata();
  const [draftRelatedMods, setDraftRelatedMods] = useState<UpdateModRelationshipInput[]>([]);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false);

  useEffect(() => {
    setDraftRelatedMods(mod?.relatedMods ?? []);
    setSelectedRows([]);
    setConfirmDeleteSelected(false);
  }, [mod?.id, mod?.relatedMods]);

  const relationshipOptions = useMemo(
    () =>
      [...mods]
        .filter((candidate) => candidate.id !== mod?.id)
        .sort((a, b) => getModDisplayName(a).localeCompare(getModDisplayName(b))),
    [mods, mod?.id]
  );

  const isDraftChanged =
    JSON.stringify(draftRelatedMods) !== JSON.stringify(mod?.relatedMods ?? []);
  const selectedCount = selectedRows.length;

  const addRelatedMod = () => {
    const nextTarget = relationshipOptions.find(
      (candidate) =>
        !draftRelatedMods.some((relatedMod) => relatedMod.targetModId === candidate.id)
    );

    setDraftRelatedMods((current) => [
      ...current,
      {
        targetModId: nextTarget?.id ?? "",
        relationshipType: "dependency",
      },
    ]);
    setConfirmDeleteSelected(false);
  };

  const updateRelatedMod = (
    index: number,
    patch: Partial<UpdateModRelationshipInput>
  ) => {
    setDraftRelatedMods((current) =>
      current.map((relatedMod, relatedIndex) =>
        relatedIndex === index ? { ...relatedMod, ...patch } : relatedMod
      )
    );
  };

  const toggleRowSelection = (index: number, checked: boolean) => {
    setSelectedRows((current) => {
      if (checked) {
        return current.includes(index) ? current : [...current, index].sort((a, b) => a - b);
      }
      return current.filter((rowIndex) => rowIndex !== index);
    });
    setConfirmDeleteSelected(false);
  };

  const handleDeleteSelected = () => {
    if (selectedRows.length === 0) return;
    setConfirmDeleteSelected(true);
  };

  const confirmBulkDelete = () => {
    if (selectedRows.length === 0) {
      setConfirmDeleteSelected(false);
      return;
    }

    const selectedSet = new Set(selectedRows);
    setDraftRelatedMods((current) => current.filter((_, index) => !selectedSet.has(index)));
    setSelectedRows([]);
    setConfirmDeleteSelected(false);
  };

  const handleSaveRelationships = () => {
    if (!mod) return;
    updateModMutation.mutate(
      {
        modId: mod.id,
        name: mod.metadata?.name ?? mod.fileName.replace(/\.jar$/i, ""),
        version: mod.metadata?.version ?? "",
        authors: mod.metadata?.authors ?? [],
        modrinthUrl: mod.metadata?.modrinthUrl ?? null,
        sourceUrl: mod.sourceUrl,
        loader: mod.metadata?.loader ?? "unknown",
        side: mod.metadata?.side ?? "unknown",
        modIdField: mod.metadata?.modId ?? null,
        installedModrinthVersionId:
          mod.metadata?.installedModrinthVersionId ?? null,
        categoryIds: mod.categories.map((category) => category.id),
        relatedMods: draftRelatedMods.filter((relatedMod) => relatedMod.targetModId),
      },
      {
        onSuccess: () => onOpenChange(false),
      }
    );
  };

  const selectedModSourceUrl = buildSelectedModSourceUrl(mod);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        {!mod ? null : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {getModDisplayName(mod)}
                {selectedModSourceUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => openUrl(selectedModSourceUrl)}
                    title="Open mod source page"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                )}
              </DialogTitle>
              <DialogDescription>
                Manage this mod&apos;s outgoing manual relationships.
              </DialogDescription>
            </DialogHeader>

            <Card>
              <CardHeader className="gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle>Outgoing Relationships</CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={addRelatedMod}>
                      <Plus className="h-4 w-4" />
                      Add Link
                    </Button>
                    {selectedCount > 0 ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleDeleteSelected}
                        className="border border-red-500/40 bg-red-500/10 text-red-600 hover:bg-red-500/20 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete Selected
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSaveRelationships}
                      disabled={updateModMutation.isPending || !isDraftChanged}
                    >
                      <Save className="h-4 w-4" />
                      Save Relationships
                    </Button>
                  </div>
                </div>
                {confirmDeleteSelected ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm">
                    <span>Delete {selectedCount} selected link{selectedCount === 1 ? "" : "s"}?</span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmDeleteSelected(false)}
                      >
                        No
                      </Button>
                      <Button type="button" size="sm" onClick={confirmBulkDelete}>
                        Yes
                      </Button>
                    </div>
                  </div>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                {draftRelatedMods.length === 0 ? (
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    No outgoing relationships yet.
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
                    <table className="w-full border-collapse text-sm">
                      <thead className="bg-[var(--color-muted)]/60 text-left">
                        <tr className="border-b border-[var(--color-border)]">
                          <th className="w-12 px-3 py-2" />
                          <th className="px-3 py-2 font-medium">Related Mod</th>
                          <th className="w-40 px-3 py-2 font-medium">Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {draftRelatedMods.map((row, index) => (
                          <tr
                            key={`${row.targetModId || "new"}-${index}`}
                            className="border-b border-[var(--color-border)] last:border-b-0"
                          >
                            <td className="px-3 py-2 align-middle">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border border-[var(--color-input)] bg-[var(--color-card)] accent-[var(--color-primary)]"
                                checked={selectedRows.includes(index)}
                                onChange={(event) => toggleRowSelection(index, event.target.checked)}
                                aria-label={`Select relationship row ${index + 1}`}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <RelatedModPicker
                                value={row.targetModId}
                                options={relationshipOptions}
                                disabledIds={draftRelatedMods
                                  .filter((_, existingIndex) => existingIndex !== index)
                                  .map((existing) => existing.targetModId)}
                                onChange={(targetModId) => updateRelatedMod(index, { targetModId })}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <select
                                className="flex h-9 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-muted)] px-3 text-sm"
                                value={row.relationshipType}
                                onChange={(event) =>
                                  updateRelatedMod(index, {
                                    relationshipType: event.target.value as ModRelationshipType,
                                  })
                                }
                              >
                                <option value="dependency">Dependency</option>
                                <option value="addon_for">Add-on For</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RelatedModPicker({
  value,
  options,
  disabledIds,
  onChange,
}: {
  value: string;
  options: ModFile[];
  disabledIds: string[];
  onChange: (targetModId: string) => void;
}) {
  const availableOptions = options.filter(
    (candidate) => !disabledIds.includes(candidate.id) || candidate.id === value
  );

  return (
    <select
      className="flex h-9 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-muted)] px-3 text-sm"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Select related mod</option>
      {availableOptions.map((candidate) => (
        <option key={candidate.id} value={candidate.id}>
          {getModDisplayName(candidate)}
        </option>
      ))}
    </select>
  );
}

function getModDisplayName(mod: ModFile) {
  return mod.metadata?.name ?? mod.fileName;
}

function buildSelectedModSourceUrl(mod: ModFile | null) {
  if (!mod) return null;

  const baseUrl = mod.metadata?.modrinthUrl ?? mod.sourceUrl ?? null;
  if (!baseUrl) return null;

  if (baseUrl.includes("modrinth.com/mod/") && !baseUrl.includes("/versions")) {
    return `${baseUrl.replace(/\/$/, "")}/versions`;
  }

  if (baseUrl.includes("curseforge.com/") && !baseUrl.includes("/files")) {
    return `${baseUrl.replace(/\/$/, "")}/files`;
  }

  return baseUrl;
}

function extractModrinthProjectId(url: string | null) {
  if (!url || !url.includes("modrinth.com")) return null;

  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const projectIndex = parts.findIndex((part) => part === "mod" || part === "project");
    return projectIndex >= 0 ? parts[projectIndex + 1] ?? null : null;
  } catch {
    const match = url.match(/modrinth\.com\/(?:mod|project)\/([^/?#]+)/i);
    return match?.[1] ?? null;
  }
}

function getNodeMonogram(label: string) {
  const words = label
    .split(/[\s_-]+/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2);
  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`;
}

function getPreferredParentId(
  nodeId: string,
  componentEdges: ModRelationshipEdge[],
  roleByNodeId: Map<string, GraphNodeRole>
) {
  const addonParent = componentEdges.find(
    (edge) => edge.relationshipType === "addon_for" && edge.sourceModId === nodeId
  )?.targetModId;
  if (addonParent) return addonParent;

  const dependencyParent = componentEdges.find(
    (edge) => edge.relationshipType === "dependency" && edge.sourceModId === nodeId
  )?.targetModId;
  if (dependencyParent) return dependencyParent;

  const fallbackDependency = componentEdges.find(
    (edge) =>
      edge.relationshipType === "dependency" &&
      edge.targetModId === nodeId &&
      roleByNodeId.get(edge.sourceModId) === "dependency"
  )?.sourceModId;
  return fallbackDependency ?? null;
}

function buildChildrenByParentId(
  component: ModRelationshipGraphNode[],
  componentEdges: ModRelationshipEdge[],
  roleByNodeId: Map<string, GraphNodeRole>
) {
  const childrenByParentId = new Map<string, string[]>();

  for (const node of component) {
    const parentId = getPreferredParentId(node.id, componentEdges, roleByNodeId);
    if (!parentId || parentId === node.id) continue;
    const children = childrenByParentId.get(parentId) ?? [];
    children.push(node.id);
    childrenByParentId.set(parentId, children);
  }

  return childrenByParentId;
}

function buildFlowNodes(
  nodes: ModRelationshipGraphNode[],
  edges: ModRelationshipEdge[],
  connectedNodeIds: Set<string>,
  layoutMode: LayoutMode,
  modIconByModId: Map<string, string | null>,
  focusModId: string | null,
  highlightedNodeIds: Set<string>
): Node<GraphNodeData>[] {
  if (nodes.length === 0) return [];
  const sortedNodes = [...nodes].sort((a, b) => a.label.localeCompare(b.label));
  const nodeMap = new Map(sortedNodes.map((node) => [node.id, node]));
  const undirectedAdjacency = new Map<string, Set<string>>();
  const degreeCount = new Map<string, number>();
  const dependencyIncomingCount = new Map<string, number>();
  const dependencyOutgoingCount = new Map<string, number>();
  const addonIncomingCount = new Map<string, number>();
  const addonOutgoingCount = new Map<string, number>();

  for (const node of sortedNodes) {
    undirectedAdjacency.set(node.id, new Set());
    degreeCount.set(node.id, 0);
    dependencyIncomingCount.set(node.id, 0);
    dependencyOutgoingCount.set(node.id, 0);
    addonIncomingCount.set(node.id, 0);
    addonOutgoingCount.set(node.id, 0);
  }

  for (const edge of edges) {
    undirectedAdjacency.get(edge.sourceModId)?.add(edge.targetModId);
    undirectedAdjacency.get(edge.targetModId)?.add(edge.sourceModId);
    degreeCount.set(edge.sourceModId, (degreeCount.get(edge.sourceModId) ?? 0) + 1);
    degreeCount.set(edge.targetModId, (degreeCount.get(edge.targetModId) ?? 0) + 1);

    if (edge.relationshipType === "dependency") {
      dependencyOutgoingCount.set(
        edge.sourceModId,
        (dependencyOutgoingCount.get(edge.sourceModId) ?? 0) + 1
      );
      dependencyIncomingCount.set(
        edge.targetModId,
        (dependencyIncomingCount.get(edge.targetModId) ?? 0) + 1
      );
      continue;
    }

    addonOutgoingCount.set(
      edge.sourceModId,
      (addonOutgoingCount.get(edge.sourceModId) ?? 0) + 1
    );
    addonIncomingCount.set(
      edge.targetModId,
      (addonIncomingCount.get(edge.targetModId) ?? 0) + 1
    );
  }

  const connectedNodes = sortedNodes.filter((node) => connectedNodeIds.has(node.id));
  const roleByNodeId = new Map<string, GraphNodeRole>();
  const importanceByNodeId = new Map<string, number>();

  for (const node of connectedNodes) {
    const dependencyIncoming = dependencyIncomingCount.get(node.id) ?? 0;
    const dependencyOutgoing = dependencyOutgoingCount.get(node.id) ?? 0;
    const addonIncoming = addonIncomingCount.get(node.id) ?? 0;
    const addonOutgoing = addonOutgoingCount.get(node.id) ?? 0;
    const degree = degreeCount.get(node.id) ?? 0;
    const dependencyWeight = dependencyIncoming * 3 + dependencyOutgoing * 2;
    const addonWeight = addonOutgoing * 3 + addonIncoming;

    let role: GraphNodeRole = "mod";
    if (dependencyWeight >= addonWeight + 2 || dependencyIncoming >= 2) {
      role = "dependency";
    } else if (addonWeight > dependencyWeight && addonOutgoing > 0) {
      role = "addon";
    }

    roleByNodeId.set(node.id, role);
    importanceByNodeId.set(
      node.id,
      degree + dependencyIncoming * 2 + dependencyOutgoing * 1.4 - addonOutgoing * 0.35
    );
  }

  const visited = new Set<string>();
  const components: ModRelationshipGraphNode[][] = [];

  for (const node of connectedNodes) {
    if (visited.has(node.id)) continue;
    const queue = [node.id];
    const componentIds: string[] = [];
    visited.add(node.id);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      componentIds.push(currentId);
      for (const neighborId of undirectedAdjacency.get(currentId) ?? []) {
        if (!visited.has(neighborId) && connectedNodeIds.has(neighborId)) {
          visited.add(neighborId);
          queue.push(neighborId);
        }
      }
    }

    const componentNodes = componentIds
      .map((id) => nodeMap.get(id))
      .filter((node): node is ModRelationshipGraphNode => !!node)
      .sort((a, b) => {
        const importanceDelta =
          (importanceByNodeId.get(b.id) ?? 0) - (importanceByNodeId.get(a.id) ?? 0);
        return importanceDelta !== 0 ? importanceDelta : a.label.localeCompare(b.label);
      });
    components.push(componentNodes);
  }

  components.sort((a, b) => b.length - a.length);

  const positions =
    layoutMode === "radial"
      ? buildRadialPositions(components, edges, roleByNodeId, importanceByNodeId)
      : buildForcePositions(components, edges, degreeCount, roleByNodeId, importanceByNodeId);

  return connectedNodes.map((node) => {
    const degree = degreeCount.get(node.id) ?? 1;
    const role = roleByNodeId.get(node.id) ?? "mod";
    const color = GRAPH_COLORS[
      components.findIndex((component) => component.some((item) => item.id === node.id)) %
        GRAPH_COLORS.length
    ] ?? GRAPH_COLORS[0];
    const baseSize = role === "dependency" ? 44 : role === "addon" ? 20 : 30;
    const multiplier = role === "dependency" ? 8 : role === "addon" ? 3.5 : 5.2;
    const size = Math.min(108, baseSize + degree * multiplier);

    return {
      id: node.id,
      type: "bubble",
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: {
        label: node.label,
        color,
        degree,
        role,
        size,
        iconUrl: modIconByModId.get(node.id) ?? null,
        showLabel: !focusModId && degree >= 5,
        dimmed: !!focusModId && !highlightedNodeIds.has(node.id),
        highlighted: highlightedNodeIds.has(node.id) && node.id !== focusModId,
        selected: node.id === focusModId,
      },
      draggable: true,
      selectable: true,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });
}

function buildRadialPositions(
  components: ModRelationshipGraphNode[][],
  edges: ModRelationshipEdge[],
  roleByNodeId: Map<string, GraphNodeRole>,
  importanceByNodeId: Map<string, number>
) {
  const positions = new Map<string, { x: number; y: number }>();
  let componentOffsetX = 0;

  for (const component of components) {
    const componentIds = new Set(component.map((node) => node.id));
    const componentEdges = edges.filter(
      (edge) => componentIds.has(edge.sourceModId) && componentIds.has(edge.targetModId)
    );
    const ordered = [...component].sort(
      (a, b) => (importanceByNodeId.get(b.id) ?? 0) - (importanceByNodeId.get(a.id) ?? 0)
    );
    const anchor = ordered.find((node) => roleByNodeId.get(node.id) === "dependency") ?? ordered[0];
    const childrenByParentId = buildChildrenByParentId(component, componentEdges, roleByNodeId);
    const dependencyNodes = ordered.filter(
      (node) =>
        node.id !== anchor.id &&
        roleByNodeId.get(node.id) === "dependency" &&
        !getPreferredParentId(node.id, componentEdges, roleByNodeId)
    );
    const coreNodes = ordered.filter((node) => roleByNodeId.get(node.id) === "mod");
    const addonNodes = ordered.filter((node) => roleByNodeId.get(node.id) === "addon");
    const positionSeed = new Map<string, { x: number; y: number }>();
    const assignedNodeIds = new Set<string>();

    positions.set(anchor.id, { x: componentOffsetX, y: 0 });
    positionSeed.set(anchor.id, { x: componentOffsetX, y: 0 });
    assignedNodeIds.add(anchor.id);

    dependencyNodes.forEach((node, index) => {
      const angle =
        -Math.PI / 2 + ((index + 1) / Math.max(dependencyNodes.length + 1, 2)) * Math.PI * 1.65;
      const radius = 120 + index * 14;
      const point = {
        x: componentOffsetX + Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * 0.88,
      };
      positions.set(node.id, point);
      positionSeed.set(node.id, point);
      assignedNodeIds.add(node.id);
    });

    const rootMods = coreNodes.filter(
      (node) => !getPreferredParentId(node.id, componentEdges, roleByNodeId)
    );

    rootMods.forEach((node, index) => {
      const angle = (index / Math.max(rootMods.length, 1)) * Math.PI * 2;
      const radius = 210 + ((index % 3) * 32);
      const point = {
        x: componentOffsetX + Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * 0.72,
      };
      positions.set(node.id, point);
      positionSeed.set(node.id, point);
      assignedNodeIds.add(node.id);
    });

    const placementQueue = [anchor.id, ...dependencyNodes.map((node) => node.id), ...rootMods.map((node) => node.id)];

    for (const parentId of placementQueue) {
      const childIds = (childrenByParentId.get(parentId) ?? []).filter(
        (childId) => !assignedNodeIds.has(childId)
      );
      const parentPosition = positionSeed.get(parentId) ?? positionSeed.get(anchor.id)!;
      const parentRole = roleByNodeId.get(parentId) ?? "mod";

      childIds.forEach((childId, index) => {
        const childRole = roleByNodeId.get(childId) ?? "mod";
        const siblingCount = Math.max(childIds.length, 1);
        const spread = childRole === "addon" ? 1.15 : 0.92;
        const angle =
          -spread / 2 + (index / Math.max(siblingCount - 1, 1)) * spread + (parentRole === "dependency" ? 0 : 0.08);
        const distance =
          childRole === "addon"
            ? parentRole === "dependency"
              ? 188
              : 150
            : parentRole === "dependency"
              ? 126
              : 176;
        const point = {
          x: parentPosition.x + Math.cos(angle) * distance,
          y: parentPosition.y + Math.sin(angle) * distance + (index % 2 === 0 ? -18 : 18),
        };
        positions.set(childId, point);
        positionSeed.set(childId, point);
        assignedNodeIds.add(childId);
      });
    }

    addonNodes
      .filter((node) => !assignedNodeIds.has(node.id))
      .forEach((node, index) => {
        const parentId = getPreferredParentId(node.id, componentEdges, roleByNodeId);
        const parentPosition =
          (parentId ? positionSeed.get(parentId) : null) ?? positionSeed.get(anchor.id)!;
        positions.set(node.id, {
          x: parentPosition.x + 150 + (index % 3) * 36,
          y: parentPosition.y + (index % 2 === 0 ? -52 : 52),
        });
        assignedNodeIds.add(node.id);
      });

    const xValues = Array.from(positions.entries())
      .filter(([id]) => componentIds.has(id))
      .map(([, point]) => point.x);
    const width = xValues.length > 0 ? Math.max(...xValues) - Math.min(...xValues) : 0;
    componentOffsetX += width + 320;
  }

  return positions;
}

function buildForcePositions(
  components: ModRelationshipGraphNode[][],
  edges: ModRelationshipEdge[],
  degreeCount: Map<string, number>,
  roleByNodeId: Map<string, GraphNodeRole>,
  importanceByNodeId: Map<string, number>
) {
  const positions = new Map<string, { x: number; y: number }>();
  let componentOffsetX = 0;

  for (const component of components) {
    const componentIds = new Set(component.map((node) => node.id));
    const componentEdges = edges.filter(
      (edge) => componentIds.has(edge.sourceModId) && componentIds.has(edge.targetModId)
    );
    const childrenByParentId = buildChildrenByParentId(component, componentEdges, roleByNodeId);
    const sim = new Map<string, { x: number; y: number; vx: number; vy: number }>();
    const centerNode =
      [...component].sort(
        (a, b) => (importanceByNodeId.get(b.id) ?? 0) - (importanceByNodeId.get(a.id) ?? 0)
      )[0];

    component.forEach((node, index) => {
      const role = roleByNodeId.get(node.id) ?? "mod";
      const parentId = getPreferredParentId(node.id, componentEdges, roleByNodeId);
      const parentRole = parentId ? roleByNodeId.get(parentId) ?? "mod" : null;
      const angle = (index / Math.max(component.length, 1)) * Math.PI * 2;
      const radius =
        node.id === centerNode.id
          ? 0
          : role === "dependency"
            ? parentId
              ? 112
              : 88 + (degreeCount.get(node.id) ?? 1) * 6
            : role === "addon"
              ? parentRole === "dependency"
                ? 220 + (index % 3) * 24
                : 164 + (index % 3) * 20
              : parentRole === "dependency"
                ? 126 + (degreeCount.get(node.id) ?? 1) * 8
                : 170 + (degreeCount.get(node.id) ?? 1) * 10;
      sim.set(node.id, {
        x: componentOffsetX + Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
      });
    });

    for (let step = 0; step < 220; step++) {
      for (const a of component) {
        const stateA = sim.get(a.id)!;
        let fx = 0;
        let fy = 0;

        for (const b of component) {
          if (a.id === b.id) continue;
          const stateB = sim.get(b.id)!;
          const dx = stateA.x - stateB.x;
          const dy = stateA.y - stateB.y;
          const distanceSq = Math.max(36, dx * dx + dy * dy);
          const distance = Math.sqrt(distanceSq);
          const repulsion = 9000 / distanceSq;
          fx += (dx / distance) * repulsion;
          fy += (dy / distance) * repulsion;
        }

        for (const edge of componentEdges) {
          if (edge.sourceModId !== a.id && edge.targetModId !== a.id) continue;
          const otherId = edge.sourceModId === a.id ? edge.targetModId : edge.sourceModId;
          const other = sim.get(otherId)!;
          const dx = other.x - stateA.x;
          const dy = other.y - stateA.y;
          const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const targetRole = roleByNodeId.get(otherId) ?? "mod";
          const springTarget =
            edge.relationshipType === "dependency"
              ? targetRole === "dependency"
                ? 92
                : 118
              : 174;
          const springStrength =
            edge.relationshipType === "dependency"
              ? 0.02
              : 0.01;
          const spring = (distance - springTarget) * springStrength;
          fx += (dx / distance) * spring;
          fy += (dy / distance) * spring;
        }

        const role = roleByNodeId.get(a.id) ?? "mod";
        const parentId = getPreferredParentId(a.id, componentEdges, roleByNodeId);
        if (a.id === centerNode.id || role === "dependency") {
          fx += (componentOffsetX - stateA.x) * 0.02;
          fy += -stateA.y * 0.02;
        } else if (role === "addon") {
          fx += (stateA.x - componentOffsetX) * 0.0015;
        }

        if (parentId) {
          const parent = sim.get(parentId);
          if (parent) {
            const dx = parent.x - stateA.x;
            const dy = parent.y - stateA.y;
            const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            const targetDistance = role === "addon" ? 158 : 112;
            const pull = (distance - targetDistance) * (role === "addon" ? 0.028 : 0.034);
            fx += (dx / distance) * pull;
            fy += (dy / distance) * pull;
          }
        }

        const children = childrenByParentId.get(a.id) ?? [];
        if (children.length > 0) {
          const childSpread = children.reduce(
            (sum, childId) => sum + ((roleByNodeId.get(childId) ?? "mod") === "addon" ? 0.2 : 0.1),
            0
          );
          fx += (componentOffsetX - stateA.x) * childSpread * 0.0015;
        }

        stateA.vx = (stateA.vx + fx) * 0.86;
        stateA.vy = (stateA.vy + fy) * 0.86;
      }

      for (const node of component) {
        const state = sim.get(node.id)!;
        state.x += state.vx;
        state.y += state.vy;
      }
    }

    let minX = Infinity;
    let maxX = -Infinity;
    for (const node of component) {
      const state = sim.get(node.id)!;
      minX = Math.min(minX, state.x);
      maxX = Math.max(maxX, state.x);
      positions.set(node.id, { x: state.x, y: state.y });
    }
    componentOffsetX += (maxX - minX) + 260;
  }

  return positions;
}
