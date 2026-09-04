import { NextResponse } from "next/server";
import { clock } from "@/lib/clock";
// Cross-root resolution smoke: @/shared/* maps to ../src/shared, outside the
// web/ directory. This is a runtime (non-type) import on purpose - it fails
// the build if turbopack.root is not the repo root. @/engine/* resolves the
// same way once src/engine lands.
import { MVP_POLICY } from "@/shared/policy";

// GET Home screen. Calls runAllScenarios only.
export async function GET() {
  const { today, now } = clock();
  return NextResponse.json(
    { todo: "A", today, now, policyVersion: MVP_POLICY.policyVersion },
    { status: 501 },
  );
}
