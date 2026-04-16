import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/server/auth";
import { getCurrentPayload } from "@/lib/server/prototype-store";

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
  return NextResponse.json(await getCurrentPayload(snapshot, user));
}
