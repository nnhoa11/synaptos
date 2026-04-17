import { NextResponse } from "next/server";
import {
  assertAdmin,
  assertStoreAccess,
  getSessionUserFromRequest,
} from "@/lib/server/auth";
import {
  getOperationalSnapshotKey,
  getStoreRecord,
  updateStoreRecord,
} from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const user = await getSessionUserFromRequest(request);
  const storeId = (await params).storeId;

  try {
    assertStoreAccess(user, storeId);
    const store = await getStoreRecord(storeId);
    if (!store) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "store not found" } },
        { status: 404 }
      );
    }

    return NextResponse.json({
      store,
      snapshotKey: await getOperationalSnapshotKey(),
    });
  } catch {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "store access denied" } },
      { status: 403 }
    );
  }
}

export async function PUT(request, { params }) {
  const user = await getSessionUserFromRequest(request);
  const storeId = (await params).storeId;
  const body = await request.json().catch(() => ({}));

  try {
    assertAdmin(user);
    assertStoreAccess(user, storeId);

    const store = await updateStoreRecord(storeId, {
      name: body.name,
      district: body.district,
      archetype: body.archetype,
      displayType: body.displayType,
      llmMode: body.llmMode,
      controlTowerEnabled: body.controlTowerEnabled,
      approvalThresholdPct: body.approvalThresholdPct,
      markdownMaxAutoDiscountPct: body.markdownMaxAutoDiscountPct,
    });

    return NextResponse.json({ store });
  } catch (error) {
    return NextResponse.json(
      { error: { code: error.code ?? "FORBIDDEN", message: "unable to update store" } },
      { status: error.code === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
