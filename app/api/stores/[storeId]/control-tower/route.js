import { NextResponse } from "next/server";
import {
  assertStoreAccess,
  getSessionUserFromRequest,
} from "@/lib/server/auth";
import { getStoreControlTowerDetail } from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const user = await getSessionUserFromRequest(request);
  const storeId = (await params).storeId;
  const snapshot = request.nextUrl.searchParams.get("snapshot");

  try {
    assertStoreAccess(user, storeId);
  } catch {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "store access denied" } },
      { status: 403 }
    );
  }

  return NextResponse.json(
    await getStoreControlTowerDetail({
      storeId,
      snapshotKey: snapshot,
      user,
    })
  );
}
