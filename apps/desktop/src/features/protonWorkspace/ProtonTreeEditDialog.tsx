import { useId, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ChevronRight, Folder } from "lucide-react";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { Button } from "../../components/ui/Button";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import type { ProtonNode, ProtonTreeEdit } from "../../types/protonWorkspace";
import { useDriveFolder, type ProtonTreeTarget } from "./ProtonTree";
import { isProtonMarkdown } from "./protonFileKinds";
import { ProtonReferenceImpactPanel } from "./ProtonReferenceImpactPanel";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { protonTreeEditCopy } from "./protonTreeEditCopy";

export function ProtonTreeEditDialog({ accountId, root, action, target, initialDestination, busy, error, onClose, onApply, fallbackFocus }: {
  accountId: string;
  root: ProtonNode;
  action: ProtonTreeEdit["action"];
  target: ProtonTreeTarget;
  initialDestination?: ProtonNode[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onApply: (edit: ProtonTreeEdit, destination: string[]) => void;
  fallbackFocus: () => HTMLElement | null;
}) {
  const copy = protonTreeEditCopy[useUiLocale()];
  const title = copy.action[action];
  const { node, parents } = target;
  const extension = node.type === "file" ? /\.[^.]+$/.exec(node.name.slice(1))?.[0] ?? "" : "";
  const baseName = extension ? node.name.slice(0, -extension.length) : node.name;
  const [name, setName] = useState(action === "rename" ? baseName : action === "duplicate" ? copy.copiedName(baseName) : "");
  const [path, setPath] = useState(initialDestination ?? [root]);
  const current = path[path.length - 1];
  const folder = useDriveFolder(accountId, current.nodeId, root.nodeId, 0, action === "move");
  const folders = folder.items.filter(item => item.type === "folder" && item.nodeId !== node.nodeId);
  const fieldId = useId();
  const creates = action === "create-document" || action === "create-folder" || action === "create-note";
  const asksName = creates || action === "rename" || action === "duplicate";
  const parentId = creates ? node.nodeId : parents[parents.length - 1]?.nodeId ?? root.nodeId;
  const enteredName = name.trim();
  const noteStem = enteredName.replace(/\.(?:nbnote|knote)$/i, "");
  const nextName = action === "create-note" ? (noteStem ? `${noteStem}.nbnote` : "")
    : enteredName + (action === "create-document" ? (isProtonMarkdown(enteredName) ? "" : ".md") : creates ? "" : extension);
  const validName = Boolean(enteredName && nextName) && nextName.length <= 255 && !/[\\/:*?"<>|\x00-\x1f\x7f]|\.$/.test(nextName);
  const saveDisabled = busy || (asksName && (!validName || action === "rename" && nextName === node.name))
    || (action === "move" && (folder.loading || Boolean(folder.error) || current.nodeId === parentId));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveDisabled) return;
    const source = { parentId, nodeId: node.nodeId, expectedName: node.name };
    if (action === "create-document" || action === "create-folder" || action === "create-note") onApply({ action, name: nextName, parentId }, []);
    else if (action === "rename" || action === "duplicate") onApply({ action, name: nextName, ...source }, []);
    else if (action === "move") onApply({ action, targetParentId: current.nodeId, ...source }, path.map(item => item.nodeId));
    else onApply({ action, ...source }, []);
  }

  return createPortal(<ModalFrame label={title} onClose={onClose} fallbackFocus={fallbackFocus} className="proton-rail-dialog">
    <form className="proton-confirm-dialog p-5" onSubmit={submit}>
      <DialogHeading title={title} onClose={onClose} closeLabel={copy.close} busy={busy} />
      <p className="mt-2 break-words text-sm text-ink-secondary">{creates ? copy.inFolder(node.name) : node.name}</p>
      {asksName && <div className="mt-4">
        <label htmlFor={fieldId} className="text-sm font-medium">{copy.name}</label>
        <div className="mt-1 flex items-center gap-2">
          <input id={fieldId} className="ui-field flex-1" aria-invalid={Boolean(name.trim() && !validName)}
            aria-describedby={name.trim() && !validName ? `${fieldId}-error` : undefined}
            data-autofocus autoComplete="off" maxLength={255} disabled={busy} value={name}
            onFocus={event => event.currentTarget.select()} onChange={event => setName(event.target.value)} />
          {!creates && extension && <span className="text-sm text-ink-secondary">{extension}</span>}
        </div>
        {name.trim() && !validName && <p id={`${fieldId}-error`} className="mt-1 text-xs text-red-700">{copy.invalidName}</p>}
        {action === "create-note" && validName && nextName !== enteredName &&
          <p className="mt-2 break-all text-xs text-ink-secondary">{nextName}</p>}
        {action === "duplicate" && <p className="mt-2 text-xs text-ink-secondary">{copy.duplicateHelp}</p>}
      </div>}
      {action === "trash" && <p className="mt-3 text-sm">{node.type === "folder"
        ? copy.trashFolder
        : copy.trashFile} {copy.draftsKept}</p>}
      {action === "move" && <div className="mt-3 space-y-2">
        <p className="text-sm">{copy.moveHelp}</p>
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          {path.length > 1 && <Button variant="quiet" size="icon" aria-label={copy.up}
            disabled={busy} onClick={() => setPath(previous => previous.slice(0, -1))}><ArrowLeft size={16} aria-hidden="true" /></Button>}
          <p className="min-w-0 break-words">{path.map(item => item.name).join(" / ")}</p>
        </div>
        <div className="max-h-48 overflow-y-auto rounded-xl border border-line bg-white">
          {folder.loading ? <p role="status" className="p-3 text-sm">{copy.loading}</p>
            : folder.error ? <p role="alert" className="p-3 text-sm">{copy.loadError}</p>
            : folders.length ? folders.map(item => <button key={item.nodeId} type="button" disabled={busy}
                className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm hover:bg-brand-hover"
                onClick={() => setPath(previous => [...previous, item])}>
                <Folder size={16} /><span className="flex-1 break-all">{item.name}</span><ChevronRight size={16} />
              </button>) : <p className="p-3 text-sm text-ink-secondary">{copy.empty}</p>}
        </div>
      </div>}
      {(action === "rename" || action === "move") && <ProtonReferenceImpactPanel
        address={{ accountId, rootId: root.nodeId, nodeId: node.nodeId }} name={node.name} revisionId={node.revisionId}
        parentId={parentId} action={action} disabled={busy} folder={node.type === "folder"} />}
      {error && <div className="mt-3"><InlineNotice tone="error" announce="alert">{error}</InlineNotice></div>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button data-autofocus={!asksName || undefined} disabled={busy} onClick={onClose}>{copy.cancel}</Button>
        <Button type="submit" variant={action === "trash" ? "danger" : "primary"}
          disabled={saveDisabled}>{busy ? copy.applying : creates ? copy.create : action === "move" ? copy.move : title}</Button>
      </div>
    </form>
  </ModalFrame>, document.body);
}
