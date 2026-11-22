import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { listProtonIncomingReferences } from "../../lib/api/protonReferences";
import { ProtonReferencesTool } from "./ProtonReferencesTool";

vi.mock("../../lib/api/protonReferences", () => ({ listProtonIncomingReferences: vi.fn(), listProtonReferences: vi.fn() }));

it("consulta enlaces entrantes por acción explícita y muestra su alcance parcial", async () => {
  const source = { nodeId: "source", name: "Origen.md", type: "file" as const, revisionId: "source~rev" };
  vi.mocked(listProtonIncomingReferences).mockResolvedValue({ revisionId: "target~rev", references: [{
    node: source, parents: [{ nodeId: "root", name: "Proyecto", type: "folder" }], revisionId: "source~rev", line: 4,
  }], partial: true, scannedDocuments: 16, scannedFolders: 2 });
  const onOpen = vi.fn();
  render(<ProtonReferencesTool address={{ accountId: "account", rootId: "root", nodeId: "target" }} revisionId="target~rev" connected onOpen={onOpen} />);
  expect(listProtonIncomingReferences).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Buscar enlaces entrantes" }));
  expect(await screen.findByText(/La consulta es parcial/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Origen.md/ }));
  expect(onOpen).toHaveBeenCalledWith(source, { revisionId: "source~rev", line: 4 });
});
