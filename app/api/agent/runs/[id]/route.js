import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/server/auth";
import { getModelRunDetail } from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const user = await getSessionUserFromRequest(request);

  try {
    const payload = await getModelRunDetail((await params).id, user);
    if (!payload) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "model run not found" } },
        { status: 404 }
      );
    }
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: { code: error.code ?? "FORBIDDEN", message: "unable to load model run detail" } },
      { status: error.code === "NOT_FOUND" ? 404 : 403 }
    );
  }
}
