import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/server/auth";
import { runAndPersist } from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function POST(request) {
  const body = await request.json();
  const { snapshot } = body;

  if (!snapshot) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "snapshot is required" } },
      { status: 400 }
    );
  }

  const user = await getSessionUserFromRequest(request);
  const payload = await runAndPersist(snapshot, user.id, user);

  return NextResponse.json(payload);
}
