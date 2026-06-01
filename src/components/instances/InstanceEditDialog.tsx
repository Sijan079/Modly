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

  useEffect(() => {
    if (!instance) {
      setName("");
      setGameDir("");
      setLoader("fabric");
      setMcVersion("");
      return;
    }

    setName(instance.name);
    setGameDir(instance.gameDir);
    setLoader(instance.loader);
    setMcVersion(instance.mcVersion ?? "");
  }, [instance]);

  const handleSave = async () => {
    if (!instance) return;

    await onSave({
      id: instance.id,
      name: name.trim(),
      gameDir: gameDir.trim(),
      loader,
      mcVersion: mcVersion.trim() || null,
    });
  };

  const handlePickGameDir = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (selected && typeof selected === "string") {
      setGameDir(selected);
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
