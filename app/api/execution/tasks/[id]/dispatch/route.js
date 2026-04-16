import { NextResponse } from "next/server";
import {
  assertCanDispatch,
  getSessionUserFromRequest,
} from "@/lib/server/auth";
import { dispatchControlTowerTask } from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  const user = await getSessionUserFromRequest(request);
  const body = await request.json().catch(() => ({}));

  try {
    assertCanDispatch(user, body.route, body.storeId ?? user.storeId);
    const payload = await dispatchControlTowerTask({
      taskId: (await params).id,
      user,
    });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: { code: error.code ?? "FORBIDDEN", message: "unable to dispatch execution task" } },
      { status: error.code === "NOT_FOUND" ? 404 : 403 }
    );
  }
}
