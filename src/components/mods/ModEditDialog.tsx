import { useEffect, useState } from "react";
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
import type {
  InstanceCategory,
  ModFile,
  ModLoaderKind,
  UpdateModMetadataInput,
} from "@/lib/types";
import { formatLoader } from "@/lib/utils";

const LOADERS: ModLoaderKind[] = [
  "fabric",
  "forge",
  "neoforge",
  "quilt",
  "unknown",
];

interface ModEditDialogProps {
  mod: ModFile | null;
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
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);

  useEffect(() => {
    if (!mod) return;
    const meta = mod.metadata;
    setName(meta?.name ?? mod.fileName.replace(/\.jar$/i, ""));
    setVersion(meta?.version ?? "");
    setAuthors(meta?.authors?.join(", ") ?? "");
    setWebsiteUrl(meta?.modrinthUrl ?? "");
    setLoader((meta?.loader as ModLoaderKind) ?? "unknown");
    setSelectedCategoryIds(mod.categories.map((category) => category.id));
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
    const url = normalizeWebsiteUrl(websiteUrl);
    onSave({
      modId: mod.id,
      name: name.trim() || "Unknown Mod",
      version: version.trim() || "?",
      authors: authors
        .split(",")
        .map((author) => author.trim())
        .filter(Boolean),
      modrinthUrl: url || null,
      loader,
      modIdField: mod.metadata?.modId ?? null,
      categoryIds: selectedCategoryIds,
    });
  };

  const openWebsite = () => {
    const url = normalizeWebsiteUrl(websiteUrl);
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
              <select
                id="mod-loader"
                className="flex h-9 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-muted)] px-3 text-sm"
                value={loader}
                onChange={(e) => setLoader(e.target.value as ModLoaderKind)}
              >
                {LOADERS.map((loaderOption) => (
                  <option key={loaderOption} value={loaderOption}>
                    {formatLoader(loaderOption)}
                  </option>
                ))}
              </select>
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
                disabled={!normalizeWebsiteUrl(websiteUrl)}
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

function normalizeWebsiteUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  return `https://${trimmed.replace(/^\/+/, "")}`;
}
