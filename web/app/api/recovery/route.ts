import { NextRequest, NextResponse } from "next/server";
import { findRecovery, recalculateContractStatuses } from "@/engine/index";
import { clock } from "@/lib/clock";
import { errorResponse } from "@/lib/api/errors";
import { loadEngineInput, requestedUserId } from "@/lib/db/data";
import { createServerClient } from "@/lib/supabase/server";

// GET Recovery cards. The search is deterministic and uses only engine results.
export async function GET(request: NextRequest) {
  try {
    const { today, now } = clock();
    const input = await loadEngineInput(createServerClient(), today, requestedUserId(request));
    const settledInput = {
      ...input,
      contracts: recalculateContractStatuses(input.contracts, today, now),
    };
    return NextResponse.json(findRecovery(settledInput, now));
  } catch (error) {
    return errorResponse(error);
  }
}
