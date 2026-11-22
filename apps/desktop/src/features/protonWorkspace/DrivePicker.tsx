import { ArrowLeft, ChevronRight, Folder } from "lucide-react";
import type { ProtonNode } from "../../types/protonWorkspace";
import { useDriveFolder } from "./ProtonTree";

export function DrivePicker({ accountId, path, busy, onBack, onOpen, onSelect }: {
  accountId: string;
  path: ProtonNode[];
  busy: boolean;
  onBack: () => void;
  onOpen: (node: ProtonNode) => void;
  onSelect: (node: ProtonNode) => void;
}) {
  const current = path[path.length - 1];
  const { items, loading, error } = useDriveFolder(accountId, current.nodeId, undefined, 0, true);
  const folders = items.filter(item => item.type === "folder");
  return <section className="mx-auto w-full max-w-2xl px-5 py-8" aria-labelledby="drive-picker-label">
    <div className="mb-4 flex items-center gap-2">
      <button type="button" aria-label="Atrás" onClick={onBack} disabled={busy} className="rounded p-2 hover:bg-brand-hover"><ArrowLeft size={18} /></button>
      <h1 id="drive-picker-label" className="text-xl font-semibold">Elegir carpeta de Proton Drive</h1>
    </div>
    <p className="mb-3 break-words text-sm text-ink-secondary">{path.map(node => node.name).join(" / ")}</p>
    <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-line bg-panel">
      {loading && <p className="px-4 py-3 text-sm text-ink-secondary" role="status">Leyendo carpetas…</p>}
      {error && <p className="px-4 py-3 text-sm" role="alert">No se pudo leer esta carpeta. Vuelve atrás y comprueba la conexión.</p>}
      {!error && !loading && !folders.length && <p className="px-4 py-3 text-sm text-ink-secondary">No hay subcarpetas.</p>}
      <ul>{folders.map(folder => <li key={folder.nodeId}>
        <button type="button" disabled={busy || loading} onClick={() => onOpen(folder)} className="flex min-h-11 w-full items-center gap-2 border-b border-line px-4 text-left text-sm last:border-b-0 hover:bg-brand-hover disabled:opacity-55">
          <Folder size={16} className="shrink-0 text-brand-dark" /><span className="flex-1 break-words">{folder.name}</span><ChevronRight size={16} className="shrink-0" />
        </button>
      </li>)}</ul>
    </div>
    <div className="mt-5 flex justify-end">
      <button type="button" onClick={() => onSelect(current)} disabled={busy || loading || error} className="min-h-11 rounded-md bg-brand-orange px-4 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
        Usar esta carpeta
      </button>
    </div>
  </section>;
}
