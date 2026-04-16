import { NextResponse } from "next/server";
import {
  assertCanApprove,
  getSessionUserFromRequest,
} from "@/lib/server/auth";
import { reviewControlTowerProposal } from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  const user = await getSessionUserFromRequest(request);
  const body = await request.json().catch(() => ({}));
  const proposalId = (await params).id;

  try {
    if (!body.storeId && user.role !== "admin") {
      assertCanApprove(user, user.storeId);
    } else {
      assertCanApprove(user, body.storeId ?? user.storeId);
    }

    const payload = await reviewControlTowerProposal({
      proposalId,
      decision: "approved",
      reviewNotes: body.reviewNotes ?? "",
      user,
    });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: { code: error.code ?? "FORBIDDEN", message: "unable to approve proposal" } },
      { status: error.code === "NOT_FOUND" ? 404 : 403 }
    );
  }
}
