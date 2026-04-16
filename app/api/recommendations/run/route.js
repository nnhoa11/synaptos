import { NextResponse } from "next/server";
import { runPrototype } from "@/lib/prototype-core";
import { getPrototypeDataset } from "@/lib/prototype-data";

export async function POST(request) {
  const body = await request.json();
  const { snapshot, calibrations = [], pendingAdjustments = {}, previousLabels = {} } = body;

  if (!snapshot) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "snapshot is required" } },
      { status: 400 }
    );
  }

  const { rows, stores } = await getPrototypeDataset();
  const payload = runPrototype({
    rows,
    stores,
    selectedSnapshot: snapshot,
    calibrations,
    pendingAdjustments,
    previousLabels,
  });

  return NextResponse.json(payload);
}
