import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseChannel } from "./release-channel.mjs";

export async function verifyReleaseAssets(directory, repository, version, apkReceiptPath) {
  releaseChannel(repository);
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error("Expected a stable VERSION.");
  const [major, minor, patch] = version.split(".").map(Number);
  const versionCode = major * 1_000_000 + minor * 1_000 + patch;
  const base = `https://github.com/${repository}/releases/download/v${version}/`;
  const msi = `Neubiki_${version}_x64_en-US.msi`;
  const nsis = `Neubiki_${version}_x64-setup.exe`;
  const apk = `Neubiki-android-arm64-v${version}.apk`;
  const windows = JSON.parse(await readFile(join(directory, "latest.json"), "utf8"));
  const android = JSON.parse(await readFile(join(directory, "android-latest.json"), "utf8"));

  const x64 = windows.platforms?.["windows-x86_64"];
  const [msiSignature, nsisSignature] = await Promise.all(
    [msi, nsis].map(name => readFile(join(directory, `${name}.sig`), "utf8").then(value => value.trim())),
  );
  if (windows.version !== version || x64?.url !== base + msi ||
      !msiSignature || !nsisSignature || x64.signature?.trim() !== msiSignature) {
    throw new Error("The Windows manifest must target this release's MSI and its exact Tauri signature.");
  }
  for (const [platform, entry] of Object.entries(windows.platforms)) {
    if (platform === "windows-x86_64") continue;
    const files = { "windows-x86_64-msi": [msi, msiSignature], "windows-x86_64-nsis": [nsis, nsisSignature] };
    const asset = Object.hasOwn(files, platform) ? files[platform] : undefined;
    if (!asset || entry?.url !== base + asset[0] || entry.signature?.trim() !== asset[1]) {
      throw new Error(`Unexpected Windows update entry: ${platform}.`);
    }
  }

  const [artifact] = android.artifacts ?? [];
  if (android.schemaVersion !== 1 || android.applicationId !== "io.github.jormazabal.neubiki.mobile" ||
      android.versionName !== version || android.versionCode !== versionCode || android.artifacts?.length !== 1 ||
      artifact?.abi !== "arm64-v8a" || artifact.fileName !== apk || artifact.url !== base + apk) {
    throw new Error("The Android manifest must target this release's Neubiki ARM64 APK and version code.");
  }

  const names = [msi, nsis, apk, "neubiki-proton-sources-windows.zip", "neubiki-proton-android-sources.zip"];
  const hashes = await Promise.all(names.map(async name => [name, await hashFile(join(directory, name))]));
  const sha256 = Object.fromEntries(hashes);
  if (artifact.sha256 !== sha256[apk] || artifact.size !== (await stat(join(directory, apk))).size) {
    throw new Error("The APK size or SHA-256 differs from the Android manifest.");
  }
  if (apkReceiptPath) {
    const receipt = JSON.parse(await readFile(apkReceiptPath, "utf8"));
    const baseline = JSON.parse(await readFile(new URL("./android-release-baseline.json", import.meta.url), "utf8"));
    if (receipt.validated !== true || receipt.apkSha256 !== sha256[apk] ||
        receipt.certificateSha256 !== baseline.certificateSha256 ||
        receipt.applicationId !== baseline.applicationId || receipt.versionCode !== versionCode ||
        receipt.minimumSdk !== baseline.minimumSdk || receipt.versionName !== version) {
      throw new Error("The downloaded APK differs from the signed and validated Android package.");
    }
  }
  return { version, repository, sha256 };
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, repository, version, apkReceiptPath, ...extra] = process.argv.slice(2);
  if (!directory || !repository || !version || extra.length) {
    throw new Error("Usage: node scripts/verify-release-assets.mjs <directory> <owner/repository> <version> [apk-receipt]");
  }
  console.log(JSON.stringify(await verifyReleaseAssets(directory, repository, version, apkReceiptPath), null, 2));
}
