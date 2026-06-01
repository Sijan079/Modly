import { ChevronRight, FileCode, Folder } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ConfigTreeNode } from "@/lib/types";

interface ConfigTreeProps {
  nodes: ConfigTreeNode[];
  activePath: string | null;
  onOpenFile: (path: string) => void;
  searchActive?: boolean;
}

export function ConfigTree({
  nodes,
  activePath,
  onOpenFile,
  searchActive = false,
}: ConfigTreeProps) {
  if (nodes.length === 0) {
    return (
      <div className="p-4 text-sm text-[var(--color-muted-foreground)]">
        {searchActive ? "No config files match your search." : "No config files found."}
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-1 p-2">
        {nodes.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            activePath={activePath}
            onOpenFile={onOpenFile}
            searchActive={searchActive}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

function TreeNode({
  node,
  depth,
  activePath,
  onOpenFile,
  searchActive,
}: {
  node: ConfigTreeNode;
  depth: number;
  activePath: string | null;
  onOpenFile: (path: string) => void;
  searchActive: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = node.isDir ? Folder : FileCode;
  const isExpanded = searchActive || expanded;

  return (
    <div>
      <Button
        type="button"
        variant={activePath === node.path ? "secondary" : "ghost"}
        className={cn(
          "h-8 w-full justify-start gap-2 px-2 text-left text-xs font-normal",
          activePath === node.path && "font-medium"
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => {
          if (node.isDir) {
            setExpanded((value) => !value);
          } else {
            onOpenFile(node.path);
          }
        }}
      >
        {node.isDir ? (
          <ChevronRight
            className={cn("h-3.5 w-3.5 transition-transform", isExpanded && "rotate-90")}
          />
        ) : (
          <span className="h-3.5 w-3.5" />
        )}
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{node.name}</span>
      </Button>
      {node.isDir && isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              onOpenFile={onOpenFile}
              searchActive={searchActive}
            />
          ))}
        </div>
      )}
    </div>
  );
}
