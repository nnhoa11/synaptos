import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/server/auth";
import {
  getAccessibleStores,
  getStoreControlTowerDetail,
} from "@/lib/server/prototype-store";

export const runtime = "nodejs";

function inRange(value, from, to) {
  const timestamp = new Date(value ?? 0).getTime();
  if (!timestamp) {
    return false;
  }
  if (from && timestamp < new Date(from).getTime()) {
    return false;
  }
  if (to && timestamp > new Date(to).getTime()) {
    return false;
  }
  return true;
}

function buildEvents(detail) {
  const logisticsByTaskId = new Map(
    detail.logisticsTasks.map((task) => [task.executionTaskId, task])
  );
  const storeName = detail.store?.name ?? detail.storeId;
  const district = detail.store?.district ?? detail.storeId;

  return detail.proposals
    .map((proposal) => {
      const executionTaskId = proposal.executionTask?.id ?? null;
      const logisticsTask = executionTaskId ? logisticsByTaskId.get(executionTaskId) : null;
      if (!executionTaskId || logisticsTask?.destination !== "eol") {
        return null;
      }

      const quantity = Number(proposal.metadata.quantity ?? 1);
      const originalValue = Math.round(Number(proposal.metadata.basePrice ?? proposal.proposedPrice ?? 0) * quantity);
      const writeoffValue = Math.round(Number(proposal.metadata.unitCost ?? proposal.metadata.basePrice ?? 0) * quantity * 0.35);

      return {
        id: proposal.id,
        store_id: detail.storeId,
        sku_id: proposal.lotId,
        product_name: proposal.skuName,
        category: proposal.metadata.category ?? "unknown",
        quantity,
        original_value: originalValue,
        writeoff_value: writeoffValue,
        eol_at:
          proposal.executionTask?.dispatchedAt ??
          proposal.executionTask?.createdAt ??
          logisticsTask.createdAt,
        routing_destination: logisticsTask.destination,
        route_label: logisticsTask.destinationLabel ?? "tax write-off hold",
        route_priority: logisticsTask.urgency ?? "high",
        store_name: storeName,
        district,
        coordinator_name: logisticsTask.coordinatorName ?? `${district} Logistics`,
        coordinator_email: logisticsTask.coordinatorEmail ?? `${detail.storeId}.logistics@synaptos.local`,
        pickup_window: logisticsTask.pickupWindow ?? null,
        handoff_message:
          logisticsTask.handoffMessage ??
          `${storeName} should isolate ${quantity} units of ${proposal.skuName} for finance-approved EOL routing.`,
        call_script:
          logisticsTask.callScript ??
          `Call logistics and confirm ${quantity} units of ${proposal.skuName} are ready for write-off pickup.`,
        checklist: logisticsTask.checklist ?? [
          "Pull units from the sale floor.",
          "Verify counts against the SynaptOS ledger.",
          "Attach tax write-off reference for finance.",
        ],
      };
    })
    .filter(Boolean);
}

export async function GET(request) {
  const user = await getSessionUserFromRequest(request);
  const storeId = request.nextUrl.searchParams.get("storeId");
  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");

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

  const events = details
    .flatMap(buildEvents)
    .filter((event) => inRange(event.eol_at, from, to))
    .sort((left, right) => new Date(right.eol_at).getTime() - new Date(left.eol_at).getTime());

  return NextResponse.json(events);
}
