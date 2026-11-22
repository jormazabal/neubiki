import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { generateProtonImage, uploadProtonImageContent } from "../../lib/api/protonImageAssets";
import { ProtonImagesTool } from "./ProtonImagesTool";
import type { ProtonToolTarget } from "./protonToolTypes";

vi.mock("../../lib/api/protonImageAssets", () => ({ generateProtonImage: vi.fn(), uploadProtonImageContent: vi.fn() }));

const target: ProtonToolTarget = {
  address: { accountId: "test", rootId: "folder", nodeId: "file" },
  baseRevisionId: "revision",
  editorKey: 1,
  draftGeneration: null,
  markdown: "# Informe",
  selection: null,
};
const path = `assets/neubiki-${"a".repeat(64)}.png`;

beforeEach(() => {
  vi.mocked(generateProtonImage).mockReset().mockResolvedValue({
    contentType: "image/png", contentBase64: "iVBORw0KGgo=", usageRecorded: true,
  });
  vi.mocked(uploadProtonImageContent).mockReset().mockResolvedValue(path);
});
afterEach(cleanup);

async function generate() {
  fireEvent.change(screen.getByRole("textbox", { name: "Describe la imagen" }), { target: { value: "Una gráfica abstracta" } });
  fireEvent.click(screen.getByRole("button", { name: "Generar imagen" }));
  await screen.findByRole("img", { name: "Vista previa de la imagen generada" });
}

it("conserva la vista previa si la subida falla y solo inserta tras confirmación de Proton", async () => {
  const apply = vi.fn().mockReturnValue(true);
  vi.mocked(uploadProtonImageContent).mockRejectedValueOnce(new Error("Sin conexión"));
  render(<ProtonImagesTool available capture={() => target} apply={apply} />);
  await generate();
  expect(generateProtonImage).toHaveBeenCalledWith(target.address, target.baseRevisionId, "Una gráfica abstracta");
  fireEvent.click(screen.getByRole("button", { name: "Subir e insertar" }));
  expect(await screen.findByText("Sin conexión")).toBeInTheDocument();
  expect(apply).not.toHaveBeenCalled();
  expect(screen.getByRole("img")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Subir e insertar" }));
  await waitFor(() => expect(apply).toHaveBeenCalledWith(target, { kind: "insert_at", markdown: `![Imagen generada](${path})` }));
  expect(generateProtonImage).toHaveBeenCalledTimes(1);
});

it("pide elegir el destino vigente si el editor cambió durante la generación", async () => {
  let current = target;
  const apply = vi.fn().mockReturnValue(true);
  render(<ProtonImagesTool available capture={() => current} apply={apply} />);
  await generate();
  current = { ...target, editorKey: 2, markdown: "# Otra versión" };
  fireEvent.click(screen.getByRole("button", { name: "Subir e insertar" }));
  expect(uploadProtonImageContent).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Insertar en el destino actual" }));
  await waitFor(() => expect(apply).toHaveBeenCalledWith(current, expect.objectContaining({ kind: "insert_at" })));
});
