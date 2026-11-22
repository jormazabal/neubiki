import { FileText } from "lucide-react";
import { useState, type ReactNode } from "react";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { ReadonlyMarkdownViewer } from "../editor/ReadonlyMarkdownViewer";
import { useProtonDocumentAiCopy } from "./protonDocumentAiCopy";
import type { ProtonToolEdit, ProtonToolTarget } from "../protonWorkspace/protonToolTypes";


const omitPreviewImage = () => "";

export function ProtonProposalReview({ title, target, kind, markdown, proposalLabel, actions }: {
  title: string;
  target: ProtonToolTarget;
  kind: ProtonToolEdit["kind"];
  markdown: string;
  proposalLabel: string;
  actions: ReactNode;
}) {
  const { comparison: c } = useProtonDocumentAiCopy();
  const versions = [{ value: "original", label: c.source }, { value: "proposal", label: c.proposal }] as const;
  const [view, setView] = useState<"original" | "proposal">("proposal");
  const original = kind === "replace_document" ? target.markdown : target.selection?.markdown;
  const scope = kind === "replace_document" ? c.whole : kind === "replace_range" ? c.selection : c.insertion;
  return <section className="proton-proposal">
    <h3>{title}</h3>
    <div className="proton-proposal-source">
      <FileText aria-hidden="true" size={16} />
      <div>{target.documentName && <strong>{target.documentName}</strong>}<span>{scope}</span></div>
    </div>
    <div className="proton-proposal-switch">
      <SegmentedControl label={c.label} options={versions} value={view} onChange={setView} />
    </div>
    <div className="proton-proposal-comparison" data-view={view}>
      <section className="proton-proposal-pane" data-version="original">
        <h4>{c.source}</h4>
        <div className="proton-proposal-content">{original
          ? <ReadonlyMarkdownViewer markdown={original} ariaLabel={c.originalContent}
            emptyMessage={c.empty} resolveImageSource={omitPreviewImage} />
          : <p className="text-ink-secondary">{kind === "insert_at" ? c.preserves : c.empty}</p>}</div>
      </section>
      <section className="proton-proposal-pane" data-version="proposal">
        <h4>{c.proposal}</h4>
        <div className="proton-proposal-content">
          <ReadonlyMarkdownViewer markdown={markdown} ariaLabel={proposalLabel} emptyMessage={c.proposalEmpty}
            resolveImageSource={omitPreviewImage} />
        </div>
      </section>
    </div>
    <div className="flex flex-wrap gap-2">{actions}</div>
  </section>;
}
