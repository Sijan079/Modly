import type { ReactNode } from "react";

interface PageShellProps {
  title: string;
  description?: ReactNode;
  controls?: ReactNode;
}

export function PageShell({ title, description, controls }: PageShellProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        {description && (
          <p className="text-sm text-[var(--color-muted-foreground)]">{description}</p>
        )}
      </div>
      {controls && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{controls}</div>
      )}
    </div>
  );
}
