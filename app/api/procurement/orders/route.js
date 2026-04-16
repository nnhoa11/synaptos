import { NextResponse } from "next/server";
import {
  assertProcurementAccess,
  getSessionUserFromRequest,
} from "@/lib/server/auth";
import { listProcurementWorkbench } from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function GET(request) {
  const user = await getSessionUserFromRequest(request);
  const snapshot = request.nextUrl.searchParams.get("snapshot");

  try {
    assertProcurementAccess(user, user.storeId);
    return NextResponse.json(await listProcurementWorkbench({ snapshotKey: snapshot, user }));
  } catch {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "procurement access denied" } },
      { status: 403 }
    );
  }
}
