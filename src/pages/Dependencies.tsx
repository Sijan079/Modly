import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import cytoscape, {
  type Core,
  type ElementDefinition,
  type LayoutOptions,
} from "cytoscape";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Expand, ExternalLink, Filter, Minus, Network, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PageShell } from "@/components/layout/PageShell";
import { PageSearchBar } from "@/components/layout/PageSearchBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemedSelect } from "@/components/ui/themed-select";
import { Skeleton } from "@/components/ui/skeleton";
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
  useModrinthProjects,
  useMods,
  useScanMods,
  useUpdateModMetadata,
} from "@/hooks/useMods";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  ModFile,
  ModRelationshipEdge,
  ModRelationshipGraphNode,
  ModRelationshipType,
  UpdateModRelationshipInput,
} from "@/lib/types";
import { useAppStore } from "@/store/app";

type EdgeFilter = "all" | ModRelationshipType;
type GraphNodeRole = "core" | "dependency" | "addon" | "isolated";

type DerivedNodeMeta = {
  id: string;
  label: string;
  role: GraphNodeRole;
  degree: number;
  size: number;
  imageUrl: string;
};

type DerivedGraphState = {
  nodeMetaById: Map<string, DerivedNodeMeta>;
  visibleNodes: ModRelationshipGraphNode[];
  visibleEdges: ModRelationshipEdge[];
  structuralNodeIds: Set<string>;
};

type GraphFocusState = {
  focusedNodeId: string | null;
  highlightedNodeIds: Set<string>;
};

type ToastState = { id: number; message: string } | null;

type RescanStep = "scanning" | "refreshing-mods" | "rebuilding-graph";

const RESCAN_STEPS: { key: RescanStep; label: string; description: string; progress: number }[] = [
  {
    key: "scanning",
    label: "Scanning mod jars",
    description: "Reading installed mods and extracting metadata.",
    progress: 34,
  },
  {
    key: "refreshing-mods",
    label: "Refreshing mod records",
    description: "Reloading the saved mod list for this instance.",
    progress: 67,
  },
  {
    key: "rebuilding-graph",
    label: "Rebuilding relationship graph",
    description: "Matching detected dependencies and rebuilding links.",
    progress: 100,
  },
];

const ROLE_COLORS: Record<GraphNodeRole, string> = {
  core: "#6f7bf7",
  dependency: "#15aabf",
  addon: "#ff9f43",
  isolated: "#6b7280",
};

const CYTOSCAPE_STYLES: any = [
  {
    selector: "node",
    style: {
      width: "data(size)",
      height: "data(size)",
      shape: "ellipse",
      "background-color": "data(color)",
      "background-image": "data(imageUrl)",
      "background-fit": "cover cover",
      "background-clip": "none",
      "border-width": 0,
      color: "#f8fafc",
      label: "",
      "font-size": 11,
      "font-weight": 600,
      "text-wrap": "wrap",
      "text-max-width": 120,
      "text-background-color": "rgba(0,0,0,0.72)",
      "text-background-opacity": 1,
      "text-background-padding": 4,
      "text-background-shape": "roundrectangle",
      "text-margin-y": 38,
      "overlay-opacity": 0,
      opacity: 1,
      "transition-property": "opacity, border-width, border-color",
      "transition-duration": "140ms",
    },
  },
  {
    selector: "node[?showLabel]",
    style: {
      label: "data(label)",
    },
  },
  {
    selector: "node.core",
    style: {
      "z-index": 5,
    },
  },
  {
    selector: "node.dependency",
    style: {
      "z-index": 4,
    },
  },
  {
    selector: "node.addon",
    style: {
      "z-index": 3,
    },
  },
  {
    selector: "node.selected",
    style: {
      "border-width": 4,
      "border-color": "rgba(255,255,255,0.85)",
      "shadow-blur": 26,
      "shadow-color": "rgba(0,0,0,0.34)",
      "shadow-opacity": 1,
    },
  },
  {
    selector: "node.highlighted",
    style: {
      "border-width": 2,
      "border-color": "rgba(255,255,255,0.55)",
      "shadow-blur": 18,
      "shadow-color": "rgba(0,0,0,0.22)",
      "shadow-opacity": 1,
    },
  },
  {
    selector: "node.dimmed",
    style: {
      opacity: 0.18,
    },
  },
  {
    selector: "edge",
    style: {
      width: 1.6,
      "line-color": "rgba(148,163,184,0.36)",
      "target-arrow-color": "rgba(148,163,184,0.36)",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
      opacity: 1,
      "transition-property": "opacity, line-color, target-arrow-color",
      "transition-duration": "140ms",
    },
  },
  {
    selector: "edge.addon_for",
    style: {
      width: 2,
      "line-style": "dashed",
    },
  },
  {
    selector: "edge.dimmed",
    style: {
      opacity: 0.12,
      "line-color": "rgba(148,163,184,0.12)",
      "target-arrow-color": "rgba(148,163,184,0.12)",
    },
  },
];

function GraphControlsRail({
  onZoomIn,
  onZoomOut,
  onFitView,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
}) {
  return (
    <div className="pointer-events-auto absolute bottom-4 right-4 z-20 overflow-hidden rounded-2xl border border-white/8 bg-[#11151c]/90 shadow-[0_18px_40px_rgba(0,0,0,0.32)] backdrop-blur">
      <button
        type="button"
        className="flex h-[42px] w-[42px] items-center justify-center border-0 border-b border-white/6 bg-transparent text-[rgba(232,234,237,0.84)] transition-colors hover:bg-white/6 hover:text-[var(--color-foreground)]"
        onClick={onZoomIn}
        aria-label="Zoom in"
      >
        <Plus className="h-4 w-4" />
      </button>
      <button
        type="button"
        className="flex h-[42px] w-[42px] items-center justify-center border-0 border-b border-white/6 bg-transparent text-[rgba(232,234,237,0.84)] transition-colors hover:bg-white/6 hover:text-[var(--color-foreground)]"
        onClick={onZoomOut}
        aria-label="Zoom out"
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        className="flex h-[42px] w-[42px] items-center justify-center border-0 bg-transparent text-[rgba(232,234,237,0.84)] transition-colors hover:bg-white/6 hover:text-[var(--color-foreground)]"
        onClick={onFitView}
        aria-label="Fit view"
      >
        <Expand className="h-4 w-4" />
      </button>
    </div>
  );
}

function GraphFilterMenu({
  showIsolated,
  onShowIsolatedChange,
}: {
  showIsolated: boolean;
  onShowIsolatedChange: (checked: boolean) => void;
}) {
  return (
    <div className="pointer-events-auto absolute right-4 top-4 z-20">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-white/8 bg-[#11151c]/90 text-[var(--color-foreground)] shadow-[0_18px_40px_rgba(0,0,0,0.32)] backdrop-blur hover:bg-[#171c24]"
          >
            <Filter className="h-4 w-4" />
            Filters
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={8}
            className="z-50 min-w-52 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-1 shadow-lg"
          >
            <DropdownMenu.CheckboxItem
              checked={showIsolated}
              onCheckedChange={(checked) => onShowIsolatedChange(checked === true)}
              className="flex cursor-pointer items-center gap-3 rounded px-3 py-2 text-sm outline-none transition-colors hover:bg-[var(--color-muted)] focus:bg-[var(--color-muted)]"
            >
              <div className="flex h-4 w-4 items-center justify-center rounded border border-[var(--color-input)] bg-[var(--color-card)] text-[10px]">
                {showIsolated ? "✓" : ""}
              </div>
              <div className="flex flex-col">
                <span>Show isolated mods</span>
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  Render mods with no relationships
                </span>
              </div>
            </DropdownMenu.CheckboxItem>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

export function RelationshipsPage() {
  const queryClient = useQueryClient();
  const { data: instances = [] } = useInstances();
  const { selectedInstanceId, setSelectedInstance } = useAppStore();
  const instanceId = selectedInstanceId ?? instances[0]?.id ?? null;
  const selectedInstance =
    instances.find((instance) => instance.id === instanceId) ?? null;
  const { data: mods = [] } = useMods(instanceId);
  const { data: graph = null, isLoading: graphLoading } =
    useInstanceRelationshipGraph(instanceId);
  const scanModsMutation = useScanMods();

  const [edgeFilter, setEdgeFilter] = useState<EdgeFilter>("all");
  const [activeModId, setActiveModId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedPath = searchParams.get("mod");
  useEffect(() => {
    if (!linkedPath || !mods.length) return;
    const mod = mods.find((item) => item.filePath === linkedPath);
    if (mod) setActiveModId(mod.id);
    setSearchParams((params) => { params.delete("mod"); return params; }, { replace: true });
  }, [linkedPath, mods, setSearchParams]);
  const [search, setSearch] = useState("");
  const [showIsolated, setShowIsolated] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [isRescanning, setIsRescanning] = useState(false);
  const [rescanStep, setRescanStep] = useState<RescanStep>("scanning");

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

  const projectIds = useMemo(
    () => Array.from(new Set(modrinthProjectByModId.values())).sort(),
    [modrinthProjectByModId]
  );
  const { data: modrinthProjects = [] } = useModrinthProjects(projectIds);
  const modIconByModId = useMemo(
    () =>
      new Map(
        Array.from(modrinthProjectByModId.entries()).map(([modId, projectId]) => [
          modId,
          modrinthProjects.find((project) => project.projectId === projectId)?.iconUrl ?? null,
        ])
      ),
    [modrinthProjectByModId, modrinthProjects]
  );

  const focusModId = activeModId ?? searchedMod?.id ?? null;
  const selectedMod = mods.find((mod) => mod.id === focusModId) ?? null;

  const graphState = useMemo(
    () =>
      buildDerivedGraphState(
        graph?.nodes ?? [],
        graph?.edges ?? [],
        edgeFilter,
        showIsolated,
        modIconByModId
      ),
    [edgeFilter, graph?.edges, graph?.nodes, modIconByModId, showIsolated]
  );

  const focusState = useMemo(
    () => buildGraphFocusState(graphState.visibleEdges, focusModId),
    [focusModId, graphState.visibleEdges]
  );

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = (message: string) => {
    setToast({ id: Date.now(), message });
  };

  const activeRescanStep =
    RESCAN_STEPS.find((step) => step.key === rescanStep) ?? RESCAN_STEPS[0];

  const handleRescanMods = async () => {
    if (!instanceId || !selectedInstance || isRescanning) return;

    setIsRescanning(true);
    setRescanStep("scanning");
    setActiveModId(null);

    try {
      await scanModsMutation.mutateAsync(instanceId);

      setRescanStep("refreshing-mods");
      await queryClient.refetchQueries({
        queryKey: ["mods", instanceId],
        exact: true,
      });

      setRescanStep("rebuilding-graph");
      await queryClient.refetchQueries({
        queryKey: ["instance-relationship-graph", instanceId],
        exact: true,
      });

      await api.files.appendLog(
        "info",
        `Relationship rescan completed: ${selectedInstance.name}`,
        selectedInstance.name
      );
      await queryClient.invalidateQueries({ queryKey: ["logs"] });
      showToast("Relationships rebuilt.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to rescan relationships.";
      showToast(message);
    } finally {
      setIsRescanning(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageShell
        title="Relationships"
        description={
          selectedInstance
            ? `${selectedInstance.name} relationships`
            : "Manual mod relationships"
        }
        controls={
          <>
            <PageSearchBar
              value={search}
              onChange={setSearch}
              placeholder="Search mods in graph..."
              className="sm:max-w-xs"
              activityLabel="relationships"
              activityContext={selectedInstance?.name}
            />
            <ThemedSelect
              className="min-w-[11rem]"
              value={instanceId ?? ""}
              onValueChange={(value) => setSelectedInstance(value || null)}
              aria-label="Select instance"
              options={[{ value: "", label: "Select instance" }, ...instances.map((instance) => ({ value: instance.id, label: instance.name }))]}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRescanMods}
              disabled={!instanceId || isRescanning}
            >
              {isRescanning ? "Rescanning..." : "Rescan Mods"}
            </Button>
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
      ) : isRescanning ? null : graphLoading ? (
        <RelationshipGraphSkeleton />
      ) : !graph || graph.edges.length === 0 ? (
        <EmptyGraphState
          mods={mods}
          selectedInstanceName={selectedInstance?.name ?? "this instance"}
          onOpenFirst={() => setActiveModId(mods[0]?.id ?? null)}
        />
      ) : graphState.visibleEdges.length === 0 ? (
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
                nodeCount={graphState.visibleNodes.length}
                edgeCount={graphState.visibleEdges.length}
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <RelationshipsGraphCanvas
              graphState={graphState}
              focusState={focusState}
              onOpenNode={setActiveModId}
              showIsolated={showIsolated}
              onShowIsolatedChange={setShowIsolated}
            />
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

      <RescanProgressModal
        open={isRescanning}
        instanceName={selectedInstance?.name ?? "instance"}
        step={activeRescanStep}
      />

      {toast && (
        <div className="pointer-events-none fixed right-5 top-5 z-50 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 text-sm text-[var(--color-foreground)] shadow-xl">
          {toast.message}
        </div>
      )}
    </div>
  );
}

function RelationshipGraphSkeleton() {
  return (
    <Card aria-busy="true" aria-label="Loading relationship graph">
      <CardContent className="relative h-[36rem] overflow-hidden p-6">
        <Skeleton className="absolute left-[12%] top-[18%] h-14 w-32" />
        <Skeleton className="absolute left-[42%] top-[11%] h-14 w-36" />
        <Skeleton className="absolute right-[12%] top-[28%] h-14 w-28" />
        <Skeleton className="absolute bottom-[18%] left-[30%] h-14 w-36" />
        <Skeleton className="absolute bottom-[14%] right-[28%] h-14 w-32" />
        <Skeleton className="absolute left-[31%] top-[31%] h-px w-[18%] rounded-none" />
        <Skeleton className="absolute right-[24%] top-[34%] h-px w-[18%] rounded-none" />
        <Skeleton className="absolute bottom-[30%] left-[40%] h-px w-[15%] rounded-none" />
      </CardContent>
    </Card>
  );
}

function RescanProgressModal({
  open,
  instanceName,
  step,
}: {
  open: boolean;
  instanceName: string;
  step: (typeof RESCAN_STEPS)[number];
}) {
  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-md"
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Rebuilding relationships</DialogTitle>
          <DialogDescription>
            {instanceName}: {step.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>{step.label}</span>
              <span>{step.progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--color-muted)]">
              <div
                className="h-full rounded-full bg-[var(--color-primary)] transition-all duration-300"
                style={{ width: `${step.progress}%` }}
              />
            </div>
          </div>

          <div className="space-y-2 text-sm text-[var(--color-muted-foreground)]">
            {RESCAN_STEPS.map((candidate) => (
              <div key={candidate.key} className="flex items-center justify-between gap-3">
                <span>{candidate.label}</span>
                <span>
                  {candidate.progress < step.progress
                    ? "Done"
                    : candidate.key === step.key
                      ? "Working..."
                      : "Queued"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
            {selectedInstanceName}
          </p>
        </div>
        <Button type="button" onClick={onOpenFirst} disabled={mods.length === 0}>
          <Plus className="h-4 w-4" />
          {mods.length === 0 ? "No mods available" : "Open a mod"}
        </Button>
      </CardContent>
    </Card>
  );
}

function GraphStats({
  nodeCount,
  edgeCount,
}: {
  nodeCount: number;
  edgeCount: number;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
      <Badge variant="secondary">{nodeCount} mods</Badge>
      <Badge variant="secondary">{edgeCount} links</Badge>
    </div>
  );
}

function RelationshipsGraphCanvas({
  graphState,
  focusState,
  onOpenNode,
  showIsolated,
  onShowIsolatedChange,
}: {
  graphState: DerivedGraphState;
  focusState: GraphFocusState;
  onOpenNode: (modId: string | null) => void;
  showIsolated: boolean;
  onShowIsolatedChange: (checked: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const onOpenNodeRef = useRef(onOpenNode);

  onOpenNodeRef.current = onOpenNode;

  const structureElements = useMemo<ElementDefinition[]>(
    () => buildCytoscapeStructureElements(graphState),
    [graphState.nodeMetaById, graphState.visibleEdges, graphState.visibleNodes]
  );

  useEffect(() => {
    if (!containerRef.current || cyRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      style: CYTOSCAPE_STYLES,
      minZoom: 0.2,
      maxZoom: 1.4,
      boxSelectionEnabled: false,
      autoungrabify: true,
      elements: [],
    });

    cy.on("tap", "node", (event) => {
      onOpenNodeRef.current(event.target.id());
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.elements().remove();
    cy.add(structureElements);
    const layout = cy.layout(buildCytoscapeLayout());
    layout.run();
    queueMicrotask(() => {
      if (cy.destroyed()) return;
      const visible = cy.elements(":visible");
      if (visible.length > 0) {
        cy.fit(visible, 42);
      }
    });
  }, [structureElements]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    applyGraphFocusState(cy, graphState.nodeMetaById, focusState);
  }, [focusState, graphState.nodeMetaById]);

  return (
    <div className="relationships-graph relative h-[calc(100vh-15rem)] min-h-[38rem] bg-[radial-gradient(circle_at_50%_40%,rgba(255,255,255,0.08),transparent_24%),linear-gradient(180deg,#11151c,#0b0e13)]">
      <div ref={containerRef} className="h-full w-full" />
      <GraphFilterMenu
        showIsolated={showIsolated}
        onShowIsolatedChange={onShowIsolatedChange}
      />
      <GraphControlsRail
        onZoomIn={() => {
          const cy = cyRef.current;
          if (!cy) return;
          cy.zoom({
            level: Math.min(cy.maxZoom(), cy.zoom() * 1.18),
            renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
          });
        }}
        onZoomOut={() => {
          const cy = cyRef.current;
          if (!cy) return;
          cy.zoom({
            level: Math.max(cy.minZoom(), cy.zoom() / 1.18),
            renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
          });
        }}
        onFitView={() => {
          const cy = cyRef.current;
          if (!cy) return;
          const visible = cy.elements(":visible");
          if (visible.length > 0) cy.fit(visible, 42);
        }}
      />
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
                              <ThemedSelect
                                className="w-full"
                                value={row.relationshipType}
                                onValueChange={(value) =>
                                  updateRelatedMod(index, {
                                    relationshipType: value as ModRelationshipType,
                                  })
                                }
                                options={[{ value: "dependency", label: "Dependency" }, { value: "addon_for", label: "Add-on For" }]}
                              />
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
    <ThemedSelect
      className="w-full"
      value={value}
      onValueChange={onChange}
      options={[{ value: "", label: "Select related mod" }, ...availableOptions.map((candidate) => ({ value: candidate.id, label: getModDisplayName(candidate) }))]}
    />
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

function buildMonogramDataUri(monogram: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="Segoe UI, sans-serif" font-size="24" font-weight="700">${escapeHtml(monogram.toUpperCase())}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildDerivedGraphState(
  nodes: ModRelationshipGraphNode[],
  allEdges: ModRelationshipEdge[],
  edgeFilter: EdgeFilter,
  showIsolated: boolean,
  modIconByModId: Map<string, string | null>
): DerivedGraphState {
  const degreeCount = new Map<string, number>();
  const dependencyIncomingCount = new Map<string, number>();
  const addonOutgoingCount = new Map<string, number>();

  for (const node of nodes) {
    degreeCount.set(node.id, 0);
    dependencyIncomingCount.set(node.id, 0);
    addonOutgoingCount.set(node.id, 0);
  }

  for (const edge of allEdges) {
    degreeCount.set(edge.sourceModId, (degreeCount.get(edge.sourceModId) ?? 0) + 1);
    degreeCount.set(edge.targetModId, (degreeCount.get(edge.targetModId) ?? 0) + 1);

    if (edge.relationshipType === "dependency") {
      dependencyIncomingCount.set(
        edge.targetModId,
        (dependencyIncomingCount.get(edge.targetModId) ?? 0) + 1
      );
    }

    if (edge.relationshipType === "addon_for") {
      addonOutgoingCount.set(
        edge.sourceModId,
        (addonOutgoingCount.get(edge.sourceModId) ?? 0) + 1
      );
    }
  }

  const visibleEdges =
    edgeFilter === "all"
      ? allEdges
      : allEdges.filter((edge) => edge.relationshipType === edgeFilter);

  const connectedVisibleNodeIds = new Set(
    visibleEdges.flatMap((edge) => [edge.sourceModId, edge.targetModId])
  );

  const structuralNodeIds = new Set<string>();
  const nodeMetaById = new Map<string, DerivedNodeMeta>();
  for (const node of nodes) {
    const degree = degreeCount.get(node.id) ?? 0;
    const dependencyIncoming = dependencyIncomingCount.get(node.id) ?? 0;
    const addonOutgoing = addonOutgoingCount.get(node.id) ?? 0;
    const role: GraphNodeRole =
      degree === 0
        ? "isolated"
        : addonOutgoing > 0
          ? "addon"
          : dependencyIncoming > 0
            ? "dependency"
            : "core";
    const baseSize =
      role === "core" ? 60 : role === "dependency" ? 46 : role === "addon" ? 28 : 22;
    const multiplier =
      role === "core" ? 4.8 : role === "dependency" ? 4.2 : role === "addon" ? 2.4 : 1.2;
    const size = Math.min(112, baseSize + degree * multiplier);
    const monogram = getNodeMonogram(node.label);

    nodeMetaById.set(node.id, {
      id: node.id,
      label: node.label,
      role,
      degree,
      size,
      imageUrl: modIconByModId.get(node.id) ?? buildMonogramDataUri(monogram),
    });

    if (degree > 0 || showIsolated) {
      if (edgeFilter === "all") {
        structuralNodeIds.add(node.id);
      } else if (connectedVisibleNodeIds.has(node.id) || (showIsolated && degree === 0)) {
        structuralNodeIds.add(node.id);
      }
    }
  }

  return {
    nodeMetaById,
    visibleNodes: nodes.filter((node) => structuralNodeIds.has(node.id)),
    visibleEdges,
    structuralNodeIds,
  };
}

function buildGraphFocusState(
  visibleEdges: ModRelationshipEdge[],
  focusModId: string | null
): GraphFocusState {
  const highlightedNodeIds = new Set<string>();
  if (focusModId) {
    highlightedNodeIds.add(focusModId);
    for (const edge of visibleEdges) {
      if (edge.sourceModId === focusModId) highlightedNodeIds.add(edge.targetModId);
      if (edge.targetModId === focusModId) highlightedNodeIds.add(edge.sourceModId);
    }
  }

  return {
    focusedNodeId: focusModId,
    highlightedNodeIds,
  };
}

function buildCytoscapeStructureElements(graphState: DerivedGraphState): ElementDefinition[] {
  const elements: ElementDefinition[] = [];
  const { nodeMetaById, visibleNodes, visibleEdges } = graphState;

  for (const node of visibleNodes) {
    const meta = nodeMetaById.get(node.id);
    if (!meta) continue;
    elements.push({
      data: {
        id: node.id,
        label: meta.label,
        role: meta.role,
        size: meta.size,
        color: ROLE_COLORS[meta.role],
        imageUrl: meta.imageUrl,
        showLabel: meta.degree >= 5 || meta.role === "isolated",
      },
      classes: meta.role,
    });
  }

  for (const edge of visibleEdges) {
    elements.push({
      data: {
        id: edge.id,
        source: edge.sourceModId,
        target: edge.targetModId,
      },
      classes: edge.relationshipType,
    });
  }

  return elements;
}

function applyGraphFocusState(
  cy: Core,
  nodeMetaById: Map<string, DerivedNodeMeta>,
  focusState: GraphFocusState
) {
  const { focusedNodeId, highlightedNodeIds } = focusState;
  const focused = !!focusedNodeId;

  cy.batch(() => {
    cy.nodes().forEach((node) => {
      const meta = nodeMetaById.get(node.id());
      const isNeighbor = highlightedNodeIds.has(node.id());
      const isFocused = focusedNodeId === node.id();
      node.toggleClass("dimmed", focused && !isNeighbor);
      node.toggleClass("selected", focused && isFocused);
      node.toggleClass("highlighted", focused && isNeighbor && !isFocused);
      node.data(
        "showLabel",
        !focused ? (meta?.degree ?? 0) >= 5 || meta?.role === "isolated" : isNeighbor
      );
    });

    cy.edges().forEach((edge) => {
      const sourceId = edge.source().id();
      const targetId = edge.target().id();
      const isHighlighted =
        focused &&
        highlightedNodeIds.has(sourceId) &&
        highlightedNodeIds.has(targetId);
      edge.toggleClass("dimmed", focused && !isHighlighted);
    });
  });
}

function buildCytoscapeLayout(): LayoutOptions {
  return {
    name: "cose",
    animate: false,
    fit: false,
    padding: 42,
    componentSpacing: 180,
    nodeRepulsion: (node) => {
      const role = node.data("role") as GraphNodeRole;
      if (role === "core") return 1200000;
      if (role === "dependency") return 840000;
      if (role === "addon") return 260000;
      return 420000;
    },
    idealEdgeLength: (edge) => {
      const sourceRole = edge.source().data("role") as GraphNodeRole;
      if (edge.hasClass("addon_for")) return sourceRole === "addon" ? 105 : 135;
      return 155;
    },
    edgeElasticity: (edge) => (edge.hasClass("addon_for") ? 70 : 110),
    gravity: 0.32,
    nestingFactor: 0.75,
    numIter: 1400,
    initialTemp: 180,
    coolingFactor: 0.93,
    minTemp: 1,
  };
}
