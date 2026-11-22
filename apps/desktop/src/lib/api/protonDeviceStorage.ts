import { requestJson } from "./client";

export type DeviceStorageFamily = { id: "proton-recovery" | "ai-history" | "recordings" } & (
  | { state: "complete" | "partial"; files: number; logicalBytes: number }
  | { state: "unavailable" }
);

export type ProtonDeviceStorage = {
  schemaVersion: 1;
  checkedAt: string;
  families: DeviceStorageFamily[];
};

const expectedFamilies = new Set(["proton-recovery", "ai-history", "recordings"]);

export async function getProtonDeviceStorage(signal?: AbortSignal) {
  const result = await requestJson<ProtonDeviceStorage>("/api/proton/device/storage", { signal });
  if (result?.schemaVersion !== 1 || !Number.isFinite(Date.parse(result.checkedAt)) || !Array.isArray(result.families)
    || result.families.length !== expectedFamilies.size || new Set(result.families.map(family => family?.id)).size !== expectedFamilies.size
    || result.families.some(family => !expectedFamilies.has(family?.id) || (family.state !== "unavailable" && (
      (family.state !== "complete" && family.state !== "partial")
      || !Number.isSafeInteger(family.files) || family.files < 0
      || !Number.isSafeInteger(family.logicalBytes) || family.logicalBytes < 0
    )))) throw new Error("Medición de almacenamiento incompatible.");
  return result;
}
