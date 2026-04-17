import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/server/auth";
import {
  getAccessibleStores,
  getCurrentPayload,
  getPrototypeMeta,
  getStoreControlTowerDetail,
} from "@/lib/server/prototype-store";

export const runtime = "nodejs";

const KG_BY_CATEGORY = {
  seafood: 0.45,
  meat: 0.35,
  drink: 1.0,
  dairy: 0.9,
  produce: 0.6,
  bakery: 0.3,
  default: 0.5,
};

function weightForCategory(category) {
  return KG_BY_CATEGORY[String(category ?? "").toLowerCase()] ?? KG_BY_CATEGORY.default;
}

function computeWasteRate(activeLots) {
  const totalImported = activeLots.reduce((sum, lot) => sum + Number(lot.totalImported ?? 0), 0);
  const totalWaste = activeLots.reduce((sum, lot) => sum + Number(lot.totalWaste ?? 0), 0);
  return totalImported > 0 ? totalWaste / totalImported : 0;
}

async function buildTrend(stores, user, period) {
  const { snapshots } = await getPrototypeMeta();
  const lastByDate = new Map();

  for (const snapshot of snapshots) {
    lastByDate.set(snapshot.slice(0, 10), snapshot);
  }

  const days = [...lastByDate.entries()].map(([date, snapshot]) => ({ date, snapshot }));
  const count = period === "90d" ? 7 : period === "7d" ? 7 : 6;
  const step = Math.max(1, Math.floor(days.length / count));
  const selected = [];

  for (let index = Math.max(0, days.length - count * step); index < days.length; index += step) {
    selected.push(days[index]);
  }

  return Promise.all(
    selected.slice(-count).map(async ({ date, snapshot }) => {
      const payload = await getCurrentPayload(snapshot, user);
      const activeLots = payload.latestRun.activeLots.filter((lot) =>
        stores.some((store) => store.id === lot.storeId)
      );

      return {
        label: date.slice(5),
        wasteRate: computeWasteRate(activeLots),
      };
    })
  );
}

export async function GET(request) {
  const user = await getSessionUserFromRequest(request);
  const storeId = request.nextUrl.searchParams.get("storeId");
  const period = request.nextUrl.searchParams.get("period") ?? "30d";
  const stores = storeId
    ? (await getAccessibleStores(user)).filter((store) => store.id === storeId)
    : await getAccessibleStores(user);

  const details = await Promise.all(
    stores.map((store) =>
      getStoreControlTowerDetail({
        storeId: store.id,
        user,
      })
    )
  );

  const markdownRescue = details.flatMap((detail) =>
    detail.proposals.filter(
      (proposal) => proposal.executionTask?.route === "label" && proposal.executionTask?.status === "dispatched"
    )
  );
  const logistics = details.flatMap((detail) => detail.logisticsTasks);
  const crossDock = logistics.filter((task) => task.destination === "cross_dock");
  const eol = details.flatMap((detail) =>
    detail.proposals.filter((proposal) => {
      const logisticsTask = detail.logisticsTasks.find(
        (task) => task.executionTaskId === proposal.executionTask?.id
      );
      return logisticsTask?.destination === "eol";
    })
  );

  const eolDonation = eol.filter((proposal) =>
    !["seafood", "meat"].includes(String(proposal.metadata.category ?? "").toLowerCase())
  );
  const eolCompost = eol.filter((proposal) =>
    ["seafood", "meat"].includes(String(proposal.metadata.category ?? "").toLowerCase())
  );

  const totalKgDiverted = [...markdownRescue, ...eol]
    .reduce(
      (sum, proposal) =>
        sum + Number(proposal.metadata.quantity ?? 1) * weightForCategory(proposal.metadata.category),
      0
    ) + crossDock.length * 0.8;

  const trend = await buildTrend(stores, user, period);
  const currentWasteRate = trend.at(-1)?.wasteRate ?? 0;
  const baselineWasteRate = trend[0]?.wasteRate ?? currentWasteRate;

  return NextResponse.json({
    period,
    wasteRate: currentWasteRate,
    baselineWasteRate,
    wasteRateDelta: currentWasteRate - baselineWasteRate,
    totalKgDiverted: Number(totalKgDiverted.toFixed(2)),
    co2SavedKg: Number((totalKgDiverted * 0.6).toFixed(2)),
    itemsRescued: markdownRescue.reduce((sum, proposal) => sum + Number(proposal.metadata.quantity ?? 1), 0),
    breakdown: {
      markdown_rescue: markdownRescue.length,
      cross_dock: crossDock.length,
      eol_donation: eolDonation.length,
      eol_compost: eolCompost.length,
    },
    trend,
  });
}
