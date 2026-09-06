import { NextRequest, NextResponse } from "next/server";
import type { WhatIfAssumption } from "@/shared/types";
import { compareWhatIf } from "@/engine/index";
import { clock } from "@/lib/clock";
import { ApiError, asObject, errorResponse } from "@/lib/api/errors";
import { loadEngineInput } from "@/lib/db/data";
import { createServerClient } from "@/lib/supabase/server";

// POST What-if comparison. compareWhatIf(input, assumptions, now).
//      The max-3 check is already enforced by the engine.
export async function POST(request: NextRequest) {
  try {
    const body = asObject(await request.json());
    if (!Array.isArray(body.assumptions)) throw new ApiError(400, "assumptions must be an array");
    const userId = typeof body.userId === "string" ? body.userId : null;
    const { today, now } = clock();
    const input = await loadEngineInput(createServerClient(), today, userId);
    return NextResponse.json({ results: compareWhatIf(input, body.assumptions as WhatIfAssumption[], now) });
  } catch (error) {
    return errorResponse(error);
  }
}
