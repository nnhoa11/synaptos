import { NextResponse } from "next/server";
import {
  assertStoreAccess,
  getSessionUserFromRequest,
} from "@/lib/server/auth";
import {
  createPosTransaction,
  getStoreRecord,
} from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function POST(request) {
  const user = await getSessionUserFromRequest(request);
  const body = await request.json().catch(() => ({}));

  if (!body.storeId || !Array.isArray(body.items) || body.total == null) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "storeId, items, and total are required" } },
      { status: 400 }
    );
  }

  try {
    assertStoreAccess(user, body.storeId);

    const transaction = await createPosTransaction({
      storeId: body.storeId,
      cashier: body.cashier ?? user.name,
      items: body.items,
      total: Number(body.total),
      actorUserId: user.id,
    });
    const store = await getStoreRecord(body.storeId);

    return NextResponse.json({
      transaction_id: transaction.id,
      receipt_data: {
        store_name: store?.name ?? body.storeId,
        cashier: transaction.cashier,
        created_at: transaction.createdAt,
        items: transaction.items,
        total: transaction.total,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: { code: error.code ?? "FORBIDDEN", message: "unable to save POS transaction" } },
      { status: error.code === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
