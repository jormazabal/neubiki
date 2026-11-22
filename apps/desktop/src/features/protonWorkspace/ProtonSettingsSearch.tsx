import { forwardRef, useId } from "react";
import { Search, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { useUiCopy } from "../../lib/i18n/UiLocale";

export function settingsSearchWords(value: string) {
  return normalize(value).trim().split(/\s+/u).filter(Boolean);
}

export function matchesSettingsWords(words: string[], text: string) {
  const normalized = normalize(text);
  return words.every(word => normalized.includes(word));
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{Mark}/gu, "").toLowerCase();
}

export const ProtonSettingsSearch = forwardRef<HTMLInputElement, {
  value: string;
  onChange: (value: string) => void;
  onResults: () => void;
  onSubmit: () => void;
  resultCount: number;
  disabled?: boolean;
}>(function ProtonSettingsSearch({ value, onChange, onResults, onSubmit, resultCount, disabled }, ref) {
  const text = useUiCopy().search;
  const inputId = useId();
  const statusId = useId();
  return <div role="search" aria-label={text.label}>
    <label className="sr-only" htmlFor={inputId}>{text.field}</label>
    <div className="relative flex min-w-0 items-center">
      <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 text-ink-secondary" />
      <input ref={ref} className={`ui-field !pl-9 [&::-webkit-search-cancel-button]:appearance-none${value ? " !pr-11" : ""}`}
        id={inputId} type="search" value={value} maxLength={100} autoComplete="off" placeholder={text.field}
        aria-describedby={value.trim() ? statusId : undefined} disabled={disabled} onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (!value.trim() || !resultCount || event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "Enter") {
            event.preventDefault();
            if (event.key === "Enter") onSubmit();
            else onResults();
          }
        }} />
      {value && <Button variant="quiet" size="icon" className="absolute right-0" disabled={disabled} aria-label={text.clear}
        onClick={() => { onChange(""); document.getElementById(inputId)?.focus(); }}>
        <X size={16} aria-hidden="true" />
      </Button>}
    </div>
    {value.trim() && <p id={statusId} role="status" className="mt-2 px-2 text-xs text-[var(--proton-rail-muted)]">
      {resultCount === 0 ? text.none : resultCount === 1 ? text.one : text.many.replace("{count}",String(resultCount))}
    </p>}
  </div>;
});
