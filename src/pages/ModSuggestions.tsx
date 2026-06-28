import { useEffect, useMemo, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Ellipsis, ExternalLink, FolderOpen, Lightbulb, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  useInstallSuggestion,
  useMods,
  useModSuggestions,
  usePromoteModSuggestion,
  useSuggestionVersions,
  useUpsertModSuggestion,
} from "@/hooks/useMods";
import { filterMods, useAppStore, type ModListFilters } from "@/store/app";
import type {
  InstanceCategory,
  ModFile,
  ModLoaderKind,
  ModSuggestion,
  SuggestionVersionOption,
} from "@/lib/types";
import { formatDate, formatLoader } from "@/lib/utils";
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
const VERSION_LOADERS: Array<ModLoaderKind | ""> = ["", "fabric", "forge", "neoforge", "quilt"];

const defaultFilters: ModListFilters = {
  categoryId: null,
  loader: "all",
  side: "all",
  status: "all",
  sort: "nameAsc",
};

const emptyDraft = {
  id: null as string | null,
  name: "",
  loader: "unknown" as ModLoaderKind,
  sourceUrl: "",
  filePath: "",
  enabled: true,
  categoryIds: [] as string[],
};

type ToastState = {
  id: number;
  message: string;
} | null;

export function ModSuggestionsPage() {
  const { data: instances = [] } = useInstances();
  const { selectedInstanceId, setSelectedInstance } = useAppStore();
  const instanceId = selectedInstanceId ?? instances[0]?.id ?? null;
  const selectedInstance = instances.find((instance) => instance.id === instanceId) ?? null;
  const { data: mods = [] } = useMods(instanceId);
  const { data: suggestions = [], isLoading } = useModSuggestions(instanceId);
  const { data: categories = [] } = useCategories(instanceId);
  const upsertSuggestion = useUpsertModSuggestion();
  const deleteSuggestion = useDeleteModSuggestion();
  const promoteSuggestion = usePromoteModSuggestion();
  const suggestionVersions = useSuggestionVersions();
  const installSuggestion = useInstallSuggestion();

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ModListFilters>(defaultFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pendingDeleteSuggestion, setPendingDeleteSuggestion] =
    useState<ModSuggestion | null>(null);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [installTarget, setInstallTarget] = useState<ModSuggestion | null>(null);
  const [installLoader, setInstallLoader] = useState<ModLoaderKind | "">("");
  const [installGameVersion, setInstallGameVersion] = useState("");
  const [versionOptions, setVersionOptions] = useState<SuggestionVersionOption[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [installError, setInstallError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  const selectedSuggestion =
    suggestions.find((suggestion) => suggestion.id === selectedId) ?? null;
  const preview = parseModSourceUrl(selectedSuggestion?.sourceUrl);
  const filteredSuggestions = useMemo(
    () => filterMods(suggestions, search, filters),
    [filters, search, suggestions]
  );
  const suggestionMatches = useMemo(
    () => buildSuggestionMatches(suggestions, mods),
    [mods, suggestions]
  );
  const matchedSuggestionCount = suggestionMatches.size;
  const hasActiveFilters =
    filters.categoryId !== null ||
    filters.loader !== "all" ||
    filters.side !== "all" ||
    filters.status !== "all";

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = (message: string) => {
    setToast({ id: Date.now(), message });
  };

  const openInstallDialog = async (suggestion: ModSuggestion) => {
    const source = parseModSourceUrl(suggestion.sourceUrl);
    if (source?.platform !== "modrinth") {
      if (suggestion.filePath) {
        if (!instanceId) return;
        promoteSuggestion.mutate(
          { instanceId, suggestionId: suggestion.id },
          {
            onSuccess: () => showToast("Suggestion installed."),
          }
        );
        return;
      }
      setInstallTarget(suggestion);
      setInstallLoader("");
      setInstallGameVersion(selectedInstance?.mcVersion ?? "");
      setVersionOptions([]);
      setSelectedVersionId("");
      setInstallError(
        source?.platform === "curseforge"
          ? "This suggestion points to CurseForge. Download from the source page first, attach the jar, then add it."
          : "Add a Modrinth source URL or attach a local jar before installing this suggestion."
      );
      setInstallDialogOpen(true);
      return;
    }

    const nextLoader =
      suggestion.metadata?.loader && suggestion.metadata.loader !== "unknown"
        ? suggestion.metadata.loader
        : selectedInstance?.loader === "vanilla"
          ? ""
          : ((selectedInstance?.loader ?? "") as ModLoaderKind | "");
    const nextGameVersion = selectedInstance?.mcVersion ?? "";

    setInstallTarget(suggestion);
    setInstallLoader(nextLoader);
    setInstallGameVersion(nextGameVersion);
    setInstallDialogOpen(true);
    setInstallError(null);
    setVersionOptions([]);
    setSelectedVersionId("");

    try {
      const versions = await suggestionVersions.mutateAsync({
        suggestionId: suggestion.id,
        gameVersion: nextGameVersion || null,
        loader: nextLoader || null,
      });
      setVersionOptions(versions);
      setSelectedVersionId(versions[0]?.versionId ?? "");
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error));
    }
  };

  const reloadInstallVersions = async () => {
    if (!installTarget) return;
    setInstallError(null);
    setVersionOptions([]);
    setSelectedVersionId("");

    try {
      const versions = await suggestionVersions.mutateAsync({
        suggestionId: installTarget.id,
        gameVersion: installGameVersion.trim() || null,
        loader: installLoader || null,
      });
      setVersionOptions(versions);
      setSelectedVersionId(versions[0]?.versionId ?? "");
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error));
    }
  };

  const confirmInstallSuggestion = async () => {
    if (!installTarget || !instanceId) return;
    const chosen = versionOptions.find((option) => option.versionId === selectedVersionId);

    if (chosen) {
      await installSuggestion.mutateAsync({
        suggestionId: installTarget.id,
        versionId: chosen.versionId,
        downloadUrl: chosen.downloadUrl,
        fileName: chosen.fileName,
        expectedSha256: chosen.expectedSha256,
      });
      showToast("Suggestion installed.");
    } else if (installTarget.filePath) {
      await promoteSuggestion.mutateAsync({ instanceId, suggestionId: installTarget.id });
      showToast("Suggestion installed.");
    } else {
      setInstallError("Pick a compatible version or attach a local jar first.");
      return;
    }

    setInstallDialogOpen(false);
    setInstallTarget(null);
    setInstallError(null);
    setVersionOptions([]);
    setSelectedVersionId("");
  };

  const editSuggestion = (suggestion: ModSuggestion) => {
    setSelectedId(suggestion.id);
    setDraft({
      id: suggestion.id,
      name: suggestion.metadata?.name ?? suggestion.fileName,
      loader: suggestion.metadata?.loader ?? "unknown",
      sourceUrl: suggestion.sourceUrl ?? "",
      filePath: suggestion.filePath ?? "",
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

  const pickSuggestionFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Mod JAR", extensions: ["jar"] }],
    });

    if (typeof selected === "string") {
      setDraft((current) => ({ ...current, filePath: selected }));
    }
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
        filePath: draft.filePath.trim(),
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
          showToast(draft.id ? "Suggestion updated." : "Suggestion added.");
        },
      }
    );
  };

  const confirmDeleteSuggestion = (suggestion: ModSuggestion) => {
    setPendingDeleteSuggestion(suggestion);
  };

  const deleteSelectedSuggestion = () => {
    if (!instanceId) return;
    if (!pendingDeleteSuggestion) return;
    deleteSuggestion.mutate(
      { instanceId, id: pendingDeleteSuggestion.id },
      {
        onSuccess: () => {
          if (selectedId === pendingDeleteSuggestion.id) {
            setSelectedId(null);
          }
          showToast("Suggestion deleted.");
          setPendingDeleteSuggestion(null);
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
        description={`Stage mods to check or download later - ${filteredSuggestions.length} of ${suggestions.length} shown${matchedSuggestionCount > 0 ? ` · ${matchedSuggestionCount} already installed` : ""}`}
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
            showSideFilter={false}
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
          {matchedSuggestionCount > 0 && (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-sm font-medium text-[var(--color-foreground)]">
                    {matchedSuggestionCount} suggestion{matchedSuggestionCount === 1 ? "" : "s"} already appear in this instance.
                  </p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Review the highlighted rows below and consider deleting the duplicate suggestions.
                  </p>
                </div>
                <Badge variant="secondary">{matchedSuggestionCount} matched</Badge>
              </CardContent>
            </Card>
          )}
          <SuggestionTable
            suggestions={filteredSuggestions}
            suggestionMatches={suggestionMatches}
            loading={isLoading}
            selectedId={selectedId}
            promotingId={
              promoteSuggestion.isPending
                ? promoteSuggestion.variables?.suggestionId ?? null
                : installSuggestion.isPending
                  ? installSuggestion.variables?.suggestionId ?? null
                  : null
            }
            onSelect={setSelectedId}
            onEdit={editSuggestion}
            onPromote={openInstallDialog}
            onDelete={confirmDeleteSuggestion}
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

      <ConfirmDialog
        open={pendingDeleteSuggestion !== null}
        title="Delete suggestion"
        description={`Delete "${pendingDeleteSuggestion?.metadata?.name ?? pendingDeleteSuggestion?.fileName ?? ""}" from suggestions?`}
        confirmLabel="Delete Suggestion"
        onConfirm={deleteSelectedSuggestion}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteSuggestion(null);
          }
        }}
      />

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
            <Field label="Downloaded file (optional)">
              <div className="flex gap-2">
                <Input
                  value={draft.filePath}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, filePath: event.target.value }))
                  }
                  placeholder="C:\\path\\to\\mod.jar"
                />
                <Button type="button" variant="outline" onClick={pickSuggestionFile}>
                  <FolderOpen className="h-4 w-4" />
                  Browse
                </Button>
              </div>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Attach a downloaded jar now if you want this suggestion ready to add into the
                instance.
              </p>
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

      <Dialog
        open={installDialogOpen}
        onOpenChange={(open) => {
          setInstallDialogOpen(open);
          if (!open) {
            setInstallTarget(null);
            setInstallError(null);
            setVersionOptions([]);
            setSelectedVersionId("");
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Install suggestion</DialogTitle>
            <DialogDescription>
              {installTarget
                ? `Choose a compatible file for ${installTarget.metadata?.name ?? installTarget.fileName}.`
                : "Choose a compatible file."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <Field label="Loader">
              <select
                className="flex h-9 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-muted)] px-3 text-sm"
                value={installLoader}
                onChange={(event) => setInstallLoader(event.target.value as ModLoaderKind | "")}
              >
                <option value="">Any loader</option>
                {VERSION_LOADERS.filter(Boolean).map((loader) => (
                  <option key={loader} value={loader}>
                    {formatLoader(loader)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Minecraft version">
              <div className="flex gap-2">
                <Input
                  value={installGameVersion}
                  onChange={(event) => setInstallGameVersion(event.target.value)}
                  placeholder="1.21.1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={reloadInstallVersions}
                  disabled={!installTarget || suggestionVersions.isPending}
                >
                  {suggestionVersions.isPending ? "Checking..." : "Check versions"}
                </Button>
              </div>
            </Field>

            {installError && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-100">
                {installError}
              </div>
            )}

            {versionOptions.length > 0 && (
              <Field label="Available files">
                <div className="max-h-64 space-y-2 overflow-auto rounded-md border border-[var(--color-border)] p-2">
                  {versionOptions.map((option) => (
                    <button
                      key={option.versionId}
                      type="button"
                      onClick={() => setSelectedVersionId(option.versionId)}
                      className={`w-full rounded-md border px-3 py-2 text-left transition ${
                        selectedVersionId === option.versionId
                          ? "border-[var(--color-primary)] bg-[var(--color-muted)]"
                          : "border-[var(--color-border)] hover:bg-[var(--color-muted)]/60"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-[var(--color-foreground)]">
                          {option.versionNumber}
                        </span>
                        <span className="text-xs text-[var(--color-muted-foreground)]">
                          {formatDate(option.releaseDate)}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-[var(--color-muted-foreground)]">
                        {option.fileName}
                      </p>
                    </button>
                  ))}
                </div>
              </Field>
            )}

            {!versionOptions.length && installTarget?.filePath && (
              <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/40 px-3 py-2 text-sm text-[var(--color-muted-foreground)]">
                No matching source file selected yet. You can still install using the attached jar.
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setInstallDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void confirmInstallSuggestion()}
              disabled={
                !installTarget ||
                promoteSuggestion.isPending ||
                installSuggestion.isPending ||
                (!selectedVersionId && !installTarget.filePath)
              }
            >
              {promoteSuggestion.isPending || installSuggestion.isPending ? "Installing..." : "Install"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {toast && (
        <div className="pointer-events-none fixed right-5 top-5 z-50 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 text-sm text-[var(--color-foreground)] shadow-xl">
          {toast.message}
        </div>
      )}
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
  suggestionMatches,
  loading,
  selectedId,
  promotingId,
  onSelect,
  onEdit,
  onPromote,
  onDelete,
}: {
  suggestions: ModSuggestion[];
  suggestionMatches: Map<string, ModFile>;
  loading: boolean;
  selectedId: string | null;
  promotingId: string | null;
  onSelect: (id: string) => void;
  onEdit: (suggestion: ModSuggestion) => void;
  onPromote: (suggestion: ModSuggestion) => void;
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
            <th className="w-32 px-5 py-3 text-left font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {suggestions.map((suggestion) => {
            const source = parseModSourceUrl(suggestion.sourceUrl);
            const selected = suggestion.id === selectedId;
            const matchedMod = suggestionMatches.get(suggestion.id) ?? null;
            return (
              <tr
                key={suggestion.id}
                className={`cursor-pointer border-b border-[var(--color-border)]/50 hover:bg-[var(--color-muted)]/50 ${
                  matchedMod
                    ? selected
                      ? "bg-amber-500/15"
                      : "bg-amber-500/5"
                    : selected
                      ? "bg-[var(--color-muted)]/70"
                      : ""
                }`}
                onClick={() => onSelect(suggestion.id)}
              >
                <td className="px-4 py-3 font-medium">
                  <div className="flex flex-col gap-1">
                    <span>{suggestion.metadata?.name ?? suggestion.fileName}</span>
                    {matchedMod && (
                      <span className="text-xs text-amber-300">
                        Already installed as {matchedMod.metadata?.name ?? matchedMod.fileName}
                      </span>
                    )}
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
                  <div className="flex flex-wrap gap-1">
                    {source ? <Badge>{source.label}</Badge> : <span>-</span>}
                    {matchedMod && (
                      <Badge variant="secondary" className="bg-amber-500/15 text-amber-200">
                        Recommend delete
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="px-5 py-3">
                  <SuggestionActionsMenu
                    suggestion={suggestion}
                    busy={promotingId === suggestion.id}
                    onEdit={onEdit}
                    onPromote={onPromote}
                    onDelete={onDelete}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SuggestionActionsMenu({
  suggestion,
  busy,
  onEdit,
  onPromote,
  onDelete,
}: {
  suggestion: ModSuggestion;
  busy: boolean;
  onEdit: (suggestion: ModSuggestion) => void;
  onPromote: (suggestion: ModSuggestion) => void;
  onDelete: (suggestion: ModSuggestion) => void;
}) {
  const canInstall = !!suggestion.filePath || !!suggestion.sourceUrl;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-[var(--color-muted-foreground)]"
          aria-label={`Open actions for ${suggestion.metadata?.name ?? suggestion.fileName}`}
          onClick={(event) => event.stopPropagation()}
        >
          <Ellipsis className="h-4 w-4" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-40 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-1 shadow-lg"
          onClick={(event) => event.stopPropagation()}
        >
          <ActionMenuItem
            disabled={!canInstall || busy}
            onSelect={() => onPromote(suggestion)}
            icon={<Plus className="h-4 w-4" />}
            label={busy ? "Installing..." : "Install"}
          />
          <ActionMenuItem
            onSelect={() => onEdit(suggestion)}
            icon={<Pencil className="h-4 w-4" />}
            label="Edit"
          />
          <ActionMenuItem
            onSelect={() => onDelete(suggestion)}
            icon={<Trash2 className="h-4 w-4" />}
            label="Delete"
            destructive
          />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ActionMenuItem({
  disabled = false,
  destructive = false,
  onSelect,
  icon,
  label,
}: {
  disabled?: boolean;
  destructive?: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={`flex cursor-default items-center gap-2 rounded px-3 py-2 text-sm outline-none transition ${
        destructive
          ? "text-[var(--color-destructive)] focus:bg-[var(--color-destructive)]/10"
          : "text-[var(--color-foreground)] focus:bg-[var(--color-muted)]"
      } data-[disabled]:pointer-events-none data-[disabled]:opacity-50`}
    >
      {icon}
      <span>{label}</span>
    </DropdownMenu.Item>
  );
}

function buildSuggestionMatches(
  suggestions: ModSuggestion[],
  mods: ModFile[]
): Map<string, ModFile> {
  const byHash = new Map<string, ModFile>();
  const byModId = new Map<string, ModFile>();
  const byName = new Map<string, ModFile>();

  for (const mod of mods) {
    if (mod.hashSha256) {
      byHash.set(mod.hashSha256.toLowerCase(), mod);
    }
    const modId = mod.metadata?.modId?.trim().toLowerCase();
    if (modId) {
      byModId.set(modId, mod);
    }
    const names = [mod.metadata?.name, mod.fileName].map(normalizeMatchText).filter(Boolean);
    for (const name of names) {
      if (!byName.has(name)) {
        byName.set(name, mod);
      }
    }
  }

  const matches = new Map<string, ModFile>();
  for (const suggestion of suggestions) {
    const hash = suggestion.hashSha256?.toLowerCase();
    if (hash && byHash.has(hash)) {
      matches.set(suggestion.id, byHash.get(hash)!);
      continue;
    }

    const modId = suggestion.metadata?.modId?.trim().toLowerCase();
    if (modId && byModId.has(modId)) {
      matches.set(suggestion.id, byModId.get(modId)!);
      continue;
    }

    const names = [suggestion.metadata?.name, suggestion.fileName]
      .map(normalizeMatchText)
      .filter(Boolean);
    const matched = names.find((name) => byName.has(name));
    if (matched) {
      matches.set(suggestion.id, byName.get(matched)!);
    }
  }

  return matches;
}

function normalizeMatchText(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.jar(\.disabled)?$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
