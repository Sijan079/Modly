import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { DashboardPage } from "@/pages/Dashboard";
import { InstancesPage } from "@/pages/Instances";
import { ModsPage } from "@/pages/Mods";
import { ResourcePacksPage } from "@/pages/ResourcePacks";
import { UpdatesPage } from "@/pages/Updates";
import { SettingsPage } from "@/pages/Settings";
import ConfigsPage from "@/pages/ConfigsPage";
import { LogsPage } from "@/pages/Logs";
import { api } from "@/lib/api";

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
              <Route path="/" element={<DashboardPage />} />
              <Route path="/instances" element={<InstancesPage />} />
              <Route path="/mods" element={<ModsPage />} />
              <Route path="/resource-packs" element={<ResourcePacksPage />} />
              <Route path="/updates" element={<UpdatesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/logs" element={<LogsPage />} />
              <Route path="/configs" element={<ConfigsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </StartupGate>
    </QueryClientProvider>
  );
}

function StartupGate({ children }: { children: React.ReactNode }) {
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
