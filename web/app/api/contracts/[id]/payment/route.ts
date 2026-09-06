import { NextRequest, NextResponse } from "next/server";
import { confirmPayment, recalculateClientStats, runAllScenarios } from "@/engine/index";
import { clock } from "@/lib/clock";
import { ApiError, asObject, assertUuid, errorResponse, requiredString } from "@/lib/api/errors";
import { clientToRow, contractToRow, mapClientRow, mapContractRow } from "@/lib/db/mappers";
import { loadEngineInput, requestedUserId, resolveUserId } from "@/lib/db/data";
import { createServerClient } from "@/lib/supabase/server";

// PATCH 입금 확인 (engine-interface.md 3-9, 이슈 #55)
//
// 실제 입금일과 실수령액을 받아 계약을 완료로 확정하고 공제율을 역산한다.
// 이어서 그 거래처의 지연 통계를 다시 계산한다(3-10) — 지연 통계는 D-day 시나리오의
// 입금일 추정 근거라, 갱신하지 않으면 이후 계산이 옛 값을 계속 쓴다.
//
// Next 16: params는 Promise다.
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    assertUuid(id, "contract id");
    const body = asObject(await request.json());
    const actualDate = requiredString(body, "actualDate");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(actualDate)) {
      throw new ApiError(400, "actualDate must be YYYY-MM-DD");
    }
    const actualNetAmount = body.actualNetAmount;
    if (typeof actualNetAmount !== "number" || !Number.isInteger(actualNetAmount) || actualNetAmount < 0) {
      throw new ApiError(400, "actualNetAmount must be a non-negative integer");
    }

    const db = createServerClient();
    // status 라우트와 같은 기준으로 사용자 범위를 좁힌다(D5-a).
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
    const { today, now } = clock();

    // 엔진이 총액 초과·음수·취소 계약을 막는다. 그 메시지를 그대로 400으로 돌려주면
    // 화면이 사유를 보여줄 수 있다(서버 내부 오류로 감추지 않는다).
    let updated;
    try {
      updated = confirmPayment(current, { contractId: id, actualDate, actualNetAmount }, now);
    } catch (engineError) {
      throw new ApiError(400, engineError instanceof Error ? engineError.message : "invalid payment input");
    }

    const row = contractToRow(updated);
    const { data: saved, error: updateError } = await db
      .from("contracts")
      .update({
        actual_date: row.actual_date,
        actual_net_amount: row.actual_net_amount,
        actual_rate: row.actual_rate,
        classification_status: row.classification_status,
        status: row.status,
        status_source: row.status_source,
        status_reason: row.status_reason,
        status_updated_at: row.status_updated_at,
        updated_at: row.updated_at,
      })
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .single();
    if (updateError) throw new Error(`[supabase] ${updateError.message}`);

    // 3-9가 "clients 지연 통계 재계산 트리거"라고 정한 흐름. 갱신 후 스냅샷으로
    // 계산해야 방금 확인한 입금이 통계에 포함된다.
    const snapshot = await loadEngineInput(db, today, userId);
    const client = snapshot.clients.find((c) => c.id === updated.clientId);
    let updatedClient = client ?? null;
    if (client) {
      const recalculated = recalculateClientStats(client, snapshot.contracts);
      if (JSON.stringify(recalculated) !== JSON.stringify(client)) {
        const clientRow = clientToRow(recalculated);
        const { data: savedClient, error: clientError } = await db
          .from("clients")
          .update({
            completed_count: clientRow.completed_count,
            median_delay_days: clientRow.median_delay_days,
            p90_delay_days: clientRow.p90_delay_days,
          })
          .eq("id", client.id)
          .eq("user_id", userId)
          .select("*")
          .single();
        if (clientError) throw new Error(`[supabase] ${clientError.message}`);
        updatedClient = mapClientRow(savedClient);
      }
    }

    // 지연 통계가 바뀌면 D-day도 바뀌므로 갱신된 스냅샷으로 다시 계산해 돌려준다.
    const after = await loadEngineInput(db, today, userId);
    return NextResponse.json({
      contract: mapContractRow(saved),
      client: updatedClient,
      dashboard: runAllScenarios(after),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
