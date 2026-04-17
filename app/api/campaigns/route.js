import { NextResponse } from "next/server";
import {
  assertStoreAccess,
  getSessionUserFromRequest,
} from "@/lib/server/auth";
import { emitLabelPriceUpdate } from "@/lib/server/execution/label-executor";
import {
  applyCampaignPrices,
  createCampaign,
  listCampaigns,
  updateCampaignStatus,
} from "@/lib/server/prototype-store";

export const runtime = "nodejs";

function canManageCampaigns(user) {
  return user && ["admin", "manager"].includes(user.role);
}

export async function GET(request) {
  const user = await getSessionUserFromRequest(request);
  const storeId = request.nextUrl.searchParams.get("storeId");
  const status = request.nextUrl.searchParams.get("status");

  try {
    if (storeId) {
      assertStoreAccess(user, storeId);
    }

    return NextResponse.json(
      await listCampaigns({
        storeId: user.role === "admin" ? storeId : user.storeId,
        status,
      })
    );
  } catch {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "campaign access denied" } },
      { status: 403 }
    );
  }
}

export async function POST(request) {
  const user = await getSessionUserFromRequest(request);
  const body = await request.json().catch(() => ({}));

  if (!canManageCampaigns(user)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "campaign access denied" } },
      { status: 403 }
    );
  }

  if (!body.storeId || !body.type || !body.discountPct || !body.startsAt || !body.endsAt) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "storeId, type, discountPct, startsAt, and endsAt are required",
        },
      },
      { status: 400 }
    );
  }

  try {
    assertStoreAccess(user, body.storeId);

    const campaign = await createCampaign({
      storeId: body.storeId,
      name: body.name,
      type: body.type,
      targetCategory: body.targetCategory ?? null,
      targetSkuId: body.targetSkuId ?? null,
      discountPct: Number(body.discountPct),
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      createdBy: user.id,
    });

    let labelUpdates = [];
    if (new Date(body.startsAt).getTime() <= Date.now()) {
      labelUpdates = await applyCampaignPrices(campaign);
      await updateCampaignStatus(campaign.id, "active");
      for (const update of labelUpdates) {
        emitLabelPriceUpdate(update);
      }
      campaign.status = "active";
    }

    return NextResponse.json({
      campaign,
      labelUpdates,
    });
  } catch (error) {
    return NextResponse.json(
      { error: { code: error.code ?? "FORBIDDEN", message: "unable to create campaign" } },
      { status: error.code === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
