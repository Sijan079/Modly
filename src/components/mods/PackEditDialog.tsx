import { useEffect, useState } from "react";
import { ExternalLink, Save } from "lucide-react";
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
import type { PackItem, UpdatePackItemMetadataInput } from "@/lib/types";

interface PackEditDialogProps {
  item: PackItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: UpdatePackItemMetadataInput) => Promise<void>;
  saving?: boolean;
}

export function PackEditDialog({
  item,
  open,
  onOpenChange,
  onSave,
  saving,
}: PackEditDialogProps) {
  const [displayName, setDisplayName] = useState("");
  const [author, setAuthor] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    const meta = item.metadata;
    setDisplayName(meta?.displayName ?? item.fileName);
    setAuthor(meta?.author ?? "");
    setWebsiteUrl(meta?.websiteUrl ?? "");
    setNotes(meta?.notes ?? "");
    setError(null);
  }, [item]);

  if (!item) return null;

  const handleSave = async () => {
    try {
      setError(null);
      await onSave({
        itemId: item.id,
        displayName: displayName.trim() || item.fileName,
        author: author.trim(),
        websiteUrl: websiteUrl.trim() || null,
        notes: notes.trim(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save changes";
      setError(message);
    }
  };

  const openWebsite = () => {
    const url = websiteUrl.trim();
    if (url) {
      const fullUrl = url.startsWith("http") ? url : `https://${url}`;
      openUrl(fullUrl);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit pack info</DialogTitle>
          <DialogDescription className="truncate">
            {item.fileName}
            {item.metadata?.customized && (
              <span className="ml-2 text-amber-400">- customized</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="pack-name">Display name</Label>
            <Input
              id="pack-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. My Resource Pack"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pack-author">Author</Label>
            <Input
              id="pack-author"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="e.g. John Doe"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pack-website">Website URL (optional)</Label>
            <div className="flex gap-2">
              <Input
                id="pack-website"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="e.g. example.com"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={openWebsite}
                disabled={!websiteUrl.trim()}
                title="Open in browser"
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pack-notes">Notes</Label>
            <textarea
              id="pack-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes about this pack..."
              className="flex min-h-24 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-muted)] px-3 py-2 text-sm placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-red-950 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
