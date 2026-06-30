import { NavLink } from "react-router-dom";
import {
  Box,
  FileCog,
  FileText,
  Home,
  Image,
  Lightbulb,
  Network,
  Package,
  RefreshCw,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", icon: Home, label: "Dashboard" },
  { to: "/instances", icon: Box, label: "Instances" },
  { to: "/mods", icon: Package, label: "Mods" },
  { to: "/dependencies", icon: Network, label: "Relationships" },
  { to: "/mod-suggestions", icon: Lightbulb, label: "Mod Suggestions" },
  { to: "/resource-packs", icon: Image, label: "DSR Packs" },
  { to: "/updates", icon: RefreshCw, label: "Updates" },
  { to: "/configs", icon: FileCog, label: "Configs" },
  { to: "/settings", icon: Settings, label: "Settings" },
  { to: "/logs", icon: FileText, label: "Logs" },
];

export function Sidebar() {
  return (
    <aside className="flex h-full w-56 flex-col border-r border-[var(--color-border)] bg-[var(--color-sidebar)]">
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-5">
        <img
          src="/app-icon.png"
          alt=""
          className="h-9 w-9 rounded-lg object-cover"
        />
        <div>
          <h1 className="text-sm font-semibold text-[var(--color-foreground)]">
            Modly
          </h1>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-[var(--color-sidebar-active)] text-[var(--color-foreground)]"
                  : "text-[var(--color-sidebar-foreground)] hover:bg-[var(--color-sidebar-active)] hover:text-[var(--color-foreground)]"
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-[var(--color-border)] p-4">
        <p className="text-xs text-[var(--color-muted-foreground)]">
          v0.1.0 - Local only
        </p>
      </div>
    </aside>
  );
}
