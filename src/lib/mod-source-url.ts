export type ModSourcePlatform = "modrinth" | "curseforge";

export interface ModSourcePreview {
  platform: ModSourcePlatform;
  label: string;
  project: string;
  url: string;
}

export function normalizeSourceUrl(input: string | null | undefined): string {
  const trimmed = input?.trim() ?? "";
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  return `https://${trimmed.replace(/^\/+/, "")}`;
}

export function parseModSourceUrl(input: string | null | undefined): ModSourcePreview | null {
  const normalized = normalizeSourceUrl(input);
  if (!normalized) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "modrinth.com" && segments[0] === "mod" && segments[1]) {
    return {
      platform: "modrinth",
      label: "Modrinth",
      project: segments[1],
      url: normalized,
    };
  }

  if (
    host === "curseforge.com" &&
    segments[0] === "minecraft" &&
    segments[1] === "mc-mods" &&
    segments[2]
  ) {
    return {
      platform: "curseforge",
      label: "CurseForge",
      project: segments[2],
      url: normalized,
    };
  }

  return null;
}
