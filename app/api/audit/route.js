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
  const includeSummary = request.nextUrl.searchParams.get("includeSummary") === "1";

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

  const entries = await listAuditEvents(storeId);
  if (!includeSummary) {
    return NextResponse.json(entries);
  }

  const summary = entries.reduce((accumulator, entry) => {
    accumulator[entry.type] = (accumulator[entry.type] ?? 0) + 1;
    return accumulator;
  }, {});

  return NextResponse.json({ entries, summary });
}
