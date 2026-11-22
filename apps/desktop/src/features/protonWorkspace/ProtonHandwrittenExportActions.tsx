import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/Button";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { exportProtonDocument, exportProtonDocumentToMobile } from "../../lib/api/protonExport";
import { isTauriMobileRuntime } from "../../lib/runtime/platform";
import { selectHandwrittenExportFilePath } from "../../lib/runtime/exportDialogs";
import type { HandwrittenExportFormat } from "../../types/domain";
import { checkpointPendingEditorInput } from "../editor/pendingInputCheckpoints";
import type { OpenedDocument } from "./useProtonDocument";
import { useHandwrittenCopy } from "../../lib/i18n/handwrittenCopy";
import { useUiLocale } from "../../lib/i18n/UiLocale";

export function ProtonHandwrittenExportActions({ snapshot, disabled }: { snapshot: () => OpenedDocument | null; disabled: boolean }) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const language = useUiLocale();
  const {export:c,common} = useHandwrittenCopy();
  const formats: [HandwrittenExportFormat, string][] = [["nbnote",c.native],["pdf","PDF"],["png",c.png],["svg",c.svg]];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const pending = useRef(false);

  async function run(format: HandwrittenExportFormat) {
    if (pending.current) return;
    checkpointPendingEditorInput();
    const document = snapshot();
    if (!document?.handwritten) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const payload = { ...document.address, name: document.document.node.name, handwritten: document.handwritten,
        format, pageId: format === "png" || format === "svg" ? document.handwritten.pages[0]?.id : undefined };
      if (isTauriMobileRuntime()) {
        const result = await exportProtonDocumentToMobile(payload);
        if (result.status === "saved") setNotice(c.saved.replace("{name}",result.fileName));
      } else {
        const output = await selectHandwrittenExportFilePath(document.document.node.name, format, language);
        if (output) {
          await exportProtonDocument(payload, output);
          setNotice(c.saved.replace("{name}",output.split(/[\\/]/).pop()??""));
        }
      }
    } catch (cause) {
      setError(runtimeErrorMessage(cause, c.failed));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <>
    <Button size="compact" variant="quiet" disabled={disabled} onClick={() => setOpen(true)}><Download size={16} aria-hidden="true" /> {c.action}</Button>
    {open && createPortal(<ModalFrame label={c.title} onClose={() => { if (!pending.current) setOpen(false); }}>
      <section className="proton-confirm-dialog space-y-3 p-5">
        <DialogHeading title={c.title} closeLabel={common.close} onClose={() => setOpen(false)} busy={busy} />
        {formats.map(([format, label]) => <Button key={format} className="w-full justify-start" disabled={busy} onClick={() => { void run(format); }}>{label}</Button>)}
        {busy && <p role="status" className="text-sm text-ink-secondary">{c.preparing}</p>}
        {error && <InlineNotice tone="error" announce="alert">{error}</InlineNotice>}
        {notice && <InlineNotice tone="success" announce="status">{notice}</InlineNotice>}
      </section>
    </ModalFrame>, document.body)}
  </>;
}
