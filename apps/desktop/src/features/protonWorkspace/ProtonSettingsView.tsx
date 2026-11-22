import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Brain, Cloud, Download, HardDrive, Palette, RefreshCw, Sparkles, Wrench } from "lucide-react";
import { ModalFrame } from "../../components/ui/ModalFrame";
import { Button } from "../../components/ui/Button";
import { StatusTag } from "../../components/ui/StatusTag";
import { DialogHeading } from "../../components/patterns/DialogHeading";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { getExportTemplate, getExportTemplatePath, resetExportTemplate, updateExportTemplate } from "../../lib/api/config";
import type { AiConfig, ExportTemplateConfig, ExportTemplateUpdate } from "../../types/domain";
import type { ProtonAccount } from "../../types/protonDirect";
import { aiConfigValues, useProtonAiSettings } from "../assistant/ProtonAiSettings";
import { AiDocumentalSettings, CapabilitiesSettings, ExportSettings, SettingsFormDepth } from "../settings/AppSettingsDialog";
import { AiSkillsSettings } from "../settings/AiSkillsSettings";
import { settingsCopy } from "../settings/settingsCopy";
import { ProtonWorkspaceMode } from "./ProtonWorkspaceMode";
import { WorkspaceAppearanceForm } from "./WorkspaceAppearanceForm";
import type { WorkspaceAppearanceController } from "./useWorkspaceAppearance";
import { ProtonUpdatesSection } from "./ProtonUpdatesSection";
import { useProtonUpdater } from "./useProtonUpdater";
import { ProtonDeviceSettings } from "./ProtonDeviceSettings";
import { ProtonExportProfiles } from "./ProtonExportProfiles";
import { useUiCopy, useUiLocale } from "../../lib/i18n/UiLocale";

const sectionDefinitions = [
  { id: "drive", label: "Proton Drive", icon: Cloud, searchTopics: "cuenta conexión carpeta raíz proyecto" },
  { id: "appearance", label: "Apariencia", icon: Palette, searchTopics: "tema perfiles color acento claro oscuro contraste lectura escala tamaño tipografía interlineado" },
  { id: "ai", label: "Inteligencia artificial", icon: Brain, searchTopics: "openai clave api credenciales modelo texto contexto privacidad historial retención datos eliminación" },
  { id: "capabilities", label: "Capacidades de IA", icon: Wrench, searchTopics: "permisos modelos imagen generación audio transcripción dibujo visión investigación" },
  { id: "skills", label: "Habilidades de IA", icon: Sparkles, searchTopics: "skills manifiesto instrucciones versiones" },
  { id: "export", label: "Exportación", icon: Download, searchTopics: "pdf word docx márgenes página formato papel plantilla títulos fuente tipografía" },
  { id: "updates", label: "Actualizaciones", icon: RefreshCw, searchTopics: "versión instalada descargar instalador reiniciar" },
  { id: "device", label: "Dispositivo", icon: HardDrive, searchTopics: "almacenamiento local disco tamaño borradores recuperación audio diagnóstico informe técnico" },
] as const;
const englishTopics = {drive:"account connection folder root project",appearance:"theme profiles color accent light dark contrast reading scale size typography line spacing language",ai:"openai key api credentials model text context privacy history retention data deletion",capabilities:"permissions models image generation audio transcription drawing vision research",skills:"skills manifest instructions versions",export:"pdf word docx margins page format paper template headings font typography",updates:"installed version download installer restart",device:"local storage disk size drafts recovery audio diagnostics report"};

type Props = {
  appearance: WorkspaceAppearanceController;
  accounts: ProtonAccount[];
  selectedAccountId?: string;
  native: boolean;
  workspaceBusy: boolean;
  folderPickerOpen: boolean;
  onChooseAccount: (id: string) => void;
  onChooseFolder: () => void;
  onAiSaved: () => void;
  onOpenAiHistory?: () => void;
  onBack: () => void;
  freezeForUpdate: () => void;
  unfreezeAfterUpdate: () => void;
  protectForUpdate: () => Promise<boolean>;
  onPendingChange?: (pending: boolean) => void;
};

export function ProtonSettingsView({
  appearance, accounts, selectedAccountId, native, workspaceBusy, folderPickerOpen, onChooseAccount, onChooseFolder, onAiSaved, onOpenAiHistory, onBack,
  freezeForUpdate, unfreezeAfterUpdate, protectForUpdate, onPendingChange,
}: Props) {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const language = useUiLocale();
  const copy = useUiCopy();
  const c = copy.settings;
  const sections = sectionDefinitions.map(section=>({...section,label:copy.sections[section.id],searchTopics:`${section.searchTopics} ${englishTopics[section.id]}`}));
  const [section, setSection] = useState<typeof sectionDefinitions[number]["id"]>("drive");
  const settings = useProtonAiSettings(0, onAiSaved);
  const [aiDraft, setAiDraft] = useState<AiConfig | null>(null);
  const [aiSaved, setAiSaved] = useState(false);
  const [template, setTemplate] = useState<ExportTemplateConfig | null>(null);
  const [templateDraft, setTemplateDraft] = useState<ExportTemplateUpdate | null>(null);
  const [templatePath, setTemplatePath] = useState("");
  const [templateError, setTemplateError] = useState("");
  const [templateSaved, setTemplateSaved] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateRetry, setTemplateRetry] = useState(0);
  const [profileDirty, setProfileDirty] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileResetKey, setProfileResetKey] = useState(0);
  const [leave, setLeave] = useState<"back" | "folder" | null>(null);
  const pendingSettings = Boolean(aiDraft || templateDraft) || profileDirty || appearance.hasPending();
  const updater = useProtonUpdater({
    freeze: freezeForUpdate, unfreeze: unfreezeAfterUpdate, protect: protectForUpdate,
    hasPendingSettings: () => Boolean(aiDraft || templateDraft) || profileDirty || appearance.hasPending(),
  });
  const busy = workspaceBusy || settings.busy || templateBusy || profileBusy || updater.busy;
  const pendingListener = useRef(onPendingChange);
  pendingListener.current = onPendingChange;
  useLayoutEffect(() => {
    onPendingChange?.(pendingSettings || busy);
  }, [pendingSettings, busy, onPendingChange]);
  useEffect(() => () => pendingListener.current?.(false), []);
  const ai = settings.config && { ...settings.config, ...aiDraft };
  const editedTemplate = template && {
    ...template,
    ...templateDraft,
    headings: { ...template.headings, ...templateDraft?.headings },
  };
  const text = settingsCopy[language];
  const editingAi = section === "ai" || section === "capabilities";

  useEffect(() => {
    if (section !== "export" || template) return;
    let active = true;
    setTemplateError("");
    void Promise.all([getExportTemplate(), getExportTemplatePath().catch(() => "")]).then(([value, path]) => {
      if (active) {
        setTemplate(value);
        setTemplatePath(path);
      }
    }, cause => {
      if (active) setTemplateError(runtimeErrorMessage(cause, c.templateReadFailed));
    });
    return () => { active = false; };
  }, [section, template, templateRetry]);

  async function saveAi() {
    if (!aiDraft || busy) return;
    if (await settings.saveConfig(aiDraft)) {
      setAiDraft(null);
      setAiSaved(true);
    }
  }

  async function saveTemplate(reset = false) {
    if (busy || (!templateDraft && !reset)) return;
    setTemplateBusy(true);
    setTemplateError("");
    try {
      const saved = reset ? await resetExportTemplate() : await updateExportTemplate(templateDraft!);
      setTemplate(saved);
      setTemplateDraft(null);
      setTemplateSaved(true);
    } catch (cause) {
      setTemplateError(runtimeErrorMessage(cause, c.templateSaveFailed));
    } finally {
      setTemplateBusy(false);
    }
  }

  function exit(action: "back" | "folder") {
    if (busy) return;
    if (aiDraft || templateDraft || profileDirty) setLeave(action);
    else if (action === "folder") onChooseFolder();
    else onBack();
  }

  function discardAndLeave() {
    setAiDraft(null);
    setTemplateDraft(null);
    setProfileResetKey(value => value + 1);
    setProfileDirty(false);
    setLeave(null);
    if (leave === "folder") onChooseFolder();
    else onBack();
  }

  return <ProtonWorkspaceMode title={c.title} sections={sections} selected={section}
    busy={busy} onSelect={setSection} onBack={() => exit("back")}>
    {language === "en" && <p className="mb-3 text-xs text-ink-secondary">{c.partialEnglish}</p>}
    {section === "appearance" && <WorkspaceAppearanceForm {...appearance} />}
    {section === "drive" && <div className="proton-settings-section">
      {accounts.length ? <>
        {accounts.length > 1 && <label className="grid gap-1 text-sm">{c.account}
          <select className="ui-field" value={selectedAccountId}
            disabled={busy || folderPickerOpen} onChange={event => onChooseAccount(event.target.value)}>
            {accounts.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}
          </select>
        </label>}
        <Button variant="primary" disabled={busy || folderPickerOpen}
          onClick={() => exit("folder")}>{c.chooseFolder}</Button>
      </> : <p className="text-sm text-ink-secondary">{c.signInHelp}</p>}
    </div>}
    {editingAi && <div className="proton-settings-editor settings-surface">
      {section === "ai" && <details className="mb-4 rounded-xl border border-line bg-panel px-4 text-sm">
        <summary className="min-h-12 cursor-pointer py-3 font-semibold">{c.privacy}</summary>
        <div className="space-y-2 pb-4 text-ink-secondary">
          <p>{c.providerHelp}</p>
          <p>{c.retentionHelp}</p>
          {onOpenAiHistory && <Button size="compact" className="mt-1" disabled={busy} onClick={onOpenAiHistory}>{c.openHistory}</Button>}
        </div>
      </details>}
      {settings.error && <InlineNotice tone="error" announce="alert">{settings.error}</InlineNotice>}
      {ai ? <>
        <div className="proton-settings-save">
          <Button variant="primary" disabled={!aiDraft || busy}
            onClick={() => { void saveAi(); }}>{c.save}</Button>
          {aiDraft && <StatusTag role="status" tone="warning" activity="waiting">{c.aiPending}</StatusTag>}
          {!aiDraft && aiSaved && <StatusTag role="status" tone="success">{c.aiSaved}</StatusTag>}
        </div>
        <fieldset className="min-w-0" disabled={busy}>
          <SettingsFormDepth english={language === "en"}>
            {section === "ai" ? <AiDocumentalSettings ai={ai} text={text} embedded
              aiIndexStatus={null} aiIndexBusy={false} aiIndexError={null} onSecurityChanged={settings.refreshConfig}
              onAiChange={value => { setAiDraft(aiConfigValues(value)); setAiSaved(false); }}
              onSaveOpenAiKey={async key => { if (!await settings.saveKey(key)) throw new Error(c.keyFailed); }}
              onDeleteOpenAiKey={() => { void settings.removeKey(); }} />
              : <>
                <p className="mb-3 text-sm text-ink-secondary">{c.assetsHelp}</p>
                <CapabilitiesSettings ai={ai} text={text} embedded
                  onAiChange={value => { setAiDraft(aiConfigValues(value)); setAiSaved(false); }} />
              </>}
          </SettingsFormDepth>
        </fieldset>
      </> : settings.error
        ? <Button className="mt-3" onClick={settings.refreshConfig}>{c.retry}</Button>
        : <p role="status">{c.loadingAi}</p>}
    </div>}
    {section === "skills" && <div className="proton-settings-editor settings-surface"><AiSkillsSettings /></div>}
    {section === "export" && <div className="proton-settings-editor settings-surface">
      {templateError && <InlineNotice tone="error" announce="alert">{templateError}</InlineNotice>}
      {editedTemplate ? <>
        <div className="proton-settings-save">
          <Button variant="primary" disabled={!templateDraft || busy}
            onClick={() => { void saveTemplate(); }}>{c.saveTemplate}</Button>
          {templateDraft && <StatusTag role="status" tone="warning" activity="waiting">{c.templatePending}</StatusTag>}
          {!templateDraft && templateSaved && <StatusTag role="status" tone="success">{c.templateSaved}</StatusTag>}
        </div>
        <fieldset className="min-w-0" disabled={busy}>
          <SettingsFormDepth english={language === "en"}>
          <ExportSettings template={editedTemplate} templatePath={templatePath} text={text} embedded
            onExportTemplateChange={value => { setTemplateDraft(value); setTemplateSaved(false); }}
            onResetExportTemplate={() => { void saveTemplate(true); }} />
          </SettingsFormDepth>
        </fieldset>
      </> : templateError
        ? <Button className="mt-3" onClick={() => setTemplateRetry(value => value + 1)}>{c.retry}</Button>
        : <p role="status">{c.loadingTemplate}</p>}
    </div>}
    <div hidden={section !== "export"} className="proton-settings-editor settings-surface">
      <ProtonExportProfiles active={section === "export"} disabled={workspaceBusy || settings.busy || templateBusy || updater.busy}
        templatePending={Boolean(templateDraft)} resetKey={profileResetKey} onDirtyChange={setProfileDirty} onBusyChange={setProfileBusy} />
    </div>
    {section === "updates" && <ProtonUpdatesSection controller={updater} native={native}
      disabled={workspaceBusy || settings.busy || templateBusy || profileBusy} pendingSettings={pendingSettings} />}
    {section === "device" && <ProtonDeviceSettings native={native} />}
    {leave && <ModalFrame label={c.pendingTitle} onClose={() => setLeave(null)}>
      <section className="proton-confirm-dialog p-5">
        <DialogHeading title={c.pendingTitle} onClose={() => setLeave(null)} />
        <p className="mt-2 text-sm text-ink-secondary">{c.pendingHelp}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="danger" onClick={discardAndLeave}>{c.discard}</Button>
          <Button data-autofocus variant="primary" onClick={() => setLeave(null)}>{c.keepEditing}</Button>
        </div>
      </section>
    </ModalFrame>}
  </ProtonWorkspaceMode>;
}
