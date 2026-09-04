import { NextRequest, NextResponse } from "next/server";
import { clock } from "@/lib/clock";

// POST What-if comparison. compareWhatIf(input, assumptions, now).
//      The max-3 check is already enforced by the engine.
export async function POST(req: NextRequest) {
  const { today, now } = clock();
  const body = await req.json();
  return NextResponse.json({ todo: "A", today, now, body }, { status: 501 });
}