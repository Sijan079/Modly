import type { Instance, PackType } from "@/lib/types";

function normalizePath(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function getResolvedPackPath(instance: Instance, packType: PackType): string {
  if (packType === "resourcePack") {
    return normalizePath(instance.resourcePacksPath) ?? `${instance.gameDir}\\resourcepacks`;
  }
  if (packType === "shaderPack") {
    return normalizePath(instance.shaderPacksPath) ?? `${instance.gameDir}\\shaderpacks`;
  }
  return normalizePath(instance.dataPacksPath) ?? `${instance.gameDir}\\datapacks`;
}

export function getResolvedConfigPath(instance: Instance): string {
  return normalizePath(instance.configPath) ?? `${instance.gameDir}\\config`;
}
