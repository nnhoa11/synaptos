import { NextResponse } from "next/server";
import { getPrototypeMeta } from "@/lib/prototype-data";

export const runtime = "nodejs";

export async function GET() {
  const { snapshots } = await getPrototypeMeta();
  return NextResponse.json(snapshots);
}
