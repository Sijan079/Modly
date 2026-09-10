import { useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

interface PageSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  activityLabel?: string;
  activityContext?: string | null;
}

export function PageSearchBar({
  value,
  onChange,
  placeholder = "Search...",
  className,
  activityLabel,
  activityContext,
}: PageSearchBarProps) {
  const lastLoggedSearch = useRef<string | null>(null);

  useEffect(() => {
    const query = value.trim().replace(/\s+/g, " ");
    if (!activityLabel || query.length < 2) {
      lastLoggedSearch.current = null;
      return;
    }

    const fingerprint = `${activityLabel}:${activityContext ?? ""}:${query}`;
    if (lastLoggedSearch.current === fingerprint) return;

    const timer = window.setTimeout(() => {
      lastLoggedSearch.current = fingerprint;
      void api.files
        .appendLog(
          "info",
          `Searched ${activityLabel}: ${query.slice(0, 120)}`,
          activityContext ?? undefined
        )
        .catch((error: unknown) => console.error("Failed to record search activity", error));
    }, 600);

    return () => window.clearTimeout(timer);
  }, [activityContext, activityLabel, value]);

  return (
    <div className={`relative min-w-0 flex-1 sm:max-w-md ${className ?? ""}`}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
      <Input
        placeholder={placeholder}
        className="h-9 pl-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
