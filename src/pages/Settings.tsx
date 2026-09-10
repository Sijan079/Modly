import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Database,
  FileArchive,
  FolderOpen,
  History,
  Save,
  SearchCheck,
  ShieldCheck,
  Tags,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ThemedSelect } from "@/components/ui/themed-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/layout/PageShell";
import { useSettings, useSaveSettings } from "@/hooks/useSettings";
import { api } from "@/lib/api";
import type { AppSettings } from "@/lib/types";

export function SettingsPage() {
  const { data: settings, isLoading } = useSettings();
  const saveMutation = useSaveSettings();
  const [form, setForm] = useState<AppSettings | null>(null);

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const pickDir = async (
    field:
      | "minecraftDir"
      | "instancesDir"
      | "exportModpackDir"
      | "exportModlistDir"
  ) => {
    const selected = await open({ directory: true, multiple: false });
    if (selected && typeof selected === "string" && form) {
      setForm({ ...form, [field]: selected });
    }
  };

  const updateForm = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    if (!form) return;
    setForm({ ...form, [key]: value });
  };

  if (isLoading || !form) {
    return <SettingsSkeleton />;
  }

  return (
    <div className="space-y-5">
      <PageShell
        title="Settings"
        description="App settings"
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <SettingsSection
          icon={FolderOpen}
          title="Workspace Defaults"
          description="Default folders."
        >
          <PathField
            label="Minecraft Directory (.minecraft)"
            value={form.minecraftDir ?? ""}
            onBrowse={() => pickDir("minecraftDir")}
            onChange={(value) => updateForm("minecraftDir", value || null)}
          />
          <PathField
            label="Default Instances Directory"
            value={form.instancesDir ?? ""}
            onBrowse={() => pickDir("instancesDir")}
            onChange={(value) => updateForm("instancesDir", value || null)}
          />
        </SettingsSection>

        <SettingsSection
          icon={FileArchive}
          title="Export Defaults"
          description="Export folders."
        >
          <PathField
            label="Modpack ZIP Export Folder"
            value={form.exportModpackDir ?? ""}
            onBrowse={() => pickDir("exportModpackDir")}
            onChange={(value) => updateForm("exportModpackDir", value || null)}
          />
          <PathField
            label="Modlist Report Export Folder"
            value={form.exportModlistDir ?? ""}
            onBrowse={() => pickDir("exportModlistDir")}
            onChange={(value) => updateForm("exportModlistDir", value || null)}
          />
        </SettingsSection>

        <SettingsSection
          icon={SearchCheck}
          title="Scan & Preload"
          description="Automatic scans."
        >
          <ToggleRow
            label="Preload new instances"
            detail="Scan after creating an instance."
            checked={form.autoScanOnInstanceAdd}
            onCheckedChange={(checked) => updateForm("autoScanOnInstanceAdd", checked)}
          />
          <Separator />
          <ToggleRow
            label="Rescan after adding mods"
            detail="Scan after copying mods."
            checked={form.autoScanAfterModAdd}
            onCheckedChange={(checked) => updateForm("autoScanAfterModAdd", checked)}
          />
        </SettingsSection>

        <SettingsSection
          icon={ShieldCheck}
          title="Audit & Health"
          description="Audit behavior."
        >
          <ToggleRow
            label="Audit after scans"
            detail="Run audit after scans."
            checked={form.autoAuditAfterScan}
            onCheckedChange={(checked) => updateForm("autoAuditAfterScan", checked)}
          />
          <Separator />
          <div className="space-y-2">
            <Label>Mark audits stale after</Label>
            <div className="flex items-center gap-2">
              <Input
                className="max-w-28"
                min={1}
                type="number"
                value={form.auditStaleDays}
                onChange={(event) =>
                  updateForm(
                    "auditStaleDays",
                    Math.max(1, parseInt(event.target.value, 10) || 7)
                  )
                }
              />
              <span className="text-sm text-[var(--color-muted-foreground)]">days</span>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          icon={FolderOpen}
          title="Window"
          description="Startup window mode."
        >
          <div className="space-y-2">
            <Label>Launch mode</Label>
            <ThemedSelect
              className="w-full"
              value={form.launchWindowMode}
              onValueChange={(value) =>
                updateForm(
                  "launchWindowMode",
                  value as AppSettings["launchWindowMode"]
                )
              }
              options={[{ value: "maximized", label: "Maximized" }, { value: "fullscreen", label: "Fullscreen" }, { value: "windowed", label: "Windowed" }]}
            />
          </div>
        </SettingsSection>

        <SettingsSection
          icon={Tags}
          title="Catalog & Reports"
          description="Export options."
        >
          <ToggleRow
            label="Include disabled mods in exports"
            detail="Include disabled mods."
            checked={form.includeDisabledModsInExports}
            onCheckedChange={(checked) =>
              updateForm("includeDisabledModsInExports", checked)
            }
          />
          <Separator />
          <ToggleRow
            label="Include audit status in exports"
            detail="Include audit status."
            checked={form.includeAuditInExports}
            onCheckedChange={(checked) => updateForm("includeAuditInExports", checked)}
          />
        </SettingsSection>

        <SettingsSection
          icon={Database}
          title="Logs & Data"
          description="Local data."
        >
          <UtilityButton
            icon={FolderOpen}
            label="Open app data folder"
            onClick={async () => {
              const appDataDir = await api.files.appDataDir();
              await api.files.openInExplorer(appDataDir);
            }}
          />
          <div className="flex items-start gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/25 p-3">
            <History className="mt-0.5 h-4 w-4 text-[var(--color-primary)]" />
            <div>
              <p className="text-sm font-medium">Activity history</p>
              <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                Visible on Dashboard and Logs.
              </p>
            </div>
          </div>
        </SettingsSection>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}>
          <Save className="h-4 w-4" />
          {saveMutation.isPending ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading settings" className="space-y-5">
      <div className="space-y-2"><Skeleton className="h-8 w-32" /><Skeleton className="h-4 w-24" /></div>
      <div className="grid gap-5 xl:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index}><CardHeader><Skeleton className="h-5 w-40" /><Skeleton className="h-3 w-24" /></CardHeader><CardContent className="space-y-4"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-2/3" /></CardContent></Card>
        ))}
      </div>
    </div>
  );
}

function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-[var(--color-primary)]" />
          {title}
        </CardTitle>
        <p className="text-sm text-[var(--color-muted-foreground)]">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function PathField({
  label,
  value,
  onChange,
  onBrowse,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBrowse: () => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input value={value} onChange={(event) => onChange(event.target.value)} />
        <Button variant="outline" size="icon" onClick={onBrowse} aria-label={`Browse ${label}`}>
          <FolderOpen className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  detail,
  checked,
  onCheckedChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{detail}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function UtilityButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button variant="outline" onClick={onClick}>
      <Icon className="h-4 w-4" />
      {label}
    </Button>
  );
}
