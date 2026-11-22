import { useEffect, useMemo, useRef, useState } from "react";
import type { HandwrittenNoteContent } from "../../types/domain";
import type { ProtonNoteMergePlan } from "../../lib/api/protonRecovery";
import { composePageChoices, reviewPageChoices, type PageChoice } from "../handwritten/handwrittenMerge";
import { ProtonHandwrittenPreview } from "./ProtonHandwrittenPreview";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { useHandwrittenCopy } from "../../lib/i18n/handwrittenCopy";

export type ProtonNoteMergeSelection = { note: HandwrittenNoteContent; plan: ProtonNoteMergePlan };

export function ProtonHandwrittenMergeReview({ local, remote, disabled, onChange }: {
  local: HandwrittenNoteContent; remote: HandwrittenNoteContent; disabled: boolean;
  onChange: (value: ProtonNoteMergeSelection | null) => void;
}) {
  const c = useHandwrittenCopy().merge;
  const [general, setGeneral] = useState<"local" | "disk" | undefined>(undefined);
  const [choices, setChoices] = useState<Record<string, PageChoice>>({});
  const notify = useRef(onChange);
  notify.current = onChange;
  const review = useMemo(() => {
    try { return {rows:reviewPageChoices(local, remote),error:""}; }
    catch { return {rows:[],error:c.limit}; }
  }, [local, remote, c.limit]);
  const rows = review.rows;
  const selection = useMemo(() => {
    if (review.error) return null;
    const note = composePageChoices(local, remote, choices, general);
    return note && general ? { note, plan: { general: general === "disk" ? "remote" as const : "local" as const,
      choices: rows.filter(row => row.changed).map(row => ({ pageId: row.id,
        choice: choices[row.id] === "disk" ? "remote" as const : choices[row.id] as "local" | "both" })) } } : null;
  }, [local, remote, choices, general, rows, review.error]);
  useEffect(() => { notify.current(selection); }, [selection]);
  return <section className="space-y-3" aria-label={c.label}>
    <h3 className="text-sm font-semibold">{c.title}</h3>
    {review.error && <InlineNotice tone="warning" announce="alert">{review.error}</InlineNotice>}
    <p className="text-sm text-ink-secondary">{c.help}</p>
    <label className="grid gap-1 text-sm font-medium">{c.general}
      <select className="ui-field" disabled={disabled} value={general ?? ""} onChange={event => setGeneral(event.target.value === "disk" ? "disk" : "local")}>
        <option value="" disabled>{c.chooseVersion}</option><option value="local">{c.local}</option><option value="disk">{c.remote}</option>
      </select>
    </label>
    <ul className="max-h-72 space-y-3 overflow-y-auto rounded-xl border border-line p-3">
      {rows.map((row, index) => <li key={row.id} className="space-y-1">
        <p className="text-sm font-medium">{index + 1}. {row.local?.title || row.disk?.title || c.untitled}</p>
        {row.changed ? <label className="grid gap-1 text-sm">{c.keepPage.replace("{number}",String(index+1))}
          <select className="ui-field" disabled={disabled} value={choices[row.id] ?? ""}
            onChange={event => setChoices(previous => ({...previous, [row.id]:event.target.value as PageChoice}))}>
            <option value="" disabled>{c.chooseContent}</option>
            <option value="local">{row.local ? c.local : c.omitLocal}</option>
            <option value="disk">{row.disk ? c.remote : c.omitRemote}</option>
            {row.local && row.disk && <option value="both">{c.both}</option>}
          </select>
        </label> : <p className="text-xs text-ink-secondary">{c.same}</p>}
      </li>)}
    </ul>
    {selection ? <section className="h-80 overflow-auto rounded-xl border border-line" aria-label={c.preview}>
      <ProtonHandwrittenPreview note={selection.note} busy={disabled} onReload={() => undefined} />
    </section> : <p role="status" className="text-sm text-ink-secondary">{c.incomplete}</p>}
  </section>;
}
