import { useRef, useState, type DragEvent } from "react";
import type { ProtonNode } from "../../types/protonWorkspace";
import type { ProtonTreeTarget } from "./ProtonTree";
import { captureProtonDrop, hasDroppedFiles, type LoadProtonImport } from "./protonImportSources";

const treeDragType = "application/x-neubiki-proton-node";

export function useProtonTreeDrop(enabled: boolean, move: (source: ProtonTreeTarget, destination: ProtonNode[]) => void,
  copy: ((destination: ProtonNode[], load: LoadProtonImport) => void) | undefined, closeMenu: () => void) {
  const source = useRef<ProtonTreeTarget | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  function operation(data: DataTransfer, path: ProtonNode[]) {
    const destination = path[path.length - 1];
    if (!enabled || destination?.type !== "folder") return;
    if (copy && hasDroppedFiles(data)) return "copy";
    const dragged = source.current;
    if (!dragged || !Array.from(data.types).includes(treeDragType)) return;
    if (destination.nodeId === dragged.parents[dragged.parents.length - 1]?.nodeId) return;
    if (path.some(node => node.nodeId === dragged.node.nodeId)) return;
    return "move";
  }

  function start(event: DragEvent, target: ProtonTreeTarget) {
    if (!enabled) { event.preventDefault(); return; }
    closeMenu();
    source.current = target;
    event.dataTransfer.setData(treeDragType, "move");
    event.dataTransfer.effectAllowed = "move";
  }

  function clear() {
    source.current = null;
    setHovered(null);
  }

  function target(path: ProtonNode[]) {
    const id = path[path.length - 1]?.nodeId;
    return {
      "data-drop-target": enabled && hovered === id || undefined,
      onDragOver(event: DragEvent) {
        const effect = operation(event.dataTransfer, path);
        if (effect) event.preventDefault();
        event.dataTransfer.dropEffect = effect ?? "none";
        setHovered(effect && id ? id : null);
      },
      onDragLeave(event: DragEvent) {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setHovered(previous => previous === id ? null : previous);
      },
      onDrop(event: DragEvent) {
        const effect = operation(event.dataTransfer, path);
        const dragged = source.current;
        event.preventDefault();
        clear();
        if (effect === "move" && dragged) move(dragged, path);
        if (effect === "copy") copy?.(path, captureProtonDrop(event.dataTransfer));
      },
    };
  }

  return { start, clear, target, hovered: enabled ? hovered : null };
}
