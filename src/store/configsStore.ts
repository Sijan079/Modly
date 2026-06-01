import { create } from "zustand";
import type { ConfigTreeNode } from "@/lib/types";

interface ConfigsStore {
  configTree: ConfigTreeNode[];
  openTabs: string[];
  activeTabPath: string | null;
  setConfigTree: (tree: ConfigTreeNode[]) => void;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  setActiveTabPath: (path: string | null) => void;
  reset: () => void;
}

export const useConfigsStore = create<ConfigsStore>((set) => ({
  configTree: [],
  openTabs: [],
  activeTabPath: null,
  setConfigTree: (tree) => set({ configTree: tree }),
  openFile: (path) =>
    set((state) => ({
      openTabs: state.openTabs.includes(path)
        ? state.openTabs
        : [...state.openTabs, path],
      activeTabPath: path,
    })),
  closeFile: (path) =>
    set((state) => {
      const openTabs = state.openTabs.filter((tab) => tab !== path);
      const activeTabPath =
        state.activeTabPath === path
          ? openTabs[openTabs.length - 1] ?? null
          : state.activeTabPath;
      return { openTabs, activeTabPath };
    }),
  setActiveTabPath: (path) => set({ activeTabPath: path }),
  reset: () => set({ configTree: [], openTabs: [], activeTabPath: null }),
}));
