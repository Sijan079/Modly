import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { ModuleErrorBoundary } from "@/components/layout/ModuleErrorBoundary";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

const DashboardPage = lazy(() => import("@/pages/Dashboard").then(({ DashboardPage }) => ({ default: DashboardPage })));
const InstancesPage = lazy(() => import("@/pages/Instances").then(({ InstancesPage }) => ({ default: InstancesPage })));
const ModsPage = lazy(() => import("@/pages/Mods").then(({ ModsPage }) => ({ default: ModsPage })));
const RelationshipsPage = lazy(() => import("@/pages/Dependencies").then(({ RelationshipsPage }) => ({ default: RelationshipsPage })));
const ModSuggestionsPage = lazy(() => import("@/pages/ModSuggestions").then(({ ModSuggestionsPage }) => ({ default: ModSuggestionsPage })));
const ResourcePacksPage = lazy(() => import("@/pages/ResourcePacks").then(({ ResourcePacksPage }) => ({ default: ResourcePacksPage })));
const UpdatesPage = lazy(() => import("@/pages/Updates").then(({ UpdatesPage }) => ({ default: UpdatesPage })));
const SettingsPage = lazy(() => import("@/pages/Settings").then(({ SettingsPage }) => ({ default: SettingsPage })));
const ConfigsPage = lazy(() => import("@/pages/ConfigsPage"));
const LogsPage = lazy(() => import("@/pages/Logs").then(({ LogsPage }) => ({ default: LogsPage })));
const ScoutPage = lazy(() => import("@/pages/Scout").then(({ ScoutPage }) => ({ default: ScoutPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <StartupGate>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<ModuleRoute name="Dashboard"><DashboardPage /></ModuleRoute>} />
              <Route path="/instances" element={<ModuleRoute name="Instances"><InstancesPage /></ModuleRoute>} />
              <Route path="/mods" element={<ModuleRoute name="Mods"><ModsPage /></ModuleRoute>} />
              <Route path="/dependencies" element={<ModuleRoute name="Relationships"><RelationshipsPage /></ModuleRoute>} />
              <Route path="/mod-suggestions" element={<ModuleRoute name="Mod Suggestions"><ModSuggestionsPage /></ModuleRoute>} />
              <Route path="/scout" element={<ModuleRoute name="Modpack Scout"><ScoutPage /></ModuleRoute>} />
              <Route path="/resource-packs" element={<ModuleRoute name="Resource Packs"><ResourcePacksPage /></ModuleRoute>} />
              <Route path="/updates" element={<ModuleRoute name="Updates"><UpdatesPage /></ModuleRoute>} />
              <Route path="/settings" element={<ModuleRoute name="Settings"><SettingsPage /></ModuleRoute>} />
              <Route path="/logs" element={<ModuleRoute name="Logs"><LogsPage /></ModuleRoute>} />
              <Route path="/configs" element={<ModuleRoute name="Configs"><ConfigsPage /></ModuleRoute>} />
            </Route>
          </Routes>
        </BrowserRouter>
      </StartupGate>
    </QueryClientProvider>
  );
}

function ModuleRoute({ name, children }: { name: string; children: ReactNode }) {
  return (
    <ModuleErrorBoundary moduleName={name}>
      <Suspense fallback={<ModuleLoadingFallback name={name} />}>{children}</Suspense>
    </ModuleErrorBoundary>
  );
}

function ModuleLoadingFallback({ name }: { name: string }) {
  return (
    <div aria-busy="true" aria-label={`Loading ${name}`} className="space-y-5">
      <div className="space-y-2"><Skeleton className="h-8 w-36" /><Skeleton className="h-4 w-56" /></div>
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

function StartupGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function warmUp() {
      const minimumSplashMs = new Promise((resolve) => setTimeout(resolve, 900));
      const instancesQuery = queryClient.fetchQuery({
        queryKey: ["instances"],
        queryFn: () => api.instances.list(),
      });

      const [instancesResult] = await Promise.allSettled([
        instancesQuery,
        queryClient.prefetchQuery({
          queryKey: ["settings"],
          queryFn: () => api.settings.get(),
        }),
        queryClient.prefetchQuery({
          queryKey: ["logs"],
          queryFn: () => api.files.logs(500),
        }),
        queryClient.prefetchQuery({
          queryKey: ["launch-status"],
          queryFn: () => api.launcher.status(),
        }),
        minimumSplashMs,
      ]);

      const firstInstance =
        instancesResult.status === "fulfilled" ? instancesResult.value[0] : null;

      if (firstInstance) {
        await Promise.allSettled([
          queryClient.prefetchQuery({
            queryKey: ["mods", firstInstance.id],
            queryFn: () => api.mods.list(firstInstance.id),
          }),
          queryClient.prefetchQuery({
            queryKey: ["categories", firstInstance.id],
            queryFn: () => api.categories.list(firstInstance.id),
          }),
          queryClient.prefetchQuery({
            queryKey: ["packs", firstInstance.id, "resourcePack"],
            queryFn: () => api.packs.list(firstInstance.id, "resourcePack"),
          }),
          queryClient.prefetchQuery({
            queryKey: ["packs", firstInstance.id, "shaderPack"],
            queryFn: () => api.packs.list(firstInstance.id, "shaderPack"),
          }),
          queryClient.prefetchQuery({
            queryKey: ["packs", firstInstance.id, "datapack"],
            queryFn: () => api.packs.list(firstInstance.id, "datapack"),
          }),
        ]);
      }

      if (mounted) {
        setReady(true);
      }
    }

    warmUp();

    return () => {
      mounted = false;
    };
  }, []);

  if (!ready) {
    return <StartupSplash />;
  }

  return children;
}

function StartupSplash() {
  return (
    <div className="splash-screen">
      <div className="splash-mark">
        <img src="/app-icon.png" alt="" />
      </div>
      <div className="splash-copy">
        <h1>Modly</h1>
        <p>Loading local library</p>
      </div>
      <div className="splash-progress" aria-hidden="true">
        <span />
      </div>
    </div>
  );
}
