import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

interface ConfigEditorProps {
  filePath: string;
}

function languageFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "json" || ext === "mcmeta") return "json";
  if (ext === "toml") return "toml";
  if (ext === "yaml" || ext === "yml") return "yaml";
  if (ext === "xml") return "xml";
  if (ext === "properties" || ext === "cfg" || ext === "conf") return "ini";
  return "plaintext";
}

export function ConfigEditor({ filePath }: ConfigEditorProps) {
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api.configs
      .readFile(filePath)
      .then((text) => {
        if (!cancelled) {
          setContent(text);
          setSavedContent(text);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const dirty = content !== savedContent;

  const saveFile = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.configs.writeFile(filePath, content);
      setSavedContent(content);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{filePath}</p>
          {error && <p className="truncate text-xs text-red-500">{error}</p>}
        </div>
        <Button
          type="button"
          size="sm"
          disabled={!dirty || saving || loading}
          onClick={saveFile}
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving" : dirty ? "Save" : "Saved"}
        </Button>
      </div>
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-muted-foreground)]">
          Loading file...
        </div>
      ) : (
        <Editor
          theme="vs-dark"
          language={languageFor(filePath)}
          value={content}
          onChange={(value) => setContent(value ?? "")}
          options={{
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false,
          }}
        />
      )}
    </div>
  );
}
