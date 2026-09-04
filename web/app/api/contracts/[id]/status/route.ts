import { NextRequest, NextResponse } from "next/server";
import { cancelContract, markContractAsRisk } from "@/engine/index";
import { clock } from "@/lib/clock";
import { ApiError, asObject, errorResponse, requiredString } from "@/lib/api/errors";
import { contractStatusUpdateRow, mapContractRow } from "@/lib/db/mappers";
import { createServerClient } from "@/lib/supabase/server";

// PATCH Manual status change: markContractAsRisk / cancelContract / revertManualStatus
// Next 16: params is a Promise
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = asObject(await request.json());
    const action = requiredString(body, "action");
    const reason = requiredString(body, "reason");
    const db = createServerClient();
    const { data, error } = await db.from("contracts").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`[supabase] ${error.message}`);
    if (!data) throw new ApiError(404, "contract not found");
    const current = mapContractRow(data);
    const { now } = clock();
    const updated = action === "risk" ? markContractAsRisk(current, reason, now)
      : action === "cancel" ? cancelContract(current, reason, now) : null;
    if (!updated) throw new ApiError(400, "action must be risk or cancel");
    const { data: saved, error: updateError } = await db.from("contracts")
      .update(contractStatusUpdateRow(updated)).eq("id", id).select("*").single();
    if (updateError) throw new Error(`[supabase] ${updateError.message}`);
    return NextResponse.json({ contract: mapContractRow(saved) });
  } catch (error) {
    return errorResponse(error);
  }
}
