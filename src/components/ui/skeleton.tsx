import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-md bg-[var(--color-muted)]/80",
        className
      )}
      {...props}
    />
  );
}

export function TableSkeleton({
  columns = 5,
  rows = 6,
  className,
}: {
  columns?: number;
  rows?: number;
  className?: string;
}) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading content"
      className={cn("overflow-hidden rounded-lg border border-[var(--color-border)]", className)}
    >
      <div className="grid gap-4 border-b border-[var(--color-border)] bg-[var(--color-muted)] px-4 py-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} className="h-3 w-3/4" />
        ))}
      </div>
      <div className="divide-y divide-[var(--color-border)]">
        {Array.from({ length: rows }, (_, rowIndex) => (
          <div key={rowIndex} className="grid gap-4 px-4 py-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {Array.from({ length: columns }, (_, columnIndex) => (
              <Skeleton key={columnIndex} className={cn("h-4", columnIndex === 0 ? "w-full" : "w-3/4")} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
