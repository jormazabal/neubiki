// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, test } from "vitest";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const visualLayers = {
  "components/ui": ["components/ui", "styles", "lib/theme"],
  "components/patterns": ["components/patterns", "components/ui", "styles", "lib/theme"],
};

function isSourceFile(entry) {
  return entry.isFile()
    && /\.[cm]?[jt]sx?$/.test(entry.name)
    && !/\.(test|spec)\./.test(entry.name);
}

function isAllowedImport(name, file, allowedLayers) {
  if (name.startsWith("@tauri-apps/")) return false;
  if (!name.startsWith(".")) return true;

  const target = relative(sourceRoot, resolve(dirname(file), name)).split(sep).join("/");
  return allowedLayers.some(layer => target === layer || target.startsWith(layer + "/"));
}

test("shared visual layers depend only on allowed source layers", () => {
  const violations = [];

  for (const [layer, allowedLayers] of Object.entries(visualLayers)) {
    const directory = join(sourceRoot, layer);
    if (layer === "components/patterns" && !existsSync(directory)) continue;

    const files = readdirSync(directory, { withFileTypes: true, recursive: true });
    for (const entry of files.filter(isSourceFile)) {
      const file = join(entry.parentPath, entry.name);
      const { importedFiles } = ts.preProcessFile(readFileSync(file, "utf8"), true, true);

      for (const { fileName } of importedFiles) {
        if (!isAllowedImport(fileName, file, allowedLayers)) {
          violations.push(`${relative(sourceRoot, file)} imports ${fileName}`);
        }
      }
    }
  }

  expect(violations).toEqual([]);
});
