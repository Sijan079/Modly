import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ThemedSelect } from "@/components/ui/themed-select";
import {
  DEFAULT_EXPORT_MOD_FILTERS,
  countMatchingMods,
} from "@/lib/export-filters";
import type {
  ExportInstanceZipInput,
  ExportModsZipInput,
  Instance,
  InstanceCategory,
  ModFile,
} from "@/lib/types";

const DEFAULT_OPTIONS = {
  includeMods: true,
  includeConfigs: true,
  includeResourcePacks: true,
  includeShaderPacks: true,
  includeDatapacks: true,
  includeManifest: true,
  ...DEFAULT_EXPORT_MOD_FILTERS,
} satisfies Omit<ExportInstanceZipInput, "instanceId" | "outputPath">;

type ToggleableExportOptionKey =
  | "includeMods"
  | "includeConfigs"
  | "includeResourcePacks"
  | "includeShaderPacks"
  | "includeDatapacks"
  | "includeManifest";

export type ExportZipDialogOptions = Omit<
  ExportInstanceZipInput,
  "instanceId" | "outputPath"
>;

interface ExportZipDialogProps {
  instance: Instance | null;
  open: boolean;
  mode?: "instance" | "mods";
  mods: ModFile[];
  categories: InstanceCategory[];
  exporting?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (
    instance: Instance,
    options: ExportZipDialogOptions
  ) => Promise<void>;
}

export function ExportZipDialog({
  instance,
  open,
  mode = "instance",
  mods,
  categories,
  exporting = false,
  onOpenChange,
  onConfirm,
}: ExportZipDialogProps) {
  const [options, setOptions] = useState<ExportZipDialogOptions>(DEFAULT_OPTIONS);

  useEffect(() => {
    if (open) {
      setOptions(DEFAULT_OPTIONS);
    }
  }, [open]);

  const isModsOnly = mode === "mods";
  const nothingSelected =
    !options.includeMods &&
    !options.includeConfigs &&
    !options.includeResourcePacks &&
    !options.includeShaderPacks &&
    !options.includeDatapacks;
  const matchingModCount = countMatchingMods(mods, options);
  const modsRequired = isModsOnly || options.includeMods;
  const disableConfirm =
    !instance ||
    exporting ||
    (!isModsOnly && nothingSelected) ||
    (modsRequired && matchingModCount === 0);

  const toggle = (key: ToggleableExportOptionKey) => {
    setOptions((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (exporting) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isModsOnly ? "Export Mods ZIP" : "Export ZIP"}</DialogTitle>
          <DialogDescription>
            {isModsOnly
              ? `Choose which mods to package for ${instance?.name ?? "this instance"}.`
              : `Choose what to package for ${instance?.name ?? "this instance"}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {!isModsOnly && (
            <>
              <ExportOptionCard
                title="Mods"
                description="Export matching mods from the instance mods folder."
                checked={options.includeMods}
                onToggle={() => toggle("includeMods")}
              />
              <ExportOptionCard
                title="Configs"
                description="Include the resolved config folder, including custom overrides."
                checked={options.includeConfigs}
                onToggle={() => toggle("includeConfigs")}
              />
              <ExportOptionCard
                title="Resource Packs"
                description="Include resolved resource pack content under resourcepacks/."
                checked={options.includeResourcePacks}
                onToggle={() => toggle("includeResourcePacks")}
              />
              <ExportOptionCard
                title="Shader Packs"
                description="Include resolved shader pack content under shaderpacks/."
                checked={options.includeShaderPacks}
                onToggle={() => toggle("includeShaderPacks")}
              />
              <ExportOptionCard
                title="Datapacks"
                description="Include resolved datapack content under datapacks/."
                checked={options.includeDatapacks}
                onToggle={() => toggle("includeDatapacks")}
              />
              <ExportOptionCard
                title="Include Modly manifest"
                description="Write modly-instance.json so another Modly app can reconstruct the instance."
                checked={options.includeManifest}
                onToggle={() => toggle("includeManifest")}
              />
            </>
          )}
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/25 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[var(--color-foreground)]">Mod filters</p>
                <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                  {isModsOnly
                    ? "This ZIP includes only matching files under mods/."
                    : "These filters only change which files are written into mods/."}
                </p>
              </div>
              <div className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted-foreground)]">
                {matchingModCount} mod{matchingModCount === 1 ? "" : "s"} match
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="space-y-1 text-sm">
                <span className="block text-xs text-[var(--color-muted-foreground)]">Audience</span>
                <ThemedSelect
                  className="w-full bg-[var(--color-card)]"
                  value={options.modAudience}
                  onValueChange={(value) =>
                    setOptions((current) => ({
                      ...current,
                      modAudience: value as ExportModsZipInput["modAudience"],
                    }))
                  }
                  options={[{ value: "any", label: "Any" }, { value: "player", label: "Player" }, { value: "server", label: "Server" }]}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="block text-xs text-[var(--color-muted-foreground)]">Category</span>
                <ThemedSelect
                  className="w-full bg-[var(--color-card)]"
                  value={options.modCategoryId ?? ""}
                  onValueChange={(value) =>
                    setOptions((current) => ({
                      ...current,
                      modCategoryId: value || null,
                    }))
                  }
                  options={[{ value: "", label: "All categories" }, ...categories.map((category) => ({ value: category.id, label: category.name }))]}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="block text-xs text-[var(--color-muted-foreground)]">State</span>
                <ThemedSelect
                  className="w-full bg-[var(--color-card)]"
                  value={options.modState}
                  onValueChange={(value) =>
                    setOptions((current) => ({
                      ...current,
                      modState: value as ExportModsZipInput["modState"],
                    }))
                  }
                  options={[{ value: "enabled", label: "Enabled only" }, { value: "disabled", label: "Disabled only" }, { value: "both", label: "Enabled and disabled" }]}
                />
              </label>
            </div>
          </div>
        </div>

        <p className="text-xs text-[var(--color-muted-foreground)]">
          {isModsOnly
            ? "The ZIP keeps standard folder names and only writes matching files into mods/."
            : "The ZIP keeps standard folder names and uses the instance's resolved override paths."}
        </p>

        {exporting && (
          <div className="flex items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/25 px-3 py-3 text-sm text-[var(--color-muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--color-primary)]" />
            <span>Exporting ZIP now. Keep this window open until the archive is finished.</span>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={exporting}>
            Cancel
          </Button>
          <Button
            onClick={() => instance && onConfirm(instance, options)}
            disabled={disableConfirm}
          >
            {exporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Exporting...
              </>
            ) : (
              "Continue"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExportOptionCard({
  title,
  description,
  checked,
  onToggle,
}: {
  title: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/25 p-3 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border border-[var(--color-input)] bg-[var(--color-card)]"
        checked={checked}
        onChange={onToggle}
      />
      <span>
        <span className="block font-medium text-[var(--color-foreground)]">{title}</span>
        <span className="mt-1 block text-[var(--color-muted-foreground)]">{description}</span>
      </span>
    </label>
  );
}
