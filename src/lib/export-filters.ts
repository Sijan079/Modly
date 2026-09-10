export type ExportModAudience = "any" | "player" | "server";
export type ExportModState = "enabled" | "disabled" | "both";

export interface ExportModFilters {
  modAudience: ExportModAudience;
  modCategoryId: string | null;
  modState: ExportModState;
}

export interface ExportFilterCategory {
  id: string;
  name: string;
}

export interface ExportFilterMod {
  id: string;
  enabled: boolean;
  metadata: {
    side: "unknown" | "client" | "server" | "both";
  } | null;
  categories: ExportFilterCategory[];
}

export const DEFAULT_EXPORT_MOD_FILTERS: ExportModFilters = {
  modAudience: "any",
  modCategoryId: null,
  modState: "enabled",
};

export function filterModsForExport(
  mods: ExportFilterMod[],
  filters: ExportModFilters
) {
  return mods.filter((mod) => matchesModExportFilters(mod, filters));
}

export function countMatchingMods(
  mods: ExportFilterMod[],
  filters: ExportModFilters
) {
  return filterModsForExport(mods, filters).length;
}

export function matchesModExportFilters(
  mod: ExportFilterMod,
  filters: ExportModFilters
) {
  if (filters.modState === "enabled" && !mod.enabled) return false;
  if (filters.modState === "disabled" && mod.enabled) return false;

  const side = mod.metadata?.side ?? "unknown";
  if (filters.modAudience === "player" && side !== "client" && side !== "both") {
    return false;
  }
  if (filters.modAudience === "server" && side !== "server" && side !== "both") {
    return false;
  }

  if (filters.modCategoryId) {
    return mod.categories.some((category) => category.id === filters.modCategoryId);
  }

  return true;
}
