import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { UpdateModMetadataInput } from "@/lib/types";

export function useMods(instanceId: string | null) {
  return useQuery({
    queryKey: ["mods", instanceId],
    queryFn: () => (instanceId ? api.mods.list(instanceId) : []),
    enabled: !!instanceId,
  });
}

export function useScanMods() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (instanceId: string) => api.mods.scan(instanceId),
    onSuccess: (_, instanceId) => {
      qc.invalidateQueries({ queryKey: ["mods", instanceId] });
      qc.invalidateQueries({ queryKey: ["instances"] });
    },
  });
}

export function useCheckModIntegrity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (instanceId: string) => api.mods.checkIntegrity(instanceId),
    onSuccess: (_, instanceId) => {
      qc.invalidateQueries({ queryKey: ["mod-integrity-audit", instanceId] });
      qc.invalidateQueries({ queryKey: ["logs"] });
    },
  });
}

export function useLatestModIntegrityAudit(instanceId: string | null) {
  return useQuery({
    queryKey: ["mod-integrity-audit", instanceId],
    queryFn: () => (instanceId ? api.mods.latestIntegrityAudit(instanceId) : null),
    enabled: !!instanceId,
  });
}

export function useToggleMod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      instanceId,
      modId,
      enabled,
    }: {
      instanceId: string;
      modId: string;
      enabled: boolean;
    }) => api.mods.toggle(instanceId, modId, enabled),
    onSuccess: (_, { instanceId }) => {
      qc.invalidateQueries({ queryKey: ["mods", instanceId] });
    },
  });
}

export function useUpdateModMetadata() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateModMetadataInput) => api.mods.updateMetadata(input),
    onSuccess: (mod) => {
      qc.invalidateQueries({ queryKey: ["mods", mod.instanceId] });
      qc.invalidateQueries({ queryKey: ["instances"] });
      qc.invalidateQueries({ queryKey: ["categories", mod.instanceId] });
    },
  });
}

export function useResetModMetadata() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modId: string) => api.mods.resetMetadata(modId),
    onSuccess: (mod) => {
      qc.invalidateQueries({ queryKey: ["mods", mod.instanceId] });
    },
  });
}
