import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function normalizeModrinthUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  if (trimmed.includes("modrinth.com")) {
    return `https://${trimmed.replace(/^\/+/, "")}`;
  }
  const slug = trimmed.replace(/^\/+/, "");
  return `https://modrinth.com/mod/${slug}`;
}

export function formatLoader(loader: string): string {
  const map: Record<string, string> = {
    vanilla: "Vanilla",
    fabric: "Fabric",
    forge: "Forge",
    neoforge: "NeoForge",
    quilt: "Quilt",
    unknown: "Unknown",
  };
  return map[loader.toLowerCase()] ?? loader;
}
