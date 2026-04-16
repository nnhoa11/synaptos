import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/server/auth";
import { listControlTowerProposals } from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function GET(request) {
  const user = await getSessionUserFromRequest(request);
  const snapshot = request.nextUrl.searchParams.get("snapshot");
  const storeId = request.nextUrl.searchParams.get("storeId");

  return NextResponse.json(
    await listControlTowerProposals({
      snapshotKey: snapshot,
      storeId,
      user,
    })
  );
}
