import { LocalizedNoticeError, useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText } from "lucide-react";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { Button } from "../../components/ui/Button";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import type { ExportDiagramResolution, ExportFormat } from "../../types/domain";
import type { ExportProfile, ExportProfiles } from "../../types/portabilityWorkspace";
import { getExportTemplate } from "../../lib/api/config";
import { getExportProfiles } from "../../lib/api/portabilityWorkspace";
import { readSharedExportProfiles, type SharedExportProfiles } from "../../lib/api/protonSharedProfiles";
import { exportCopy } from "../../lib/i18n/exportCopy";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import { protonSharedProfilesCopy } from "./protonSharedProfilesCopy";
import { exportProtonDocument, exportProtonDocumentToMobile } from "../../lib/api/protonExport";
import { openMobileExport } from "../../lib/api/mobileExports";
import { selectExportFilePath } from "../../lib/runtime/exportDialogs";
import { isTauriMobileRuntime } from "../../lib/runtime/platform";
import type { OpenedDocument } from "./useProtonDocument";
import { ExportStatus } from "../documents/ExportStatus";

const formats: ReadonlyArray<[ExportFormat, string]> = [
  ["md", "Markdown (.md)"], ["pdf", "PDF (.pdf)"], ["docx", "Word (.docx)"],
];

export function ProtonExportActions({ disabled, snapshot, requested, onRequestHandled }: {
  disabled: boolean;
  snapshot: () => OpenedDocument | null;
  requested: boolean;
  onRequestHandled: () => void;
}) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const language = useUiLocale();
  const t = protonSharedProfilesCopy[language];
  const c = exportCopy[language];
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ exportId?: string; fileName: string } | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [catalog, setCatalog] = useState<ExportProfiles>();
  const [shared, setShared] = useState<{ key: string; catalog: SharedExportProfiles }>();
  const [sharedError, setSharedError] = useState("");
  const [profileId, setProfileId] = useState("");
  const [profileError, setProfileError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (requested && !disabled && !progress) {
      setOpen(true);
      onRequestHandled();
    }
  }, [requested, disabled, progress, onRequestHandled]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setCatalog(undefined);
    setProfileId("");
    setProfileError("");
    setShared(undefined);
    setSharedError("");
    void getExportProfiles().then(value => {
      if (active) setCatalog(value);
    }, cause => {
      if (active) setProfileError(runtimeErrorMessage(cause, c.profilesFailed));
    });
    const source = snapshot();
    if (source) {
      const { accountId, rootId } = source.address;
      const key = JSON.stringify([accountId, rootId]);
      void readSharedExportProfiles({ accountId, rootId }).then(value => {
        if (active) setShared({ key, catalog: value });
      }, cause => { if (active) setSharedError(runtimeErrorMessage(cause, t.sharedLoadFailed)); });
    }
    return () => { active = false; };
  }, [open]);

  async function start(format: ExportFormat) {
    setOpen(false);
    setError("");
    setSaved(null);
    try {
      const source = snapshot();
      if (!source || source.document.markdown === null) return;
      const project = profileId.startsWith("project:");
      if (format !== "md" && project && shared?.key !== JSON.stringify([source.address.accountId, source.address.rootId])) throw new LocalizedNoticeError(t.scopeChanged);
      const id = project ? profileId.slice("project:".length) : profileId;
      const profile = format === "md" ? undefined : (project ? shared?.catalog.profiles : catalog?.profiles)?.find(item => item.id === id);
      const profileRevision = profile ? project ? shared?.catalog.revisionId : catalog?.revision : undefined;
      if (format !== "md" && profileId && !profile) throw new LocalizedNoticeError(t.staleSelection);
      if (profile && !profileRevision) throw new LocalizedNoticeError(c.profileUnverified);
      const name = source.document.node.name;
      const mobile = isTauriMobileRuntime();
      setProgress(name);
      const output = mobile ? null : await selectExportFilePath(name, format, language);
      if (!mobile && !output) return;
      const diagramAssets = format === "md" ? undefined : await (async () => {
        const resolution = profile ? diagramResolution(profile) : (await getExportTemplate()).document.diagramResolution;
        const { prepareMermaidDiagramAssets } = await import("../editor/mermaidDiagrams");
        return prepareMermaidDiagramAssets(source.markdown, resolution);
      })();
      const payload = { ...source.address, name, format, markdown: source.markdown, diagramAssets,
        ...(profile && profileRevision ? { profileId: profile.id, profileRevision, ...(project ? { profileSource: "project" as const } : {}) } : {}) };
      if (output) {
        const result = await exportProtonDocument(payload, output);
        setSaved({ fileName: result.outputPath.split(/[\\/]/).pop() || name });
      } else {
        const result = await exportProtonDocumentToMobile(payload);
        if (result.status === "saved") setSaved(result);
      }
    } catch (cause) {
      setError(runtimeErrorMessage(cause, c.exportFailed));
    } finally {
      setProgress(null);
    }
  }

  async function openFile() {
    if (!saved?.exportId || opening) return;
    setOpening(true);
    try { await openMobileExport(saved.exportId); }
    catch (cause) { setError(runtimeErrorMessage(cause, c.openFailed)); }
    finally { setOpening(false); }
  }

  return <>
    <Button ref={trigger} variant="quiet" size="compact" disabled={disabled || Boolean(progress)}
      aria-haspopup="dialog" onClick={() => setOpen(true)}><Download size={15} aria-hidden="true" /> {c.export}</Button>
    {error && <InlineNotice tone="error" announce="alert" action={<Button size="compact" variant="quiet" onClick={() => setError("")}>{c.close}</Button>}>
      {error}
    </InlineNotice>}
    {(progress || saved) && createPortal(<ExportStatus progress={progress} saved={saved} opening={opening}
      onOpen={() => { void openFile(); }} onClose={() => {
        setSaved(null);
        trigger.current?.focus({ preventScroll: true });
      }} />, document.body)}
    {open && createPortal(<ModalFrame label={c.documentTitle} onClose={() => setOpen(false)}>
      <section className="proton-confirm-dialog p-5">
        <DialogHeading title={c.documentTitle} onClose={() => setOpen(false)} closeLabel={c.closeExport} />
        {profileError && <InlineNotice tone="warning">{profileError}</InlineNotice>}
        {sharedError && <InlineNotice tone="warning">{sharedError}</InlineNotice>}
        {(!!catalog?.profiles.length || !!shared?.catalog.profiles.length) && <label className="mt-3 grid gap-1 text-sm">
          {c.profile}
          <select className="ui-field w-full" value={profileId} onChange={event => setProfileId(event.target.value)}>
            <option value="">{c.currentTemplate}</option>
            {!!catalog?.profiles.length && <optgroup label={t.deviceGroup}>{catalog.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</optgroup>}
            {!!shared?.catalog.profiles.length && <optgroup label={t.projectGroup} disabled={shared.catalog.outcome !== "confirmed"}>{shared.catalog.profiles.map(profile => <option key={profile.id} value={`project:${profile.id}`}>{profile.name}</option>)}</optgroup>}
          </select>
        </label>}
        <div className="proton-export-formats mt-3 grid gap-2">
          {formats.map(([format, label]) => <Button key={format}
            onClick={() => { void start(format); }}><FileText size={16} aria-hidden="true" /> {label}</Button>)}
        </div>
      </section>
    </ModalFrame>, document.body)}
  </>;
}

function diagramResolution(profile: ExportProfile): ExportDiagramResolution {
  const style = profile.style as { document?: { diagramResolution?: unknown } } | null | undefined;
  const resolution = style?.document?.diagramResolution;
  return resolution === "low" || resolution === "high" ? resolution : "medium";
}
