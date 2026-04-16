import { NextResponse } from "next/server";
import {
  assertCanApprove,
  getSessionUserFromRequest,
} from "@/lib/server/auth";
import {
  approveRecommendation,
  getCurrentPayload,
} from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  const body = await request.json();
  const { discountPct, comment = "", snapshot } = body;
  const user = await getSessionUserFromRequest(request);

  if (!snapshot) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "snapshot is required" } },
      { status: 400 }
    );
  }

  const currentPayload = await getCurrentPayload(snapshot, user);
  const recommendation =
    currentPayload?.latestRun.recommendations.find((item) => item.id === params.id) ?? null;

  if (!recommendation) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "recommendation not found" } },
      { status: 404 }
    );
  }

  try {
    assertCanApprove(user, recommendation.storeId);
    const payload = await approveRecommendation({
      recommendationId: params.id,
      discountPct: Number(discountPct ?? recommendation.recommendedDiscountPct),
      comment,
      user,
      snapshotKey: snapshot,
    });

    return NextResponse.json({ status: "approved", payload });
  } catch (error) {
    return NextResponse.json(
      { error: { code: error.code ?? "FORBIDDEN", message: "approval failed" } },
      { status: error.code === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
