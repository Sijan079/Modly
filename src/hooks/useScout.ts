import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useScoutTargets() {
  return useQuery({ queryKey: ["scout-targets"], queryFn: api.scout.listTargets });
}

export function useScoutAnalysis(targetId: string | null) {
  return useQuery({
    queryKey: ["scout-analysis", targetId],
    queryFn: () => (targetId ? api.scout.latestAnalysis(targetId) : null),
    enabled: !!targetId,
  });
}

export function useScoutRecommendations(targetId: string | null) {
  return useQuery({
    queryKey: ["scout-recommendations", targetId],
    queryFn: () => (targetId ? api.scout.recommendations(targetId) : null),
    enabled: !!targetId,
  });
}

export function useCreateScoutTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, name }: { path: string; name?: string }) => api.scout.createTarget(path, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scout-targets"] }),
  });
}

export function useCreateScoutInstanceTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.scout.createInstanceTarget,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scout-targets"] }),
  });
}

export function useAnalyzeScoutTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.scout.analyze,
    onSuccess: (analysis) => {
      queryClient.setQueryData(["scout-analysis", analysis.targetId], analysis);
      queryClient.invalidateQueries({ queryKey: ["scout-recommendations", analysis.targetId] });
    },
  });
}

export function useDiscoverScoutCandidates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.scout.discoverCandidates,
    onSuccess: (result, targetId) => queryClient.setQueryData(["scout-recommendations", targetId], result),
  });
}

export function useSearchScoutCandidates() {
  return useMutation({
    mutationFn: ({ targetId, query }: { targetId: string; query: string }) =>
      api.scout.searchCandidates(targetId, query),
  });
}
