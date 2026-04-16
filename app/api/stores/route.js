import { NextResponse } from "next/server";
import { getPrototypeMeta } from "@/lib/prototype-data";

export async function GET() {
  const { stores } = await getPrototypeMeta();
  return NextResponse.json(stores);
}
