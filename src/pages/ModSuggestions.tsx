import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Ellipsis, ExternalLink, FolderOpen, Lightbulb, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemedSelect } from "@/components/ui/themed-select";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ChangePlanDialog } from "@/components/mods/ChangePlanDialog";
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
import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";
import { ModFilters } from "@/components/mods/ModFilters";
import { useCategories } from "@/hooks/useCategories";
import { useInstances } from "@/hooks/useInstances";
import {
  useDeleteModSuggestion,
  useModrinthProjectDetails,
  useModrinthProjects,
  useMods,
  useModSuggestions,
  useSuggestionVersions,
  useUpsertModSuggestion,
} from "@/hooks/useMods";
import { filterMods, useAppStore, type ModListFilters } from "@/store/app";
import type {
  InstanceCategory,
  ModFile,
  ModLoaderKind,
  ModSide,
  ModrinthProjectSummary,
  ModSuggestion,
  SuggestionVersionOption,
  ChangeRequest,
} from "@/lib/types";
import { formatDate, formatLoader } from "@/lib/utils";
import { normalizeSourceUrl, parseModSourceUrl } from "@/lib/mod-source-url";

const LOADERS: ModLoaderKind[] = ["fabric", "forge", "neoforge", "quilt", "unknown"];
const VERSION_LOADERS: Array<ModLoaderKind | ""> = ["", "fabric", "forge", "neoforge", "quilt"];
const SIDES: ModSide[] = ["unknown", "client", "server", "both"];

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
  version: "",
  loader: "unknown" as ModLoaderKind,
  side: "unknown" as ModSide,
  sourceUrl: "",
  authors: [] as string[],
  filePath: "",
  enabled: true,
  categoryIds: [] as string[],
};

type ToastState = {
  id: number;
  message: string;
} | null;

type InstallState = {
  open: boolean;
  target: ModSuggestion | null;
  loader: ModLoaderKind | "";
  gameVersion: string;
  versionOptions: SuggestionVersionOption[];
  selectedVersionId: string;
  error: string | null;
};

function createInstallState(
  selectedInstance: { mcVersion?: string | null; loader?: string | null } | null
): InstallState {
  return {
    open: false,
    target: null,
    loader:
      selectedInstance?.loader && selectedInstance.loader !== "vanilla"
        ? (selectedInstance.loader as ModLoaderKind | "")
        : "",
    gameVersion: selectedInstance?.mcVersion ?? "",
    versionOptions: [],
    selectedVersionId: "",
    error: null,
  };
}

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
  const suggestionVersions = useSuggestionVersions();
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]);

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ModListFilters>(defaultFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [editorOpen, setEditorOpen] = useState(false);
  const [manualMetadataOpen, setManualMetadataOpen] = useState(false);
  const [importedSourceUrl, setImportedSourceUrl] = useState<string | null>(null);
  const [pendingDeleteSuggestion, setPendingDeleteSuggestion] =
    useState<ModSuggestion | null>(null);
  const [installState, setInstallState] = useState<InstallState>(() =>
    createInstallState(selectedInstance)
  );
  const [toast, setToast] = useState<ToastState>(null);
  const draftSource = parseModSourceUrl(draft.sourceUrl);
  const draftProjectId =
    editorOpen && draftSource?.platform === "modrinth" ? draftSource.project : null;
  const {
    data: editorProjectDetails = null,
    isLoading: editorProjectLoading,
    error: editorProjectError,
  } = useModrinthProjectDetails(draftProjectId);

  const selectedSuggestion =
    suggestions.find((suggestion) => suggestion.id === selectedId) ?? null;
  const preview = parseModSourceUrl(selectedSuggestion?.sourceUrl);
  const previewProjectId = preview?.platform === "modrinth" ? preview.project : null;
  const {
    data: previewProjects = [],
    isLoading: previewProjectLoading,
    error: previewProjectError,
  } = useModrinthProjects(
    previewProjectId ? [previewProjectId] : []
  );
  const previewProject = previewProjects[0] ?? null;
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

  useEffect(() => {
    if (!editorProjectDetails || !draftSource?.url || importedSourceUrl === draftSource.url) return;

    setDraft((current) => ({
      ...current,
      name: editorProjectDetails.project.title,
      loader: preferredProjectLoader(editorProjectDetails.project.loaders, selectedInstance?.loader),
      authors: editorProjectDetails.authors,
    }));
    setImportedSourceUrl(draftSource.url);
  }, [draftSource?.url, editorProjectDetails, importedSourceUrl, selectedInstance?.loader]);

  const showToast = (message: string) => {
    setToast({ id: Date.now(), message });
  };

  const resetInstallState = () => {
    setInstallState(createInstallState(selectedInstance));
  };

  const openInstallState = (
    target: ModSuggestion,
    loader: ModLoaderKind | "",
    gameVersion: string,
    error: string | null = null
  ) => {
    setInstallState({
      open: true,
      target,
      loader,
      gameVersion,
      versionOptions: [],
      selectedVersionId: "",
      error,
    });
  };

  const openInstallDialog = async (suggestion: ModSuggestion) => {
    const source = parseModSourceUrl(suggestion.sourceUrl);
    if (source?.platform !== "modrinth") {
      if (suggestion.filePath) {
        if (!instanceId) return;
        setChangeRequests([{ kind: "add", instanceId, suggestionId: suggestion.id, sourcePath: suggestion.filePath }]);
        return;
      }
      openInstallState(
        suggestion,
        "",
        selectedInstance?.mcVersion ?? "",
        source?.platform === "curseforge"
          ? "This suggestion points to CurseForge. Download from the source page first, attach the jar, then add it."
          : "Add a Modrinth source URL or attach a local jar before installing this suggestion."
      );
      return;
    }

    const nextLoader =
      suggestion.metadata?.loader && suggestion.metadata.loader !== "unknown"
        ? suggestion.metadata.loader
        : selectedInstance?.loader === "vanilla"
          ? ""
          : ((selectedInstance?.loader ?? "") as ModLoaderKind | "");
    const nextGameVersion = selectedInstance?.mcVersion ?? "";

    openInstallState(suggestion, nextLoader, nextGameVersion);

    try {
      const versions = await suggestionVersions.mutateAsync({
        suggestionId: suggestion.id,
        gameVersion: nextGameVersion || null,
        loader: nextLoader || null,
      });
      setInstallState((current) => ({
        ...current,
        versionOptions: versions,
        selectedVersionId: versions[0]?.versionId ?? "",
      }));
    } catch (error) {
      setInstallState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  const reloadInstallVersions = async () => {
    if (!installState.target) return;
    setInstallState((current) => ({
      ...current,
      error: null,
      versionOptions: [],
      selectedVersionId: "",
    }));

    try {
      const versions = await suggestionVersions.mutateAsync({
        suggestionId: installState.target.id,
        gameVersion: installState.gameVersion.trim() || null,
        loader: installState.loader || null,
      });
      setInstallState((current) => ({
        ...current,
        versionOptions: versions,
        selectedVersionId: versions[0]?.versionId ?? "",
      }));
    } catch (error) {
      setInstallState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  const confirmInstallSuggestion = async () => {
    if (!installState.target || !instanceId) return;
    const chosen = installState.versionOptions.find(
      (option) => option.versionId === installState.selectedVersionId
    );

    if (chosen) {
      setChangeRequests([{ kind: "add", instanceId, suggestionId: installState.target.id,
        versionId: chosen.versionId, downloadUrl: chosen.downloadUrl,
        fileName: chosen.fileName, expectedSha256: chosen.expectedSha256 }]);
    } else if (installState.target.filePath) {
      setChangeRequests([{ kind: "add", instanceId, suggestionId: installState.target.id, sourcePath: installState.target.filePath }]);
    } else {
      setInstallState((current) => ({
        ...current,
        error: "Pick a compatible version or attach a local jar first.",
      }));
      return;
    }

    resetInstallState();
  };

  const editSuggestion = (suggestion: ModSuggestion) => {
    setSelectedId(suggestion.id);
    setDraft({
      id: suggestion.id,
      name: suggestion.metadata?.name ?? suggestion.fileName,
      version: suggestion.metadata?.version === "?" ? "" : suggestion.metadata?.version ?? "",
      loader: suggestion.metadata?.loader ?? "unknown",
      side: suggestion.metadata?.side ?? "unknown",
      sourceUrl: suggestion.sourceUrl ?? "",
      authors: suggestion.metadata?.authors ?? [],
      filePath: suggestion.filePath ?? "",
      enabled: suggestion.enabled,
      categoryIds: suggestion.categories.map((category) => category.id),
    });
    setManualMetadataOpen(true);
    setImportedSourceUrl(parseModSourceUrl(suggestion.sourceUrl)?.url ?? null);
    setEditorOpen(true);
  };

  const resetDraft = () => {
    setDraft(emptyDraft);
    setManualMetadataOpen(false);
    setImportedSourceUrl(null);
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
        version: draft.version.trim() || "?",
        authors: draft.authors,
        loader: draft.loader,
        side: draft.side,
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

  const isCurseForgeDraft = draftSource?.platform === "curseforge";
  const isModrinthDraft = draftSource?.platform === "modrinth";
  const showManualMetadata =
    !isModrinthDraft || manualMetadataOpen || editorProjectError !== null;
  const selectedSourceUrl = normalizeSourceUrl(selectedSuggestion?.sourceUrl);

  return (
    <div className="flex flex-col gap-5">
      <PageShell
        title="Saved suggestions"
        description={`Review additions before installation - ${filteredSuggestions.length} of ${suggestions.length} shown${matchedSuggestionCount > 0 ? ` · ${matchedSuggestionCount} already installed` : ""}`}
        controls={
          <>
            <Button variant="outline" asChild><Link to="/scout">Back to Discover</Link></Button>
            <ThemedSelect
              className="min-w-[11rem]"
              value={instanceId ?? ""}
              onValueChange={(value) => setSelectedInstance(value || null)}
              aria-label="Select instance"
              options={[{ value: "", label: "Select instance" }, ...instances.map((instance) => ({ value: instance.id, label: instance.name }))]}
            />
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
            activityLabel="mod suggestions"
            activityContext={selectedInstance?.name}
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
          selectedSourceUrl && selectedSuggestion
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
            promotingId={null}
            onSelect={setSelectedId}
            onEdit={editSuggestion}
            onPromote={openInstallDialog}
            onDelete={confirmDeleteSuggestion}
          />
        </div>

        {selectedSourceUrl && selectedSuggestion && (
          <Card className="h-[calc(100vh-13rem)] min-h-[520px] overflow-hidden">
            <CardContent className="flex h-full flex-col gap-4 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-[var(--color-muted-foreground)]">Source preview</p>
                  <h3 className="mt-1 text-lg font-semibold">{selectedSuggestion.metadata?.name}</h3>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={preview?.platform === "modrinth" ? "default" : "secondary"}>
                    {preview?.label ?? "Source link"}
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
                {preview ? (
                  <SourcePreviewContent
                    preview={preview}
                    project={previewProject}
                    loading={previewProjectLoading}
                    error={
                      previewProjectError instanceof Error
                        ? previewProjectError.message
                        : null
                    }
                  />
                ) : (
                  <GenericSourcePreview url={selectedSourceUrl} />
                )}
              </div>
              <Button variant="outline" onClick={() => openUrl(selectedSourceUrl)}>
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
            <Field label="Mod page URL">
              <Input
                value={draft.sourceUrl}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, sourceUrl: event.target.value }))
                }
                placeholder="https://modrinth.com/mod/... or https://curseforge.com/minecraft/mc-mods/..."
              />
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Paste a Modrinth or CurseForge mod page. Modrinth details are imported automatically.
              </p>
            </Field>
            {isModrinthDraft && (
              <ModrinthMetadataPanel
                details={editorProjectDetails}
                loading={editorProjectLoading}
                error={editorProjectError instanceof Error ? editorProjectError.message : null}
                manualOpen={manualMetadataOpen}
                onEditDetails={() => setManualMetadataOpen((open) => !open)}
              />
            )}
            {isCurseForgeDraft && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-100">
                CurseForge links are saved as a source only. Enter the mod details below manually.
              </div>
            )}
            {showManualMetadata && (
              <div className="grid gap-4 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/25 p-3 sm:grid-cols-2">
                <Field label="Display name">
                  <Input
                    value={draft.name}
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Sodium"
                  />
                </Field>
                <Field label="Loader">
                  <ThemedSelect
                    className="w-full"
                    value={draft.loader}
                    onValueChange={(value) => setDraft((current) => ({ ...current, loader: value as ModLoaderKind }))}
                    options={LOADERS.map((value) => ({ value, label: formatLoader(value) }))}
                  />
                </Field>
                <Field label="Authors">
                  <Input
                    value={draft.authors.join(", ")}
                    onChange={(event) => setDraft((current) => ({ ...current, authors: event.target.value.split(",").map((author) => author.trim()).filter(Boolean) }))}
                    placeholder="Author name"
                  />
                </Field>
                <Field label="Version">
                  <Input
                    value={draft.version}
                    onChange={(event) => setDraft((current) => ({ ...current, version: event.target.value }))}
                    placeholder="e.g. 1.2.3"
                  />
                </Field>
                <Field label="Side">
                  <ThemedSelect
                    className="w-full"
                    value={draft.side}
                    onValueChange={(value) => setDraft((current) => ({ ...current, side: value as ModSide }))}
                    options={SIDES.map((value) => ({ value, label: value === "unknown" ? "Unknown" : value === "client" ? "Client" : value === "server" ? "Server" : "Both" }))}
                  />
                </Field>
              </div>
            )}
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
              disabled={!instanceId || !draft.name.trim() || editorProjectLoading || upsertSuggestion.isPending}
            >
              <Save className="h-4 w-4" />
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={installState.open}
        onOpenChange={(open) => {
          if (!open) resetInstallState();
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Install suggestion</DialogTitle>
            <DialogDescription>
              {installState.target
                ? `Choose a compatible file for ${installState.target.metadata?.name ?? installState.target.fileName}.`
                : "Choose a compatible file."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <Field label="Loader">
              <ThemedSelect
                className="w-full"
                value={installState.loader}
                onValueChange={(value) =>
                  setInstallState((current) => ({
                    ...current,
                    loader: value as ModLoaderKind | "",
                  }))
                }
                options={[{ value: "", label: "Any loader" }, ...VERSION_LOADERS.filter(Boolean).map((value) => ({ value, label: formatLoader(value) }))]}
              />
            </Field>
            <Field label="Minecraft version">
              <div className="flex gap-2">
                <Input
                  value={installState.gameVersion}
                  onChange={(event) =>
                    setInstallState((current) => ({
                      ...current,
                      gameVersion: event.target.value,
                    }))
                  }
                  placeholder="1.21.1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={reloadInstallVersions}
                  disabled={!installState.target || suggestionVersions.isPending}
                >
                  {suggestionVersions.isPending ? "Checking..." : "Check versions"}
                </Button>
              </div>
            </Field>

            {installState.error && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-100">
                {installState.error}
              </div>
            )}

            {installState.versionOptions.length > 0 && (
              <Field label="Available files">
                <div className="max-h-64 space-y-2 overflow-auto rounded-md border border-[var(--color-border)] p-2">
                  {installState.versionOptions.map((option) => (
                    <button
                      key={option.versionId}
                      type="button"
                      onClick={() =>
                        setInstallState((current) => ({
                          ...current,
                          selectedVersionId: option.versionId,
                        }))
                      }
                      className={`w-full rounded-md border px-3 py-2 text-left transition ${
                        installState.selectedVersionId === option.versionId
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

            {!installState.versionOptions.length && installState.target?.filePath && (
              <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/40 px-3 py-2 text-sm text-[var(--color-muted-foreground)]">
                No matching source file selected yet. You can still install using the attached jar.
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={resetInstallState}>
              Cancel
            </Button>
            <Button
              onClick={() => void confirmInstallSuggestion()}
              disabled={
                !installState.target ||
                (!installState.selectedVersionId && !installState.target.filePath)
              }
            >
              Install
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {changeRequests.length > 0 && <ChangePlanDialog requests={changeRequests} instance={selectedInstance} onClose={() => setChangeRequests([])} onApplied={() => showToast("Suggestion installed.")} />}

      {toast && (
        <div className="pointer-events-none fixed right-5 top-5 z-50 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 text-sm text-[var(--color-foreground)] shadow-xl">
          {toast.message}
        </div>
      )}
    </div>
  );
}

function ModrinthMetadataPanel({
  details,
  loading,
  error,
  manualOpen,
  onEditDetails,
}: {
  details: { project: ModrinthProjectSummary; authors: string[] } | null;
  loading: boolean;
  error: string | null;
  manualOpen: boolean;
  onEditDetails: () => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/25 p-3">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }

  if (!details) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 text-sm text-amber-100">
        {error ?? "Modrinth details could not be loaded. You can enter the details manually."}
      </div>
    );
  }

  const authors = details.authors.length > 0 ? details.authors.join(", ") : "No author data listed";
  const loaders = details.project.loaders.length > 0
    ? details.project.loaders.map((loader) => formatLoader(loader as ModLoaderKind)).join(", ")
    : "No loader data listed";

  return (
    <div className="rounded-md border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Metadata imported from Modrinth</p>
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{details.project.title}</p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onEditDetails}>
          {manualOpen ? "Hide details" : "Edit details"}
        </Button>
      </div>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div><dt className="text-[var(--color-muted-foreground)]">Authors</dt><dd className="mt-0.5 text-[var(--color-foreground)]">{authors}</dd></div>
        <div><dt className="text-[var(--color-muted-foreground)]">Loaders</dt><dd className="mt-0.5 text-[var(--color-foreground)]">{loaders}</dd></div>
      </dl>
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

function GenericSourcePreview({ url }: { url: string }) {
  return (
    <div className="flex h-full flex-col justify-center gap-3 p-5 text-sm text-[var(--color-muted-foreground)]">
      <p className="font-medium text-[var(--color-foreground)]">Source link available</p>
      <p>This link is not a recognized Modrinth or CurseForge mod page, but you can still open it in your browser.</p>
      <p className="break-all text-xs">{url}</p>
    </div>
  );
}

function SourcePreviewContent({
  preview,
  project,
  loading,
  error,
}: {
  preview: NonNullable<ReturnType<typeof parseModSourceUrl>>;
  project: ModrinthProjectSummary | null;
  loading: boolean;
  error: string | null;
}) {
  if (preview.platform === "modrinth") {
    return <ModrinthPreview project={project} loading={loading} error={error} />;
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

function ModrinthPreview({
  project,
  loading,
  error,
}: {
  project: ModrinthProjectSummary | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <div aria-busy="true" aria-label="Loading Modrinth preview" className="space-y-5 p-5">
        <div className="flex items-start gap-4"><Skeleton className="h-16 w-16 shrink-0" /><div className="flex-1 space-y-3"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /></div></div>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    );
  }

  if (!project) {
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
        {project.iconUrl && (
          <img
            src={project.iconUrl}
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

      <PreviewBadgeGroup label="Loaders" values={project.loaders} />
      <PreviewBadgeGroup label="Categories" values={project.categories} />
      <PreviewBadgeGroup
        label="Game versions"
        values={project.gameVersions.slice(-8).reverse()}
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

function formatCount(value?: number | null) {
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
    return <TableSkeleton columns={5} />;
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
  const byProjectId = new Map<string, ModFile>();
  const byFileName = new Map<string, ModFile>();

  for (const mod of mods) {
    if (mod.hashSha256) {
      byHash.set(mod.hashSha256.toLowerCase(), mod);
    }
    const modId = mod.metadata?.modId?.trim().toLowerCase();
    if (modId) {
      byModId.set(modId, mod);
    }
    const projectId = parseModSourceUrl(mod.metadata?.modrinthUrl ?? mod.sourceUrl)?.platform === "modrinth"
      ? parseModSourceUrl(mod.metadata?.modrinthUrl ?? mod.sourceUrl)?.project
      : null;
    if (projectId && !byProjectId.has(projectId)) {
      byProjectId.set(projectId, mod);
    }
    const fileName = normalizeMatchText(mod.fileName);
    if (fileName && !byFileName.has(fileName)) {
      byFileName.set(fileName, mod);
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

    const source = parseModSourceUrl(suggestion.sourceUrl);
    if (source?.platform === "modrinth" && byProjectId.has(source.project)) {
      matches.set(suggestion.id, byProjectId.get(source.project)!);
      continue;
    }

    const fileName = normalizeMatchText(suggestion.fileName);
    if (fileName && byFileName.has(fileName)) {
      matches.set(suggestion.id, byFileName.get(fileName)!);
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

function preferredProjectLoader(
  loaders: string[],
  instanceLoader: string | null | undefined
): ModLoaderKind {
  const supported = loaders
    .map((loader) => loader.toLowerCase())
    .filter((loader): loader is ModLoaderKind => LOADERS.includes(loader as ModLoaderKind));
  const preferred = instanceLoader?.toLowerCase() as ModLoaderKind | undefined;

  if (preferred && preferred !== "unknown" && supported.includes(preferred)) {
    return preferred;
  }

  return supported[0] ?? "unknown";
}
