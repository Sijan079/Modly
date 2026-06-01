import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FileTabsProps {
  activePath: string | null;
  openTabs: string[];
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

export function FileTabs({
  activePath,
  openTabs,
  onSelect,
  onClose,
}: FileTabsProps) {
  if (openTabs.length === 0) return null;

  return (
    <div className="flex min-h-10 items-center overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-muted)]/40">
      {openTabs.map((path) => {
        const name = path.split(/[\\/]/).pop() ?? path;
        const active = activePath === path;

        return (
          <div
            key={path}
            className={`flex h-10 min-w-32 max-w-56 items-center border-r border-[var(--color-border)] ${
              active ? "bg-[var(--color-background)]" : ""
            }`}
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate px-3 text-left text-xs"
              onClick={() => onSelect(path)}
              title={path}
            >
              {name}
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mr-1 h-7 w-7"
              onClick={() => onClose(path)}
              title="Close file"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
