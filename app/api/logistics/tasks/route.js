import { NextResponse } from "next/server";
import {
  assertLogisticsAccess,
  getSessionUserFromRequest,
} from "@/lib/server/auth";
import { listLogisticsWorkbench } from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function GET(request) {
  const user = await getSessionUserFromRequest(request);
  const snapshot = request.nextUrl.searchParams.get("snapshot");

  try {
    assertLogisticsAccess(user, user.storeId);
    return NextResponse.json(await listLogisticsWorkbench({ snapshotKey: snapshot, user }));
  } catch {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "logistics access denied" } },
      { status: 403 }
    );
  }
}
