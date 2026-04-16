import { NextResponse } from "next/server";
import {
  assertStoreAccess,
  getSessionUserFromRequest,
} from "@/lib/server/auth";
import { listCalibrations, saveCalibration } from "@/lib/server/prototype-store";

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

  return NextResponse.json(await listCalibrations(storeId));
}

export async function POST(request) {
  const user = await getSessionUserFromRequest(request);
  const body = await request.json();
  const {
    storeId,
    skuKey,
    shrinkageUnits = 0,
    spoiledUnits = 0,
    notes = "",
    snapshot,
  } = body;

  if (!storeId || !skuKey || !snapshot) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "storeId, skuKey, and snapshot are required" } },
      { status: 400 }
    );
  }

  try {
    assertStoreAccess(user, storeId);
    const payload = await saveCalibration({
      storeId,
      skuKey,
      shrinkageUnits: Number(shrinkageUnits),
      spoiledUnits: Number(spoiledUnits),
      notes,
      snapshotKey: snapshot,
      user,
    });
    return NextResponse.json({ status: "saved", payload });
  } catch (error) {
    return NextResponse.json(
      { error: { code: error.code ?? "FORBIDDEN", message: "calibration failed" } },
      { status: error.code === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
