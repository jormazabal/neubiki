import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProtonResearchDialog } from "./ProtonResearchDialog";
import { checkProtonResearch, removeProtonResearchReport, reviewProtonResearch, runProtonResearch } from "../../lib/api/protonResearch";
import { UiLocaleProvider } from "../../lib/i18n/UiLocale";

vi.mock("../../lib/api/protonResearch", () => ({
  checkProtonResearch: vi.fn(), removeProtonResearchReport: vi.fn(), reviewProtonResearch: vi.fn(), runProtonResearch: vi.fn(),
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("requires a matching estimate and sends the public question without active document content", async () => {
  const address = { accountId: "a", rootId: "r", nodeId: "n" };
  vi.mocked(reviewProtonResearch).mockResolvedValue({ quoteId: "quote", attemptId: "attempt", model: "text model", estimatedEur: .11, sourceLimit: 8 });
  vi.mocked(runProtonResearch).mockResolvedValue({
    report: "Informe revisable", limited: false, usageRecorded: true,
    sources: [{ title: "Fuente de la búsqueda", url: "https://example.test/story" }],
  });
  const target = { address, baseRevisionId: "r2", markdown: "Texto privado" };
  render(<ProtonResearchDialog target={target}
    initialQuestion="" onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Pregunta de investigación" }), { target: { value: "Pregunta pública" } });
  fireEvent.click(screen.getByRole("button", { name: "Revisar coste" }));
  const confirm = await screen.findByRole("button", { name: "Confirmar investigación" });
  expect(runProtonResearch).not.toHaveBeenCalled();
  fireEvent.click(confirm);
  expect(await screen.findByRole("region", { name: "Informe de investigación" })).toHaveTextContent("Informe revisable");
  expect(runProtonResearch).toHaveBeenCalledWith({ ...address, baseRevisionId: "r2", question: "Pregunta pública" }, {quoteId:"quote",attemptId:"attempt"});
  expect(screen.getByRole("link", { name: "Fuente de la búsqueda" })).toHaveAttribute("rel", "noopener noreferrer");
});

it("requires fresh cost review after explicit private-source consent and separates completed synthesis",async()=>{
  const address={accountId:"a",rootId:"r",nodeId:"n"};
  vi.mocked(reviewProtonResearch).mockResolvedValueOnce({quoteId:"public",attemptId:"first",model:"model",estimatedEur:.1,sourceLimit:8,synthesis:false})
    .mockResolvedValueOnce({quoteId:"combined",attemptId:"second",model:"model",estimatedEur:.2,sourceLimit:8,synthesis:true});
  vi.mocked(runProtonResearch).mockResolvedValue({report:"Informe público",sources:[{url:"https://example.test/public",title:"Cita pública"}],limited:false,usageRecorded:true,synthesis:"Síntesis privada conservada",synthesisStatus:"completed",sourceNames:["Notas privadas.md"]});
  render(<ProtonResearchDialog target={{address,baseRevisionId:"r2"}}
    initialQuestion="Pregunta pública" availableSources={[
      {nodeId:"source",revisionId:"source~rev",name:"Notas privadas.md",kind:"text"},
      {nodeId:"image",revisionId:"image~rev",name:"Imagen privada.png",kind:"image"},
    ]} onClose={vi.fn()}/>);
  const include=screen.getByRole("checkbox",{name:"Combinar el informe público con estas fuentes privadas"});
  expect(include).not.toBeChecked();expect(screen.getByText("Notas privadas.md")).toBeVisible();
  expect(screen.queryByText("Imagen privada.png")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Revisar coste"}));
  await screen.findByRole("button",{name:"Confirmar investigación"});
  expect(reviewProtonResearch).toHaveBeenLastCalledWith({...address,baseRevisionId:"r2",question:"Pregunta pública"});
  fireEvent.click(include);
  expect(screen.queryByRole("button",{name:"Confirmar investigación"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Revisar coste"}));
  fireEvent.click(await screen.findByRole("button",{name:"Confirmar investigación"}));
  expect(await screen.findByRole("region",{name:"Informe de investigación"})).toHaveTextContent("Informe público");
  expect(screen.getByRole("region",{name:"Síntesis con tus fuentes"})).toHaveTextContent("Síntesis privada conservada");
  expect(runProtonResearch).toHaveBeenCalledWith({...address,baseRevisionId:"r2",question:"Pregunta pública",sources:[{nodeId:"source",revisionId:"source~rev"}]},{quoteId:"combined",attemptId:"second"});
  expect(screen.getByRole("button",{name:"Copiar síntesis"})).toBeVisible();
});

it("retains the public report and citations when English synthesis is unconfirmed without replay",async()=>{
  vi.mocked(reviewProtonResearch).mockResolvedValue({quoteId:"quote",attemptId:"attempt",model:"model",estimatedEur:.2,sourceLimit:8,synthesis:true});
  vi.mocked(runProtonResearch).mockResolvedValue({report:"Original public report",sources:[{title:"Public citation",url:"https://example.test/public"}],limited:false,usageRecorded:true,synthesisStatus:"unconfirmed",sourceNames:["Notas.md"]});
  render(<UiLocaleProvider language="en"><ProtonResearchDialog target={{address:{accountId:"a",rootId:"r",nodeId:"n"},baseRevisionId:"r2"}}
    initialQuestion="Public question" availableSources={[{nodeId:"source",revisionId:"source~rev",name:"Notas.md",kind:"text"}]} onClose={vi.fn()}/></UiLocaleProvider>);
  fireEvent.click(screen.getByRole("checkbox",{name:"Combine the public report with these private sources"}));
  fireEvent.click(screen.getByRole("button",{name:"Review cost"}));
  fireEvent.click(await screen.findByRole("button",{name:"Confirm research"}));
  expect(await screen.findByRole("region",{name:"Research report"})).toHaveTextContent("Original public report");
  expect(screen.getByRole("link",{name:"Public citation"})).toBeVisible();
  expect(screen.getByText("The synthesis was not confirmed. The public report and citations are preserved and will not be repeated automatically.")).toBeVisible();
  expect(screen.queryByRole("button",{name:"Confirm research"})).toBeNull();
  expect(screen.queryByRole("button",{name:"Copy synthesis"})).toBeNull();
  expect(runProtonResearch).toHaveBeenCalledTimes(1);
});

it("refuses an estimate that does not confirm selected synthesis sources",async()=>{
  vi.mocked(reviewProtonResearch).mockResolvedValue({quoteId:"quote",attemptId:"attempt",model:"model",estimatedEur:.1,sourceLimit:8,synthesis:false});
  render(<ProtonResearchDialog target={{address:{accountId:"a",rootId:"r",nodeId:"n"},baseRevisionId:"r2"}}
    initialQuestion="Pregunta" availableSources={[{nodeId:"source",revisionId:"source~rev",name:"Notas.md",kind:"text"}]} onClose={vi.fn()}/>);
  fireEvent.click(screen.getByRole("checkbox",{name:"Combinar el informe público con estas fuentes privadas"}));
  fireEvent.click(screen.getByRole("button",{name:"Revisar coste"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("La estimación no confirma las fuentes elegidas");
  expect(screen.queryByRole("button",{name:"Confirmar investigación"})).toBeNull();
  expect(runProtonResearch).not.toHaveBeenCalled();
});

it("recovers the confirmed public report after the combined response is lost without repeating either stage", async () => {
  const address = { accountId: "a", rootId: "r", nodeId: "n" };
  vi.mocked(reviewProtonResearch).mockResolvedValue({ quoteId: "quote", attemptId: "attempt", model: "model", estimatedEur: .2, sourceLimit: 8, synthesis: true });
  vi.mocked(runProtonResearch).mockRejectedValue(new Error("Connection lost"));
  vi.mocked(checkProtonResearch).mockResolvedValue({ attempts: [{
    attemptId: "attempt", startedAt: 1760000000, webState: "completed", synthesisState: "started",
    webUsageRecorded: true, synthesisUsageRecorded: null, publicReportAvailable: true,
    publicReport: { report: "Public report restored", sources: [{ title: "Public citation", url: "https://example.test/report" }], limited: false, usageRecorded: true },
  }] });
  render(<UiLocaleProvider language="en"><ProtonResearchDialog target={{ address, baseRevisionId: "r2" }}
    initialQuestion="Public question" availableSources={[{ nodeId: "source", revisionId: "source~rev", name: "Private notes.md", kind: "text" }]} onClose={vi.fn()} /></UiLocaleProvider>);
  fireEvent.click(screen.getByRole("checkbox", { name: "Combine the public report with these private sources" }));
  const retain = screen.getByRole("checkbox", { name: "Keep the public report on this device for seven days" });
  expect(retain).not.toBeChecked();
  fireEvent.click(retain);
  fireEvent.click(screen.getByRole("button", { name: "Review cost" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm research" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The research could not be confirmed. Check usage before trying again.");
  fireEvent.click(screen.getByRole("button", { name: "Check this attempt" }));
  expect(await screen.findByRole("region", { name: "Research report" })).toHaveTextContent("Public report restored");
  expect(screen.getByRole("link", { name: "Public citation" })).toBeVisible();
  expect(screen.getByText("Status unknown")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Confirm research" })).toBeNull();
  expect(checkProtonResearch).toHaveBeenCalledWith(address, "attempt");
  expect(runProtonResearch).toHaveBeenCalledTimes(1);
  expect(runProtonResearch).toHaveBeenCalledWith(expect.objectContaining({ retainPublicReport: true }), { quoteId: "quote", attemptId: "attempt" });
});

it("opens a receipt for the current document without another review or provider call", async () => {
  const address = { accountId: "a", rootId: "r", nodeId: "n" };
  const receipt = { attemptId: "attempt", startedAt: 1760000000, webState: "completed", synthesisState: "notRequested", webUsageRecorded: false, synthesisUsageRecorded: null, publicReportAvailable: false } as const;
  vi.mocked(checkProtonResearch).mockResolvedValue({ attempts: [receipt] });
  render(<UiLocaleProvider language="en"><ProtonResearchDialog target={{ address, baseRevisionId: "r3" }}
    initialQuestion="" onClose={vi.fn()} /></UiLocaleProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Check recent attempts" }));
  fireEvent.click(await screen.findByRole("button", { name: /Report confirmed/ }));
  expect(await screen.findByText(/public report is unavailable on this device/i)).toBeVisible();
  expect(screen.getByText("Recording unconfirmed")).toBeVisible();
  expect(checkProtonResearch).toHaveBeenNthCalledWith(1, address, undefined);
  expect(checkProtonResearch).toHaveBeenNthCalledWith(2, address, "attempt");
  expect(reviewProtonResearch).not.toHaveBeenCalled();
  expect(runProtonResearch).not.toHaveBeenCalled();
});

it("asks for explicit confirmation before removing the local report and preserves the receipt", async () => {
  const address = { accountId: "a", rootId: "r", nodeId: "n" };
  const receipt = { attemptId: "attempt", startedAt: 1760000000, webState: "completed", synthesisState: "notRequested", webUsageRecorded: true, synthesisUsageRecorded: null, publicReportAvailable: true } as const;
  vi.mocked(checkProtonResearch).mockResolvedValueOnce({ attempts: [receipt] }).mockResolvedValueOnce({ attempts: [{ ...receipt,
    publicReport: { report: "Local report", sources: [{ title: "Citation", url: "https://example.test/report" }], limited: false, usageRecorded: true },
  }] });
  vi.mocked(removeProtonResearchReport).mockResolvedValue({ attempts: [{ ...receipt, publicReportAvailable: false }] });
  render(<UiLocaleProvider language="en"><ProtonResearchDialog target={{ address, baseRevisionId: "r3" }}
    canSubmit={false} initialQuestion="" onClose={vi.fn()} /></UiLocaleProvider>);

  fireEvent.click(screen.getByRole("button", { name: "Check recent attempts" }));
  fireEvent.click(await screen.findByRole("button", { name: /Report confirmed/ }));
  const remove = await screen.findByRole("button", { name: "Delete local copy…" });
  fireEvent.click(remove);
  expect(removeProtonResearchReport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("region", { name: "Research report" })).toHaveTextContent("Local report");
  fireEvent.click(screen.getByRole("button", { name: "Delete local copy…" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete report copy" }));
  expect(await screen.findByText("Copy removed from this device.")).toBeVisible();
  expect(screen.queryByRole("region", { name: "Research report" })).toBeNull();
  expect(screen.getByText("Recorded")).toBeVisible();
  expect(removeProtonResearchReport).toHaveBeenCalledTimes(1);
  expect(removeProtonResearchReport).toHaveBeenCalledWith(address, "attempt");
  expect(runProtonResearch).not.toHaveBeenCalled();
});
