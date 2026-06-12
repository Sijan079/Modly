import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Lightbulb, Plus, Save, Trash2, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageShell } from "@/components/layout/PageShell";
import { PageSearchBar } from "@/components/layout/PageSearchBar";
import { PageToolbar } from "@/components/layout/PageToolbar";
import { ModFilters } from "@/components/mods/ModFilters";
import { useCategories } from "@/hooks/useCategories";
import { useInstances } from "@/hooks/useInstances";
import {
  useDeleteModSuggestion,
  useModSuggestions,
  useUpsertModSuggestion,
} from "@/hooks/useMods";
import { filterMods, useAppStore, type ModListFilters } from "@/store/app";
import type { InstanceCategory, ModLoaderKind, ModSuggestion } from "@/lib/types";
import { formatLoader } from "@/lib/utils";
import { normalizeSourceUrl, parseModSourceUrl } from "@/lib/mod-source-url";

interface ModrinthProject {
  title: string;
  description: string;
  body?: string;
  icon_url?: string | null;
  downloads?: number;
  followers?: number;
  categories?: string[];
  game_versions?: string[];
  loaders?: string[];
}

const LOADERS: ModLoaderKind[] = ["fabric", "forge", "neoforge", "quilt", "unknown"];

const defaultFilters: ModListFilters = {
  categoryId: null,
  loader: "all",
  status: "all",
};

const emptyDraft = {
  id: null as string | null,
  name: "",
  loader: "unknown" as ModLoaderKind,
  sourceUrl: "",
  enabled: true,
  categoryIds: [] as string[],
};

export function ModSuggestionsPage() {
  const { data: instances = [] } = useInstances();
  const { selectedInstanceId, setSelectedInstance } = useAppStore();
  const instanceId = selectedInstanceId ?? instances[0]?.id ?? null;
  const { data: suggestions = [], isLoading } = useModSuggestions(instanceId);
  const { data: categories = [] } = useCategories(instanceId);
  const upsertSuggestion = useUpsertModSuggestion();
  const deleteSuggestion = useDeleteModSuggestion();

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ModListFilters>(defaultFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [editorOpen, setEditorOpen] = useState(false);

  const selectedSuggestion =
    suggestions.find((suggestion) => suggestion.id === selectedId) ?? null;
  const preview = parseModSourceUrl(selectedSuggestion?.sourceUrl);
  const filteredSuggestions = useMemo(
    () => filterMods(suggestions, search, filters),
    [filters, search, suggestions]
  );
  const hasActiveFilters =
    filters.categoryId !== null ||
    filters.loader !== "all" ||
    filters.status !== "all";

  const editSuggestion = (suggestion: ModSuggestion) => {
    setSelectedId(suggestion.id);
    setDraft({
      id: suggestion.id,
      name: suggestion.metadata?.name ?? suggestion.fileName,
      loader: suggestion.metadata?.loader ?? "unknown",
      sourceUrl: suggestion.sourceUrl ?? "",
      enabled: suggestion.enabled,
      categoryIds: suggestion.categories.map((category) => category.id),
    });
    setEditorOpen(true);
  };

  const resetDraft = () => {
    setDraft(emptyDraft);
  };

  const clearSearchAndFilters = () => {
    setSearch("");
    setFilters(defaultFilters);
  };

  const openNewSuggestionModal = () => {
    resetDraft();
    setEditorOpen(true);
  };

  const saveDraft = () => {
    if (!instanceId) return;
    const normalizedUrl = normalizeSourceUrl(draft.sourceUrl);
    const name = draft.name.trim();
    if (!name) return;

    upsertSuggestion.mutate(
      {
        id: draft.id,
        instanceId,
        fileName: name,
        filePath: "",
        enabled: draft.enabled,
        hashSha256: null,
        sourceUrl: normalizedUrl || null,
        name,
        version: "?",
        authors: [],
        loader: draft.loader,
        modIdField: null,
        categoryIds: draft.categoryIds,
      },
      {
        onSuccess: (suggestion) => {
          setSelectedId(suggestion.id);
          resetDraft();
          setEditorOpen(false);
        },
      }
    );
  };

  const deleteSelectedSuggestion = (suggestion: ModSuggestion) => {
    if (!instanceId) return;
    const displayName = suggestion.metadata?.name ?? suggestion.fileName;
    const typedName = window.prompt(
      `Delete "${displayName}" from suggestions?\n\nType the mod name to confirm.`
    );
    if (typedName !== displayName) return;
    deleteSuggestion.mutate(
      { instanceId, id: suggestion.id },
      {
        onSuccess: () => {
          if (selectedId === suggestion.id) {
            setSelectedId(null);
          }
        },
      }
    );
  };

  const toggleCategory = (category: InstanceCategory) => {
    setDraft((current) => ({
      ...current,
      categoryIds: current.categoryIds.includes(category.id)
        ? current.categoryIds.filter((id) => id !== category.id)
        : [...current.categoryIds, category.id],
    }));
  };

  return (
    <div className="flex flex-col gap-5">
      <PageShell
        title="Mod Suggestions"
        description={`Stage mods to check or download later - ${filteredSuggestions.length} of ${suggestions.length} shown`}
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
            <Button onClick={openNewSuggestionModal} disabled={!instanceId}>
              <Plus className="h-4 w-4" />
              Add Suggestion
            </Button>
          </>
        }
      />

      <PageToolbar
        search={
          <PageSearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search suggestions by name, loader, category, source..."
          />
        }
        filters={
          <ModFilters
            filters={filters}
            onChange={setFilters}
            categories={categories}
            instanceId={instanceId}
            onClear={clearSearchAndFilters}
            showClear={hasActiveFilters || search.trim().length > 0}
          />
        }
      />

      <div
        className={`grid gap-5 transition-[grid-template-columns] duration-300 ease-out ${
          preview && selectedSuggestion
            ? "xl:grid-cols-[minmax(0,1fr)_460px]"
            : "xl:grid-cols-[minmax(0,1fr)]"
        }`}
      >
        <div className="flex min-w-0 flex-col gap-4">
          <SuggestionTable
            suggestions={filteredSuggestions}
            loading={isLoading}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onEdit={editSuggestion}
            onDelete={deleteSelectedSuggestion}
          />
        </div>

        {preview && selectedSuggestion && (
          <Card className="h-[calc(100vh-13rem)] min-h-[520px] overflow-hidden">
            <CardContent className="flex h-full flex-col gap-4 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-[var(--color-muted-foreground)]">Source preview</p>
                  <h3 className="mt-1 text-lg font-semibold">{selectedSuggestion.metadata?.name}</h3>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={preview.platform === "modrinth" ? "default" : "secondary"}>
                    {preview.label}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Close preview"
                    onClick={() => setSelectedId(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-background)]">
                <SourcePreviewContent preview={preview} />
              </div>
              <Button variant="outline" onClick={() => openUrl(preview.url)}>
                <ExternalLink className="h-4 w-4" />
                Open in browser
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft.id ? "Edit suggestion" : "Add suggestion"}</DialogTitle>
            <DialogDescription>
              Save a mod to check or download later.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <Field label="Display name">
              <Input
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Sodium"
              />
            </Field>
            <Field label="Loader">
              <select
                className="flex h-9 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-muted)] px-3 text-sm"
                value={draft.loader}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    loader: event.target.value as ModLoaderKind,
                  }))
                }
              >
                {LOADERS.map((loader) => (
                  <option key={loader} value={loader}>
                    {formatLoader(loader)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Source URL">
              <Input
                value={draft.sourceUrl}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, sourceUrl: event.target.value }))
                }
                placeholder="https://modrinth.com/mod/... or https://curseforge.com/minecraft/mc-mods/..."
              />
            </Field>
            <div className="space-y-2">
              <Label>Categories</Label>
              {categories.length === 0 ? (
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Create categories from the Mods page to tag suggestions.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => toggleCategory(category)}
                      className="focus:outline-none"
                    >
                      <Badge
                        variant={draft.categoryIds.includes(category.id) ? "default" : "outline"}
                        className="cursor-pointer"
                      >
                        {category.name}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={saveDraft}
              disabled={!instanceId || !draft.name.trim() || upsertSuggestion.isPending}
            >
              <Save className="h-4 w-4" />
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function SourcePreviewContent({
  preview,
}: {
  preview: NonNullable<ReturnType<typeof parseModSourceUrl>>;
}) {
  if (preview.platform === "modrinth") {
    return <ModrinthPreview projectSlug={preview.project} />;
  }

  return (
    <div className="flex h-full flex-col justify-center gap-3 p-5 text-sm text-[var(--color-muted-foreground)]">
      <p className="font-medium text-[var(--color-foreground)]">
        CurseForge does not allow embedded page previews here.
      </p>
      <p>
        Use the browser button below to view the source page. The saved URL still works for
        tracking and future download migration.
      </p>
    </div>
  );
}

function ModrinthPreview({ projectSlug }: { projectSlug: string }) {
  const [project, setProject] = useState<ModrinthProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setProject(null);
    setError(null);
    setLoading(true);

    fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectSlug)}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Modrinth returned ${response.status}`);
        }
        return response.json() as Promise<ModrinthProject>;
      })
      .then((data) => setProject(data))
      .catch((fetchError) => {
        if (controller.signal.aborted) return;
        setError(fetchError instanceof Error ? fetchError.message : "Could not load preview");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [projectSlug]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--color-muted-foreground)]">
        Loading Modrinth preview...
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex h-full flex-col justify-center gap-3 p-5 text-sm text-[var(--color-muted-foreground)]">
        <p className="font-medium text-[var(--color-foreground)]">Preview unavailable</p>
        <p>{error ?? "The project data could not be loaded."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-5">
      <div className="flex items-start gap-4">
        {project.icon_url && (
          <img
            src={project.icon_url}
            alt=""
            className="h-16 w-16 shrink-0 rounded-lg border border-[var(--color-border)] object-cover"
          />
        )}
        <div className="min-w-0">
          <h4 className="text-lg font-semibold text-[var(--color-foreground)]">
            {project.title}
          </h4>
          <p className="mt-1 text-sm leading-6 text-[var(--color-muted-foreground)]">
            {project.description}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <Stat label="Downloads" value={formatCount(project.downloads)} />
        <Stat label="Followers" value={formatCount(project.followers)} />
      </div>

      <PreviewBadgeGroup label="Loaders" values={project.loaders ?? []} />
      <PreviewBadgeGroup label="Categories" values={project.categories ?? []} />
      <PreviewBadgeGroup
        label="Game versions"
        values={(project.game_versions ?? []).slice(-8).reverse()}
      />

      {project.body && (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-3">
          <p className="text-xs uppercase text-[var(--color-muted-foreground)]">Summary</p>
          <p className="mt-2 max-h-48 overflow-hidden whitespace-pre-line text-sm leading-6 text-[var(--color-foreground)]">
            {project.body.slice(0, 1200)}
            {project.body.length > 1200 ? "..." : ""}
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-3">
      <p className="text-xs text-[var(--color-muted-foreground)]">{label}</p>
      <p className="mt-1 font-semibold text-[var(--color-foreground)]">{value}</p>
    </div>
  );
}

function PreviewBadgeGroup({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase text-[var(--color-muted-foreground)]">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) => (
          <Badge key={value} variant="secondary" className="text-[10px]">
            {value}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function formatCount(value?: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(value ?? 0);
}

function SuggestionTable({
  suggestions,
  loading,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
}: {
  suggestions: ModSuggestion[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (suggestion: ModSuggestion) => void;
  onDelete: (suggestion: ModSuggestion) => void;
}) {
  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center text-[var(--color-muted-foreground)]">
        Loading suggestions...
      </div>
    );
  }

  if (suggestions.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] text-[var(--color-muted-foreground)]">
        <Lightbulb className="h-5 w-5" />
        <p>No mod suggestions yet</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] bg-[var(--color-muted)]">
            <th className="w-[40%] px-4 py-3 text-left font-medium">Name</th>
            <th className="w-[18%] px-4 py-3 text-left font-medium">Loader</th>
            <th className="w-[26%] px-4 py-3 text-left font-medium">Categories</th>
            <th className="w-[12%] px-4 py-3 text-left font-medium">Source</th>
            <th className="w-14 px-4 py-3 text-left font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {suggestions.map((suggestion) => {
            const source = parseModSourceUrl(suggestion.sourceUrl);
            const selected = suggestion.id === selectedId;
            return (
              <tr
                key={suggestion.id}
                className={`cursor-pointer border-b border-[var(--color-border)]/50 hover:bg-[var(--color-muted)]/50 ${
                  selected ? "bg-[var(--color-muted)]/70" : ""
                }`}
                onClick={() => onSelect(suggestion.id)}
                onDoubleClick={() => onEdit(suggestion)}
              >
                <td className="px-4 py-3 font-medium">
                  <div className="flex flex-col gap-1">
                    <span>{suggestion.metadata?.name ?? suggestion.fileName}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge variant="outline">
                    {formatLoader(suggestion.metadata?.loader ?? "unknown")}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {suggestion.categories.length > 0 ? (
                      suggestion.categories.map((category) => (
                        <Badge key={category.id} variant="secondary" className="text-[10px]">
                          {category.name}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-[var(--color-muted-foreground)]">-</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {source ? <Badge>{source.label}</Badge> : "-"}
                </td>
                <td className="px-4 py-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-[var(--color-muted-foreground)] hover:bg-[var(--color-destructive)]/10 hover:text-[var(--color-destructive)]"
                    aria-label={`Delete ${suggestion.metadata?.name ?? suggestion.fileName}`}
                    title="Delete suggestion"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(suggestion);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
