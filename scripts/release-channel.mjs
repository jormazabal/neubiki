import { appendFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function releaseChannel(repository) {
  if (!/^[a-z\d](?:[a-z\d-]*[a-z\d])?\/[a-z\d_.-]+$/i.test(repository ?? "") ||
      repository.split("/").some(part => part === "." || part === "..")) {
    throw new Error("A Neubiki GitHub release repository (owner/name) is required.");
  }

  const [owner, name] = repository.split("/");
  const downloads = `https://github.com/${repository}/releases/latest/download`;
  return {
    owner,
    name,
    windows: {
      plugins: { updater: { endpoints: [`${downloads}/latest.json`] } },
    },
    androidManifest: `${downloads}/android-latest.json`,
  };
}

function main([platform, ...extra], env) {
  const channel = releaseChannel(env.NEUBIKI_RELEASE_REPOSITORY);
  if (extra.length || !["windows", "android"].includes(platform)) {
    throw new Error("Usage: node scripts/release-channel.mjs <windows|android>");
  }

  if (env.GITHUB_ENV) {
    const variables = platform === "windows"
      ? windowsWorkflowVariables(channel, env.RUNNER_TEMP)
      : { VITE_NEUBIKI_ANDROID_UPDATE_MANIFEST_URL: channel.androidManifest };
    const lines = Object.entries(variables).map(([name, value]) => `${name}=${value}`);
    appendFileSync(env.GITHUB_ENV, lines.join("\n") + "\n");
  } else {
    const value = platform === "windows" ? channel.windows : channel.androidManifest;
    console.log(typeof value === "string" ? value : JSON.stringify(value));
  }
}

function windowsWorkflowVariables(channel, directory) {
  const configPath = join(directory, "neubiki-release-tauri.json");
  writeFileSync(configPath, JSON.stringify({
    ...channel.windows,
    build: { beforeBuildCommand: "" },
  }) + "\n");
  return {
    NEUBIKI_RELEASE_OWNER: channel.owner,
    NEUBIKI_RELEASE_REPO: channel.name,
    NEUBIKI_WINDOWS_RELEASE_CONFIG_PATH: configPath,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2), process.env);
}
