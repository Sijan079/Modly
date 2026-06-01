import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { PlatformLinkButton } from "@/components/ui/platform-link-button";
import type { ModFile } from "@/lib/types";
import { formatLoader } from "@/lib/utils";

interface ModTableProps {
  mods: ModFile[];
  totalCount?: number;
  onToggle: (modId: string, enabled: boolean) => void;
  onEdit: (mod: ModFile) => void;
  loading?: boolean;
}

export function ModTable({
  mods,
  totalCount = 0,
  onToggle,
  onEdit,
  loading,
}: ModTableProps) {
  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center text-[var(--color-muted-foreground)]">
        Scanning mods...
      </div>
    );
  }

  if (mods.length === 0) {
    const filteredOut = totalCount > 0;
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 text-[var(--color-muted-foreground)]">
        <p>{filteredOut ? "No mods match your search or filters" : "No mods found"}</p>
        <p className="text-xs">
          {filteredOut
            ? "Try clearing search or filters above"
            : "Drop .jar files into the mods folder or scan"}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] bg-[var(--color-muted)]">
            <th className="w-20 px-4 py-3 text-left font-medium">Enabled</th>
            <th className="w-[36%] px-4 py-3 text-left font-medium">Name</th>
            <th className="w-[14%] px-4 py-3 text-left font-medium">Version</th>
            <th className="w-[22%] px-4 py-3 text-left font-medium">Categories</th>
            <th className="w-[14%] px-4 py-3 text-left font-medium">Loader</th>
            <th className="w-[10%] px-4 py-3 text-left font-medium">Link</th>
          </tr>
        </thead>
        <tbody>
          {mods.map((mod) => (
            <tr
              key={mod.id}
              className="cursor-pointer border-b border-[var(--color-border)]/50 hover:bg-[var(--color-muted)]/50"
              onClick={() => onEdit(mod)}
            >
              <td className="px-4 py-3">
                <Switch
                  checked={mod.enabled}
                  onClick={(event) => event.stopPropagation()}
                  onCheckedChange={(checked) => onToggle(mod.id, checked)}
                />
              </td>
              <td className="px-4 py-3 font-medium">
                <div className="flex flex-col gap-1">
                  <span>{mod.metadata?.name ?? mod.fileName}</span>
                  <span className="truncate text-xs text-[var(--color-muted-foreground)]">
                    {mod.fileName}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 text-[var(--color-muted-foreground)]">
                {mod.metadata?.version ?? "-"}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {mod.categories.length > 0 ? (
                    mod.categories.map((category) => (
                      <Badge
                        key={category.id}
                        variant="secondary"
                        className="text-[10px]"
                      >
                        {category.name}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-[var(--color-muted-foreground)]">-</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                {mod.metadata?.loader ? (
                  <Badge variant="outline">
                    {formatLoader(mod.metadata.loader)}
                  </Badge>
                ) : (
                  "-"
                )}
              </td>
              <td className="px-4 py-3">
                <PlatformLinkButton url={mod.metadata?.modrinthUrl ?? null} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
