import { useState } from "react";
import type { HandwrittenNoteContent } from "../../types/domain";
import type { HandwrittenPageFocus } from "../../types/localSearch";
import { HandwrittenEditor } from "../handwritten/HandwrittenEditor";
import { DEFAULT_ERASER_CONFIG } from "../handwritten/handwrittenModel";
import { ProtonPageAiDialog, type ProtonNoteAiController } from "./ProtonPageAiDialog";
import type { ProtonNoteAiKind } from "../../lib/api/protonNoteAi";

export function ProtonHandwrittenEditor({ note, name, onChange, edited, pageFocus, onPageFocusHandled, aiController }: {
  note: HandwrittenNoteContent;
  name: string;
  onChange: (note: HandwrittenNoteContent) => void;
  edited: boolean;
  pageFocus?: HandwrittenPageFocus | null;
  onPageFocusHandled?: (id: number) => void;
  aiController: ProtonNoteAiController;
}) {
  const [eraser, setEraser] = useState(DEFAULT_ERASER_CONFIG);
  const [ai, setAi] = useState<{ kind: ProtonNoteAiKind; pageId: string; pageNumber: number } | null>(null);
  return <><HandwrittenEditor noteId={note.id} name={name} content={note} toolPresets={note.toolPresets}
    eraserConfig={eraser} isDirty={edited} saveState="idle" onChange={onChange}
    pageFocus={pageFocus} onPageFocusHandled={onPageFocusHandled}
    onToolPresetsChange={toolPresets => onChange({ ...note, toolPresets, updatedAt: new Date().toISOString() })}
    onEraserConfigChange={setEraser} onPageAi={(kind, pageId, pageNumber) => setAi({ kind, pageId, pageNumber })} />
    {ai && <ProtonPageAiDialog {...ai} controller={aiController} onClose={() => setAi(null)} />}
  </>;
}
