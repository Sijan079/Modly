import { useState } from "react";
import { Plus, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
} from "@/hooks/useCategories";

interface CategoryManagerProps {
  instanceId: string | null;
}

export function CategoryManager({ instanceId }: CategoryManagerProps) {
  const { data: categories = [] } = useCategories(instanceId);
  const createMutation = useCreateCategory();
  const deleteMutation = useDeleteCategory();
  const [newName, setNewName] = useState("");

  const handleAdd = () => {
    if (!instanceId || !newName.trim()) return;
    createMutation.mutate(
      { instanceId, name: newName.trim() },
      { onSuccess: () => setNewName("") }
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
                  onClick={() => deleteMutation.mutate(cat.id)}
                  title="Remove category"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
