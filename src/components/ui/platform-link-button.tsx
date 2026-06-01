import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PlatformLinkButton({ url }: { url: string | null }) {
  if (!url) {
    return <span className="text-[var(--color-muted-foreground)]">-</span>;
  }

  const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
  const platform = getLinkPlatform(normalizedUrl);
  const title =
    platform === "modrinth"
      ? "Open Modrinth page"
      : platform === "curseforge"
        ? "Open CurseForge page"
        : "Open website";

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={(event) => {
        event.stopPropagation();
        openUrl(normalizedUrl);
      }}
      title={title}
    >
      {platform === "modrinth" ? (
        <ModrinthIcon className="h-5 w-5" />
      ) : platform === "curseforge" ? (
        <CurseForgeIcon className="h-5 w-5" />
      ) : (
        <ExternalLink className="h-5 w-5" />
      )}
    </Button>
  );
}

function getLinkPlatform(url: string): "modrinth" | "curseforge" | "generic" {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes("modrinth.com")) {
    return "modrinth";
  }

  if (lowerUrl.includes("curseforge.com")) {
    return "curseforge";
  }

  return "generic";
}

function ModrinthIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="4" fill="#1BD96A" />
      <path
        d="M7 16V8h2.4l2.6 4.28L14.6 8H17v8h-2V11.5l-2.26 3.72h-1.48L9 11.5V16H7Z"
        fill="#0B1F14"
      />
    </svg>
  );
}

function CurseForgeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="4" fill="#F16436" />
      <path
        d="M15.9 9.18a4.84 4.84 0 0 0-2.92-.94c-3 0-4.98 1.83-4.98 4.7c0 2.83 1.88 4.58 4.88 4.58c1.18 0 2.28-.28 3.08-.8v-1.94c-.78.62-1.7.98-2.68.98c-1.76 0-2.88-1.06-2.88-2.82c0-1.8 1.16-2.92 2.98-2.92c.92 0 1.78.28 2.52.86V9.18Z"
        fill="white"
      />
    </svg>
  );
}
