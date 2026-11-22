import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/Button";
import { Switch } from "../../components/ui/Switch";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { deleteOpenAiKey, saveOpenAiKey } from "../../lib/api/ai";
import { getAiConfig, updateAiConfig } from "../../lib/api/config";
import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import type { AiConfig, AiConfigStatus } from "../../types/domain";

type Permission = "editDocuments" | "generateImages";

const settingsCopy = {
  es: {
    readFailed: "No se pudieron consultar los ajustes de IA.",
    keyFailed: "No se pudo confirmar la configuración de OpenAI. Consulta los ajustes antes de repetir.",
    permissionFailed: "No se pudo confirmar el cambio de permiso.",
    saveFailed: "No se pudo confirmar el guardado de los ajustes de IA.",
    removeFailed: "No se pudo confirmar que se retiró la clave.",
    key: "Clave de OpenAI", configured: "Configurada", saveKey: "Guardar clave",
    edit: "Permitir propuestas de edición", images: "Permitir generar imágenes",
  },
  en: {
    readFailed: "AI settings could not be loaded.",
    keyFailed: "OpenAI setup could not be confirmed. Check AI Settings before trying again.",
    permissionFailed: "The permission change could not be confirmed.",
    saveFailed: "Saving AI settings could not be confirmed.",
    removeFailed: "Removing the key could not be confirmed.",
    key: "OpenAI key", configured: "Configured", saveKey: "Save key",
    edit: "Allow editing proposals", images: "Allow image generation",
  },
};

export function aiConfigValues(config: AiConfigStatus): AiConfig {
  const { openaiKeyConfigured, openaiKeyPreview, credentialStorageError, credentialProtection, ...values } = config;
  return values;
}

export function useProtonAiSettings(revision = 0, onSaved?: () => void) {
  const copy = settingsCopy[useUiLocale()];
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const [config, setConfig] = useState<AiConfigStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<{ cause: unknown; fallback: keyof typeof copy } | null>(null);
  const error = issue ? runtimeErrorMessage(issue.cause, copy[issue.fallback]) : "";
  const mounted = useRef(false);
  const writing = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    void getAiConfig().then(value => {
      if (!current) return;
      setConfig(value);
      setIssue(null);
    }, cause => {
      if (current) setIssue({ cause, fallback: "readFailed" });
    });
    return () => { current = false; };
  }, [revision]);

  async function write(action: () => Promise<AiConfigStatus>, fallback: keyof typeof copy) {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setIssue(null);
    try {
      const latest = await action();
      onSaved?.();
      if (mounted.current) setConfig(latest);
      return true;
    } catch (cause) {
      if (mounted.current) setIssue({ cause, fallback });
      return false;
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const saveKey = (key: string) => write(async () => {
    const saved = await saveOpenAiKey(key);
    if (!saved.configured) throw new Error("Unconfirmed credential");
    return getAiConfig();
  }, "keyFailed");

  const changePermission = (permission: Permission, enabled: boolean) => write(async () => {
    const latest = aiConfigValues(await getAiConfig());
    return updateAiConfig({ ...latest, permissions: { ...latest.permissions, [permission]: enabled } });
  }, "permissionFailed");

  const saveConfig = (next: AiConfig) => write(() => updateAiConfig(next), "saveFailed");
  const removeKey = () => write(async () => {
    await deleteOpenAiKey();
    return getAiConfig();
  }, "removeFailed");
  const refreshConfig = () => {
    void getAiConfig().then(value => {
      setConfig(value);
      setIssue(null);
    }, cause => setIssue({ cause, fallback: "readFailed" }));
  };

  return { config, setConfig, busy, error, saveKey, changePermission, saveConfig, removeKey, refreshConfig };
}

export function ProtonAiSettingsForm({ settings, applying = false }: {
  settings: ReturnType<typeof useProtonAiSettings>;
  applying?: boolean;
}) {
  const copy = settingsCopy[useUiLocale()];
  const [key, setKey] = useState("");
  const { config, busy, error, saveKey, changePermission } = settings;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!key.trim() || busy) return;
    if (await saveKey(key.trim())) setKey("");
  }

  return <div className="space-y-2 text-sm">
    <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
      <label className="min-w-36 flex-1 text-xs font-medium">
        {copy.key} {config?.openaiKeyConfigured && <span className="text-ink-secondary">· {copy.configured}</span>}
        <input className="ui-field mt-1"
          type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} disabled={busy} />
      </label>
      <Button type="submit" disabled={!key.trim() || busy}>{copy.saveKey}</Button>
    </form>
    {config && <>
      <Switch disabled={busy || applying}
        checked={config.permissions.editDocuments} onChange={event => { void changePermission("editDocuments", event.target.checked); }}>
        {copy.edit}
      </Switch>
      <Switch disabled={busy}
        checked={Boolean(config.permissions.generateImages)} onChange={event => { void changePermission("generateImages", event.target.checked); }}>
        {copy.images}
      </Switch>
    </>}
    {error && <InlineNotice tone="error" announce="alert">{error}</InlineNotice>}
  </div>;
}
