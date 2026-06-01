import { create } from "zustand";
import type { Instance, ModFile, ModLoaderKind } from "@/lib/types";
import { formatLoader } from "@/lib/utils";

export type ModStatusFilter = "all" | "enabled" | "disabled";

export interface ModListFilters {
  categoryId: string | null;
  loader: ModLoaderKind | "all";
  status: ModStatusFilter;
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

  if (filters.categoryId) {
    result = result.filter((m) =>
      m.categories.some((c) => c.id === filters.categoryId)
    );
  }

  const q = query.trim().toLowerCase();
  if (q) {
    result = result.filter((m) => modSearchText(m).includes(q));
  }

  return result;
}
