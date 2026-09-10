import { NavLink } from "react-router-dom";
import {
  Box,
  FileCog,
  Home,
  Image,
  Lightbulb,
  Network,
  Package,
  RefreshCw,
  ScanSearch,
  Settings,
  TerminalSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navGroups = [
  {
    label: "Workspace",
    items: [
      { to: "/", icon: Home, label: "Dashboard" },
      { to: "/instances", icon: Box, label: "Instances" },
    ],
  },
  {
    label: "Content",
    items: [
      { to: "/mods", icon: Package, label: "Mods" },
      { to: "/dependencies", icon: Network, label: "Relationships" },
      { to: "/mod-suggestions", icon: Lightbulb, label: "Suggestions" },
      { to: "/scout", icon: ScanSearch, label: "Modpack Scout" },
      { to: "/resource-packs", icon: Image, label: "DSR Packs" },
      { to: "/updates", icon: RefreshCw, label: "Updates" },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/configs", icon: FileCog, label: "Configs" },
      { to: "/settings", icon: Settings, label: "Settings" },
    ],
  },
];

export function Sidebar() {
  return (
    <aside className="flex h-full w-60 flex-col border-r border-[var(--color-border)] bg-[var(--color-sidebar)]">
      <div className="flex items-center gap-3 px-5 py-5">
        <img
          src="/app-icon.png"
          alt=""
          className="h-8 w-8 rounded-md object-cover ring-1 ring-white/10"
        />
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-[var(--color-foreground)]">Modly</h1>
          <p className="mt-0.5 text-[11px] text-[var(--color-muted-foreground)]">Local modpack manager</p>
        </div>
      </div>

      <nav aria-label="Main navigation" className="flex-1 space-y-5 overflow-y-auto px-3 pb-4 pt-2">
        {navGroups.map((group) => (
          <div key={group.label}>
            <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--color-muted-foreground)]">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === "/"}
                  className={({ isActive }) =>
                    cn(
                      "group relative flex h-9 items-center gap-3 rounded-md px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
                      isActive
                        ? "bg-[var(--color-sidebar-active)] font-medium text-[var(--color-foreground)]"
                        : "text-[var(--color-sidebar-foreground)] hover:bg-white/[0.035] hover:text-[var(--color-foreground)]"
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-[var(--color-primary)]" />}
                      <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-[var(--color-primary)]" : "text-[var(--color-muted-foreground)] group-hover:text-[var(--color-secondary-foreground)]")} />
                      <span className="truncate">{label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-[var(--color-border)] p-3">
        <NavLink
          to="/logs"
          className={({ isActive }) => cn(
            "flex h-9 items-center gap-3 rounded-md px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
            isActive ? "bg-[var(--color-sidebar-active)] text-[var(--color-foreground)]" : "text-[var(--color-sidebar-foreground)] hover:bg-white/[0.035] hover:text-[var(--color-foreground)]",
          )}
        >
          <TerminalSquare className="h-4 w-4 text-[var(--color-muted-foreground)]" />
          Activity log
          <span className="ml-auto text-[10px] text-[var(--color-muted-foreground)]">Local</span>
        </NavLink>
      </div>
    </aside>
  );
}
