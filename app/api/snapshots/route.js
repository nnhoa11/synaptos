import { NextResponse } from "next/server";
import { getPrototypeMeta } from "@/lib/prototype-data";

export async function GET() {
  const { snapshots } = await getPrototypeMeta();
  return NextResponse.json(snapshots);
}
