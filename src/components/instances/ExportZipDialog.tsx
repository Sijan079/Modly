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
import type { ExportInstanceZipInput, Instance } from "@/lib/types";

const DEFAULT_OPTIONS = {
  includeMods: true,
  includeConfigs: true,
  includeResourcePacks: true,
  includeShaderPacks: true,
  includeDatapacks: true,
  includeManifest: true,
} satisfies Omit<ExportInstanceZipInput, "instanceId" | "outputPath">;

interface ExportZipDialogProps {
  instance: Instance | null;
  open: boolean;
  exporting?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (
    instance: Instance,
    options: Omit<ExportInstanceZipInput, "instanceId" | "outputPath">
  ) => Promise<void>;
}

export function ExportZipDialog({
  instance,
  open,
  exporting = false,
  onOpenChange,
  onConfirm,
}: ExportZipDialogProps) {
  const [options, setOptions] =
    useState<Omit<ExportInstanceZipInput, "instanceId" | "outputPath">>(DEFAULT_OPTIONS);

  useEffect(() => {
    if (open) {
      setOptions(DEFAULT_OPTIONS);
    }
  }, [open]);

  const nothingSelected =
    !options.includeMods &&
    !options.includeConfigs &&
    !options.includeResourcePacks &&
    !options.includeShaderPacks &&
    !options.includeDatapacks;

  const toggle = (key: keyof typeof DEFAULT_OPTIONS) => {
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
          <DialogTitle>Export ZIP</DialogTitle>
          <DialogDescription>
            Choose what to package for {instance?.name ?? "this instance"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <ExportOptionCard
            title="Mods"
            description="Export enabled mods from the instance mods folder."
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
        </div>

        <p className="text-xs text-[var(--color-muted-foreground)]">
          The ZIP keeps standard folder names and uses the instance's resolved override paths.
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
            disabled={!instance || exporting || nothingSelected}
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
