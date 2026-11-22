import { ArrowLeft, ChevronRight, Folder } from "lucide-react";
import { useId } from "react";
import { Button } from "../../components/ui/Button";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import type { ProtonNode } from "../../types/protonWorkspace";
import { useDriveFolder } from "./ProtonTree";
import { useUiCopy } from "../../lib/i18n/UiLocale";

export function DrivePicker({ accountId, rootId, title, path, busy, onBack, onOpen, onSelect }: {
  accountId: string;
  rootId?: string;
  title?: string;
  path: ProtonNode[];
  busy: boolean;
  onBack: () => void;
  onOpen: (node: ProtonNode) => void;
  onSelect: (node: ProtonNode) => void;
}) {
  const text = useUiCopy().picker;
  const current = path[path.length - 1];
  const label = useId();
  const { items, loading, error } = useDriveFolder(accountId, current.nodeId, rootId, 0, true);
  const folders = items.filter(item => item.type === "folder");
  return <section className="mx-auto w-full max-w-2xl px-5 py-8" aria-labelledby={label}>
    <div className="mb-4 flex items-center gap-2">
      <Button variant="quiet" size="icon" aria-label={text.back} onClick={onBack} disabled={busy}><ArrowLeft size={18} aria-hidden="true" /></Button>
      <h1 id={label} className="text-xl font-bold">{title ?? text.title}</h1>
    </div>
    <p className="mb-3 break-words text-sm text-ink-secondary">{path.map(node => node.name).join(" / ")}</p>
    <div className="max-h-[45vh] overflow-y-auto rounded-2xl border border-line bg-panel">
      {loading && <p className="px-4 py-3 text-sm text-ink-secondary" role="status">{text.loading}</p>}
      {error && <div className="m-2"><InlineNotice tone="error" announce="alert">{text.error}</InlineNotice></div>}
      {!error && !loading && !folders.length && <p className="px-4 py-3 text-sm text-ink-secondary">{text.empty}</p>}
      <ul>{folders.map(folder => <li key={folder.nodeId}>
        <button type="button" disabled={busy || loading} onClick={() => onOpen(folder)} className="flex min-h-11 w-full items-center gap-2 border-b border-line px-4 text-left text-sm last:border-b-0 hover:bg-brand-hover disabled:opacity-55">
          <Folder size={16} className="shrink-0 text-brand-dark" /><span className="flex-1 break-words">{folder.name}</span><ChevronRight size={16} className="shrink-0" />
        </button>
      </li>)}</ul>
    </div>
    <div className="mt-5 flex justify-end">
      <Button variant="primary" onClick={() => onSelect(current)} disabled={busy || loading || error}>
        {text.select}
      </Button>
    </div>
  </section>;
}
