import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PackType, UpdatePackItemMetadataInput } from "@/lib/types";

export function usePacks(instanceId: string | null, packType: PackType) {
  return useQuery({
    queryKey: ["packs", instanceId, packType],
    queryFn: () => (instanceId ? api.packs.list(instanceId, packType) : []),
    enabled: !!instanceId,
  });
}

export function useScanPacks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ instanceId, packType }: { instanceId: string; packType: PackType }) =>
      api.packs.scan(instanceId, packType),
    onSuccess: (_, { instanceId, packType }) => {
      qc.invalidateQueries({ queryKey: ["packs", instanceId, packType] });
    },
  });
}

export function useTogglePack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      enabled,
    }: {
      itemId: string;
      enabled: boolean;
    }) => api.packs.toggle(itemId, enabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["packs"] });
    },
  });
}

export function useUpdatePackMetadata() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePackItemMetadataInput) =>
      api.packs.updateMetadata(input),
    onSuccess: (pack) => {
      qc.invalidateQueries({ queryKey: ["packs", pack.instanceId] });
      qc.invalidateQueries({ queryKey: ["packs"] });
    },
  });
}
