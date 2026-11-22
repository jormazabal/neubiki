const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--android-only")) {
  throw new Error("Usage: node scripts/check-release-secrets.mjs [--android-only]");
}
const windowsSecrets = [
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
];
const androidSecrets = [
  "ANDROID_KEYSTORE_PASSWORD",
  "ANDROID_KEY_ALIAS",
  "ANDROID_KEY_PASSWORD",
];

const hasAndroidKeystore =
  Boolean(process.env.ANDROID_KEYSTORE_PATH?.trim()) ||
  Boolean(process.env.ANDROID_KEYSTORE_BASE64?.trim());

const requiredSecrets = args.length ? androidSecrets : [...windowsSecrets, ...androidSecrets];
const missing = requiredSecrets.filter((name) => !process.env[name]?.trim());
if (!hasAndroidKeystore) {
  missing.push("ANDROID_KEYSTORE_PATH or ANDROID_KEYSTORE_BASE64");
}

if (missing.length > 0) {
  console.error("Release signing preflight failed. Missing required signing inputs:");
  for (const name of missing) console.error(`- ${name}`);
  process.exit(1);
}

console.log("Release signing preflight passed.");
