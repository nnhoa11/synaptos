import { NextResponse } from "next/server";
import {
  assertCanApprove,
  getSessionUserFromRequest,
} from "@/lib/server/auth";
import {
  getCurrentPayload,
  rejectRecommendation,
} from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  const body = await request.json();
  const { comment = "", snapshot } = body;
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
    const payload = await rejectRecommendation({
      recommendationId: params.id,
      comment,
      user,
      snapshotKey: snapshot,
    });

    return NextResponse.json({ status: "rejected", payload });
  } catch (error) {
    return NextResponse.json(
      { error: { code: error.code ?? "FORBIDDEN", message: "rejection failed" } },
      { status: error.code === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
