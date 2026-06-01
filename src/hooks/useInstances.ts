import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CreateInstanceInput } from "@/lib/types";

export function useInstances() {
  return useQuery({
    queryKey: ["instances"],
    queryFn: () => api.instances.list(),
  });
}

export function useInstance(id: string | null) {
  return useQuery({
    queryKey: ["instance", id],
    queryFn: () => (id ? api.instances.get(id) : null),
    enabled: !!id,
  });
}

export function useCreateInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInstanceInput) => api.instances.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["instances"] }),
  });
}

export function useDeleteInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, deleteFiles }: { id: string; deleteFiles: boolean }) =>
      api.instances.delete(id, deleteFiles),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["instances"] }),
  });
}

export function useScanMinecraft() {
  return useMutation({
    mutationFn: () => api.scan.defaultMinecraft(),
  });
}
