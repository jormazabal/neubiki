import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = readFileSync(join(repoRoot, "VERSION"), "utf8").trim();
const [receiptFlag, receiptPath, ...extraArgs] = process.argv.slice(2);
if (receiptFlag && (receiptFlag !== "--native-receipt" || !receiptPath || extraArgs.length)) {
  throw new Error("Usage: pnpm android:build:release [--native-receipt <path>]");
}
const sdkRoot = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk");
const ndkHome = process.env.NDK_HOME ?? join(sdkRoot, "ndk", "28.2.13676358");
const javaHome = process.env.JAVA_HOME ?? "C:\\Program Files\\Android\\Android Studio\\jbr";
const abi = process.env.NEUBIKI_ANDROID_ABI ?? "arm64";
const androidApiLevel = process.env.NEUBIKI_ANDROID_API_LEVEL ?? "29";
if (androidApiLevel !== "29") throw new Error("The Android release must target API 29, matching the minimum SDK.");
const llvmBin = join(ndkHome, "toolchains", "llvm", "prebuilt", process.platform === "win32" ? "windows-x86_64" : "linux-x86_64", "bin");
const commandExtension = process.platform === "win32" ? ".cmd" : "";

const targets = {
  arm64: {
    manifestAbi: "arm64-v8a",
    rustTarget: "aarch64-linux-android",
    linker: `aarch64-linux-android${androidApiLevel}-clang${commandExtension}`,
    jniFolder: "arm64-v8a",
    gradleTask: ":app:assembleArm64Release",
    apkPath: ["arm64", "release", "app-arm64-release.apk"],
    outputName: `Neubiki-android-arm64-v${version}.apk`,
  },
};

const target = targets[abi];
if (!target) {
  throw new Error(`Unsupported NEUBIKI_ANDROID_ABI=${abi}. Use one of: ${Object.keys(targets).join(", ")}`);
}

assertAndroidSigningEnvironment();
if(!existsSync(javaHome)||!existsSync(sdkRoot))throw new Error("JAVA_HOME and ANDROID_HOME must identify the release toolchains.");

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
env[`CC_${target.rustTarget.replaceAll("-","_")}`]=join(llvmBin,target.linker);
env[`AR_${target.rustTarget.replaceAll("-","_")}`]=join(llvmBin,process.platform==="win32"?"llvm-ar.exe":"llvm-ar");

console.log(`Neubiki Android release build`);
console.log(`Version: ${version}`);
console.log(`ABI: ${abi}`);

assertNoClientSecretEnvironment(env);
const python = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const releaseDirectory = join(repoRoot, "output", `release-${version}`, "android");
const nativeReceipt = receiptPath
  ? resolve(receiptPath)
  : join(releaseDirectory, "proton", "android-native.json");
if (!receiptPath) {
  run(process.execPath, ["scripts/prepare-proton-android.mjs", "--abi", target.manifestAbi], repoRoot, env);
}
const nativeResources = join(repoRoot, "apps/desktop/src-tauri/resources/proton");
run(python, [
  "scripts/check-android-release.py",
  "--native-dir", join(nativeResources, "android", target.manifestAbi),
  "--notices-dir", join(nativeResources, "android-notices"),
  "--native-receipt", nativeReceipt,
], repoRoot, env);
run("pnpm", ["build"], repoRoot, env);
run("node", ["scripts/check-client-bundle-clean.mjs", "apps/desktop/dist"], repoRoot, env);
run(
  "cargo",
  ["build", "--locked", "--lib", "--target", target.rustTarget, "--features", "custom-protocol", "--release"],
  join(repoRoot, "apps", "desktop", "src-tauri"),
  env,
);

const targetDirectory = process.env.CARGO_TARGET_DIR
  ? resolve(repoRoot, "apps/desktop/src-tauri", process.env.CARGO_TARGET_DIR)
  : join(repoRoot, "apps/desktop/src-tauri/target");
const sourceLibrary = join(targetDirectory, target.rustTarget, "release", `lib${appLibrary}.so`);
const jniDir = join(repoRoot, "apps", "desktop", "src-tauri", "gen", "android", "app", "src", "main", "jniLibs", target.jniFolder);
const jniLibrary = join(jniDir, `lib${appLibrary}.so`);
mkdirSync(jniDir, { recursive: true });
const previousJni=existsSync(jniLibrary)?readFileSync(jniLibrary):null;
copyFileSync(sourceLibrary, jniLibrary);
try {
  run(join(llvmBin, process.platform === "win32" ? "llvm-strip.exe" : "llvm-strip"), ["--strip-unneeded", jniLibrary], repoRoot, env);
  const gradleWrapper = join(repoRoot, "apps", "desktop", "src-tauri", "gen", "android", process.platform === "win32" ? "gradlew.bat" : "gradlew");
  if (process.platform !== "win32") chmodSync(gradleWrapper, 0o755);
  run(
    process.platform === "win32" ? "gradlew.bat" : "./gradlew",
    [target.gradleTask, "-x", target.gradleTask.replace("assemble", "rustBuild"), "--no-daemon"],
    join(repoRoot, "apps", "desktop", "src-tauri", "gen", "android"),
    env,
  );

  const apk = join(repoRoot, "apps", "desktop", "src-tauri", "gen", "android", "app", "build", "outputs", "apk", ...target.apkPath);
  const metadata=JSON.parse(readFileSync(join(dirname(apk),"output-metadata.json"),"utf8"));
  if(metadata.applicationId!==applicationId||metadata.variantName.toLowerCase().includes("debug"))throw new Error("Refusing non-production Android package.");
  run(python, [
    "scripts/check-android-release.py", "--apk", apk, "--native-receipt", nativeReceipt,
    "--app-library", jniLibrary, "--version", version, "--build-tools", join(sdkRoot, "build-tools", "36.0.0"),
    "--out", join(releaseDirectory, "packaging.json"),
  ], repoRoot, env);
  const output = join(repoRoot, "output", target.outputName);
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(apk, output);
  console.log(`APK: ${output}`);
} finally {
  if(previousJni===null)rmSync(jniLibrary, { force: true });
  else writeFileSync(jniLibrary,previousJni);
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

function assertAndroidSigningEnvironment() {
  const required = ["ANDROID_KEYSTORE_PATH", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"];
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Android release builds require signing environment variables: ${missing.join(", ")}`);
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
