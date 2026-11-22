import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownSourceViewer, formatMarkdownSourceForDisplay } from "./MarkdownSourceViewer";

it("focuses an exact physical source line without compacting blank list lines", () => {
  const source = "- Uno\n\n- Dos\n\n[Destino](archivo.md)\n";
  const { container } = render(<MarkdownSourceViewer markdown={source} zoomPercent={100} lineNumber={5} />);
  expect(container.querySelector("code")?.textContent).toBe(source);
  expect(screen.getByLabelText("Línea 5")).toHaveTextContent("[Destino](archivo.md)");
  expect(screen.getByLabelText("Línea 5")).toHaveFocus();
});

describe("formatMarkdownSourceForDisplay", () => {
  it("compacts redundant blank lines between consecutive simple bullet items", () => {
    expect(formatMarkdownSourceForDisplay("- Uno\n\n- Dos\n\n- Tres")).toBe("- Uno\n- Dos\n- Tres");
  });

  it("compacts ordered and checklist items at the same nesting level", () => {
    expect(formatMarkdownSourceForDisplay("1. Uno\n\n2. Dos\n\n- [ ] Pendiente\n\n- [x] Hecho")).toBe("1. Uno\n2. Dos\n- [ ] Pendiente\n- [x] Hecho");
  });

  it("keeps meaningful loose-list spacing when an item contains a continuation paragraph", () => {
    const markdown = "- Uno\n\n  Explicacion adicional.\n\n- Dos";

    expect(formatMarkdownSourceForDisplay(markdown)).toBe(markdown);
  });
});
