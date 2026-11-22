import { Check, RotateCcw } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Button } from "../../components/ui/Button";
import { StatusTag } from "../../components/ui/StatusTag";
import { InlineNotice } from "../../components/patterns/InlineNotice";
import { workspacePalettes } from "../../lib/theme/workspacePalettes";
import { profilePreview } from "../../lib/theme/workspaceTheme";
import { appearanceProfiles, noteFonts, noteHeadingSizeLimits, noteLineHeights, workspaceColors, type NoteFont, type NoteLineHeight,
  type WorkspaceProfile } from "../../types/workspaceAppearance";
import type { WorkspaceAppearanceController } from "./useWorkspaceAppearance";
import { uiCopy } from "../../lib/i18n/uiCopy";

const profiles = Object.entries(appearanceProfiles) as [WorkspaceProfile, typeof appearanceProfiles[WorkspaceProfile]][];
const scales = Array.from({ length: 9 }, (_, i) => 85 + 5 * i);

export function WorkspaceAppearanceForm({ value, status, change, reset, retry }: WorkspaceAppearanceController) {
  const text = uiCopy[value.language].appearance;
  const editable = status !== "loading" && status !== "load-error";
  const message = status === "saving" ? text.saving : status === "saved" ? text.saved
    : status === "loading" ? text.loading : "";
  const failed = status === "error" || status === "load-error";
  const minimumHeadingSize = Math.max(noteHeadingSizeLimits.min, value.noteTextSize);

  return <div className="workspace-appearance-form">
    <div className="workspace-appearance-actions">
      <Button size="compact" disabled={!editable} onClick={reset}>
        <RotateCcw size={15} aria-hidden="true" /> {text.reset}
      </Button>
      <span role="status">{message && <StatusTag tone={status === "saved" ? "success" : "neutral"}
        data-saved={status === "saved" || undefined} activity={status === "saved" ? undefined : "working"}>{message}</StatusTag>}</span>
    </div>
    {failed && <InlineNotice tone="error" announce="alert"
      action={<Button size="compact" variant="quiet" onClick={retry}>{text.retry}</Button>}>
      {status === "error" ? text.saveFailed : text.readFailed}
    </InlineNotice>}
    <fieldset disabled={!editable} className="workspace-appearance-section">
      <legend>{text.profiles}</legend>
      <div className="workspace-profile-options">
        {profiles.map(([id]) => <label key={id} className="workspace-profile-option">
          <input type="radio" name="appearance-profile" checked={value.profile === id} aria-label={text.profileLabels[id]}
            onChange={() => change({ profile: id })} />
          <span className="workspace-profile-card">
            <span aria-hidden="true" className="workspace-profile-preview" style={profilePreview(id, value.primaryColor)}>
              <span><b>N</b><i /><i /></span><span><i /><i /><i /></span><span><i /><i /></span>
            </span>
            <span className="workspace-profile-title">{text.profileLabels[id]}</span>
            <small>{text.profileDescriptions[id]}</small>
            {value.profile === id && <Check size={17} className="workspace-profile-check" aria-hidden="true" />}
          </span>
        </label>)}
      </div>
    </fieldset>
    <fieldset disabled={!editable} className="workspace-appearance-section">
      <legend>{text.interface}</legend>
      <Row label={text.language} description={text.languageHelp}>
        <select aria-label={text.language} value={value.language} onChange={event => change({language:event.target.value === "en" ? "en" : "es"})}>
          <option value="es" lang="es">Español</option><option value="en" lang="en">English</option>
        </select>
      </Row>
      <Row label={text.scale}>
        <select aria-label={text.scale} value={value.zoomPercent} onChange={e => change({ zoomPercent: Number(e.target.value) })}>
          {scales.map(scale => <option key={scale} value={scale}>{scale} %</option>)}
        </select>
      </Row>
      <Row label={text.color} description={text.colorHelp}>
        <div className="workspace-color-options" role="group" aria-label={text.color}>
          {workspaceColors.map(color => {
            const palette = workspacePalettes[color];
            return <label key={color} title={text.colors[color]} className="workspace-color-option">
              <input type="radio" name="appearance-color" aria-label={text.colors[color]} checked={value.primaryColor === color}
                onChange={() => change({ primaryColor: color })} />
              <span style={{ "--swatch": palette.swatch, "--swatch-mark": palette.mark } as CSSProperties}>
                {value.primaryColor === color && <Check size={20} aria-hidden="true" />}
              </span>
            </label>;
          })}
          <span className="workspace-color-name">{text.colors[value.primaryColor]}</span>
        </div>
      </Row>
    </fieldset>
    <fieldset disabled={!editable} className="workspace-appearance-section">
      <legend>{text.notes}</legend>
      <Row label={text.font}>
        <select aria-label={text.font} value={value.noteFont} onChange={e => change({ noteFont: e.target.value as NoteFont })}>
          {Object.entries(noteFonts).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </Row>
      <Row label={text.bodySize}>
        <SizeSelect label={text.bodySize} min={12} max={28} value={value.noteTextSize}
          onChange={size => change({ noteTextSize: size })} />
      </Row>
      <Row label={text.headingSize} description={text.headingHelp}>
        <SizeSelect label={text.headingSize} min={minimumHeadingSize} max={noteHeadingSizeLimits.max}
          value={Math.max(value.noteHeadingSizePx, minimumHeadingSize)} onChange={size => change({ noteHeadingSizePx: size })} />
      </Row>
      <Row label={text.lineHeight}>
        <select aria-label={text.lineHeight} value={value.noteLineHeight} onChange={e => change({ noteLineHeight: Number(e.target.value) as NoteLineHeight })}>
          {noteLineHeights.map(height => <option key={height} value={height}>{height.toLocaleString(value.language)}</option>)}
        </select>
      </Row>
    </fieldset>
  </div>;
}

function Row({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return <div className="workspace-appearance-row">
    <div><strong>{label}</strong>{description && <small>{description}</small>}</div>
    {children}
  </div>;
}

function SizeSelect({ label, min, max, value, onChange }: {
  label: string; min: number; max: number; value: number; onChange: (value: number) => void;
}) {
  return <select aria-label={label} value={value} onChange={e => onChange(Number(e.target.value))}>
    {Array.from({ length: max - min + 1 }, (_, i) => min + i).map(size => <option key={size} value={size}>{size} px</option>)}
  </select>;
}
