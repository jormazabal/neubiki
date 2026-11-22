import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyReleaseAssets } from "./verify-release-assets.mjs";

test("release verification binds both manifests to the exact platform assets", async t => {
  const directory = await mkdtemp(join(tmpdir(), "neubiki-release-check-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repository = "example/neubiki-downloads";
  const version = "0.8.0";
  const msi = `Neubiki_${version}_x64_en-US.msi`;
  const nsis = `Neubiki_${version}_x64-setup.exe`;
  const apk = `Neubiki-android-arm64-v${version}.apk`;
  const base = `https://github.com/${repository}/releases/download/v${version}/`;
  const apkContent = "example APK";
  const apkHash = createHash("sha256").update(apkContent).digest("hex");
  const windows = {
    version,
    platforms: {
      "windows-x86_64": { url: base + msi, signature: "msi signature" },
      "windows-x86_64-nsis": { url: base + nsis, signature: "nsis signature" },
    },
  };
  const android = {
    schemaVersion: 1,
    versionName: version,
    versionCode: 8000,
    applicationId: "io.github.jormazabal.neubiki.mobile",
    artifacts: [{ abi: "arm64-v8a", url: base + apk, fileName: apk, sha256: apkHash, size: apkContent.length }],
  };
  const files = {
    "latest.json": JSON.stringify(windows),
    "android-latest.json": JSON.stringify(android),
    [msi]: "MSI",
    [nsis]: "NSIS",
    [apk]: apkContent,
    [`${msi}.sig`]: "msi signature",
    [`${nsis}.sig`]: "nsis signature",
    "neubiki-proton-sources-windows.zip": "Windows sources",
    "neubiki-proton-android-sources.zip": "Android sources",
  };
  await Promise.all(Object.entries(files).map(([name, data]) => writeFile(join(directory, name), data)));
  const release = await verifyReleaseAssets(directory, repository, version);
  assert.equal(release.sha256[apk], apkHash);

  await writeFile(join(directory, apk), "incorrect APK");
  await assert.rejects(verifyReleaseAssets(directory, repository, version), /APK size or SHA-256/);
  await writeFile(join(directory, apk), apkContent);
  windows.platforms["windows-x86_64"].url = base + nsis;
  await writeFile(join(directory, "latest.json"), JSON.stringify(windows));
  await assert.rejects(verifyReleaseAssets(directory, repository, version), /target this release's MSI/);
});
