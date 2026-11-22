import { useUiLocale } from "../../lib/i18n/UiLocale";

export function AiHistoryRetentionOption({ checked, onChange, disabled, label }: {
  checked: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  const english = useUiLocale() === "en";
  const action = label ?? (english ? "Save the result" : "Guardar el resultado");
  return <label className="flex min-h-12 items-center gap-2 text-xs text-ink-secondary">
    <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
    {action} {english ? "in private history for 7 days" : "en el historial privado durante 7 días"}
  </label>;
}
