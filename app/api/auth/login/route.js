import { NextResponse } from "next/server";
import {
  resolveLoginUser,
  setSessionCookie,
} from "@/lib/server/auth";
import { getAccessibleStores } from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function POST(request) {
  const body = await request.json();
  const { role = "admin", storeId = null } = body;
  const user = await resolveLoginUser(role, storeId);

  if (!user) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "unable to resolve login user" } },
      { status: 400 }
    );
  }

  const response = NextResponse.json({
    user,
    stores: await getAccessibleStores(user),
  });
  setSessionCookie(response, user.id);
  return response;
}
