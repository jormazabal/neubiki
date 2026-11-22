import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,within} from "@testing-library/react";
import {UiLocaleProvider} from "../../lib/i18n/UiLocale";
import {HandwrittenEditor} from "./HandwrittenEditor";
import {createDefaultHandwrittenContent,DEFAULT_ERASER_CONFIG} from "./handwrittenModel";

afterEach(()=>{
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("localizes the handwritten editor controls while preserving saved pen names and selections",()=>{
  vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue(null);
  vi.stubGlobal("ResizeObserver",class {
    observe(){}
    disconnect(){}
  });
  const note=createDefaultHandwrittenContent("note","Nota guardada");
  note.toolPresets[0].label="Tinta personal";
  note.ocr.textByPage["page-1"]="Transcripción guardada";
  const change=vi.fn();
  const editor=<HandwrittenEditor noteId={note.id} name={note.title} content={note} toolPresets={note.toolPresets}
    eraserConfig={DEFAULT_ERASER_CONFIG} isDirty={false} saveState="idle" onChange={change}
    onToolPresetsChange={change} onEraserConfigChange={change}/>;
  const view=render(<UiLocaleProvider language="en">{editor}</UiLocaleProvider>);
  const pages=screen.getByRole("button",{name:"Show pages"});
  fireEvent.click(pages);
  const list=screen.getByRole("region",{name:"Note pages"});
  expect(pages).toHaveAttribute("aria-expanded","true");
  expect(within(list).getByRole("button",{name:"Page 1"})).toHaveAttribute("aria-current","page");
  fireEvent.click(within(list).getByRole("button",{name:"Close pages"}));
  fireEvent.click(screen.getByRole("button",{name:"Zoom settings"}));
  expect(screen.getByRole("slider",{name:"Zoom level"})).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"Close zoom settings"}));
  fireEvent.click(screen.getByRole("button",{name:"Page text"}));
  const transcription=screen.getByRole("dialog",{name:"Page text"});
  expect(within(transcription).getByRole("textbox",{name:"Reviewed transcription"})).toHaveValue("Transcripción guardada");
  expect(within(transcription).getByRole("button",{name:"Apply text to note"})).toBeEnabled();
  fireEvent.click(within(transcription).getByRole("button",{name:"Cancel"}));
  fireEvent.doubleClick(screen.getByRole("button",{name:"Tinta personal"}));
  expect(screen.getByRole("textbox",{name:"Pen name"})).toHaveValue("Tinta personal");
  expect(screen.getByRole("button",{name:"Fountain pen"})).toBeVisible();
  view.rerender(<UiLocaleProvider language="es">{editor}</UiLocaleProvider>);
  expect(screen.getByRole("textbox",{name:"Nombre del lápiz"})).toHaveValue("Tinta personal");
  expect(screen.getByRole("button",{name:"Pluma"})).toBeVisible();
  expect(change).not.toHaveBeenCalled();
});
