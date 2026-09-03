// test/db-smoke.ts
// Next.js 없이도 지금 당장 확인 가능한 것: 실제 Supabase에 계약을 저장하고,
// 그 데이터로 엔진(runAllScenarios)이 정상적으로 D-day를 계산하는지.
// 나중에 API 라우트(POST /api/contracts)를 만들 때 이 로직을 거의 그대로 옮기면 된다.
//
// 실행 전 준비:
//   PowerShell에서 (커밋 금지, 로컬 세션에만):
//     $env:SUPABASE_URL="https://xxxx.supabase.co"
//     $env:SUPABASE_ANON_KEY="eyJ..."
//   .env.example에 있는 변수명과 동일해야 한다.
//
// 실행:
//   npm run build && node dist/test/db-smoke.js

import { createClient } from "@supabase/supabase-js";
import { calculateExpectedDate, calculateExpectedNetAmount, runAllScenarios } from "../src/engine/index";
import type { EngineInput, User, Client, Contract } from "../src/shared/types";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("❌ SUPABASE_URL / SUPABASE_ANON_KEY 환경변수가 없습니다. 위 주석의 준비 단계를 먼저 하세요.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function main() {
  console.log("── 1. 데모 사용자 생성 (없으면) ──");
  const { data: existingUsers } = await supabase.from("users").select("*").limit(1);
  let userId: string;
  if (existingUsers && existingUsers.length > 0) {
    userId = existingUsers[0].id;
    console.log(`  기존 사용자 재사용: ${userId}`);
  } else {
    const { data: newUser, error } = await supabase
      .from("users")
      .insert({ total_balance: 800_000, monthly_fixed_outflow: 1_200_000, safety_buffer: 0 })
      .select()
      .single();
    if (error || !newUser) throw new Error(`사용자 생성 실패: ${error?.message}`);
    userId = newUser.id;
    console.log(`  신규 사용자 생성: ${userId}`);
  }

  console.log("\n── 2. 데모 거래처 생성 ──");
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .insert({ user_id: userId, name: `db-smoke-테스트거래처-${Date.now()}` })
    .select()
    .single();
  if (clientErr || !client) throw new Error(`거래처 생성 실패: ${clientErr?.message}`);
  console.log(`  거래처 생성: ${client.id}`);

  console.log("\n── 3. 계약 저장 (엔진 계산 함수로 expectedDate·expectedNetAmount 산출 후 INSERT) ──");
  const completionDate = "2026-09-03";
  const expectedDate = calculateExpectedDate({
    settlementTerm: "NEXT_MONTH_END",
    settlementDay: null,
    completionDate,
    invoiceDate: null,
  });
  const netAmountResult = calculateExpectedNetAmount({
    grossAmount: 2_400_000,
    confirmedExpectedRate: 0.033,
    actualNetAmount: null,
  });
  console.log(`  계산된 예정입금일: ${expectedDate}`);
  console.log(`  계산된 예상 실수령액: ${netAmountResult.amount}원 (${netAmountResult.status})`);

  const now = new Date().toISOString();
  const { data: contract, error: contractErr } = await supabase
    .from("contracts")
    .insert({
      user_id: userId,
      client_id: client.id,
      gross_amount: 2_400_000,
      completion_date: completionDate,
      settlement_term: "NEXT_MONTH_END",
      expected_date: expectedDate,
      expected_date_source: "calculated",
      income_type: "business_personal_service",
      classification_status: "user_confirmed",
      confirmed_expected_rate: 0.033,
      expected_net_amount: netAmountResult.amount,
      status: "waiting",
      status_source: "system",
      status_updated_at: now,
    })
    .select()
    .single();
  if (contractErr || !contract) throw new Error(`계약 저장 실패: ${contractErr?.message}`);
  console.log(`  ✅ 계약 저장 성공: ${contract.id}`);

  console.log("\n── 4. DB에서 다시 읽어서 엔진(runAllScenarios) 실행 ──");
  const [{ data: userRow }, { data: contractRows }, { data: clientRows }] = await Promise.all([
    supabase.from("users").select("*").eq("id", userId).single(),
    supabase.from("contracts").select("*").eq("user_id", userId),
    supabase.from("clients").select("*").eq("user_id", userId),
  ]);
  if (!userRow) throw new Error("사용자 재조회 실패");

  const user: User = {
    id: userRow.id,
    totalBalance: userRow.total_balance,
    monthlyFixedOutflow: userRow.monthly_fixed_outflow,
    safetyBuffer: userRow.safety_buffer,
    taxReserveRate: userRow.tax_reserve_rate,
    createdAt: userRow.created_at,
    updatedAt: userRow.updated_at,
  };
  const contracts: Contract[] = (contractRows ?? []).map((r: any) => ({
    id: r.id,
    clientId: r.client_id,
    grossAmount: r.gross_amount,
    completionDate: r.completion_date,
    invoiceDate: r.invoice_date,
    settlementTerm: r.settlement_term,
    settlementDay: r.settlement_day,
    expectedDate: r.expected_date,
    expectedDateSource: r.expected_date_source,
    actualDate: r.actual_date,
    incomeType: r.income_type,
    classificationStatus: r.classification_status,
    referenceRate: r.reference_rate,
    confirmedExpectedRate: r.confirmed_expected_rate,
    actualRate: r.actual_rate,
    expectedNetAmount: r.expected_net_amount,
    actualNetAmount: r.actual_net_amount,
    status: r.status,
    statusSource: r.status_source,
    statusReason: r.status_reason,
    statusUpdatedAt: r.status_updated_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
  const clients: Client[] = (clientRows ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    completedCount: r.completed_count,
    medianDelayDays: r.median_delay_days,
    p90DelayDays: r.p90_delay_days,
  }));

  const engineInput: EngineInput = {
    today: new Date().toISOString().slice(0, 10),
    user,
    contracts,
    clients,
    outflows: [],
    savings: [],
  };

  const summary = runAllScenarios(engineInput);
  console.log(`  ✅ 기준 D-day: ${summary.baseline.dDay} (D-${summary.baseline.daysRemaining})`);
  console.log(`  ✅ 낙관 D-day: ${summary.optimistic.dDay}`);
  console.log(`  ✅ 비관 D-day: ${summary.pessimistic.dDay}`);

  console.log("\n── 5. 뒷정리 (테스트 데이터 삭제) ──");
  await supabase.from("contracts").delete().eq("id", contract.id);
  await supabase.from("clients").delete().eq("id", client.id);
  console.log("  삭제 완료 (사용자는 재사용을 위해 남겨둠)");

  console.log("\n✅ 전체 파이프라인(Supabase 저장 → 재조회 → 엔진 계산) 정상 동작 확인");
}

main().catch((err) => {
  console.error("❌ 실패:", err.message);
  process.exit(1);
});
