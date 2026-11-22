import { ArrowLeft, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { matchesSettingsWords, ProtonSettingsSearch, settingsSearchWords } from "./ProtonSettingsSearch";
import { useUiCopy } from "../../lib/i18n/UiLocale";

type ModeSection<Id extends string> = { id: Id; label: string; icon: LucideIcon; searchTopics?: string };

export function ProtonWorkspaceMode<Id extends string>({
  title, sections, selected, busy = false, onSelect, onBack, children,
}: {
  title: string;
  sections: readonly ModeSection<Id>[];
  selected: Id;
  busy?: boolean;
  onSelect: (id: Id) => void;
  onBack: () => void;
  children: ReactNode;
}) {
  const text = useUiCopy().navigation;
  const [showSections, setShowSections] = useState(true);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const sectionNav = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const contentHeading = useRef<HTMLHeadingElement>(null);
  const selectedSection = sections.find(section => section.id === selected);
  const words = settingsSearchWords(query);
  const visibleSections = words.length ? sections.filter(section =>
    matchesSettingsWords(words, `${section.label} ${section.searchTopics ?? ""}`)) : sections;

  useEffect(() => { backButton.current?.focus(); }, []);
  useEffect(() => {
    if (window.innerWidth >= 768) return;
    if (showSections) sectionNav.current?.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus();
    else contentHeading.current?.focus();
  }, [showSections]);

  function activate(id: Id) {
    onSelect(id);
    setShowSections(false);
    if (query) {
      setQuery("");
      requestAnimationFrame(() => contentHeading.current?.focus());
    }
    if (content.current) content.current.scrollTop = 0;
  }

  return <div className="proton-workspace-grid proton-workspace-mode" data-mode-page={showSections ? "sections" : "content"}
    onKeyDown={event => {
      if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing || busy) return;
      event.preventDefault();
      if (query) {
        setQuery("");
        search.current?.focus();
      } else if (!showSections && window.innerWidth < 768) setShowSections(true);
      else onBack();
    }}>
    <aside className="proton-workspace-rail proton-mode-navigation" aria-label={title}>
      <button ref={backButton} className="proton-mode-back" type="button" disabled={busy} onClick={onBack}>
        <ArrowLeft size={17} /> {text.back}
      </button>
      <h2>{title}</h2>
      <ProtonSettingsSearch ref={search} value={query} onChange={setQuery} disabled={busy} resultCount={visibleSections.length}
        onResults={() => sectionNav.current?.querySelector<HTMLButtonElement>("button")?.focus()}
        onSubmit={() => {
          if (visibleSections.length === 1) activate(visibleSections[0].id);
          else sectionNav.current?.querySelector<HTMLButtonElement>("button")?.focus();
        }} />
      <nav ref={sectionNav} aria-label={text.sections.replace("{title}", title.toLowerCase())}>
        {visibleSections.map(({ id, label, icon: Icon }) => <button key={id} type="button" className="proton-tree-item"
          aria-current={id === selected ? "page" : undefined} disabled={busy} onClick={() => activate(id)}>
          <Icon size={17} aria-hidden="true" /> {label}
        </button>)}
      </nav>
    </aside>
    <main className="proton-mode-main" aria-label={selectedSection?.label ?? title}>
      <button className="proton-mode-sections" type="button" disabled={busy} onClick={() => setShowSections(true)}>
        <ArrowLeft size={17} /> {title}
      </button>
      <div className="proton-mode-content" ref={content}>
        <h1 ref={contentHeading} tabIndex={-1}>{selectedSection?.label ?? title}</h1>
        {children}
      </div>
    </main>
  </div>;
}
