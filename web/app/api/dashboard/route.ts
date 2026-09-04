import { NextResponse } from "next/server";
import { clock } from "@/lib/clock";

// GET Home screen. Calls runAllScenarios only.
export async function GET() {
  const { today, now } = clock();
  return NextResponse.json({ todo: "A", today, now }, { status: 501 });
}