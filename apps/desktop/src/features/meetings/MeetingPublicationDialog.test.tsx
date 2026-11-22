import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { checkMeetingPublication, publishMeeting, reviewMeetingPublication } from "../../lib/api/meetingPublication";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import { MeetingPublicationDialog } from "./MeetingPublicationDialog";

vi.mock("../../lib/api/meetingPublication", () => ({
  checkMeetingPublication: vi.fn(), publishMeeting: vi.fn(), reviewMeetingPublication: vi.fn(),
}));
vi.mock("../editor/ReadonlyMarkdownViewer", () => ({ ReadonlyMarkdownViewer: ({ markdown }: { markdown: string }) => <p>{markdown}</p> }));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("reviews before publishing and checks a lost acknowledgement without another upload", async () => {
  const workspace = { accountId: "account", root: { nodeId: "root", name: "Archivo", type: "folder" as const }, canWrite: true };
  const source = { sessionId: "meeting", title: "Reunión", sourceRevision: "source", summaryRevision: "summary" };
  const node = { nodeId: "published", name: "Reunión - resumen.md", type: "file" as const, revisionId: "revision" };
  const onPublished = vi.fn();
  vi.mocked(reviewMeetingPublication).mockResolvedValue({ state: "review", markdown: "Resumen aprobado", digest: "approved", partial: true });
  vi.mocked(publishMeeting).mockResolvedValue({ state: "unknown" });
  vi.mocked(checkMeetingPublication).mockResolvedValue({ state: "confirmed", node });

  render(<MeetingPublicationDialog source={source} workspace={workspace} onClose={vi.fn()} onPublished={onPublished} />);
  fireEvent.click(screen.getByRole("button", { name: "Revisar documento" }));
  expect(await screen.findByText("Resumen aprobado")).toBeVisible();
  expect(screen.getByText("El documento incluye solo los fragmentos confirmados.")).toBeVisible();
  expect(publishMeeting).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Publicar en Proton" }));
  const target = { accountId: "account", rootId: "root", parentId: "root", name: node.name,
    sessionId: source.sessionId, sourceRevision: source.sourceRevision, summaryRevision: source.summaryRevision };
  expect(publishMeeting).toHaveBeenCalledWith(target, "approved");
  fireEvent.click(await screen.findByRole("button", { name: "Comprobar publicación" }));
  expect(checkMeetingPublication).toHaveBeenCalledWith(target);
  fireEvent.click(await screen.findByRole("button", { name: "Abrir documento" }));
  expect(onPublished).toHaveBeenCalledWith(node, [workspace.root]);
  expect(publishMeeting).toHaveBeenCalledTimes(1);
});

it("uses the English transcript controls and checks the original target without publishing twice", async () => {
  const workspace = { accountId: "account", root: { nodeId: "root", name: "Archivo", type: "folder" as const }, canWrite: true };
  const source = { sessionId: "meeting", title: "Reunión semanal", sourceRevision: "source" };
  const node = { nodeId: "published", name: "Reunión semanal - transcript.md", type: "file" as const, revisionId: "r1" };
  const target = { accountId: "account", rootId: "root", parentId: "root", name: node.name,
    sessionId: source.sessionId, sourceRevision: source.sourceRevision, summaryRevision: undefined };
  vi.mocked(reviewMeetingPublication).mockResolvedValue({ state: "review", markdown: "Fragmento original", digest: "approved", partial: true });
  vi.mocked(publishMeeting).mockResolvedValue({ state: "unknown" });
  vi.mocked(checkMeetingPublication).mockResolvedValue({ state: "confirmed", node });

  render(<UiLocaleProvider language="en">
    <MeetingPublicationDialog source={source} workspace={workspace} onClose={vi.fn()} onPublished={vi.fn()} />
  </UiLocaleProvider>);
  expect(screen.getByRole("dialog", { name: "Publish transcript to Proton" })).toBeVisible();
  expect(screen.getByRole("textbox")).toHaveValue("Reunión semanal - transcript");
  expect(screen.getByText("Archivo")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Review document" }));
  expect(await screen.findByText("Fragmento original")).toBeVisible();
  expect(screen.getByText("The document includes only confirmed excerpts.")).toBeVisible();
  expect(reviewMeetingPublication).toHaveBeenCalledWith(target);
  expect(publishMeeting).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Publish to Proton" }));
  fireEvent.click(await screen.findByRole("button", { name: "Check publication" }));
  expect(await screen.findByText("Document saved in Proton.")).toHaveAttribute("role", "status");
  expect(checkMeetingPublication).toHaveBeenCalledWith(target);
  expect(publishMeeting).toHaveBeenCalledWith(target, "approved");
  expect(publishMeeting).toHaveBeenCalledTimes(1);
});
