import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemedSelect } from "@/components/ui/themed-select";
import type { InstanceCategory, ModLoaderKind, ModSide } from "@/lib/types";
import {
  type ModListFilters,
  type ModSortOption,
  type ModStatusFilter,
} from "@/store/app";
import { formatLoader } from "@/lib/utils";

const LOADERS: Array<ModLoaderKind | "all"> = [
  "all",
  "fabric",
  "forge",
  "neoforge",
  "quilt",
  "unknown",
];

const SIDES: Array<ModSide | "all"> = ["all", "client", "server", "both"];

const SORT_OPTIONS: Array<{ value: ModSortOption; label: string }> = [
  { value: "nameAsc", label: "A-Z" },
  { value: "nameDesc", label: "Z-A" },
  { value: "installedNewest", label: "Newest installed" },
  { value: "installedOldest", label: "Oldest installed" },
];

interface ModFiltersProps {
  filters: ModListFilters;
  onChange: (filters: ModListFilters) => void;
  categories: InstanceCategory[];
  instanceId: string | null;
  onClear: () => void;
  showClear: boolean;
  showSideFilter?: boolean;
}

export function ModFilters({
  filters,
  onChange,
  categories,
  instanceId,
  onClear,
  showClear,
  showSideFilter = true,
}: ModFiltersProps) {
  return (
    <>
      <Filter className="hidden h-4 w-4 shrink-0 text-[var(--color-muted-foreground)] sm:block" />
      <ThemedSelect
        className="min-w-[8rem]"
        value={filters.categoryId ?? ""}
        onValueChange={(value) => onChange({ ...filters, categoryId: value || null })}
        disabled={!instanceId}
        aria-label="Filter by category"
        options={[{ value: "", label: "All categories" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
      />
      <ThemedSelect
        className="min-w-[7rem]"
        value={filters.loader}
        onValueChange={(value) =>
          onChange({
            ...filters,
            loader: value as ModLoaderKind | "all",
          })
        }
        aria-label="Filter by loader"
        options={LOADERS.map((loader) => ({ value: loader, label: loader === "all" ? "All loaders" : formatLoader(loader) }))}
      />
      {showSideFilter && (
        <ThemedSelect
          className="min-w-[7rem]"
          value={filters.side}
          onValueChange={(value) =>
            onChange({
              ...filters,
              side: value as ModSide | "all",
            })
          }
          aria-label="Filter by side"
          options={SIDES.map((side) => ({ value: side, label: side === "all" ? "All sides" : side === "client" ? "Client" : side === "server" ? "Server" : "Both" }))}
        />
      )}
      <ThemedSelect
        className="min-w-[10rem]"
        value={filters.sort}
        onValueChange={(value) =>
          onChange({
            ...filters,
            sort: value as ModSortOption,
          })
        }
        aria-label="Sort mods"
        options={SORT_OPTIONS.map((option) => ({ value: option.value, label: `Sort: ${option.label}` }))}
      />
      <ThemedSelect
        className="min-w-[7rem]"
        value={filters.status}
        onValueChange={(value) =>
          onChange({
            ...filters,
            status: value as ModStatusFilter,
          })
        }
        aria-label="Filter by status"
        options={[{ value: "all", label: "All mods" }, { value: "enabled", label: "Enabled" }, { value: "disabled", label: "Disabled" }]}
      />
      {showClear && (
        <Button variant="ghost" size="sm" className="h-9 gap-1" onClick={onClear}>
          <X className="h-3.5 w-3.5" />
          Clear
        </Button>
      )}
    </>
  );
}
