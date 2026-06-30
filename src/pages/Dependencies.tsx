import { useEffect, useId, useMemo, useState } from "react";
import { ExternalLink, Network, Pencil, Plus, Save, Table2, Trash2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PageShell } from "@/components/layout/PageShell";
import { PageSearchBar } from "@/components/layout/PageSearchBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useInstances } from "@/hooks/useInstances";
import { useModRelationships, useMods, useUpdateModMetadata } from "@/hooks/useMods";
import type {
  ModFile,
  ModRelationshipEdge,
  ModRelationshipType,
  UpdateModRelationshipInput,
} from "@/lib/types";
import { useAppStore } from "@/store/app";

export function RelationshipsPage() {
  const { data: instances = [] } = useInstances();
  const { selectedInstanceId, setSelectedInstance } = useAppStore();
  const instanceId = selectedInstanceId ?? instances[0]?.id ?? null;
  const selectedInstance =
    instances.find((instance) => instance.id === instanceId) ?? null;
  const { data: mods = [] } = useMods(instanceId);
  const updateModMutation = useUpdateModMetadata();

  const [search, setSearch] = useState("");
  const [view, setView] = useState<"table" | "graph">("table");
  const [selectedModId, setSelectedModId] = useState<string>("");
  const [draftRelatedMods, setDraftRelatedMods] = useState<UpdateModRelationshipInput[]>([]);
  const [editingRows, setEditingRows] = useState<number[]>([]);

  const modOptions = useMemo(
    () =>
      [...mods]
        .sort((a, b) => getModDisplayName(a).localeCompare(getModDisplayName(b)))
        .filter((mod) => {
          const query = search.trim().toLowerCase();
          if (!query) return true;
          return [getModDisplayName(mod), mod.fileName, mod.metadata?.modId ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(query);
        }),
    [mods, search]
  );

  const selectedMod =
    modOptions.find((mod) => mod.id === selectedModId) ??
    mods.find((mod) => mod.id === selectedModId) ??
    modOptions[0] ??
    null;

  const { data: relationships = null } = useModRelationships(selectedMod?.id ?? null);

  useEffect(() => {
    setDraftRelatedMods(selectedMod?.relatedMods ?? []);
    setEditingRows([]);
  }, [selectedMod?.id, selectedMod?.relatedMods]);

  const filteredOutgoing = relationships?.outgoing ?? [];

  const reverseGroups = useMemo(
    () => ({
      dependency: (relationships?.incoming ?? []).filter(
        (edge) => edge.relationshipType === "dependency"
      ),
      addon_for: (relationships?.incoming ?? []).filter(
        (edge) => edge.relationshipType === "addon_for"
      ),
    }),
    [relationships]
  );

  const relationshipOptions = useMemo(
    () =>
      [...mods]
        .filter((candidate) => candidate.id !== selectedMod?.id)
        .sort((a, b) => getModDisplayName(a).localeCompare(getModDisplayName(b))),
    [mods, selectedMod?.id]
  );

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
    setEditingRows((current) => [...current, draftRelatedMods.length]);
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

  const removeRelatedMod = (index: number) => {
    setDraftRelatedMods((current) =>
      current.filter((_, relatedIndex) => relatedIndex !== index)
    );
    setEditingRows((current) =>
      current
        .filter((rowIndex) => rowIndex !== index)
        .map((rowIndex) => (rowIndex > index ? rowIndex - 1 : rowIndex))
    );
  };

  const handleSaveRelationships = () => {
    if (!selectedMod) return;
    updateModMutation.mutate({
      modId: selectedMod.id,
      name: selectedMod.metadata?.name ?? selectedMod.fileName.replace(/\.jar$/i, ""),
      version: selectedMod.metadata?.version ?? "",
      authors: selectedMod.metadata?.authors ?? [],
      modrinthUrl: selectedMod.metadata?.modrinthUrl ?? null,
      sourceUrl: selectedMod.sourceUrl,
      loader: selectedMod.metadata?.loader ?? "unknown",
      side: selectedMod.metadata?.side ?? "unknown",
      modIdField: selectedMod.metadata?.modId ?? null,
      installedModrinthVersionId:
        selectedMod.metadata?.installedModrinthVersionId ?? null,
      categoryIds: selectedMod.categories.map((category) => category.id),
      relatedMods: draftRelatedMods.filter((relatedMod) => relatedMod.targetModId),
    });
    setEditingRows([]);
  };

  const startEditingRow = (index: number) => {
    setEditingRows((current) =>
      current.includes(index) ? current : [...current, index]
    );
  };

  const isDraftChanged =
    JSON.stringify(draftRelatedMods) !== JSON.stringify(selectedMod?.relatedMods ?? []);
  const selectedModSourceUrl = buildSelectedModSourceUrl(selectedMod);

  return (
    <div className="flex flex-col gap-5">
      <PageShell
        title="Relationships"
        description={
          selectedInstance
            ? `Inspect manual dependencies and add-on relationships inside ${selectedInstance.name}.`
            : "Inspect manual dependencies and add-on relationships for the selected instance."
        }
        controls={
          <>
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
            <ViewToggle active={view} onChange={setView} />
          </>
        }
      />

      {!instanceId ? (
        <Card>
          <CardContent className="flex h-56 items-center justify-center text-[var(--color-muted-foreground)]">
            Select an instance to inspect relationships.
          </CardContent>
        </Card>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
          <aside className="min-h-0 border-r border-[var(--color-border)]">
            <div className="border-b border-[var(--color-border)] px-4 py-3">
              <h2 className="text-sm font-medium">Mods</h2>
              <p className="mt-1 truncate text-xs text-[var(--color-muted-foreground)]">
                {selectedInstance?.name ?? "Select an instance"}
              </p>
              <PageSearchBar
                value={search}
                onChange={setSearch}
                placeholder="Search mods..."
                className="mt-3 sm:max-w-none"
              />
            </div>
            <div className="max-h-[calc(100vh-18rem)] overflow-y-auto">
              {modOptions.length === 0 ? (
                <div className="px-4 py-6 text-sm text-[var(--color-muted-foreground)]">
                  No mods found.
                </div>
              ) : (
                modOptions.map((mod) => (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => setSelectedModId(mod.id)}
                    className={`flex w-full items-center justify-between border-b border-[var(--color-border)] px-4 py-3 text-left text-sm last:border-b-0 ${
                      selectedMod?.id === mod.id
                        ? "bg-[var(--color-muted)] text-[var(--color-foreground)]"
                        : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
                    }`}
                  >
                    <span className="font-medium">{getModDisplayName(mod)}</span>
                  </button>
                ))
              )}
            </div>
          </aside>

          <main className="flex min-h-0 flex-col overflow-hidden">
            {!selectedMod ? (
              <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-muted-foreground)]">
                Select a mod to view relationship details.
              </div>
            ) : (
              <>
                <div className="border-b border-[var(--color-border)] px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-medium">{getModDisplayName(selectedMod)}</h2>
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
                      </div>
                      <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                        Inspect and manage outgoing and reverse relationships for this mod.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
                  <div className="mb-4 grid gap-4 lg:grid-cols-2">
                    <ReversePanel
                      title="Required By"
                      emptyLabel="No mods currently require this mod."
                      rows={reverseGroups.dependency}
                    />
                    <ReversePanel
                      title="Extended By"
                      emptyLabel="No add-ons currently point to this mod."
                      rows={reverseGroups.addon_for}
                    />
                  </div>

                  {view === "table" ? (
                    <RelationshipsTable
                      selectedMod={selectedMod}
                      draftRows={draftRelatedMods}
                      options={relationshipOptions}
                      saving={updateModMutation.isPending}
                      dirty={isDraftChanged}
                      editingRows={editingRows}
                      onAdd={addRelatedMod}
                      onChange={updateRelatedMod}
                      onEdit={startEditingRow}
                      onRemove={removeRelatedMod}
                      onSave={handleSaveRelationships}
                    />
                  ) : (
                    <RelationshipsGraph
                      selectedMod={selectedMod}
                      rows={filteredOutgoing}
                      draftRows={draftRelatedMods}
                      options={relationshipOptions}
                      saving={updateModMutation.isPending}
                      dirty={isDraftChanged}
                      onAdd={addRelatedMod}
                      onChange={updateRelatedMod}
                      onRemove={removeRelatedMod}
                      onSave={handleSaveRelationships}
                    />
                  )}
                </div>
              </>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function ViewToggle({
  active,
  onChange,
}: {
  active: "table" | "graph";
  onChange: (view: "table" | "graph") => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-1">
      <ToggleButton
        active={active === "table"}
        icon={Table2}
        label="Table"
        onClick={() => onChange("table")}
      />
      <ToggleButton
        active={active === "graph"}
        icon={Network}
        label="Graph"
        onClick={() => onChange("graph")}
      />
    </div>
  );
}

function ToggleButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded px-3 py-1.5 text-sm ${
        active
          ? "bg-[var(--color-primary)] text-white"
          : "text-[var(--color-muted-foreground)]"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function RelationshipsTable({
  selectedMod,
  draftRows,
  options,
  saving,
  dirty,
  editingRows,
  onAdd,
  onChange,
  onEdit,
  onRemove,
  onSave,
}: {
  selectedMod: ModFile;
  draftRows: UpdateModRelationshipInput[];
  options: ModFile[];
  saving: boolean;
  dirty: boolean;
  editingRows: number[];
  onAdd: () => void;
  onChange: (index: number, patch: Partial<UpdateModRelationshipInput>) => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onSave: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{getModDisplayName(selectedMod)}</CardTitle>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onAdd}>
            <Plus className="h-4 w-4" />
            Add New Relationship
          </Button>
          <Button type="button" size="sm" onClick={onSave} disabled={saving || !dirty}>
            <Save className="h-4 w-4" />
            Save
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-muted)]">
                <th className="px-4 py-3 text-left font-medium">Related Mod</th>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {draftRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="px-4 py-6 text-center text-[var(--color-muted-foreground)]"
                  >
                    No related mods mapped yet. Click `Add New Relationship` to create one.
                  </td>
                </tr>
              ) : (
                draftRows.map((row, index) => (
                  <tr key={`${row.targetModId || "new"}-${index}`} className="border-b border-[var(--color-border)]/50">
                    <td className="px-4 py-3">
                      {editingRows.includes(index) ? (
                        <RelatedModPicker
                          value={row.targetModId}
                          options={options}
                          disabledIds={draftRows
                            .filter((_, existingIndex) => existingIndex !== index)
                            .map((existing) => existing.targetModId)}
                          onChange={(targetModId) => onChange(index, { targetModId })}
                        />
                      ) : (
                        <span className="font-medium text-[var(--color-foreground)]">
                          {options.find((candidate) => candidate.id === row.targetModId)
                            ? getModDisplayName(
                                options.find((candidate) => candidate.id === row.targetModId)!
                              )
                            : "Unselected"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editingRows.includes(index) ? (
                        <select
                          className="flex h-9 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-muted)] px-3 text-sm"
                          value={row.relationshipType}
                          onChange={(event) =>
                            onChange(index, {
                              relationshipType: event.target.value as ModRelationshipType,
                            })
                          }
                        >
                          <option value="dependency">Dependency</option>
                          <option value="addon_for">Add-on For</option>
                        </select>
                      ) : (
                        <RelationshipBadge type={row.relationshipType} />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => onEdit(index)}
                          title="Edit relationship"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => onRemove(index)}
                          title="Remove relationship"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function RelationshipsGraph({
  selectedMod,
  rows,
  saving,
  dirty,
  onAdd,
  onSave,
  onChange: _onChange,
  onRemove: _onRemove,
  draftRows: _draftRows,
  options: _options,
}: {
  selectedMod: ModFile;
  rows: ModRelationshipEdge[];
  draftRows: UpdateModRelationshipInput[];
  options: ModFile[];
  saving: boolean;
  dirty: boolean;
  onAdd: () => void;
  onChange: (index: number, patch: Partial<UpdateModRelationshipInput>) => void;
  onRemove: (index: number) => void;
  onSave: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{getModDisplayName(selectedMod)}</CardTitle>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onAdd}>
            <Plus className="h-4 w-4" />
            Add New Relationship
          </Button>
          <Button type="button" size="sm" onClick={onSave} disabled={saving || !dirty}>
            <Save className="h-4 w-4" />
            Save
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Add and edit relationships in the table view. The graph stays as the visual summary.
        </p>
        <div className="rounded-lg border border-[var(--color-border)] p-6">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-6">
            <DependencyGraphCard label={getModDisplayName(selectedMod)} tone="root" />
            {rows.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                No outgoing relationships for this filter.
              </p>
            ) : (
              <>
                <div className="h-8 w-px bg-[var(--color-border)]" />
                <div className="grid w-full gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {rows.map((row) => (
                    <div key={row.id} className="flex flex-col items-center gap-3">
                      <div className="h-6 w-px bg-[var(--color-border)]" />
                      <DependencyGraphCard
                        label={row.targetModName}
                        subtitle={formatRelationshipType(row.relationshipType)}
                        tone={row.relationshipType === "addon_for" ? "addon" : "installed"}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
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
  const listId = useId();
  const [text, setText] = useState("");

  useEffect(() => {
    const selected = options.find((candidate) => candidate.id === value);
    setText(selected ? getModDisplayName(selected) : "");
  }, [options, value]);

  const availableOptions = options.filter(
    (candidate) => !disabledIds.includes(candidate.id) || candidate.id === value
  );

  const resolveSelection = (nextText: string) => {
    const match = availableOptions.find(
      (candidate) => getModDisplayName(candidate).toLowerCase() === nextText.trim().toLowerCase()
    );
    if (match) {
      onChange(match.id);
    } else if (!nextText.trim()) {
      onChange("");
    }
  };

  return (
    <>
      <input
        list={listId}
        className="flex h-9 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-muted)] px-3 text-sm"
        value={text}
        onChange={(event) => {
          const nextText = event.target.value;
          setText(nextText);
        }}
        onBlur={() => resolveSelection(text)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            resolveSelection(text);
          }
        }}
        placeholder="Search related mod..."
      />
      <datalist id={listId}>
        {availableOptions.map((candidate) => (
          <option key={candidate.id} value={getModDisplayName(candidate)} />
        ))}
      </datalist>
    </>
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

function formatRelationshipType(type: ModRelationshipType) {
  return type === "addon_for" ? "Add-on For" : "Dependency";
}

function RelationshipBadge({ type }: { type: ModRelationshipType }) {
  return (
    <Badge variant={type === "addon_for" ? "secondary" : "default"}>
      {formatRelationshipType(type)}
    </Badge>
  );
}

function ReversePanel({
  title,
  emptyLabel,
  rows,
}: {
  title: string;
  emptyLabel: string;
  rows: ModRelationshipEdge[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {rows.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">{emptyLabel}</p>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-3 py-2"
            >
              <span className="font-medium">{row.sourceModName}</span>
              <RelationshipBadge type={row.relationshipType} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function DependencyGraphCard({
  label,
  subtitle,
  tone,
}: {
  label: string;
  subtitle?: string;
  tone: "root" | "installed" | "addon";
}) {
  const toneClasses =
    tone === "root"
      ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
      : tone === "addon"
        ? "border-[var(--color-secondary)] bg-[var(--color-secondary)] text-[var(--color-secondary-foreground)]"
        : "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-foreground)]";

  return (
    <div className={`w-full rounded-xl border px-4 py-3 text-center shadow-sm ${toneClasses}`}>
      <p className="font-medium">{label}</p>
      {subtitle && (
        <p
          className={`mt-1 text-xs ${
            tone === "root" ? "text-white/80" : "text-[var(--color-muted-foreground)]"
          }`}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}
