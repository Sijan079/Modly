import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/layout/PageShell";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";

export function LogsPage() {
  const { data: logs = [], isLoading, refetch } = useQuery({
    queryKey: ["logs"],
    queryFn: () => api.files.logs(2000),
    refetchInterval: 5000,
  });
  const weeklyLogs = useMemo(() => {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return logs.filter((log) => {
      const timestamp = new Date(log.createdAt).getTime();
      return Number.isFinite(timestamp) && timestamp >= oneWeekAgo;
    });
  }, [logs]);

  return (
    <div className="space-y-6">
      <PageShell
        title="Logs"
        description="Application activity from the last 7 days"
        controls={
          <Button variant="outline" onClick={() => refetch()}>
            Refresh
          </Button>
        }
      />

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
        <ScrollArea className="h-[calc(100vh-220px)]">
          {isLoading ? (
            <p className="p-4 text-[var(--color-muted-foreground)]">Loading logs...</p>
          ) : weeklyLogs.length === 0 ? (
            <p className="p-4 text-[var(--color-muted-foreground)]">
              No activity in the last 7 days
            </p>
          ) : (
            <div className="divide-y divide-[var(--color-border)] font-mono text-xs">
              {weeklyLogs.map((log) => (
                <div key={log.id} className="flex gap-3 px-4 py-2 hover:bg-[var(--color-muted)]/30">
                  <span className="shrink-0 text-[var(--color-muted-foreground)]">
                    {formatDate(log.createdAt)}
                  </span>
                  <LevelBadge level={log.level} />
                  <span className="flex-1 break-all">{log.message}</span>
                  {log.context && (
                    <span className="text-[var(--color-muted-foreground)]">
                      [{log.context}]
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}

function LevelBadge({ level }: { level: string }) {
  const variant =
    level === "error"
      ? "destructive"
      : level === "warn"
        ? "warning"
        : level === "info"
          ? "default"
          : "secondary";

  return (
    <Badge variant={variant as "default"} className="shrink-0 uppercase">
      {level}
    </Badge>
  );
}
