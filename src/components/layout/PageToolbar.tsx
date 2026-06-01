import type { ReactNode } from "react";

interface PageToolbarProps {
  search: ReactNode;
  filters?: ReactNode;
}

/** Search on the left, filter controls on the right (per-page, not global). */
export function PageToolbar({ search, filters }: PageToolbarProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 sm:flex-row sm:items-center sm:justify-between">
      {search}
      {filters && (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">{filters}</div>
      )}
    </div>
  );
}
