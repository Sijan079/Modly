import { Copy, Download, FolderOpen, Package, Pencil, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Instance } from "@/lib/types";
import { formatLoader } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface InstanceCardProps {
  instance: Instance;
  selected?: boolean;
  onClick: () => void;
  onEdit: () => void;
  onExport: () => void;
  onOpenFolder: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function InstanceCard({
  instance,
  selected,
  onClick,
  onEdit,
  onExport,
  onOpenFolder,
  onDuplicate,
  onDelete,
}: InstanceCardProps) {
  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:border-[var(--color-primary)]/50",
        selected && "border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/30"
      )}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 text-lg">
                <Package className="h-5 w-5 text-[var(--color-primary)]" />
              </div>
            <div>
              <CardTitle className="text-base">{instance.name}</CardTitle>
              <p className="mt-0.5 truncate text-xs text-[var(--color-muted-foreground)] max-w-[200px]">
                {instance.mcVersion ?? "No version set"}
              </p>
            </div>
          </div>
          <Badge variant="secondary">{formatLoader(instance.loader)}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex gap-4 text-xs text-[var(--color-muted-foreground)]">
          <span>{instance.modCount} mods</span>
          <span>{instance.enabledModCount} enabled</span>
        </div>
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm"
            variant="outline"
            onClick={onEdit}
            aria-label={`Edit ${instance.name}`}
            title="Edit instance"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="outline" onClick={onExport} title="Export ZIP">
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="outline" onClick={onOpenFolder}>
            <FolderOpen className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="outline" onClick={onDuplicate}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5 text-[var(--color-destructive)]" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
