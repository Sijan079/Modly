import { useMemo, useState } from "react";
import { Plus, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
} from "@/hooks/useCategories";
import { useMods } from "@/hooks/useMods";
import type { InstanceCategory } from "@/lib/types";

interface CategoryManagerProps {
  instanceId: string | null;
  onCategoryDeleted?: (categoryId: string) => void;
}

export function CategoryManager({
  instanceId,
  onCategoryDeleted,
}: CategoryManagerProps) {
  const { data: categories = [] } = useCategories(instanceId);
  const { data: mods = [] } = useMods(instanceId);
  const createMutation = useCreateCategory();
  const deleteMutation = useDeleteCategory();
  const [newName, setNewName] = useState("");
  const [pendingDeleteCategory, setPendingDeleteCategory] = useState<InstanceCategory | null>(null);
  const [deleteMode, setDeleteMode] = useState<"clear" | "recategorize">("clear");
  const [replacementCategoryId, setReplacementCategoryId] = useState("");

  const affectedModCount = useMemo(() => {
    if (!pendingDeleteCategory) return 0;
    return mods.filter((mod) =>
      mod.categories.some((category) => category.id === pendingDeleteCategory.id)
    ).length;
  }, [mods, pendingDeleteCategory]);

  const replacementOptions = useMemo(() => {
    if (!pendingDeleteCategory) return [];
    return categories.filter((category) => category.id !== pendingDeleteCategory.id);
  }, [categories, pendingDeleteCategory]);
  const canRecategorize = replacementOptions.length > 0;

  const handleAdd = () => {
    if (!instanceId || !newName.trim()) return;
    createMutation.mutate(
      { instanceId, name: newName.trim() },
      { onSuccess: () => setNewName("") }
    );
  };

  const openDeleteDialog = (category: InstanceCategory) => {
    setPendingDeleteCategory(category);
    setDeleteMode("clear");
    setReplacementCategoryId("");
  };

  const closeDeleteDialog = () => {
    setPendingDeleteCategory(null);
    setDeleteMode("clear");
    setReplacementCategoryId("");
  };

  const handleDelete = () => {
    if (!pendingDeleteCategory) return;
    const deletedCategoryId = pendingDeleteCategory.id;
    deleteMutation.mutate(
      {
        categoryId: deletedCategoryId,
        mode: deleteMode === "recategorize" && canRecategorize ? "recategorize" : "clear",
        replacementCategoryId:
          deleteMode === "recategorize" && canRecategorize
            ? replacementCategoryId || null
            : null,
      },
      {
        onSuccess: () => {
          onCategoryDeleted?.(deletedCategoryId);
          closeDeleteDialog();
        },
      }
    );
  };

  if (!instanceId) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-[var(--color-muted-foreground)]">
          Select an instance to manage categories.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Tag className="h-4 w-4" />
          Instance categories
        </CardTitle>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Tags are unique per instance. Assign them when editing a mod.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="New category (e.g. Performance)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <Button
            size="icon"
            onClick={handleAdd}
            disabled={!newName.trim() || createMutation.isPending}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {categories.length === 0 ? (
          <p className="text-xs text-[var(--color-muted-foreground)]">
            No categories yet.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <Badge
                key={cat.id}
                variant="secondary"
                className="gap-1 pr-1"
              >
                {cat.name}
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-black/20"
                  onClick={() => openDeleteDialog(cat)}
                  title="Remove category"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={pendingDeleteCategory !== null}
        title="Delete category"
        description={
          affectedModCount > 0
            ? `"${pendingDeleteCategory?.name ?? ""}" is assigned to ${affectedModCount} mod${affectedModCount === 1 ? "" : "s"}. Choose whether to leave those mods blank or move them to another category in bulk.`
            : `Delete "${pendingDeleteCategory?.name ?? ""}"?`
        }
        confirmLabel={affectedModCount > 0 ? "Delete Category" : "Delete"}
        confirmDisabled={
          deleteMutation.isPending ||
          (affectedModCount > 0 &&
            canRecategorize &&
            deleteMode === "recategorize" &&
            !replacementCategoryId)
        }
        onConfirm={handleDelete}
        onOpenChange={(open) => !open && closeDeleteDialog()}
      >
        {affectedModCount > 0 && (
          <div className="space-y-4">
            <label className="flex gap-3 rounded-md border border-[var(--color-border)] p-3 text-sm">
              <input
                type="radio"
                name="delete-category-mode"
                className="mt-0.5"
                checked={deleteMode === "clear"}
                onChange={() => setDeleteMode("clear")}
              />
              <div>
                <p className="font-medium">Leave affected mods blank</p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Remove this category and leave the affected mods uncategorized.
                </p>
              </div>
            </label>
            {canRecategorize ? (
              <label className="flex gap-3 rounded-md border border-[var(--color-border)] p-3 text-sm">
                <input
                  type="radio"
                  name="delete-category-mode"
                  className="mt-0.5"
                  checked={deleteMode === "recategorize"}
                  onChange={() => setDeleteMode("recategorize")}
                />
                <div className="flex-1 space-y-2">
                  <p className="font-medium">Recategorize affected mods</p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Move every affected mod to one replacement category before deleting this one.
                  </p>
                  <select
                    className="flex h-9 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-muted)] px-3 text-sm"
                    value={replacementCategoryId}
                    onChange={(event) => setReplacementCategoryId(event.target.value)}
                    disabled={deleteMode !== "recategorize"}
                  >
                    <option value="">Select replacement category</option>
                    {replacementOptions.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
            ) : (
              <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3 text-sm text-[var(--color-muted-foreground)]">
                This is the only category, so affected mods can only be left blank.
              </div>
            )}
          </div>
        )}
      </ConfirmDialog>
    </Card>
  );
}
