import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DeleteCategoryInput } from "@/lib/types";

export function useCategories(instanceId: string | null) {
  return useQuery({
    queryKey: ["categories", instanceId],
    queryFn: () =>
      instanceId ? api.categories.list(instanceId) : Promise.resolve([]),
    enabled: !!instanceId,
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.categories.create,
    onSuccess: (cat) => {
      qc.invalidateQueries({ queryKey: ["categories", cat.instanceId] });
    },
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DeleteCategoryInput) => api.categories.delete(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["mods"] });
    },
  });
}
