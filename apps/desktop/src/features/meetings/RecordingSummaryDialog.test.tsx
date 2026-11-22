import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { generateRecordingSummary, getRecordingSummary, saveRecordingSummary } from "../../lib/api/recordingSummaries";
import { recordingTranscript } from "../../lib/api/recordings";
import { getAiSkill } from "../../lib/api/skills";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import type { RecordingTranscript } from "../../types/recording";
import { RecordingSummaryDialog } from "./RecordingSummaryDialog";

vi.mock("../../lib/api/recordings", () => ({ recordingTranscript: vi.fn() }));
vi.mock("../../lib/api/skills", () => ({ getAiSkill: vi.fn() }));
vi.mock("../../lib/api/recordingSummaries", () => ({
  generateRecordingSummary: vi.fn(), getRecordingSummary: vi.fn(), saveRecordingSummary: vi.fn(),
}));
vi.mock("../editor/ReadonlyMarkdownViewer", () => ({ ReadonlyMarkdownViewer: ({ markdown }: { markdown: string }) => <p>{markdown}</p> }));

const date = "2026-11-16T09:30:00Z";
const source: RecordingTranscript = {
  schemaVersion: 1, sessionId: "meeting", revision: 2, sourceRevision: "source", title: "Reunión de prueba", createdAt: date,
  projectId: "neubiki-private-meetings", status: "attention", samples: 48000, sampleRate: 24000, audioAvailable: true,
  segments: [{ id: "fragment-1", start: 0, samples: 24000, text: "Se revisó el plan.", speaker: null, timing: "fragment" }],
  unconfirmedCount: 1, wordTimingAvailable: false, diarizationAvailable: false, readOnly: true, startsProvider: false, checkedAt: date,
};
const proposal = {
  sessionId: source.sessionId, sourceRevision: source.sourceRevision, skillId: "neubiki.meeting_summary", skillVersion: "1.0.0",
  mode: "minutes", markdown: "Se revisó el plan. [fragment-1]",
};
const previous = { ...proposal, schemaVersion: 1 as const, revision: "saved", savedAt: date };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(recordingTranscript).mockResolvedValue(source);
  vi.mocked(getRecordingSummary).mockResolvedValue(null);
  vi.mocked(getAiSkill).mockResolvedValue({ manifest: { modes: [
    { id: "summary", name: "Resumen ejecutivo", supportedActions: ["summarize_meeting"] },
    { id: "minutes", name: "Acta estructurada", supportedActions: ["summarize_meeting"] },
  ] } } as Awaited<ReturnType<typeof getAiSkill>>);
  vi.mocked(generateRecordingSummary).mockResolvedValue(proposal);
});
afterEach(cleanup);

it("confirms the text submission and saves only the reviewed Markdown", async () => {
  render(<RecordingSummaryDialog sessionId={source.sessionId} onClose={vi.fn()} />);
  expect(await screen.findByText(/Transcripción parcial/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Habilidad y formato"), { target: { value: "minutes" } });
  fireEvent.change(screen.getByLabelText("Indicaciones adicionales"), { target: { value: "  Destaca decisiones  " } });
  fireEvent.click(screen.getByRole("button", { name: "Generar resumen" }));
  expect(generateRecordingSummary).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Enviar texto" }));
  expect(generateRecordingSummary).toHaveBeenCalledWith("meeting", "source", "minutes", "Destaca decisiones");
  await screen.findByText(proposal.markdown);
  expect(saveRecordingSummary).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Editar"));
  const markdown = "Revisión del plan. [fragment-1]";
  fireEvent.change(screen.getByRole("textbox", { name: "Resumen en Markdown" }), { target: { value: markdown } });
  vi.mocked(saveRecordingSummary).mockResolvedValue({ ...previous, markdown });
  fireEvent.click(screen.getByRole("button", { name: "Guardar resumen" }));
  expect(saveRecordingSummary).toHaveBeenCalledWith({ ...proposal, markdown }, null);
  expect(await screen.findByText("Resumen guardado en este dispositivo.")).toBeInTheDocument();
});

it("keeps a prior summary consultable when the source changes", async () => {
  vi.mocked(getRecordingSummary).mockResolvedValue({ ...previous, sourceRevision: "prior" });
  render(<RecordingSummaryDialog sessionId={source.sessionId} onClose={vi.fn()} />);
  expect(await screen.findByText(/La transcripción cambió desde esta versión/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Guardar resumen" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Copiar resumen guardado" })).toBeEnabled();
  expect(generateRecordingSummary).not.toHaveBeenCalled();
});

it("uses English consent and review controls while preserving the source text and revision", async () => {
  render(<UiLocaleProvider language="en">
    <RecordingSummaryDialog sessionId={source.sessionId} onClose={vi.fn()} />
  </UiLocaleProvider>);
  expect(screen.getByRole("dialog", { name: "Meeting summary" })).toBeVisible();
  expect(await screen.findByText(source.title)).toBeVisible();
  expect(screen.getByText("Partial transcript. The summary uses confirmed excerpts.")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Skill and format"), { target: { value: "minutes" } });
  fireEvent.change(screen.getByLabelText("Additional instructions"), { target: { value: "Revisar decisiones" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate summary" }));
  expect(generateRecordingSummary).not.toHaveBeenCalled();
  expect(screen.getByText(/confirmed transcript text will be sent to OpenAI/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Send text" }));
  expect(await screen.findByText(proposal.markdown)).toBeVisible();
  expect(generateRecordingSummary).toHaveBeenCalledWith(source.sessionId, source.sourceRevision, "minutes", "Revisar decisiones");
  expect(saveRecordingSummary).not.toHaveBeenCalled();
});
