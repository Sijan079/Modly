import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen } from "lucide-react";
import type { Instance, LoaderType, UpdateInstanceInput } from "@/lib/types";

interface InstanceEditDialogProps {
  instance: Instance | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: UpdateInstanceInput) => Promise<void>;
  onExport: (instance: Instance) => Promise<void>;
  saving?: boolean;
  exporting?: boolean;
}

export function InstanceEditDialog({
  instance,
  open,
  onOpenChange,
  onSave,
  onExport,
  saving = false,
  exporting = false,
}: InstanceEditDialogProps) {
  const [name, setName] = useState("");
  const [gameDir, setGameDir] = useState("");
  const [loader, setLoader] = useState<LoaderType>("fabric");
  const [mcVersion, setMcVersion] = useState("");
  const [resourcePacksPath, setResourcePacksPath] = useState("");
  const [shaderPacksPath, setShaderPacksPath] = useState("");
  const [dataPacksPath, setDataPacksPath] = useState("");
  const [configPath, setConfigPath] = useState("");

  useEffect(() => {
    if (!instance) {
      setName("");
      setGameDir("");
      setLoader("fabric");
      setMcVersion("");
      setResourcePacksPath("");
      setShaderPacksPath("");
      setDataPacksPath("");
      setConfigPath("");
      return;
    }

    setName(instance.name);
    setGameDir(instance.gameDir);
    setLoader(instance.loader);
    setMcVersion(instance.mcVersion ?? "");
    setResourcePacksPath(instance.resourcePacksPath ?? "");
    setShaderPacksPath(instance.shaderPacksPath ?? "");
    setDataPacksPath(instance.dataPacksPath ?? "");
    setConfigPath(instance.configPath ?? "");
  }, [instance]);

  const handleSave = async () => {
    if (!instance) return;

    await onSave({
      id: instance.id,
      name: name.trim(),
      gameDir: gameDir.trim(),
      loader,
      mcVersion: mcVersion.trim() || null,
      resourcePacksPath: resourcePacksPath.trim() || null,
      shaderPacksPath: shaderPacksPath.trim() || null,
      dataPacksPath: dataPacksPath.trim() || null,
      configPath: configPath.trim() || null,
    });
  };

  const handlePickGameDir = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: gameDir || undefined,
    });
    if (selected && typeof selected === "string") {
      setGameDir(selected);
    }
  };

  const pickPath = async (
    currentValue: string,
    setter: (value: string) => void
  ) => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: currentValue || gameDir || undefined,
    });
    if (selected && typeof selected === "string") {
      setter(selected);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit instance</DialogTitle>
          <DialogDescription className="truncate">
            {instance?.gameDir ?? "Update this instance's details"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="instance-name">Name</Label>
            <Input
              id="instance-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="My Modpack"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="instance-game-dir">Game Directory</Label>
            <div className="flex gap-2">
              <Input
                id="instance-game-dir"
                value={gameDir}
                onChange={(event) => setGameDir(event.target.value)}
                placeholder="C:\\Games\\MyModpack"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handlePickGameDir}
                aria-label="Select game directory"
                title="Select game directory"
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="instance-loader">Loader</Label>
              <select
                id="instance-loader"
                className="flex h-9 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-muted)] px-3 text-sm"
                value={loader}
                onChange={(event) => setLoader(event.target.value as LoaderType)}
              >
                <option value="vanilla">Vanilla</option>
                <option value="fabric">Fabric</option>
                <option value="forge">Forge</option>
                <option value="neoforge">NeoForge</option>
                <option value="quilt">Quilt</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="instance-version">Minecraft Version</Label>
              <Input
                id="instance-version"
                value={mcVersion}
                onChange={(event) => setMcVersion(event.target.value)}
                placeholder="1.20.1"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <PathOverrideField
              label="Resource Packs Path"
              value={resourcePacksPath}
              placeholder={`${gameDir || "C:\\Games\\MyModpack"}\\resourcepacks`}
              onChange={setResourcePacksPath}
              onBrowse={() => pickPath(resourcePacksPath, setResourcePacksPath)}
              onClear={() => setResourcePacksPath("")}
            />
            <PathOverrideField
              label="Shader Packs Path"
              value={shaderPacksPath}
              placeholder={`${gameDir || "C:\\Games\\MyModpack"}\\shaderpacks`}
              onChange={setShaderPacksPath}
              onBrowse={() => pickPath(shaderPacksPath, setShaderPacksPath)}
              onClear={() => setShaderPacksPath("")}
            />
            <PathOverrideField
              label="Datapacks Path"
              value={dataPacksPath}
              placeholder={`${gameDir || "C:\\Games\\MyModpack"}\\datapacks`}
              onChange={setDataPacksPath}
              onBrowse={() => pickPath(dataPacksPath, setDataPacksPath)}
              onClear={() => setDataPacksPath("")}
            />
            <PathOverrideField
              label="Config Path"
              value={configPath}
              placeholder={`${gameDir || "C:\\Games\\MyModpack"}\\config`}
              onChange={setConfigPath}
              onBrowse={() => pickPath(configPath, setConfigPath)}
              onClear={() => setConfigPath("")}
            />
          </div>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Leave path overrides blank to keep using the default folders inside the game directory.
          </p>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => instance && onExport(instance)}
            disabled={!instance || exporting}
          >
            <Download className="h-4 w-4" />
            Export ZIP
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !name.trim() || !gameDir.trim()}
            >
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PathOverrideField({
  label,
  value,
  placeholder,
  onChange,
  onBrowse,
  onClear,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onBrowse: () => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
        <Button type="button" variant="outline" size="icon" onClick={onBrowse} title={`Browse ${label}`}>
          <FolderOpen className="h-4 w-4" />
        </Button>
      </div>
      {value && (
        <Button type="button" variant="ghost" size="sm" className="h-7 px-0" onClick={onClear}>
          Clear override
        </Button>
      )}
    </div>
  );
}
