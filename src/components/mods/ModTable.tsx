import { Check, Eye, EyeOff, Minus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlatformLinkButton } from "@/components/ui/platform-link-button";
import type { ModFile } from "@/lib/types";
import { formatLoader } from "@/lib/utils";

interface ModTableProps {
  mods: ModFile[];
  totalCount?: number;
  onToggle: (modId: string, enabled: boolean) => void;
  onEdit: (mod: ModFile) => void;
  onDelete: (mod: ModFile) => void;
  selectedModIds?: string[];
  onSelectionChange?: (modId: string, selected: boolean) => void;
  onSelectAll?: (selected: boolean) => void;
  loading?: boolean;
}

export function ModTable({
  mods,
  totalCount = 0,
  onToggle,
  onEdit,
  onDelete,
  selectedModIds = [],
  onSelectionChange,
  onSelectAll,
  loading,
}: ModTableProps) {
  const selectedVisibleCount = mods.filter((mod) => selectedModIds.includes(mod.id)).length;
  const selectionState =
    selectedVisibleCount === 0 ? "empty" : selectedVisibleCount === mods.length ? "checked" : "partial";

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
            <th className="w-12 px-3 py-3 text-left font-medium">
              <SelectionCheckbox
                state={selectionState}
                aria-label="Select all visible mods"
                onClick={() => onSelectAll?.(selectionState !== "checked")}
              />
            </th>
            <th className="w-[40%] px-4 py-3 text-left font-medium">Name</th>
            <th className="w-[15%] px-4 py-3 text-left font-medium">Version</th>
            <th className="w-[17%] px-4 py-3 text-left font-medium">Categories</th>
            <th className="w-[10%] px-4 py-3 text-left font-medium">Loader</th>
            <th className="w-[10%] px-4 py-3 text-left font-medium">Side</th>
            <th className="w-[10%] px-4 py-3 text-left font-medium">Link</th>
            <th className="w-24 px-4 py-3 text-left font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {mods.map((mod) => (
            <tr
              key={mod.id}
              className={`cursor-pointer border-b border-[var(--color-border)]/50 ${
                selectedModIds.includes(mod.id)
                  ? "bg-[var(--color-primary)]/10 hover:bg-[var(--color-primary)]/15"
                  : "hover:bg-[var(--color-muted)]/50"
              } ${
                mod.enabled ? "" : "opacity-45 grayscale"
              }`}
              onClick={() => onEdit(mod)}
            >
              <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}>
                <SelectionCheckbox
                  state={selectedModIds.includes(mod.id) ? "checked" : "empty"}
                  aria-label={`Select ${mod.metadata?.name ?? mod.fileName}`}
                  onClick={() => onSelectionChange?.(mod.id, !selectedModIds.includes(mod.id))}
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
                {mod.metadata?.side && mod.metadata.side !== "unknown" ? (
                  <Badge variant="outline">
                    {mod.metadata.side === "client"
                      ? "Client"
                      : mod.metadata.side === "server"
                        ? "Server"
                        : "Both"}
                  </Badge>
                ) : (
                  <span className="text-[var(--color-muted-foreground)]">-</span>
                )}
              </td>
              <td className="px-4 py-3">
                <PlatformLinkButton url={mod.sourceUrl ?? mod.metadata?.modrinthUrl ?? null} />
              </td>
              <td className="px-4 py-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                  aria-label={`${mod.enabled ? "Disable" : "Enable"} ${mod.metadata?.name ?? mod.fileName}`}
                  title={mod.enabled ? "Disable mod" : "Enable mod"}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggle(mod.id, !mod.enabled);
                  }}
                >
                  {mod.enabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-[var(--color-muted-foreground)] hover:bg-[var(--color-destructive)]/10 hover:text-[var(--color-destructive)]"
                  aria-label={`Delete ${mod.metadata?.name ?? mod.fileName}`}
                  title="Delete mod"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(mod);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SelectionCheckbox({
  state,
  onClick,
  "aria-label": ariaLabel,
}: {
  state: "empty" | "partial" | "checked";
  onClick: () => void;
  "aria-label": string;
}) {
  const selected = state !== "empty";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "partial" ? "mixed" : selected}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`inline-flex h-4 w-4 items-center justify-center rounded-[4px] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-card)] ${
        selected
          ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
          : "border-[var(--color-input)] bg-[var(--color-card)] text-transparent hover:border-[var(--color-primary)]"
      }`}
    >
      {state === "checked" ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
      {state === "partial" ? <Minus className="h-3 w-3" strokeWidth={3} /> : null}
    </button>
  );
}
