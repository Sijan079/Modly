import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ThemedSelect } from "@/components/ui/themed-select";
import type {
  BulkUpdateModMetadataInput,
  InstanceCategory,
  ModLoaderKind,
  ModSide,
} from "@/lib/types";
import { formatLoader } from "@/lib/utils";

const LOADERS: ModLoaderKind[] = ["fabric", "forge", "neoforge", "quilt", "unknown"];
const SIDES: ModSide[] = ["unknown", "client", "server", "both"];

interface BulkModEditDialogProps {
  instanceId: string | null;
  selectedCount: number;
  categories: InstanceCategory[];
  open: boolean;
  saving?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: BulkUpdateModMetadataInput) => void;
}

export function BulkModEditDialog({
  instanceId,
  selectedCount,
  categories,
  open,
  saving,
  onOpenChange,
  onSave,
}: BulkModEditDialogProps) {
  const [loader, setLoader] = useState<ModLoaderKind>("unknown");
  const [side, setSide] = useState<ModSide>("unknown");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setLoader("unknown");
      setSide("unknown");
      setCategoryIds([]);
    }
  }, [open]);

  const toggleCategory = (categoryId: string) => {
    setCategoryIds((current) =>
      current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId]
    );
  };

  const save = () => {
    if (!instanceId) return;
    onSave({
      instanceId,
      modIds: [],
      categoryIds,
      loader,
      side,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk edit mods</DialogTitle>
          <DialogDescription>
            Set categories, loader, and side for {selectedCount} selected mod{selectedCount === 1 ? "" : "s"}.
            Categories replace each mod&apos;s current categories.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bulk-mod-loader">Loader</Label>
              <ThemedSelect
                id="bulk-mod-loader"
                className="w-full"
                value={loader}
                onValueChange={(value) => setLoader(value as ModLoaderKind)}
                options={LOADERS.map((value) => ({ value, label: formatLoader(value) }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-mod-side">Side</Label>
              <ThemedSelect
                id="bulk-mod-side"
                className="w-full"
                value={side}
                onValueChange={(value) => setSide(value as ModSide)}
                options={SIDES.map((value) => ({ value, label: value === "unknown" ? "Unknown" : value === "client" ? "Client" : value === "server" ? "Server" : "Both" }))}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Categories</Label>
            {categories.length === 0 ? (
              <p className="text-xs text-[var(--color-muted-foreground)]">No categories are available for this instance.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {categories.map((category) => (
                  <button key={category.id} type="button" onClick={() => toggleCategory(category.id)}>
                    <Badge variant={categoryIds.includes(category.id) ? "default" : "outline"}>{category.name}</Badge>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={!instanceId || selectedCount === 0 || saving}>
            <Save className="h-4 w-4" /> Apply to {selectedCount}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
