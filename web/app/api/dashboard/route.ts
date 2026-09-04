import { NextRequest, NextResponse } from "next/server";
import { runAllScenarios } from "@/engine/index";
import { clock } from "@/lib/clock";
import { errorResponse } from "@/lib/api/errors";
import { loadEngineInput, requestedUserId } from "@/lib/db/data";
import { createServerClient } from "@/lib/supabase/server";

// GET Home screen. Calls runAllScenarios only.
export async function GET(request: NextRequest) {
  try {
    const { today } = clock();
    const input = await loadEngineInput(createServerClient(), today, requestedUserId(request));
    return NextResponse.json(runAllScenarios(input));
  } catch (error) {
    return errorResponse(error);
  }
}
