import { NextRequest, NextResponse } from "next/server";
import { clock } from "@/lib/clock";

// GET  List. Run recalculateContractStatuses(contracts, today, now) before returning.
//      Write back only the changed rows (no bulk overwrite - statusReason would be lost).
export async function GET() {
  const { today, now } = clock();
  return NextResponse.json({ todo: "A", today, now }, { status: 501 });
}

// POST Save contract. 400 if classificationStatus is below user_confirmed.
//      Re-run runAllScenarios after saving and return the latest D-day.
export async function POST(req: NextRequest) {
  const { today, now } = clock();
  const body = await req.json();
  return NextResponse.json({ todo: "A", today, now, body }, { status: 501 });
}