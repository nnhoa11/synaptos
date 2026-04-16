import { NextResponse } from "next/server";
import {
  assertStoreAccess,
  getSessionUserFromRequest,
} from "@/lib/server/auth";
import { listAuditEvents } from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function GET(request) {
  const user = await getSessionUserFromRequest(request);
  const storeId = request.nextUrl.searchParams.get("storeId") || (user.role === "admin" ? null : user.storeId);

  if (storeId) {
    try {
      assertStoreAccess(user, storeId);
    } catch {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "store access denied" } },
        { status: 403 }
      );
    }
  }

  return NextResponse.json(await listAuditEvents(storeId));
}
