import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InstanceCategory, ModLoaderKind } from "@/lib/types";
import {
  type ModListFilters,
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

interface ModFiltersProps {
  filters: ModListFilters;
  onChange: (filters: ModListFilters) => void;
  categories: InstanceCategory[];
  instanceId: string | null;
  onClear: () => void;
  showClear: boolean;
}

export function ModFilters({
  filters,
  onChange,
  categories,
  instanceId,
  onClear,
  showClear,
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
