import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/server/auth";
import { runAllReplayScenarios } from "@/lib/server/agent/__fixtures__/replay-runner";

export const runtime = "nodejs";

export async function GET(request) {
  const user = await getSessionUserFromRequest(request);

  if (user.role !== "admin") {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "admin role required for replay checks" } },
      { status: 403 }
    );
  }

  try {
    const results = runAllReplayScenarios();
    return NextResponse.json({
      ...results,
      executedAt: new Date().toISOString(),
      executedBy: user.name,
    });
  } catch (error) {
    return NextResponse.json(
      { error: { code: "REPLAY_FAILED", message: error.message } },
      { status: 500 }
    );
  }
}
