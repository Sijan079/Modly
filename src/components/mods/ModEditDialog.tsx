import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ExternalLink, RotateCcw, Save } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ThemedSelect } from "@/components/ui/themed-select";
import type {
  InstanceCategory,
  ModFile,
  ModLoaderKind,
  ModRelationshipType,
  ModSide,
  UpdateModRelationshipInput,
  UpdateModMetadataInput,
} from "@/lib/types";
import { formatLoader } from "@/lib/utils";
import { normalizeSourceUrl } from "@/lib/mod-source-url";
import { api } from "@/lib/api";

const LOADERS: ModLoaderKind[] = [
  "fabric",
  "forge",
  "neoforge",
  "quilt",
  "unknown",
];

const SIDES: ModSide[] = ["unknown", "client", "server", "both"];

interface ModEditDialogProps {
  mod: ModFile | null;
  mods: ModFile[];
  categories: InstanceCategory[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: UpdateModMetadataInput) => void;
  onReset: (modId: string) => void;
  saving?: boolean;
  resetting?: boolean;
}

export function ModEditDialog({
  mod,
  mods,
  categories,
  open,
  onOpenChange,
  onSave,
  onReset,
  saving,
  resetting,
}: ModEditDialogProps) {
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [authors, setAuthors] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [loader, setLoader] = useState<ModLoaderKind>("unknown");
  const [side, setSide] = useState<ModSide>("unknown");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [relatedMods, setRelatedMods] = useState<UpdateModRelationshipInput[]>([]);
  const { data: declared, isPending: declaredPending, error: declaredError } = useQuery({
    queryKey: ["mod-truth-relationships", mod?.instanceId, mod?.filePath],
    queryFn: () => api.mods.truthRelationships(mod!.instanceId, mod!.filePath),
    enabled: open && !!mod,
  });

  useEffect(() => {
    if (!mod) return;
    const meta = mod.metadata;
    setName(meta?.name ?? mod.fileName.replace(/\.jar$/i, ""));
    setVersion(meta?.version ?? "");
    setAuthors(meta?.authors?.join(", ") ?? "");
    setWebsiteUrl(mod.sourceUrl ?? meta?.modrinthUrl ?? "");
    setLoader((meta?.loader as ModLoaderKind) ?? "unknown");
    setSide(meta?.side ?? "unknown");
    setSelectedCategoryIds(mod.categories.map((category) => category.id));
    setRelatedMods(mod.relatedMods ?? []);
  }, [mod]);

  if (!mod) return null;

  const toggleCategory = (categoryId: string) => {
    setSelectedCategoryIds((prev) =>
      prev.includes(categoryId)
        ? prev.filter((id) => id !== categoryId)
        : [...prev, categoryId]
    );
  };

  const handleSave = () => {
    const url = normalizeSourceUrl(websiteUrl);
    onSave({
      modId: mod.id,
      name: name.trim() || "Unknown Mod",
      version: version.trim() || "?",
      authors: authors
        .split(",")
        .map((author) => author.trim())
        .filter(Boolean),
      modrinthUrl: url.includes("modrinth.com") ? url : null,
      sourceUrl: url || null,
      loader,
      side,
      modIdField: mod.metadata?.modId ?? null,
      categoryIds: selectedCategoryIds,
      relatedMods: relatedMods.filter((relatedMod) => relatedMod.targetModId),
    });
  };

  const relationshipOptions = mods
    .filter((candidate) => candidate.id !== mod.id)
    .sort((a, b) =>
      (a.metadata?.name ?? a.fileName).localeCompare(b.metadata?.name ?? b.fileName)
    );

  const addRelatedMod = () => {
    const nextTarget = relationshipOptions.find(
      (candidate) => !relatedMods.some((relatedMod) => relatedMod.targetModId === candidate.id)
    );
    setRelatedMods((prev) => [
      ...prev,
      {
        targetModId: nextTarget?.id ?? "",
        relationshipType: "dependency",
      },
    ]);
  };

  const updateRelatedMod = (
    index: number,
    patch: Partial<UpdateModRelationshipInput>
  ) => {
    setRelatedMods((prev) =>
      prev.map((relatedMod, relatedIndex) =>
        relatedIndex === index ? { ...relatedMod, ...patch } : relatedMod
      )
    );
  };

  const removeRelatedMod = (index: number) => {
    setRelatedMods((prev) => prev.filter((_, relatedIndex) => relatedIndex !== index));
  };

  const getRelationshipLabel = (value: ModRelationshipType) =>
    value === "addon_for" ? "Add-on For" : "Dependency";

  const openWebsite = () => {
    const url = normalizeSourceUrl(websiteUrl);
    if (url) {
      openUrl(url);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit mod info</DialogTitle>
          <DialogDescription className="truncate">
            {mod.fileName}
            {mod.metadata?.customized && (
              <span className="ml-2 text-amber-400">- customized</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="mod-name">Display name</Label>
            <Input
              id="mod-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sodium"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mod-version">Version</Label>
              <Input
                id="mod-version"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="e.g. 0.5.11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mod-loader">Loader</Label>
              <ThemedSelect
                id="mod-loader"
                className="w-full"
                value={loader}
                onValueChange={(value) => setLoader(value as ModLoaderKind)}
                options={LOADERS.map((value) => ({ value, label: formatLoader(value) }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mod-side">Side</Label>
              <ThemedSelect
                id="mod-side"
                className="w-full"
                value={side}
                onValueChange={(value) => setSide(value as ModSide)}
                options={SIDES.map((value) => ({
                  value,
                  label: value === "unknown"
                      ? ""
                      : value === "client"
                      ? "Client"
                      : value === "server"
                        ? "Server"
                        : "Both",
                }))}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mod-authors">Authors (comma-separated)</Label>
            <Input
              id="mod-authors"
              value={authors}
              onChange={(e) => setAuthors(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mod-website">Website URL (optional)</Label>
            <div className="flex gap-2">
              <Input
                id="mod-website"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://modrinth.com/mod/... or https://curseforge.com/..."
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={openWebsite}
                disabled={!normalizeSourceUrl(websiteUrl)}
                title="Open in browser"
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Categories</Label>
            {categories.length === 0 ? (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Create categories in the panel above the mod list first.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {categories.map((category) => {
                  const selected = selectedCategoryIds.includes(category.id);
                  return (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => toggleCategory(category.id)}
                      className="focus:outline-none"
                    >
                      <Badge
                        variant={selected ? "default" : "outline"}
                        className="cursor-pointer"
                      >
                        {category.name}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="space-y-3">
            <div className="rounded-md border border-[var(--color-border)] p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2"><strong>Declared relationships</strong><Link className="text-[var(--color-primary)] hover:underline" to={`/dependencies?mod=${encodeURIComponent(mod.filePath)}`} onClick={() => onOpenChange(false)}>Open graph</Link></div>
              {declaredPending ? <p role="status">Loading relationships...</p> : declaredError ? <p role="alert">Could not load declared relationships.</p> : declared && <p className="mt-1 text-[var(--color-muted-foreground)]">{declared.outgoing.length} declared links; {declared.incoming.length} incoming references. {declared.requiredDependentPaths.length} required dependent paths. Review the graph before removal.</p>}
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label>Related Mods</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRelatedMod}
                disabled={relationshipOptions.length === 0}
              >
                Add Related Mod
              </Button>
            </div>
            {relatedMods.length === 0 ? (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                No related mods mapped yet.
              </p>
            ) : (
              <div className="space-y-2">
                {relatedMods.map((relatedMod, index) => (
                  <div key={`${relatedMod.targetModId || "new"}-${index}`} className="grid gap-2 md:grid-cols-[1fr_10rem_auto]">
                    <RelatedModPicker
                      value={relatedMod.targetModId}
                      options={relationshipOptions}
                      disabledIds={relatedMods
                        .filter((_, relatedIndex) => relatedIndex !== index)
                        .map((existing) => existing.targetModId)}
                      onChange={(targetModId) =>
                        updateRelatedMod(index, { targetModId })
                      }
                    />
                    <ThemedSelect
                      className="w-full"
                      value={relatedMod.relationshipType}
                      onValueChange={(value) =>
                        updateRelatedMod(index, {
                          relationshipType: value as ModRelationshipType,
                        })
                      }
                      options={[
                        { value: "dependency", label: getRelationshipLabel("dependency") },
                        { value: "addon_for", label: getRelationshipLabel("addon_for") },
                      ]}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeRelatedMod(index)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={resetting}
            onClick={() => onReset(mod.id)}
          >
            <RotateCcw className={`h-4 w-4 ${resetting ? "animate-spin" : ""}`} />
            Re-parse from JAR
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4" />
              Save
            </Button>
          </div>
        </div>
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
  const listId = useId();
  const [text, setText] = useState("");

  useEffect(() => {
    const selected = options.find((candidate) => candidate.id === value);
    setText(selected ? selected.metadata?.name ?? selected.fileName : "");
  }, [options, value]);

  const availableOptions = options.filter(
    (candidate) => !disabledIds.includes(candidate.id) || candidate.id === value
  );

  const resolveSelection = (nextText: string) => {
    const match = availableOptions.find(
      (candidate) =>
        (candidate.metadata?.name ?? candidate.fileName).toLowerCase() ===
        nextText.trim().toLowerCase()
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
          <option
            key={candidate.id}
            value={candidate.metadata?.name ?? candidate.fileName}
          />
        ))}
      </datalist>
    </>
  );
}
