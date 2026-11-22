import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { releaseChannel } from "./release-channel.mjs";

const [directory, ...extra] = process.argv.slice(2);
if (!directory || extra.length) {
  throw new Error("Usage: node scripts/create-windows-update-manifest.mjs <directory>");
}
const repository = process.env.NEUBIKI_RELEASE_REPOSITORY;
releaseChannel(repository);
const version = (await readFile("VERSION", "utf8")).trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Expected a stable VERSION.");

const base = `https://github.com/${repository}/releases/download/v${version}/`;
const msi = await updateEntry(`Neubiki_${version}_x64_en-US.msi`);
const nsis = await updateEntry(`Neubiki_${version}_x64-setup.exe`);
const manifest = {
  version,
  notes: (await readFile(`docs/releases/${version}.md`, "utf8")).trim(),
  pub_date: new Date().toISOString(),
  platforms: { "windows-x86_64": msi, "windows-x86_64-msi": msi, "windows-x86_64-nsis": nsis },
};
await writeFile(join(directory, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");

async function updateEntry(filename) {
  await access(join(directory, filename));
  const signature = (await readFile(join(directory, `${filename}.sig`), "utf8")).trim();
  if (!signature) throw new Error(`The updater signature is empty for ${filename}.`);
  return { url: base + filename, signature };
}
