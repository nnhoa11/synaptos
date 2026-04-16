import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/server/auth";
import { getAggregationRunDetail } from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const user = await getSessionUserFromRequest(request);
  const payload = await getAggregationRunDetail((await params).id, user);

  if (!payload) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "aggregation run not found" } },
      { status: 404 }
    );
  }

  return NextResponse.json(payload);
}
