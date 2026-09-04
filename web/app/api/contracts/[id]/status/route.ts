import { NextRequest, NextResponse } from "next/server";
import { cancelContract, markContractAsRisk } from "@/engine/index";
import { clock } from "@/lib/clock";
import {
  ApiError,
  asObject,
  assertUuid,
  errorResponse,
  requiredString,
} from "@/lib/api/errors";
import { contractStatusUpdateRow, mapContractRow } from "@/lib/db/mappers";
import { requestedUserId, resolveUserId } from "@/lib/db/data";
import { createServerClient } from "@/lib/supabase/server";

// PATCH Manual status change: markContractAsRisk / cancelContract / revertManualStatus
// Next 16: params is a Promise
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    assertUuid(id, "contract id");
    const body = asObject(await request.json());
    const action = requiredString(body, "action");
    const reason = requiredString(body, "reason");
    const db = createServerClient();

    // 이 라우트만 사용자 범위 없이 id만으로 조회·갱신하고 있었다.
    // 나머지 질의는 전부 user_id로 좁히는데(loadEngineInput, GET write-back,
    // find-or-create) 여기만 빠져 있어서, 계약 UUID만 알면 남의 계약도
    // risk/cancelled로 바꿀 수 있었다. RLS가 전체 허용이라 이 라우트가
    // 유일한 방어선이므로(D5-a) 다른 질의와 같은 기준으로 좁힌다.
    const userId = await resolveUserId(
      db,
      requestedUserId(request) ?? (typeof body.userId === "string" ? body.userId : null),
    );

    const { data, error } = await db
      .from("contracts")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(`[supabase] ${error.message}`);
    if (!data) throw new ApiError(404, "contract not found");

    const current = mapContractRow(data);
    const { now } = clock();
    const updated = action === "risk" ? markContractAsRisk(current, reason, now)
      : action === "cancel" ? cancelContract(current, reason, now) : null;
    if (!updated) throw new ApiError(400, "action must be risk or cancel");

    const { data: saved, error: updateError } = await db.from("contracts")
      .update(contractStatusUpdateRow(updated))
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .single();
    if (updateError) throw new Error(`[supabase] ${updateError.message}`);
    return NextResponse.json({ contract: mapContractRow(saved) });
  } catch (error) {
    return errorResponse(error);
  }
}
