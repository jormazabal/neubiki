import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Brain, Download } from "lucide-react";
import { expect, it, vi } from "vitest";
import { ProtonWorkspaceMode } from "./ProtonWorkspaceMode";

it("encuentra el apartado por tema, limpia la búsqueda y abre el resultado desde el teclado", async () => {
  const onSelect = vi.fn();
  const onBack = vi.fn();
  render(<ProtonWorkspaceMode title="Configuración" selected="ai" sections={[
    { id: "ai", label: "Inteligencia artificial", icon: Brain, searchTopics: "retención" },
    { id: "export", label: "Exportación", icon: Download, searchTopics: "PDF márgenes" },
  ]} onSelect={onSelect} onBack={onBack}><p>Contenido</p></ProtonWorkspaceMode>);

  const input = screen.getByRole("searchbox", { name: "Buscar ajustes" });
  fireEvent.change(input, { target: { value: "sin resultado" } });
  expect(screen.getByRole("status")).toHaveTextContent("No hay apartados que coincidan");
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input).toHaveValue("");
  expect(onBack).not.toHaveBeenCalled();

  fireEvent.change(input, { target: { value: "pdf margenes" } });
  expect(screen.queryByRole("button", { name: "Inteligencia artificial" })).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("1 apartado encontrado");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input).toHaveValue("");
  expect(onSelect).toHaveBeenCalledWith("export");
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveFocus());
});
