import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
      <select
        className="h-9 min-w-[8rem] rounded-md border border-[var(--color-input)] bg-[var(--color-muted)] px-2 text-sm"
        value={filters.categoryId ?? ""}
        onChange={(e) =>
          onChange({ ...filters, categoryId: e.target.value || null })
        }
        disabled={!instanceId}
        aria-label="Filter by category"
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select
        className="h-9 min-w-[7rem] rounded-md border border-[var(--color-input)] bg-[var(--color-muted)] px-2 text-sm"
        value={filters.loader}
        onChange={(e) =>
          onChange({
            ...filters,
            loader: e.target.value as ModLoaderKind | "all",
          })
        }
        aria-label="Filter by loader"
      >
        {LOADERS.map((l) => (
          <option key={l} value={l}>
            {l === "all" ? "All loaders" : formatLoader(l)}
          </option>
        ))}
      </select>
      {showSideFilter && (
        <select
          className="h-9 min-w-[7rem] rounded-md border border-[var(--color-input)] bg-[var(--color-muted)] px-2 text-sm"
          value={filters.side}
          onChange={(e) =>
            onChange({
              ...filters,
              side: e.target.value as ModSide | "all",
            })
          }
          aria-label="Filter by side"
        >
          {SIDES.map((side) => (
            <option key={side} value={side}>
              {side === "all"
                ? "All sides"
                : side === "client"
                  ? "Client"
                  : side === "server"
                    ? "Server"
                    : "Both"}
            </option>
          ))}
        </select>
      )}
      <select
        className="h-9 min-w-[10rem] rounded-md border border-[var(--color-input)] bg-[var(--color-muted)] px-2 text-sm"
        value={filters.sort}
        onChange={(e) =>
          onChange({
            ...filters,
            sort: e.target.value as ModSortOption,
          })
        }
        aria-label="Sort mods"
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            Sort: {option.label}
          </option>
        ))}
      </select>
      <select
        className="h-9 min-w-[7rem] rounded-md border border-[var(--color-input)] bg-[var(--color-muted)] px-2 text-sm"
        value={filters.status}
        onChange={(e) =>
          onChange({
            ...filters,
            status: e.target.value as ModStatusFilter,
          })
        }
        aria-label="Filter by status"
      >
        <option value="all">All mods</option>
        <option value="enabled">Enabled</option>
        <option value="disabled">Disabled</option>
      </select>
      {showClear && (
        <Button variant="ghost" size="sm" className="h-9 gap-1" onClick={onClear}>
          <X className="h-3.5 w-3.5" />
          Clear
        </Button>
      )}
    </>
  );
}
