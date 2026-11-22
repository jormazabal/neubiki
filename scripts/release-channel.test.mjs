import assert from "node:assert/strict";
import test from "node:test";
import { releaseChannel } from "./release-channel.mjs";

test("Windows and Android use separate manifests in one Neubiki release channel", () => {
  const channel = releaseChannel("example/Neubiki-downloads");
  assert.equal(channel.owner, "example");
  assert.equal(channel.name, "Neubiki-downloads");
  assert.deepEqual(channel.windows.plugins.updater.endpoints, [
    "https://github.com/example/Neubiki-downloads/releases/latest/download/latest.json",
  ]);
  assert.equal(channel.androidManifest,
    "https://github.com/example/Neubiki-downloads/releases/latest/download/android-latest.json");
});

test("channel configuration rejects an absent, untrusted, or ambiguous destination", () => {
  for (const target of [undefined, "", "https://github.com/org/repo", "org/repo?x", "org/..", "org/repo\nx=y", "org/repo/other"]) {
    assert.throws(() => releaseChannel(target), /owner\/name/);
  }
});
