import { create } from "zustand";
import type { Instance, ModFile, ModLoaderKind, ModSide } from "@/lib/types";
import { formatLoader } from "@/lib/utils";

export type ModStatusFilter = "all" | "enabled" | "disabled";
export type ModSortOption = "nameAsc" | "nameDesc" | "installedNewest" | "installedOldest";

export interface ModListFilters {
  categoryId: string | null;
  loader: ModLoaderKind | "all";
  side: ModSide | "all";
  status: ModStatusFilter;
  sort: ModSortOption;
}

interface AppStore {
  selectedInstanceId: string | null;
  sidebarCollapsed: boolean;
  setSelectedInstance: (id: string | null) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  selectedInstanceId: null,
  sidebarCollapsed: false,
  setSelectedInstance: (id) => set({ selectedInstanceId: id }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
}));

export function filterInstances(
  instances: Instance[],
  query: string
): Instance[] {
  if (!query.trim()) return instances;
  const q = query.toLowerCase();
  return instances.filter(
    (i) =>
      i.name.toLowerCase().includes(q) ||
      i.gameDir.toLowerCase().includes(q) ||
      (i.mcVersion?.toLowerCase().includes(q) ?? false)
  );
}

function modSearchText(mod: ModFile): string {
  const meta = mod.metadata;
  const parts = [
    mod.fileName,
    meta?.name,
    meta?.version,
    meta?.modId,
    meta?.modrinthUrl,
    mod.sourceUrl,
    meta?.loader ? formatLoader(meta.loader) : null,
    meta?.loader,
    ...(meta?.authors ?? []),
    ...mod.categories.map((c) => c.name),
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export function filterMods(
  mods: ModFile[],
  query: string,
  filters: ModListFilters
): ModFile[] {
  let result = mods;

  if (filters.status === "enabled") {
    result = result.filter((m) => m.enabled);
  } else if (filters.status === "disabled") {
    result = result.filter((m) => !m.enabled);
  }

  if (filters.loader !== "all") {
    result = result.filter((m) => m.metadata?.loader === filters.loader);
  }

  if (filters.side !== "all") {
    result = result.filter((m) => (m.metadata?.side ?? "unknown") === filters.side);
  }

  if (filters.categoryId) {
    result = result.filter((m) =>
      m.categories.some((c) => c.id === filters.categoryId)
    );
  }

  const q = query.trim().toLowerCase();
  if (q) {
    result = result.filter((m) => modSearchText(m).includes(q));
  }

  return [...result].sort((a, b) => compareMods(a, b, filters.sort));
}

function compareMods(a: ModFile, b: ModFile, sort: ModSortOption): number {
  switch (sort) {
    case "nameDesc":
      return compareText(modDisplayName(b), modDisplayName(a));
    case "installedNewest":
      return compareInstalledAt(b, a);
    case "installedOldest":
      return compareInstalledAt(a, b);
    case "nameAsc":
    default:
      return compareText(modDisplayName(a), modDisplayName(b));
  }
}

function modDisplayName(mod: ModFile): string {
  return mod.metadata?.name ?? mod.fileName;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function compareInstalledAt(a: ModFile, b: ModFile): number {
  const aTime = Date.parse(a.installedAt);
  const bTime = Date.parse(b.installedAt);
  const safeATime = Number.isNaN(aTime) ? 0 : aTime;
  const safeBTime = Number.isNaN(bTime) ? 0 : bTime;
  if (safeATime !== safeBTime) {
    return safeATime - safeBTime;
  }
  return compareText(modDisplayName(a), modDisplayName(b));
}
