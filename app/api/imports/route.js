import { NextResponse } from "next/server";
import { assertAdmin, getSessionUserFromRequest } from "@/lib/server/auth";
import {
  getPrototypeMeta,
  importBaselineData,
  runAndPersist,
} from "@/lib/server/prototype-store";

export const runtime = "nodejs";

export async function POST(request) {
  const user = await getSessionUserFromRequest(request);

  try {
    assertAdmin(user);
    const batch = await importBaselineData({
      actorUserId: user.id,
      source: "manual_baseline_import",
      resetState: true,
    });
    const { defaultSnapshot } = await getPrototypeMeta();
    const payload = defaultSnapshot ? await runAndPersist(defaultSnapshot, user.id, user) : null;
    return NextResponse.json({ status: "completed", batch, payload });
  } catch (error) {
    return NextResponse.json(
      { error: { code: error.code ?? "FORBIDDEN", message: "import failed" } },
      { status: error.code === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
