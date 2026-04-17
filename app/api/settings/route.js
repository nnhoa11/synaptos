import { NextResponse } from "next/server";
import {
  assertAdmin,
  getSessionUserFromRequest,
} from "@/lib/server/auth";
import {
  getSettingsBundle,
  setSettingsBundle,
} from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function GET(request) {
  const user = await getSessionUserFromRequest(request);

  if (!user || !["admin", "manager"].includes(user.role)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "settings access denied" } },
      { status: 403 }
    );
  }

  return NextResponse.json(await getSettingsBundle());
}

export async function PUT(request) {
  const user = await getSessionUserFromRequest(request);

  try {
    assertAdmin(user);
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await setSettingsBundle(body));
  } catch (error) {
    return NextResponse.json(
      { error: { code: error.code ?? "FORBIDDEN", message: "unable to update settings" } },
      { status: error.code === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
