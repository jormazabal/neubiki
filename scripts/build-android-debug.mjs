import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sdkRoot = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk");
const ndkHome = process.env.NDK_HOME ?? join(sdkRoot, "ndk", "28.2.13676358");
const javaHome = process.env.JAVA_HOME ?? "C:\\Program Files\\Android\\Android Studio\\jbr";
const abi = process.env.NEUBIKI_ANDROID_ABI ?? "arm64";
const qaBuild = process.env.NEUBIKI_ANDROID_QA === "1";
const androidApiLevel = process.env.NEUBIKI_ANDROID_API_LEVEL ?? "29";
const llvmBin = join(ndkHome, "toolchains", "llvm", "prebuilt", process.platform === "win32" ? "windows-x86_64" : "linux-x86_64", "bin");
const commandExtension = process.platform === "win32" ? ".cmd" : "";

const targets = {
  arm64: {
    rustTarget: "aarch64-linux-android",
    linker: `aarch64-linux-android${androidApiLevel}-clang${commandExtension}`,
    jniFolder: "arm64-v8a",
    gradleTask: ":app:assembleArm64Debug",
    apkPath: ["arm64", "debug", "app-arm64-debug.apk"],
    outputName: "Neubiki-android-arm64-debug.apk",
  },
  x86_64: {
    rustTarget: "x86_64-linux-android",
    linker: `x86_64-linux-android${androidApiLevel}-clang${commandExtension}`,
    jniFolder: "x86_64",
    gradleTask: ":app:assembleX86_64Debug",
    apkPath: ["x86_64", "debug", "app-x86_64-debug.apk"],
    outputName: "Neubiki-android-x86_64-debug.apk",
  },
};

const target = targets[abi];
if (!target) {
  throw new Error(`Unsupported NEUBIKI_ANDROID_ABI=${abi}. Use one of: ${Object.keys(targets).join(", ")}`);
}
const tauriRoot = join(repoRoot, "apps", "desktop", "src-tauri");
const androidProject = join(tauriRoot, "gen", "android");
const applicationId = JSON.parse(readFileSync(join(tauriRoot, "tauri.android.conf.json"), "utf8")).identifier;
const appLibrary = "neubiki_desktop_lib";
const kotlinOutput = join(androidProject, "app", "src", "main", "java", ...applicationId.split("."), "generated");
mkdirSync(kotlinOutput, { recursive: true });

const env = {
  ...process.env,
  WRY_ANDROID_PACKAGE: applicationId,
  WRY_ANDROID_LIBRARY: appLibrary,
  WRY_ANDROID_KOTLIN_FILES_OUT_DIR: kotlinOutput,
  JAVA_HOME: javaHome,
  ANDROID_HOME: sdkRoot,
  NDK_HOME: ndkHome,
  PATH: [
    join(javaHome, "bin"),
    join(sdkRoot, "cmdline-tools", "latest", "bin"),
    join(sdkRoot, "platform-tools"),
    llvmBin,
    process.env.PATH ?? "",
  ].join(delimiter),
};

env[`CARGO_TARGET_${target.rustTarget.toUpperCase().replaceAll("-", "_")}_LINKER`] = join(llvmBin, target.linker);

console.log(`Neubiki Android debug build`);
console.log(`ABI: ${abi}`);
console.log("Runtime: local Tauri/Rust (no external product service)");

assertNoClientSecretEnvironment(env);
run("pnpm", ["build"], repoRoot, env);
run("node", ["scripts/check-client-bundle-clean.mjs", "apps/desktop/dist"], repoRoot, env);
run(
  "cargo",
  ["build", "--target", target.rustTarget, "--features", "custom-protocol"],
  join(repoRoot, "apps", "desktop", "src-tauri"),
  env,
);

const sourceLibrary = join(repoRoot, "apps", "desktop", "src-tauri", "target", target.rustTarget, "debug", `lib${appLibrary}.so`);
const jniDir = join(repoRoot, "apps", "desktop", "src-tauri", "gen", "android", "app", "src", "main", "jniLibs", target.jniFolder);
const jniLibrary = join(jniDir, `lib${appLibrary}.so`);
mkdirSync(jniDir, { recursive: true });
copyFileSync(sourceLibrary, jniLibrary);

try {
  const gradleWrapper = join(repoRoot, "apps", "desktop", "src-tauri", "gen", "android", process.platform === "win32" ? "gradlew.bat" : "gradlew");
  if (process.platform !== "win32") chmodSync(gradleWrapper, 0o755);
  run(
    process.platform === "win32" ? "gradlew.bat" : "./gradlew",
    [target.gradleTask, "-x", target.gradleTask.replace("assemble", "rustBuild"), ...(qaBuild ? ["-PneubikiQa=true"] : [])],
    join(repoRoot, "apps", "desktop", "src-tauri", "gen", "android"),
    env,
  );

  const apk = join(repoRoot, "apps", "desktop", "src-tauri", "gen", "android", "app", "build", "outputs", "apk", ...target.apkPath);
  const metadata = JSON.parse(readFileSync(join(dirname(apk), "output-metadata.json"), "utf8"));
  const expectedPackage = qaBuild ? `${applicationId}.v3qa` : applicationId;
  if (metadata.applicationId !== expectedPackage) throw new Error(`Refusing to copy APK with unexpected package: ${metadata.applicationId}`);
  const output = join(repoRoot, "output", qaBuild ? target.outputName.replace(".apk", "-qa.apk") : target.outputName);
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(apk, output);
  console.log(`APK: ${output}`);
} finally {
  rmSync(jniLibrary, { force: true });
}
function run(command, args, cwd, env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    shell: process.platform === "win32" && (command === "pnpm" || command.endsWith(".bat")),
    stdio: "inherit",
  });
  if (result.status !== 0) {
    const reason = result.error?.message ?? result.signal ?? result.status;
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${reason}`);
  }
}

function assertNoClientSecretEnvironment(env) {
  const unsafeKeys = Object.keys(env).filter((key) => {
    const normalized = key.toUpperCase();
    return normalized.startsWith("VITE_OPENAI") || (normalized.startsWith("VITE_") && normalized.includes("API_KEY"));
  });
  if (unsafeKeys.length > 0) {
    throw new Error(`Refusing to build Android with client-exposed secret variables: ${unsafeKeys.join(", ")}`);
  }

  for (const [key, value] of Object.entries(env)) {
    if (!key.toUpperCase().startsWith("VITE_") || typeof value !== "string") continue;
    if (/sk-[A-Za-z0-9_-]{20,}/.test(value)) {
      throw new Error(`Refusing to build Android because ${key} looks like an OpenAI API key.`);
    }
  }
}
