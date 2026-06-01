import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ConfirmUpdateMatchInput, UpdateModFromModrinthInput } from "@/lib/types";

export function useUpdates(instanceId: string | null) {
  return useQuery({
    queryKey: ["updates", instanceId],
    queryFn: () => (instanceId ? api.updates.check(instanceId) : []),
    enabled: false,
  });
}

export function useConfirmUpdateMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConfirmUpdateMatchInput) => api.updates.confirmMatch(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["updates"] });
      qc.invalidateQueries({ queryKey: ["mods"] });
      qc.invalidateQueries({ queryKey: ["packs"] });
    },
  });
}

export function useUpdateModFromModrinth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateModFromModrinthInput) => api.updates.updateMod(input),
    onSuccess: (mod) => {
      qc.invalidateQueries({ queryKey: ["mods", mod.instanceId] });
      qc.invalidateQueries({ queryKey: ["instances"] });
      qc.invalidateQueries({ queryKey: ["updates", mod.instanceId] });
    },
  });
}
