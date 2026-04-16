import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/server/auth";
import {
  getCurrentPayload,
  getStoreControlTowerDetail,
} from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function GET(request) {
  const snapshot = request.nextUrl.searchParams.get("snapshot");

  if (!snapshot) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "snapshot is required" } },
      { status: 400 }
    );
  }

  const user = await getSessionUserFromRequest(request);
  const payload = await getCurrentPayload(snapshot, user);
  const storeId = request.nextUrl.searchParams.get("storeId") ?? user.storeId ?? payload.latestRun.recommendations[0]?.storeId ?? null;
  const controlTower = storeId
    ? await getStoreControlTowerDetail({
        storeId,
        snapshotKey: snapshot,
        user,
      })
    : null;

  return NextResponse.json({
    ...payload.latestRun.metrics,
        controlTower: controlTower
          ? {
              proposalCount: controlTower.proposals.length,
              pendingApprovals: controlTower.approvals.filter((item) => item.status === "pending").length,
              logisticsTasks: controlTower.logisticsTasks.length,
              procurementOrders: controlTower.procurementOrders.length,
              modelRunCount: controlTower.modelRunHistory?.length ?? 0,
              latestModelRunStatus: controlTower.latestModelRun?.status ?? null,
              latestProvider: controlTower.latestModelRun?.provider ?? null,
              latestModel: controlTower.latestModelRun?.model ?? null,
              estimatedProviderCost:
                controlTower.modelRunHistory?.reduce(
                  (sum, modelRun) => sum + Number(modelRun.estimatedCost ?? 0),
                  0
                ) ?? 0,
              simulated: controlTower.simulated,
            }
          : null,
  });
}
