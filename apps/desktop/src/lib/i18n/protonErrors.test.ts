import { expect, it } from "vitest";
import { ApiError } from "../api/errors";
import { getProtonErrorMessage } from "./protonErrors";

it("localizes stable error codes and keeps an unknown remote detail out of the notice", () => {
  const readOnly = new ApiError(403, "Proton", "La carpeta es de solo lectura.", "not-started", "proton-workspace-read-only");
  expect(getProtonErrorMessage(readOnly, "Fallback", "en")).toBe("The current Proton folder is read-only.");
  expect(getProtonErrorMessage(readOnly, "Fallback", "es")).toBe("La carpeta actual de Proton es de solo lectura.");
  const external = new ApiError(409, "Proton", "Unknown response from remote file «Guía.md»", "unknown", "new-remote-code");
  expect(getProtonErrorMessage(external, "Fallback", "en")).toBe("The result is unconfirmed. Check its status before repeating the operation.");
  expect(external.detail).toBe("Unknown response from remote file «Guía.md»");
  expect(getProtonErrorMessage(new Error("Private provider detail"), "Could not read the file.", "en")).toBe("Could not read the file.");
});

it("shows the result check even when an ambiguous error also has a known code", () => {
  const failed = new ApiError(409, "Proton", "", "unknown", "runtime-transfer-failed");
  expect(getProtonErrorMessage(failed, "", "es")).toBe("No se confirmó el resultado. Comprueba su estado antes de repetir la operación.");
  expect(getProtonErrorMessage("Mensaje de un runtime anterior", "", "en")).toBe("Could not complete the operation.");
});
