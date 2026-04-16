import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/server/auth";
import { runAgentPipeline } from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function POST(request) {
  const body = await request.json();
  const snapshot = body.snapshot;

  if (!snapshot) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "snapshot is required" } },
      { status: 400 }
    );
  }

  const user = await getSessionUserFromRequest(request);
  try {
    const payload = await runAgentPipeline(snapshot, user.id, user);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: { code: error.code ?? "PIPELINE_ERROR", message: error.message ?? "agent pipeline failed" } },
      { status: 500 }
    );
  }
}
