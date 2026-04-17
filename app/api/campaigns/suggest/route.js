import { NextResponse } from "next/server";
import { average } from "@/lib/prototype-core";
import {
  assertStoreAccess,
  getSessionUserFromRequest,
} from "@/lib/server/auth";
import { runCampaignAgent } from "@/lib/server/agent/agents/campaign-agent";
import {
  getStoreRecord,
  getStorefrontData,
} from "@/lib/server/prototype-store";

export const runtime = "nodejs";

function mapArchetype(store) {
  if (store?.archetype === "premium") {
    return "premium_urban";
  }
  if (store?.archetype === "transit") {
    return "transit";
  }
  return "residential";
}

export async function POST(request) {
  const user = await getSessionUserFromRequest(request);
  const body = await request.json().catch(() => ({}));
  const storeId = body.storeId ?? user.storeId;

  if (!user || !["admin", "manager"].includes(user.role) || !storeId) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "campaign suggestion access denied" } },
      { status: 403 }
    );
  }

  try {
    assertStoreAccess(user, storeId);
    const store = await getStoreRecord(storeId);
    const storefront = await getStorefrontData({ storeId });
    const input = {
      archetype: body.archetype ?? mapArchetype(store),
      district_profile: body.districtProfile ?? {
        district: store?.district ?? "Q7",
        spending_tier: "middle",
        peak_hours: ["17:00-19:00"],
        profile_type: mapArchetype(store),
      },
      intraday_traffic: body.intradayTraffic ?? {
        peak_hours: ["12:00-14:00", "17:00-19:00"],
        avg_item_traffic: Number(average(storefront.products.map((item) => item.itemTraffic ?? 1)).toFixed(2)),
      },
      inventory_state: {
        lot_count: storefront.products.length,
        markdown_candidates: storefront.products.filter((item) => item.discountPct != null).length,
        rte_lot_count: storefront.products.filter((item) =>
          String(item.category ?? "").toLowerCase().includes("rte")
        ).length,
      },
    };

    const result = await runCampaignAgent(input);

    return NextResponse.json({
      status: result.status,
      suggestion: result.output,
      input,
      failureReason: result.failureReason ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: error.code ?? "FORBIDDEN",
          message: "unable to generate campaign suggestion",
        },
      },
      { status: error.code === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
