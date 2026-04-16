import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/server/auth";
import { getAccessibleStores } from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function GET(request) {
  const user = await getSessionUserFromRequest(request);
  return NextResponse.json(await getAccessibleStores(user));
}
