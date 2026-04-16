import { NextResponse } from "next/server";
import { assertAdmin, getSessionUserFromRequest } from "@/lib/server/auth";
import { getImportBatch } from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const user = await getSessionUserFromRequest(request);

  try {
    assertAdmin(user);
  } catch {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "admin access required" } },
      { status: 403 }
    );
  }

  const batch = await getImportBatch(params.id);

  if (!batch) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "import batch not found" } },
      { status: 404 }
    );
  }

  return NextResponse.json(batch);
}
