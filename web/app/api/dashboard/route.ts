import { NextResponse } from "next/server";
import { clock } from "@/lib/clock";
// Cross-root resolution smoke (PR review 2). Both aliases point outside the
// web/ directory - @/shared/* to ../src/shared, @/engine/* to ../src/engine -
// so these runtime (non-type) imports fail the build unless turbopack.root is
// the repo root. Keep at least one of them until a real handler uses them.
import { MVP_POLICY } from "@/shared/policy";
import { addDays, diffDays } from "@/engine/index";

// GET Home screen. Calls runAllScenarios only.
export async function GET() {
  const { today, now } = clock();
  const tomorrow = addDays(today, 1);
  return NextResponse.json(
    {
      todo: "A",
      today,
      now,
      policyVersion: MVP_POLICY.policyVersion,
      engineSmoke: { tomorrow, diffDays: diffDays(today, tomorrow) },
    },
    { status: 501 },
  );
}
