import { NextRequest, NextResponse } from "next/server";
import type { ContractCreateInput } from "@/shared/types";
import type { IncomeType, SettlementTerm } from "@/shared/enums";
import { getWithholdingReference } from "@/shared/policy";
import { calculateExpectedDate, calculateExpectedNetAmount, recalculateContractStatuses, runAllScenarios } from "@/engine/index";
import { clock } from "@/lib/clock";
// 거래처 정규화는 Mock 저장소와 같은 함수를 쓴다. 복사본이 둘이면 한쪽만 바뀌었을 때
// "B미디어"와 "B 미디어"가 서로 다른 거래처로 갈리고, 완료 이력이 나뉘어 지연 예측이
// cold_start로 떨어진다 (PR #25 리뷰).
import { normalizeClientName } from "@/lib/client-name";
import { ApiError, asObject, errorResponse, requiredString } from "@/lib/api/errors";
import { loadEngineInput, requestedUserId, resolveUserId } from "@/lib/db/data";
import { contractStatusUpdateRow, mapClientRow, mapContractRow } from "@/lib/db/mappers";
import { createServerClient } from "@/lib/supabase/server";

const INCOME_TYPES = new Set<IncomeType>(["business_personal_service", "qualifying_other_income", "employment_income", "no_withholding", "needs_review"]);
const SETTLEMENT_TERMS = new Set<SettlementTerm>(["ON_COMPLETION", "SAME_MONTH_END", "NEXT_MONTH_END", "NEXT_MONTH_DAY", "NET_DAYS", "UNKNOWN"]);

export async function GET(request: NextRequest) {
  try {
    const { today, now } = clock();
    const db = createServerClient();
    const input = await loadEngineInput(db, today, requestedUserId(request));
    const recalculated = recalculateContractStatuses(input.contracts, today, now);
    const changed = recalculated.filter((contract, index) => contract !== input.contracts[index]);
    await Promise.all(changed.map(async (contract) => {
      const { error } = await db.from("contracts").update(contractStatusUpdateRow(contract)).eq("id", contract.id).eq("user_id", input.user.id);
      if (error) throw new Error(`[supabase] ${error.message}`);
    }));
    return NextResponse.json({ contracts: recalculated, updatedCount: changed.length });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = asObject(await request.json());
    const input = parseContractInput(body);
    const { today, now } = clock();
    const db = createServerClient();
    const userId = await resolveUserId(db, stringOrNull(body.userId));
    const client = await findOrCreateClient(db, userId, input.clientName);
    const expectedDate = input.manualExpectedDate ?? calculateExpectedDate(input);
    if (input.settlementTerm === "UNKNOWN" && expectedDate === null) {
      throw new ApiError(400, "manualExpectedDate is required when settlementTerm is UNKNOWN");
    }
    const referenceRate = getWithholdingReference(input.incomeType).referenceRate;
    const expectedNetAmount = calculateExpectedNetAmount({ grossAmount: input.grossAmount, payerStatedNetAmount: input.payerStatedNetAmount, confirmedExpectedRate: input.confirmedExpectedRate, actualNetAmount: null }).amount;
    const { data, error } = await db.from("contracts").insert({
      user_id: userId, client_id: client.id, gross_amount: input.grossAmount,
      completion_date: input.completionDate, invoice_date: input.invoiceDate,
      settlement_term: input.settlementTerm, settlement_day: input.settlementDay,
      expected_date: expectedDate, expected_date_source: input.manualExpectedDate ? "manual" : "calculated",
      actual_date: null, income_type: input.incomeType, classification_status: input.classificationStatus,
      reference_rate: referenceRate, confirmed_expected_rate: input.confirmedExpectedRate,
      actual_rate: null, payer_stated_net_amount: input.payerStatedNetAmount,
      expected_net_amount: expectedNetAmount, actual_net_amount: null,
      status: "waiting", status_source: "system", status_reason: null, status_updated_at: now,
    }).select("*").single();
    if (error) throw new Error(`[supabase] ${error.message}`);
    const snapshot = await loadEngineInput(db, today, userId);
    return NextResponse.json({ contract: mapContractRow(data), dashboard: runAllScenarios(snapshot) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

function parseContractInput(body: Record<string, unknown>): ContractCreateInput {
  if (body.classificationStatus !== "user_confirmed") throw new ApiError(400, "classificationStatus must be user_confirmed before saving");
  const incomeType = requiredString(body, "incomeType") as IncomeType;
  const settlementTerm = requiredString(body, "settlementTerm") as SettlementTerm;
  if (!INCOME_TYPES.has(incomeType)) throw new ApiError(400, "invalid incomeType");
  if (!SETTLEMENT_TERMS.has(settlementTerm)) throw new ApiError(400, "invalid settlementTerm");
  const grossAmount = body.grossAmount;
  if (typeof grossAmount !== "number" || !Number.isInteger(grossAmount) || grossAmount <= 0) throw new ApiError(400, "grossAmount must be a positive integer");
  const settlementDay = numberOrNull(body.settlementDay);
  if ((settlementTerm === "NEXT_MONTH_DAY" || settlementTerm === "NET_DAYS") && settlementDay === null) {
    throw new ApiError(400, `settlementDay is required for ${settlementTerm}`);
  }
  if (settlementDay !== null && (!Number.isInteger(settlementDay) || settlementDay < 1 || settlementDay > 365)) {
    throw new ApiError(400, "settlementDay must be an integer from 1 to 365");
  }
  const payerStatedNetAmount = numberOrNull(body.payerStatedNetAmount);
  if (payerStatedNetAmount !== null && (!Number.isInteger(payerStatedNetAmount) || payerStatedNetAmount < 0 || payerStatedNetAmount > grossAmount)) {
    throw new ApiError(400, "payerStatedNetAmount must be an integer from 0 to grossAmount");
  }
  const confirmedExpectedRate = numberOrNull(body.confirmedExpectedRate);
  if (confirmedExpectedRate !== null && (confirmedExpectedRate < 0 || confirmedExpectedRate > 1)) {
    throw new ApiError(400, "confirmedExpectedRate must be between 0 and 1");
  }
  return {
    clientName: requiredString(body, "clientName"), grossAmount,
    completionDate: requiredString(body, "completionDate"), invoiceDate: stringOrNull(body.invoiceDate),
    settlementTerm, settlementDay, manualExpectedDate: stringOrNull(body.manualExpectedDate),
    incomeType, classificationStatus: "user_confirmed", payerStatedNetAmount,
    confirmedExpectedRate,
  };
}

function stringOrNull(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ApiError(400, "expected string or null");
  return value;
}

function numberOrNull(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ApiError(400, "expected number or null");
  return value;
}

async function findOrCreateClient(db: ReturnType<typeof createServerClient>, userId: string, name: string) {
  const { data: existing, error: selectError } = await db.from("clients").select("*").eq("user_id", userId);
  if (selectError) throw new Error(`[supabase] ${selectError.message}`);
  const normalized = normalizeClientName(name);
  const match = (existing ?? []).find((row) => normalizeClientName(String(row.name)) === normalized);
  if (match) return mapClientRow(match);
  const { data, error } = await db.from("clients").insert({ user_id: userId, name }).select("*").single();
  if (error) throw new Error(`[supabase] ${error.message}`);
  return mapClientRow(data);
}
