import { UiLocaleProvider } from "../../lib/i18n/UiLocale";
import { cleanup,fireEvent,render,screen } from "@testing-library/react";
import { afterEach,expect,it,vi } from "vitest";
import { ExportStatus } from "./ExportStatus";
afterEach(cleanup);
it("never announces a completed export while conversion or destination is pending",()=>{
  render(<ExportStatus progress="Note.md" saved={null} opening={false} onOpen={vi.fn()} onClose={vi.fn()}/>);
  expect(screen.getByRole("status")).toHaveTextContent("Preparando exportación");expect(screen.queryByText("Archivo exportado")).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"Abrir"})).not.toBeInTheDocument();
});
it("opens the confirmed result and keeps the filename available when truncated",()=>{
  const open=vi.fn(),close=vi.fn();render(<ExportStatus progress={null} saved={{exportId:"id",fileName:"Documento largo.pdf"}} opening={false} onOpen={open} onClose={close}/>);
  expect(screen.getByTitle("Documento largo.pdf")).toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:"Abrir"}));expect(open).toHaveBeenCalledOnce();fireEvent.click(screen.getByRole("button",{name:"Cerrar aviso de exportación"}));expect(close).toHaveBeenCalledOnce();
});

it("changes English status controls without translating the exported filename",()=>{
  const props={progress:null,saved:{exportId:"id",fileName:"Reunión.pdf"},opening:false,onOpen:vi.fn(),onClose:vi.fn()};
  const view=render(<UiLocaleProvider language="en"><ExportStatus {...props}/></UiLocaleProvider>);
  expect(screen.getByText("File exported")).toBeVisible();
  expect(screen.getByTitle("Reunión.pdf")).toBeVisible();
  expect(screen.getByRole("button",{name:"Open"})).toBeEnabled();
  expect(screen.getByRole("button",{name:"Close export notification"})).toBeVisible();
  view.rerender(<UiLocaleProvider language="es"><ExportStatus {...props}/></UiLocaleProvider>);
  expect(screen.getByText("Archivo exportado")).toBeVisible();
  expect(screen.getByTitle("Reunión.pdf")).toBeVisible();
});
