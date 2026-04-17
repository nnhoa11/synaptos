import { NextResponse } from "next/server";
import {
  assertStoreAccess,
  getSessionUserFromRequest,
} from "@/lib/server/auth";
import { emitLabelPriceUpdate } from "@/lib/server/execution/label-executor";
import {
  listCampaigns,
  revertCampaignPrices,
  updateCampaignStatus,
} from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function DELETE(request, { params }) {
  const user = await getSessionUserFromRequest(request);
  const campaignId = (await params).id;

  if (!user || !["admin", "manager"].includes(user.role)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "campaign access denied" } },
      { status: 403 }
    );
  }

  const campaign = (await listCampaigns()).find((entry) => entry.id === campaignId) ?? null;
  if (!campaign) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "campaign not found" } },
      { status: 404 }
    );
  }

  try {
    assertStoreAccess(user, campaign.storeId);
    let labelUpdates = [];

    if (campaign.status === "active") {
      labelUpdates = await revertCampaignPrices(campaign);
      for (const update of labelUpdates) {
        emitLabelPriceUpdate(update);
      }
    }

    await updateCampaignStatus(campaign.id, "expired");

    return NextResponse.json({
      status: "expired",
      campaignId: campaign.id,
      labelUpdates,
    });
  } catch (error) {
    return NextResponse.json(
      { error: { code: error.code ?? "FORBIDDEN", message: "unable to stop campaign" } },
      { status: error.code === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
