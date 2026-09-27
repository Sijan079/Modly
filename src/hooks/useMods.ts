import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  ModrinthProjectSummary,
  ModrinthProjectDetails,
  ModRelationshipGraph,
  ModRelationshipsForMod,
  UpdateModMetadataInput,
  BulkUpdateModMetadataInput,
  UpsertModSuggestionInput,
} from "@/lib/types";

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
      qc.invalidateQueries({ queryKey: ["instance-relationship-graph", instanceId] });
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

export function useModSuggestions(instanceId: string | null) {
  return useQuery({
    queryKey: ["mod-suggestions", instanceId],
    queryFn: () => (instanceId ? api.mods.listSuggestions(instanceId) : []),
    enabled: !!instanceId,
  });
}

export function useUpsertModSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertModSuggestionInput) => api.mods.upsertSuggestion(input),
    onSuccess: (suggestion) => {
      qc.invalidateQueries({ queryKey: ["mod-suggestions", suggestion.instanceId] });
      qc.invalidateQueries({ queryKey: ["categories", suggestion.instanceId] });
    },
  });
}

export function useDeleteModSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ instanceId: _instanceId, id }: { instanceId: string; id: string }) =>
      api.mods.deleteSuggestion(id),
    onSuccess: (_, { instanceId }) => {
      qc.invalidateQueries({ queryKey: ["mod-suggestions", instanceId] });
    },
  });
}

export function useSuggestionVersions() {
  return useMutation({
    mutationFn: ({
      suggestionId,
      gameVersion,
      loader,
    }: {
      suggestionId: string;
      gameVersion?: string | null;
      loader?: string | null;
    }) => api.updates.listSuggestionVersions(suggestionId, gameVersion, loader),
  });
}

export function useModrinthProjects(projectIds: string[]) {
  const normalizedIds = [...projectIds].sort();
  return useQuery<ModrinthProjectSummary[]>({
    queryKey: ["modrinth-projects", normalizedIds],
    queryFn: () => api.updates.modrinthProjects(normalizedIds),
    enabled: normalizedIds.length > 0,
    staleTime: 1000 * 60 * 30,
  });
}

export function useModrinthProjectDetails(projectId: string | null) {
  return useQuery<ModrinthProjectDetails | null>({
    queryKey: ["modrinth-project-details", projectId],
    queryFn: () => (projectId ? api.updates.modrinthProjectDetails(projectId) : null),
    enabled: !!projectId,
    staleTime: 1000 * 60 * 30,
  });
}

export function useUpdateModMetadata() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateModMetadataInput) => api.mods.updateMetadata(input),
    onSuccess: (mod) => {
      qc.invalidateQueries({ queryKey: ["mods", mod.instanceId] });
      qc.invalidateQueries({ queryKey: ["instance-relationship-graph", mod.instanceId] });
      qc.invalidateQueries({ queryKey: ["mod-relationships", mod.id] });
      qc.invalidateQueries({ queryKey: ["instances"] });
      qc.invalidateQueries({ queryKey: ["categories", mod.instanceId] });
    },
  });
}

export function useBulkUpdateModMetadata() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkUpdateModMetadataInput) => api.mods.bulkUpdateMetadata(input),
    onSuccess: (_mods, input) => {
      qc.invalidateQueries({ queryKey: ["mods", input.instanceId] });
      qc.invalidateQueries({ queryKey: ["instance-relationship-graph", input.instanceId] });
      qc.invalidateQueries({ queryKey: ["instances"] });
      qc.invalidateQueries({ queryKey: ["categories", input.instanceId] });
    },
  });
}

export function useModRelationships(modId: string | null) {
  return useQuery<ModRelationshipsForMod | null>({
    queryKey: ["mod-relationships", modId],
    queryFn: () => (modId ? api.mods.relationships(modId) : null),
    enabled: !!modId,
  });
}

export function useInstanceRelationshipGraph(instanceId: string | null) {
  return useQuery<ModRelationshipGraph | null>({
    queryKey: ["instance-relationship-graph", instanceId],
    queryFn: () => (instanceId ? api.mods.relationshipGraph(instanceId) : null),
    enabled: !!instanceId,
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
