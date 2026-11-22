import { describe, expect, it } from "vitest";
import { relativeAssetPath } from "./protonImages";

describe("Proton image paths", () => {
  it("decodes relative path segments without altering the Markdown reference", () => {
    expect(relativeAssetPath("../figuras/foto%20de%20prueba.png?rev=1#x")).toBe("../figuras/foto de prueba.png");
  });
  it("does not dereference external, absolute or ambiguous paths", () => {
    for (const source of ["https://example.invalid/asset", "//example.invalid/asset", "/asset.png", "a%2Ffile.png", "a%5Cfile.png", "D:\\asset.png", "bad%BB.png"]) {
      expect(relativeAssetPath(source)).toBeNull();
    }
  });
});
