import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  ModRelationshipsForMod,
  UpdateModMetadataInput,
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

export function usePromoteModSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ instanceId: _instanceId, suggestionId }: { instanceId: string; suggestionId: string }) =>
      api.mods.promoteSuggestion(suggestionId),
    onSuccess: (_mod, { instanceId }) => {
      qc.invalidateQueries({ queryKey: ["mod-suggestions", instanceId] });
      qc.invalidateQueries({ queryKey: ["mods", instanceId] });
      qc.invalidateQueries({ queryKey: ["instances"] });
      qc.invalidateQueries({ queryKey: ["categories", instanceId] });
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

export function useInstallSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.updates.installSuggestion,
    onSuccess: (mod) => {
      qc.invalidateQueries({ queryKey: ["mod-suggestions", mod.instanceId] });
      qc.invalidateQueries({ queryKey: ["mods", mod.instanceId] });
      qc.invalidateQueries({ queryKey: ["instances"] });
      qc.invalidateQueries({ queryKey: ["categories", mod.instanceId] });
    },
  });
}

export function useDeleteMod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ instanceId: _instanceId, modId }: { instanceId: string; modId: string }) =>
      api.mods.delete(modId),
    onSuccess: (_, { instanceId }) => {
      qc.invalidateQueries({ queryKey: ["mods", instanceId] });
      qc.invalidateQueries({ queryKey: ["instances"] });
      qc.invalidateQueries({ queryKey: ["mod-integrity-audit", instanceId] });
    },
  });
}

export function useUpdateModMetadata() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateModMetadataInput) => api.mods.updateMetadata(input),
    onSuccess: (mod) => {
      qc.invalidateQueries({ queryKey: ["mods", mod.instanceId] });
      qc.invalidateQueries({ queryKey: ["mod-relationships", mod.id] });
      qc.invalidateQueries({ queryKey: ["instances"] });
      qc.invalidateQueries({ queryKey: ["categories", mod.instanceId] });
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

export function useResetModMetadata() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modId: string) => api.mods.resetMetadata(modId),
    onSuccess: (mod) => {
      qc.invalidateQueries({ queryKey: ["mods", mod.instanceId] });
    },
  });
}
