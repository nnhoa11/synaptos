import { NextResponse } from "next/server";
import {
  assertStoreAccess,
  getSessionUserFromRequest,
} from "@/lib/server/auth";
import { getStorefrontData } from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function GET(request) {
  const user = await getSessionUserFromRequest(request);
  const storeId = request.nextUrl.searchParams.get("storeId");

  if (!storeId) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "storeId is required" } },
      { status: 400 }
    );
  }

  try {
    assertStoreAccess(user, storeId);
    return NextResponse.json(await getStorefrontData({ storeId }));
  } catch {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "store access denied" } },
      { status: 403 }
    );
  }
}
