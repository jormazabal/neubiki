import { Send, Settings2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { saveOpenAiKey } from "../../lib/api/ai";
import { getApiErrorMessage } from "../../lib/api/client";
import { getAiConfig, updateAiConfig } from "../../lib/api/config";
import { requestProtonText } from "../../lib/api/protonText";
import type { AiConfigStatus } from "../../types/domain";
import type { ProtonTextResult } from "../../types/protonText";
import type { ProtonDocumentToolProps, ProtonToolEdit, ProtonToolTarget } from "../protonWorkspace/protonToolTypes";

const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-medium hover:bg-brand-hover disabled:opacity-50";
const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand-orange px-3 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50";
const input = "w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink-primary focus:border-brand-orange focus:outline-none";

const editLabels: Record<ProtonToolEdit["kind"], string> = {
  replace_document: "Reemplazar el documento",
  replace_range: "Reemplazar la selección",
  insert_at: "Insertar en la posición de origen",
};

function getEdit(result: ProtonTextResult, target: ProtonToolTarget): ProtonToolEdit | null {
  switch (result.kind) {
    case "replace_document":
      return { kind: result.kind, markdown: result.text };
    case "replace_range":
      if (target.selection && target.selection.to > target.selection.from && target.selection.markdown.trim()) {
        return { kind: result.kind, markdown: result.text };
      }
      return null;
    case "insert_at":
      return target.selection ? { kind: result.kind, markdown: result.text } : null;
    default:
      return null;
  }
}

export function ProtonAssistant({ available, capture, apply }: ProtonDocumentToolProps) {
  const [prompt, setPrompt] = useState("");
  const [config, setConfig] = useState<AiConfigStatus | null>(null);
  const [settingsChoice, setSettingsChoice] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [requestError, setRequestError] = useState("");
  const [answer, setAnswer] = useState("");
  const [proposal, setProposal] = useState<{ target: ProtonToolTarget; edit: ProtonToolEdit } | null>(null);
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const settingsOpen = settingsChoice ?? Boolean((config && !config.openaiKeyConfigured) || settingsError);
  const promptId = useId();
  const sourceId = useId();

  useEffect(() => {
    let active = true;
    mounted.current = true;
    void getAiConfig().then(value => {
      if (active) {
        setConfig(value);
      }
    }, () => {
      if (active) {
        setSettingsError("No se pudieron consultar los ajustes de IA.");
      }
    });
    return () => {
      active = false;
      mounted.current = false;
      pending.current?.abort();
    };
  }, []);

  async function saveKey(event: FormEvent) {
    event.preventDefault();
    if (!key.trim() || settingsBusy) return;
    setSettingsBusy(true);
    setSettingsError("");
    try {
      const saved = await saveOpenAiKey(key.trim());
      if (mounted.current) {
        setKey("");
        if (!saved.configured) throw new Error("Unconfirmed credential");
        const latest = await getAiConfig();
        if (mounted.current) setConfig(latest);
      }
    } catch {
      if (mounted.current) setSettingsError("No se pudo confirmar la configuración de OpenAI. Consulta los ajustes antes de repetir.");
    } finally {
      if (mounted.current) setSettingsBusy(false);
    }
  }

  async function changePermission(permission: "editDocuments" | "generateImages", enabled: boolean) {
    setSettingsBusy(true);
    setSettingsError("");
    try {
      const { openaiKeyConfigured, openaiKeyPreview, credentialStorageError, credentialProtection, ...latest } = await getAiConfig();
      const updated = await updateAiConfig({ ...latest, permissions: { ...latest.permissions, [permission]: enabled } });
      if (mounted.current) setConfig(updated);
    } catch {
      if (mounted.current) setSettingsError("No se pudo confirmar el cambio de permiso.");
    } finally {
      if (mounted.current) setSettingsBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = prompt.trim();
    if (!available || !config?.openaiKeyConfigured || !text || pending.current || applying || settingsBusy) return;
    const target = capture();
    if (!target) {
      setRequestError("Abre un documento y espera a que esté disponible.");
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setRunning(true);
    setRequestError("");
    setAnswer("");
    setProposal(null);
    setStatus("");
    try {
      const selectedMarkdown = target.selection?.markdown.trim() ? target.selection.markdown : undefined;
      const reply = await requestProtonText({
        ...target.address,
        baseRevisionId: target.baseRevisionId,
        kind: "assistant",
        prompt: text,
        markdown: target.markdown,
        selectedMarkdown,
      }, controller.signal);
      if (controller.signal.aborted) return;
      if (typeof reply?.text !== "string" || !reply.text.trim()) {
        throw new Error("El asistente no devolvió ningún resultado válido.");
      }
      if (reply.kind === "answer") {
        setAnswer(reply.text);
        return;
      }
      const edit = getEdit(reply, target);
      if (!edit) throw new Error("La propuesta no corresponde a la selección o al cursor de origen.");
      setProposal({ target, edit });
    } catch (error) {
      if (!controller.signal.aborted) {
        setRequestError(getApiErrorMessage(error, "No se pudo completar la solicitud de IA."));
      }
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setRunning(false);
    }
  }

  async function applyProposal() {
    if (!available || !proposal || applying) return;
    setApplying(true);
    setRequestError("");
    try {
      const latest = await getAiConfig();
      if (!mounted.current) return;
      setConfig(latest);
      if (!latest.permissions.editDocuments) {
        setRequestError("Activa el permiso de edición de documentos en Ajustes de IA.");
      } else if (apply(proposal.target, proposal.edit)) {
        setProposal(null);
        setStatus("Propuesta aplicada al editor.");
      } else {
        setRequestError("El documento, la revisión o la selección cambió. Genera otra propuesta desde el contenido actual.");
      }
    } catch {
      if (mounted.current) setRequestError("No se pudo aplicar la propuesta al editor.");
    } finally {
      if (mounted.current) setApplying(false);
    }
  }

  return (
    <section aria-label="Asistente de IA" className="space-y-3 text-sm text-ink-primary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-secondary">Modo rápido</span>
        <button type="button" className={button} aria-expanded={settingsOpen} onClick={() => {
          setSettingsChoice(!settingsOpen);
          if (settingsOpen) setKey("");
        }}>
          <Settings2 size={16} aria-hidden /> Ajustes de IA
        </button>
      </div>
      {settingsOpen && (
        <div className="space-y-3 rounded-md border border-line p-3">
          <form className="flex flex-wrap items-end gap-2" onSubmit={saveKey}>
            <label className="min-w-36 flex-1 text-xs font-medium">
              Clave de OpenAI {config?.openaiKeyConfigured && <span className="text-ink-secondary">· Configurada</span>}
              <input className={`${input} mt-1 min-h-11`} type="password" autoComplete="off"
                value={key} onChange={event => setKey(event.target.value)} disabled={settingsBusy} />
            </label>
            <button type="submit" className={button} disabled={!key.trim() || settingsBusy}>
              Guardar clave
            </button>
          </form>
          {config && (
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" className="size-4 accent-brand-orange" disabled={settingsBusy || applying}
                checked={config.permissions.editDocuments} onChange={event => { void changePermission("editDocuments", event.target.checked); }} />
              Permitir propuestas de edición
            </label>
          )}
          {config && (
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" className="size-4 accent-brand-orange" disabled={settingsBusy}
                checked={config.permissions.generateImages} onChange={event => { void changePermission("generateImages", event.target.checked); }} />
              Permitir generar imágenes
            </label>
          )}
          {settingsError && <p role="alert" className="text-red-700">{settingsError}</p>}
        </div>
      )}
      <form className="space-y-2" onSubmit={submit}>
        <label htmlFor={promptId} className="font-medium">Pide ayuda con el documento</label>
        <div className="rounded-md border border-line bg-panel focus-within:border-brand-orange">
          <textarea id={promptId} aria-describedby={sourceId} rows={3}
            className="w-full resize-y rounded-md bg-transparent px-3 py-2 outline-none"
            value={prompt} onChange={event => setPrompt(event.target.value)} disabled={running || applying} />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <span id={sourceId} className="text-xs leading-4 text-ink-secondary">Se envían a OpenAI el documento activo y la selección, si la hay.</span>
            <button type="submit" className={primary} disabled={!available || !config?.openaiKeyConfigured || !prompt.trim() || running || applying || settingsBusy}>
              <Send size={15} aria-hidden /> Enviar
            </button>
          </div>
        </div>
      </form>
      {running && <p role="status" className="text-ink-secondary">Procesando solicitud…</p>}
      {requestError && <p role="alert" className="text-red-700">{requestError}</p>}
      {status && <p role="status" className="text-ink-secondary">{status}</p>}
      {answer && <p role="status" className="whitespace-pre-wrap break-words rounded-md bg-panel p-3">{answer}</p>}
      {proposal && (
        <div className="space-y-2 rounded-md border border-line p-3">
          <p className="font-medium">{editLabels[proposal.edit.kind]}</p>
          <pre aria-label="Vista previa de la propuesta" className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-panel p-2 text-sm">{proposal.edit.markdown}</pre>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={!available || applying || settingsBusy}
              onClick={() => { void applyProposal(); }}>Aplicar al editor</button>
            <button type="button" className={button} disabled={applying} onClick={() => { setProposal(null); setRequestError(""); }}>Descartar</button>
          </div>
        </div>
      )}
    </section>
  );
}
