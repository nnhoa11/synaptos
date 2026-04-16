import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildSnapshots, buildStores, normalizeRow, parseCsv } from "@/lib/prototype-core";

const csvPath = path.join(
  process.cwd(),
  "SynaptOS_Data - SynaptOS_Baseline_Final_v4.csv"
);

let datasetPromise;

async function loadDataset() {
  const text = await readFile(csvPath, "utf8");
  const rows = parseCsv(text)
    .map(normalizeRow)
    .filter(Boolean)
    .sort((a, b) => a.timestampMs - b.timestampMs);

  return {
    rows,
    stores: buildStores(rows),
    snapshots: buildSnapshots(rows),
  };
}

export async function getPrototypeDataset() {
  if (!datasetPromise) {
    datasetPromise = loadDataset();
  }
  return datasetPromise;
}

export async function getPrototypeMeta() {
  const { stores, snapshots } = await getPrototypeDataset();
  const defaultSnapshot =
    [...snapshots]
      .reverse()
      .find((snapshot) => new Date(snapshot).getHours() <= 20) ??
    snapshots[snapshots.length - 1] ??
    null;

  return { stores, snapshots, defaultSnapshot };
}
