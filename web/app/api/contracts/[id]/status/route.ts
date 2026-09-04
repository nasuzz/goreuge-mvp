import { NextRequest, NextResponse } from "next/server";
import { clock } from "@/lib/clock";

// PATCH Manual status change: markContractAsRisk / cancelContract / revertManualStatus
// Next 16: params is a Promise
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { now } = clock();
  const body = await req.json();
  return NextResponse.json({ todo: "A", id, now, body }, { status: 501 });
}