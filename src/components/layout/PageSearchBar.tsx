import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface PageSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function PageSearchBar({
  value,
  onChange,
  placeholder = "Search...",
  className,
}: PageSearchBarProps) {
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
