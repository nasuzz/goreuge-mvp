import { NextRequest, NextResponse } from "next/server";

// POST Create the initial users row: totalBalance / monthlyFixedOutflow / safetyBuffer
export async function POST(req: NextRequest) {
  const body = await req.json();
  return NextResponse.json({ todo: "A", body }, { status: 501 });
}