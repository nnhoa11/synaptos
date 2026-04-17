import { NextResponse } from "next/server";
import {
  assertStoreAccess,
  getSessionUserFromRequest,
} from "@/lib/server/auth";
import { runPipeline } from "@/lib/server/agent/pipeline";
import {
  getPrototypeMeta,
  runAggregationForSnapshot,
} from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function POST(request) {
  const body = await request.json();
  const user = await getSessionUserFromRequest(request);
  const { defaultSnapshot, stores } = await getPrototypeMeta();
  const snapshot = body.snapshot ?? defaultSnapshot;
  const requestedMode = body.mode ?? "live";
  const storeId = body.storeId ?? user.storeId ?? stores[0]?.id ?? null;

  if (!snapshot) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "snapshot is required" } },
      { status: 400 }
    );
  }

  if (requestedMode === "legacy") {
    const payload = await runAggregationForSnapshot(snapshot, user.id, user);
    return NextResponse.json(payload);
  }

  if (!storeId) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "storeId is required for pipeline mode" } },
      { status: 400 }
    );
  }

  try {
    assertStoreAccess(user, storeId);
    const payload = await runPipeline({
      actorUserId: user.id,
      snapshotKey: snapshot,
      storeId,
      user,
    });

    return NextResponse.json({
      pipelineRunId: payload.agentRun.id,
      aggregationRunId: payload.aggregationRun.id,
      snapshotKey: snapshot,
      storeId,
      status: payload.agentRun.status,
      proposalCount: payload.proposals.length,
      approvalCount: payload.approvalRequests.length,
      executionCount: payload.executionTasks.length,
      stageSummary: payload.agentRun.summary,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: error.code ?? "PIPELINE_ERROR",
          message: error.message ?? "unable to run the multi-agent pipeline",
        },
      },
      { status: error.code === "FORBIDDEN" ? 403 : 500 }
    );
  }
}
