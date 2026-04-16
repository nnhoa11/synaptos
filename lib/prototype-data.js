import { getPrototypeMeta as getStoredPrototypeMeta } from "@/lib/server/prototype-store";

export async function getPrototypeDataset() {
  const { stores, snapshots, defaultSnapshot } = await getStoredPrototypeMeta();
  return {
    rows: [],
    stores,
    snapshots,
    defaultSnapshot,
  };
}

export async function getPrototypeMeta() {
  return getStoredPrototypeMeta();
}
