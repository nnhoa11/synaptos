import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/server/auth";
import { runAggregationForSnapshot } from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function POST(request) {
  const body = await request.json();
  const snapshot = body.snapshot;

  if (!snapshot) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "snapshot is required" } },
      { status: 400 }
    );
  }

  const user = await getSessionUserFromRequest(request);
  const payload = await runAggregationForSnapshot(snapshot, user.id, user);
  return NextResponse.json(payload);
}
