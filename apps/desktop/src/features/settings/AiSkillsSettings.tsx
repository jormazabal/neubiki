import { useRuntimeErrorMessage } from "../../lib/i18n/protonErrors";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle, Check, FileText, ListFilter, Play, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { getAiSkill, listAiSkills, previewAiSkillSelection, validateAiSkill } from "../../lib/api/skills";
import { useUiLocale } from "../../lib/i18n/UiLocale";
import type {
  AiSkillApplication,
  AiSkillDetail,
  AiSkillDiagnostic,
  AiSkillMode,
  AiSkillSelectionPreview,
  AiSkillSummary,
  AiSkillValidationResponse,
  MermaidDiagramType,
} from "../../types/domain";
import { aiSkillsSettingsCopy } from "./aiSkillsSettingsCopy";

const tabs = ["summary", "modes", "instructions", "manifest", "examples", "diagnostics"] as const;
type DetailTab = typeof tabs[number];
type Issue = { part: keyof typeof aiSkillsSettingsCopy.es.errors; detail: string };

export function AiSkillsSettings() {
  const runtimeErrorMessage = useRuntimeErrorMessage();
  const language = useUiLocale();
  const copy = aiSkillsSettingsCopy[language];
  const detailsId = useId();
  const [skills, setSkills] = useState<AiSkillSummary[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<AiSkillDetail | null>(null);
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [runtime, setRuntime] = useState("all");
  const [detailTab, setDetailTab] = useState<DetailTab>("summary");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<Issue | null>(null);
  const [validation, setValidation] = useState<AiSkillValidationResponse | null>(null);
  const [validating, setValidating] = useState(false);
  const [previewInput, setPreviewPrompt] = useState<string>();
  const [previewAction, setPreviewAction] = useState("answer");
  const [preview, setPreview] = useState<AiSkillSelectionPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewPrompt = previewInput ?? copy.previewExample;
  const currentSkill = useRef(selectedSkillId);
  currentSkill.current = selectedSkillId;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listAiSkills()
      .then((response) => {
        if (cancelled) return;
        setSkills(response.skills);
        setSelectedSkillId((current) => current ?? response.skills[0]?.id ?? null);
        setError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setError({ part: "catalog", detail: runtimeErrorMessage(error, "") });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedSkillId) {
      setSelectedSkill(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setValidation(null);
    getAiSkill(selectedSkillId)
      .then((skill) => {
        if (cancelled) return;
        setSelectedSkill(skill);
        setDetailTab("summary");
        setError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setError({ part: "detail", detail: runtimeErrorMessage(error, "") });
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSkillId]);

  const categories = useMemo(() => {
    const values = new Set<string>();
    skills.forEach((skill) => skill.categories.forEach((item) => values.add(item)));
    return Array.from(values).sort((first, second) => first.localeCompare(second, language));
  }, [language, skills]);

  const filteredSkills = skills.filter((skill) => {
    if (category !== "all" && !skill.categories.includes(category)) return false;
    if (status !== "all" && skill.status !== status) return false;
    if (source !== "all" && skill.source !== source) return false;
    if (runtime === "enabled" && !skill.runtimeEnabled) return false;
    if (runtime === "visible" && skill.runtimeEnabled) return false;
    return true;
  });

  async function runValidation() {
    if (!selectedSkillId || selectedSkill?.id !== selectedSkillId || validating || detailLoading) return;
    setValidating(true);
    setError(null);
    try {
      const result = await validateAiSkill(selectedSkillId);
      if (currentSkill.current !== selectedSkillId) return;
      setValidation(result);
      setSelectedSkill((skill) => skill?.id === selectedSkillId ? { ...skill, diagnostics: result.diagnostics, status: result.status } : skill);
      setDetailTab("diagnostics");
    } catch (cause) {
      if (currentSkill.current === selectedSkillId) setError({ part: "validation", detail: runtimeErrorMessage(cause, "") });
    } finally {
      setValidating(false);
    }
  }

  async function runPreview() {
    setPreviewLoading(true);
    setError(null);
    try {
      const result = await previewAiSkillSelection({
        prompt: previewPrompt,
        expectedAction: previewAction,
      });
      setPreview(result);
    } catch (cause) {
      setError({ part: "preview", detail: runtimeErrorMessage(cause, "") });
    } finally {
      setPreviewLoading(false);
    }
  }

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    const next = event.key === "Home" ? 0 : event.key === "End" ? last
      : event.key === "ArrowLeft" ? (index + last) % tabs.length
      : event.key === "ArrowRight" ? (index + 1) % tabs.length : null;
    if (next === null) return;
    event.preventDefault();
    setDetailTab(tabs[next]);
    document.getElementById(`${detailsId}-${tabs[next]}`)?.focus();
  }

  return (
    <div className="grid min-h-[560px] gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-hidden rounded-md border border-line bg-panel/40">
        <div className="border-b border-line bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-brand-orange" />
            <h3 className="text-[14px] font-semibold text-ink-primary">{copy.title}</h3>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-ink-secondary">{copy.catalogHelp}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 border-b border-line bg-white px-3 py-3">
          <FilterSelect {...copy.filters.category} value={category} onChange={setCategory}
            options={[["all", copy.filters.category.all], ...categories.map((item) => [item, item] as [string, string])]} />
          <FilterSelect {...copy.filters.status} value={status} onChange={setStatus}
            options={(["all", "valid", "error", "draft"] as const).map(id => [id, copy.filters.status[id]])} />
          <FilterSelect {...copy.filters.source} value={source} onChange={setSource}
            options={(["all", "base", "user", "imported"] as const).map(id => [id, copy.filters.source[id]])} />
          <FilterSelect {...copy.filters.runtime} value={runtime} onChange={setRuntime}
            options={(["all", "enabled", "visible"] as const).map(id => [id, copy.filters.runtime[id]])} />
        </div>
        <div className="max-h-[390px] overflow-y-auto p-2">
          {loading ? (
            <p role="status" className="px-2 py-4 text-[11px] text-ink-secondary">{copy.loading}</p>
          ) : filteredSkills.length ? (
            filteredSkills.map((skill) => (
              <button
                key={skill.id}
                type="button"
                className={[
                  "mb-1 w-full rounded-md border px-3 py-2 text-left transition last:mb-0",
                  selectedSkillId === skill.id ? "border-brand-orange bg-brand-hover" : "border-line bg-white hover:bg-panel",
                ].join(" ")}
                onClick={() => setSelectedSkillId(skill.id)}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[11px] font-semibold text-ink-primary">{skill.name}</span>
                  <SkillBadge skill={skill} />
                </span>
                <span className="mt-1 block text-[10px] leading-4 text-ink-secondary">{skill.description}</span>
                <span className="mt-1 flex items-center justify-between text-[10px] text-ink-secondary">
                  <span>{copy.modesCount(skill.modes.length)}</span>
                  <span>{skill.runtimeEnabled ? copy.runtimeActive : copy.visible}</span>
                </span>
              </button>
            ))
          ) : (
            <p role="status" className="px-2 py-4 text-[11px] text-ink-secondary">{skills.length ? copy.filteredEmpty : copy.catalogEmpty}</p>
          )}
        </div>
      </aside>

      <section className="min-h-0 overflow-hidden rounded-md border border-line bg-white">
        {error ? (
          <div role="alert" className="m-4 rounded-md border border-orange-200 bg-brand-hover px-3 py-2 text-[11px] font-semibold text-brand-orange">
            {error.detail || copy.errors[error.part]}
          </div>
        ) : null}
        {selectedSkill ? (
          <div className="flex h-full min-h-0 flex-col">
            <header className="border-b border-line px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-[16px] font-semibold text-ink-primary">{selectedSkill.name}</h3>
                    <SkillBadge skill={selectedSkill} />
                    <span className="rounded bg-panel px-1.5 py-0.5 text-[9px] font-semibold uppercase text-ink-secondary">
                      {selectedSkill.visibility === "readonly" ? copy.readOnly : copy.editable}
                    </span>
                  </div>
                  <p className="mt-1 max-w-[760px] text-[11px] leading-5 text-ink-secondary">{selectedSkill.description}</p>
                </div>
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-[11px] font-semibold text-ink-primary hover:bg-brand-hover hover:text-brand-orange"
                  onClick={() => void runValidation()}
                  disabled={validating || detailLoading || selectedSkill.id !== selectedSkillId}
                >
                  <RefreshCw size={13} />
                  {validating ? copy.validating : copy.validate}
                </button>
              </div>
            </header>

            <div className="flex min-h-9 shrink-0 overflow-x-auto border-b border-line bg-white" role="tablist" aria-label={copy.detail}>
              {tabs.map((id, index) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`${detailsId}-${id}`}
                  aria-selected={detailTab === id}
                  aria-controls={`${detailsId}-panel`}
                  tabIndex={detailTab === id ? 0 : -1}
                  className={[
                    "relative shrink-0 border-r border-line px-3 text-[11px]",
                    detailTab === id ? "font-semibold text-ink-primary" : "text-ink-secondary hover:bg-panel hover:text-ink-primary",
                  ].join(" ")}
                  onClick={() => setDetailTab(id)}
                  onKeyDown={event => navigateTabs(event, index)}
                >
                  {copy.tabs[id]}
                  {detailTab === id ? <span className="absolute inset-x-0 bottom-0 h-[2px] bg-brand-orange" /> : null}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" role="tabpanel" id={`${detailsId}-panel`}
              tabIndex={0} aria-labelledby={`${detailsId}-${detailTab}`}>
              {detailLoading ? (
                <p role="status" className="text-[11px] text-ink-secondary">{copy.detailLoading}</p>
              ) : detailTab === "summary" ? (
                <div className="space-y-4">
                  <SkillSummaryPanel skill={selectedSkill} />
                  <SelectionPreviewPanel
                    prompt={previewPrompt}
                    action={previewAction}
                    preview={preview}
                    loading={previewLoading}
                    onPromptChange={setPreviewPrompt}
                    onActionChange={setPreviewAction}
                    onRun={() => void runPreview()}
                  />
                </div>
              ) : detailTab === "modes" ? (
                <ModesPanel modes={selectedSkill.modes} mermaidCatalog={selectedSkill.mermaidCatalog} />
              ) : detailTab === "instructions" ? (
                <ReadonlyCodeBlock label="SKILL.md" value={selectedSkill.instructionsMarkdown} />
              ) : detailTab === "manifest" ? (
                <ReadonlyCodeBlock label="manifest.json" value={selectedSkill.manifestJson} />
              ) : detailTab === "examples" ? (
                <SkillExamples examples={selectedSkill.examples} />
              ) : (
                <DiagnosticsPanel diagnostics={validation?.diagnostics ?? selectedSkill.diagnostics} />
              )}
            </div>
          </div>
        ) : (
          <div className="grid h-full min-h-[420px] place-items-center text-center text-[11px] text-ink-secondary">
            <div>
              <ListFilter size={28} className="mx-auto mb-2 text-brand-orange" />
              {copy.selectSkill}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function FilterSelect({ label, ariaLabel, value, options, onChange }: {
  label: string; ariaLabel: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void;
}) {
  return (
    <label className="block text-[10px] font-semibold uppercase text-ink-secondary">
      {label}
      <select
        aria-label={ariaLabel}
        className="mt-1 h-8 w-full rounded-md border border-line bg-white px-2 text-[11px] text-ink-primary outline-none focus:border-brand-orange"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([id, text]) => (
          <option key={id} value={id}>{text}</option>
        ))}
      </select>
    </label>
  );
}

function SkillSummaryPanel({ skill }: { skill: AiSkillDetail }) {
  const copy = aiSkillsSettingsCopy[useUiLocale()];
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <SummaryGroup title={copy.identity} rows={[
        ["ID", skill.id],
        [copy.version, skill.version],
        [copy.filters.source.label, skill.source === "base" ? copy.baseOrigin : copy.filters.source[skill.source]],
        [copy.visibility, skill.visibility === "readonly" ? copy.readOnly : copy.editable],
        [copy.filters.runtime.label, skill.runtimeEnabled ? copy.runtimeEnabled : copy.runtimeVisible],
      ]} />
      <SummaryGroup title={copy.capabilities} rows={[
        [copy.categories, skill.categories.join(", ")],
        [copy.capabilities, skill.capabilities.join(", ")],
        [copy.actions, skill.outputActions.join(", ")],
        [copy.modes, String(skill.modes.length)],
      ]} />
      {(skill.manifest.orchestratesSkills?.length || skill.manifest.auxiliarySkillCategories?.length || skill.manifest.requiredCapabilities?.length) ? (
        <SummaryGroup title={copy.coordination} rows={[
          [copy.auxiliaries, skill.manifest.orchestratesSkills?.join(", ") ?? ""],
          [copy.auxiliaryCategories, skill.manifest.auxiliarySkillCategories?.join(", ") ?? ""],
          [copy.requiredCapabilities, skill.manifest.requiredCapabilities?.join(", ") ?? ""],
        ]} />
      ) : null}
      {skill.source === "base" && <section className="rounded-md border border-line bg-panel/40 px-3 py-3 lg:col-span-2">
        <div className="flex items-start gap-2">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-brand-orange" />
          <p className="text-[11px] leading-5 text-ink-secondary">
            {copy.basePolicy}
          </p>
        </div>
      </section>}
    </div>
  );
}

function ModesPanel({ modes, mermaidCatalog }: { modes: AiSkillMode[]; mermaidCatalog: MermaidDiagramType[] }) {
  const copy = aiSkillsSettingsCopy[useUiLocale()];
  const families = useMemo(() => groupMermaidByFamily(mermaidCatalog), [mermaidCatalog]);
  return (
    <div className="space-y-4">
      {modes.length ? <div className="grid gap-3 lg:grid-cols-2">
        {modes.map((mode) => (
          <section key={mode.id} className="rounded-md border border-line bg-white">
            <div className="border-b border-line px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[11px] font-semibold text-ink-primary">{mode.name}</h4>
                <span className="rounded bg-panel px-1.5 py-0.5 text-[9px] font-semibold uppercase text-ink-secondary">{mode.riskLevel}</span>
              </div>
              <p className="mt-1 text-[10px] leading-4 text-ink-secondary">{mode.description}</p>
            </div>
            <div className="space-y-2 px-3 py-3 text-[10px] leading-4 text-ink-secondary">
              <ModeList title={copy.whenToUse} values={mode.whenToUse} />
              <ModeList title={copy.whenNotToUse} values={mode.whenNotToUse} />
              <p><span className="font-semibold text-ink-primary">{copy.actions}</span> · {mode.supportedActions.join(", ") || copy.unspecified}</p>
              <p><span className="font-semibold text-ink-primary">{copy.validators}</span> · {mode.validators.join(", ") || copy.unspecified}</p>
              <p><span className="font-semibold text-ink-primary">{copy.capabilities}</span> · {mode.requiresCapabilities.join(", ") || copy.unspecified}</p>
            </div>
          </section>
        ))}
      </div> : <p className="text-[11px] text-ink-secondary">{copy.noModes}</p>}
      {mermaidCatalog.length ? (
        <section className="rounded-md border border-line bg-panel/30 px-3 py-3">
          <h4 className="text-[11px] font-semibold text-ink-primary">{copy.supportedMermaid}</h4>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {Object.entries(families).map(([family, types]) => (
              <div key={family} className="rounded-md border border-line bg-white px-3 py-2">
                <h5 className="text-[10px] font-semibold uppercase text-ink-secondary">{family}</h5>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {types.map((type) => (
                    <span key={type.id} className="rounded border border-line bg-panel px-1.5 py-0.5 text-[10px] text-ink-secondary">
                      {type.id} · {type.maturity}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SelectionPreviewPanel({
  prompt,
  action,
  preview,
  loading,
  onPromptChange,
  onActionChange,
  onRun,
}: {
  prompt: string;
  action: string;
  preview: AiSkillSelectionPreview | null;
  loading: boolean;
  onPromptChange: (value: string) => void;
  onActionChange: (value: string) => void;
  onRun: () => void;
}) {
  const copy = aiSkillsSettingsCopy[useUiLocale()];
  return (
    <section className="rounded-md border border-line bg-white">
      <div className="border-b border-line px-3 py-2">
        <h4 className="text-[11px] font-semibold text-ink-primary">{copy.previewTitle}</h4>
        <p className="mt-1 text-[10px] text-ink-secondary">{copy.previewHelp}</p>
      </div>
      <div className="space-y-2 px-3 py-3">
        <textarea
          className="min-h-[72px] w-full rounded-md border border-line bg-white px-2 py-2 text-[11px] leading-5 text-ink-primary outline-none focus:border-brand-orange"
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          aria-label={copy.previewInput}
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-8 rounded-md border border-line bg-white px-2 text-[11px] text-ink-primary outline-none focus:border-brand-orange"
            value={action}
            onChange={(event) => onActionChange(event.target.value)}
            aria-label={copy.expectedAction}
          >
            {Object.entries(copy.previewActions).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand-orange px-3 text-[11px] font-semibold text-white hover:bg-brand-dark"
            onClick={onRun}
            disabled={loading || !prompt.trim()}
          >
            <Play size={13} />
            {loading ? copy.previewing : copy.runPreview}
          </button>
        </div>
        {preview ? (
          <div className="grid gap-2 pt-2 text-[10px] leading-4 text-ink-secondary lg:grid-cols-3">
            <PreviewColumn title={copy.candidates} values={preview.candidateSkills.map((skill) => skill.name)} />
            <PreviewColumn title={copy.applied} values={preview.applications.map(applicationLabel)} />
            <PreviewColumn title={copy.diagnostics} values={preview.diagnostics.slice(0, 4).map(diagnostic =>
              [diagnostic.title ?? diagnostic.message, diagnostic.modeId].filter(Boolean).join(" · "))} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PreviewColumn({ title, values }: { title: string; values: string[] }) {
  const copy = aiSkillsSettingsCopy[useUiLocale()];
  return (
    <div className="rounded-md border border-line bg-panel/30 px-2 py-2">
      <h5 className="font-semibold text-ink-primary">{title}</h5>
      {values.length ? values.map((value) => <p key={value} className="mt-1">{value}</p>) : <p className="mt-1">{copy.noData}</p>}
    </div>
  );
}

function ModeList({ title, values }: { title: string; values: string[] }) {
  const copy = aiSkillsSettingsCopy[useUiLocale()];
  return (
    <div>
      <p className="font-semibold text-ink-primary">{title}</p>
      {values.length ? values.map((value) => <p key={value}>- {value}</p>) : <p>{copy.unspecified}</p>}
    </div>
  );
}

function SummaryGroup({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  const copy = aiSkillsSettingsCopy[useUiLocale()];
  return (
    <section className="rounded-md border border-line bg-white">
      <h4 className="border-b border-line px-3 py-2 text-[11px] font-semibold text-ink-primary">{title}</h4>
      <dl className="divide-y divide-line">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 px-3 py-2 text-[11px]">
            <dt className="font-semibold text-ink-secondary">{label}</dt>
            <dd className="min-w-0 break-words text-ink-primary">{value || copy.unspecified}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ReadonlyCodeBlock({ label, value }: { label: string; value: string }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-ink-secondary">
        <FileText size={14} className="text-brand-orange" />
        {label}
      </div>
      <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-panel/50 p-3 font-mono text-[11px] leading-5 text-ink-primary">
        {value}
      </pre>
    </section>
  );
}

function SkillExamples({ examples }: { examples: AiSkillDetail["examples"] }) {
  const copy = aiSkillsSettingsCopy[useUiLocale()];
  if (!examples.length) {
    return <p className="text-[11px] text-ink-secondary">{copy.noExamples}</p>;
  }
  return (
    <div className="space-y-3">
      {examples.map((example) => (
        <ReadonlyCodeBlock key={example.name} label={example.name} value={example.markdown} />
      ))}
    </div>
  );
}

function DiagnosticsPanel({ diagnostics }: { diagnostics: AiSkillDiagnostic[] }) {
  const copy = aiSkillsSettingsCopy[useUiLocale()];
  if (!diagnostics.length) {
    return <p className="text-[11px] text-ink-secondary">{copy.noDiagnostics}</p>;
  }
  return (
    <div className="space-y-2">
      {diagnostics.map((diagnostic) => {
        const tone = diagnostic.severity === "error" || diagnostic.status === "error" ? "error" : diagnostic.severity === "warning" || diagnostic.status === "warning" || diagnostic.status === "rejected" ? "warning" : "success";
        return (
          <div
            key={`${diagnostic.skillId}-${diagnostic.status}-${diagnostic.title}-${diagnostic.modeId ?? ""}`}
            className={[
              "rounded-md border px-3 py-2 text-[11px] leading-5",
              tone === "error" ? "border-orange-200 bg-brand-hover text-brand-orange" : tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700",
            ].join(" ")}
          >
            <div className="flex items-center gap-2 font-semibold">
              {tone === "error" ? <AlertTriangle size={13} /> : <Check size={13} />}
              {diagnostic.title ?? diagnostic.message}
            </div>
            <p className="mt-1 font-mono text-[10px]">
              {diagnostic.skillId}{diagnostic.modeId ? ` / ${diagnostic.modeId}` : ""}{diagnostic.phase ? ` · ${diagnostic.phase}` : ""}
            </p>
            {diagnostic.validatorId ? <p className="mt-1">{copy.validator} · {diagnostic.validatorId}</p> : null}
            {(diagnostic.notes ?? []).map((note) => (
              <p key={note} className="mt-1">{note}</p>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function SkillBadge({ skill }: { skill: Pick<AiSkillSummary, "source" | "status" | "runtimeEnabled"> }) {
  const copy = aiSkillsSettingsCopy[useUiLocale()];
  const statusClass = skill.status === "error" ? "bg-brand-hover text-brand-orange" : skill.runtimeEnabled ? "bg-emerald-50 text-emerald-700" : "bg-panel text-ink-secondary";
  return (
    <span className={["shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase", statusClass].join(" ")}>
      {copy.filters.source[skill.source]}
    </span>
  );
}

function groupMermaidByFamily(catalog: MermaidDiagramType[]) {
  return catalog.reduce<Record<string, MermaidDiagramType[]>>((acc, item) => {
    acc[item.family] = acc[item.family] ?? [];
    acc[item.family].push(item);
    return acc;
  }, {});
}

function applicationLabel(application: AiSkillApplication) {
  return `${application.skillId.replace(/^neubiki\./, "")} / ${application.modeId}`;
}
