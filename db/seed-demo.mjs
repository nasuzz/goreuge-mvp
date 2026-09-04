// db/seed-demo.mjs — src/shared/mock-data.json -> db/seed-demo.sql 생성기
//
// 이슈 #23. 데모 시드를 손으로 쓴 SQL로 두면 mock-data.json과 조용히 어긋난다.
// 엔진 기대값(EXPECTED)은 mock-data.json 기준이라, 시드가 한 칸이라도 다르면
// D-day가 안 맞고 그 원인을 찾는 데 시간이 다 간다. 그래서 JSON에서 생성한다.
//
// 재생성:  node db/seed-demo.mjs > db/seed-demo.sql
//
// [왜 API가 아니라 SQL인가]
// POST /api/onboarding + POST /api/contracts 로는 이 데이터를 재현할 수 없다:
//   - POST /api/contracts는 항상 status='waiting', actual_date=null로 넣는다.
//     mock의 delayed/risk/completed/cancelled 4건을 만들 수 없다.
//   - classification_status가 user_confirmed가 아니면 400이다. contract-004는
//     needs_review라 아예 못 들어간다.
//   - clients의 completed_count/median_delay_days/p90_delay_days를 넣는 경로가
//     없다. 전부 0/null이 되어 모든 거래처가 cold_start로 떨어지고, 지연
//     시나리오가 달라져 D-day 기대값(낙관 10-24 / 기준 09-30 / 비관 09-14)이
//     나오지 않는다.
//   - outflows / savings를 넣는 API 자체가 없다. 미수금·잔액 곡선이 통째로 다르다.
// 따라서 시드는 SQL로 넣어야 한다.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(path.join(here, "../src/shared/mock-data.json"), "utf8"));

// mock의 id는 "user-demo-01" 같은 문자열이지만 스키마는 uuid다.
// DEMO_USER_ID를 고정해야 데모 중 다른 행이 잡히지 않으므로(이슈 #23) 결정적으로 매핑한다.
const UUID = {
  user: "a0000000-0000-4000-8000-000000000001",
  client: (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  contract: (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  outflow: (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  saving: (n) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
};

const idMap = new Map([[raw.user.id, UUID.user]]);
raw.clients.forEach((c, i) => idMap.set(c.id, UUID.client(i + 1)));
raw.contracts.forEach((c, i) => idMap.set(c.id, UUID.contract(i + 1)));
raw.outflows.forEach((o, i) => idMap.set(o.id, UUID.outflow(i + 1)));
(raw.savings ?? []).forEach((s, i) => idMap.set(s.id, UUID.saving(i + 1)));

const uuid = (mockId) => {
  const v = idMap.get(mockId);
  if (!v) throw new Error(`매핑되지 않은 id: ${mockId}`);
  return v;
};

// SQL 리터럴. 값은 전부 mock-data.json에서 오지만 문자열은 그대로 이스케이프한다.
const lit = (v) => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return `'${String(v).replace(/'/g, "''")}'`;
};

const row = (values) => `(${values.join(", ")})`;

const out = [];
const p = (s = "") => out.push(s);

p("-- db/seed-demo.sql — 데모 시드 (이슈 #23)");
p("--");
p("-- ⚠️ 이 파일은 생성물이다. 직접 고치지 말 것.");
p("--    재생성: node db/seed-demo.mjs > db/seed-demo.sql");
p("--    원본:   src/shared/mock-data.json");
p("--");
p("-- 적용: Supabase 대시보드 > SQL Editor에 그대로 붙여넣기.");
p("--       schema.sql(+ 이슈 #16 payer_stated_net_amount 마이그레이션)이 먼저 적용돼 있어야 한다.");
p("--");
p("-- 몇 번을 실행해도 같은 상태가 된다(먼저 지우고 넣는다). 스모크 테스트로");
p("-- 데모 데이터가 바뀐 뒤 원상복구할 때도 이 파일을 다시 실행하면 된다.");
p("--");
p(`-- DEMO_USER_ID=${UUID.user}`);
p(`-- 기준일(DEMO_TODAY)=${raw._meta.today}`);
p("--");
p(`-- 페르소나: ${raw._meta.persona}`);
p("");
p("begin;");
p("");
p("-- ── 기존 데모 행 제거 (참조 순서대로) ──────────────────");
p(`delete from savings_checks where saving_id in (select id from savings where user_id = ${lit(UUID.user)});`);
p(`delete from savings      where user_id = ${lit(UUID.user)};`);
p(`delete from transactions where user_id = ${lit(UUID.user)};`);
p(`delete from outflows     where user_id = ${lit(UUID.user)};`);
p(`delete from contracts    where user_id = ${lit(UUID.user)};`);
p(`delete from clients      where user_id = ${lit(UUID.user)};`);
p(`delete from users        where id      = ${lit(UUID.user)};`);
p("");

const u = raw.user;
p("-- ── 1. users ───────────────────────────────────────────");
p(`-- 안전예비금 0원: 제안값 ${u.monthlyFixedOutflow.toLocaleString()}원이 잔액 ${u.totalBalance.toLocaleString()}원보다 커서`);
p("-- 사용자가 '0원으로 시작'을 선택한 케이스(기획서 3-3).");
p("insert into users (id, total_balance, monthly_fixed_outflow, safety_buffer, tax_reserve_rate, created_at, updated_at) values");
p(row([lit(UUID.user), lit(u.totalBalance), lit(u.monthlyFixedOutflow), lit(u.safetyBuffer), lit(u.taxReserveRate), lit(u.createdAt), lit(u.updatedAt)]) + ";");
p("");

p("-- ── 2. clients ─────────────────────────────────────────");
p("-- completed_count가 3 미만이면 통계값은 반드시 null이다(client_stats_consistency).");
p("insert into clients (id, user_id, name, completed_count, median_delay_days, p90_delay_days) values");
p(raw.clients.map((c) => row([
  lit(uuid(c.id)), lit(UUID.user), lit(c.name),
  lit(c.completedCount), lit(c.medianDelayDays), lit(c.p90DelayDays),
])).join(",\n") + ";");
p("");

p("-- ── 3. contracts ───────────────────────────────────────");
p("insert into contracts (");
p("  id, user_id, client_id, gross_amount, completion_date, invoice_date,");
p("  settlement_term, settlement_day, expected_date, expected_date_source, actual_date,");
p("  income_type, classification_status,");
p("  reference_rate, confirmed_expected_rate, actual_rate,");
p("  payer_stated_net_amount, expected_net_amount, actual_net_amount,");
p("  status, status_source, status_reason, status_updated_at, created_at, updated_at");
p(") values");
p(raw.contracts.map((c) => "  " + row([
  lit(uuid(c.id)), lit(UUID.user), lit(uuid(c.clientId)),
  lit(c.grossAmount), lit(c.completionDate), lit(c.invoiceDate),
  lit(c.settlementTerm), lit(c.settlementDay), lit(c.expectedDate),
  lit(c.expectedDateSource), lit(c.actualDate),
  lit(c.incomeType), lit(c.classificationStatus),
  lit(c.referenceRate), lit(c.confirmedExpectedRate), lit(c.actualRate),
  lit(c.payerStatedNetAmount), lit(c.expectedNetAmount), lit(c.actualNetAmount),
  lit(c.status), lit(c.statusSource), lit(c.statusReason),
  lit(c.statusUpdatedAt), lit(c.createdAt), lit(c.updatedAt),
])).join(",\n") + ";");
p("");

p("-- ── 4. outflows ────────────────────────────────────────");
p("-- included_in_baseline=true는 monthly_fixed_outflow에 이미 포함된 항목이다.");
p("-- 엔진이 개별 차감하면 중복 차감이 된다(기획서 9-3).");
p("insert into outflows (id, user_id, kind, name, amount, due_date, recurrence, included_in_baseline) values");
p(raw.outflows.map((o) => "  " + row([
  lit(uuid(o.id)), lit(UUID.user), lit(o.kind), lit(o.name),
  lit(o.amount), lit(o.dueDate), lit(o.recurrence), lit(o.includedInBaseline),
])).join(",\n") + ";");
p("");

if ((raw.savings ?? []).length > 0) {
  p("-- ── 5. savings (P1) ────────────────────────────────────");
  p("insert into savings (id, user_id, kind, name, target_amount, weekly_amount, planned_amount, reserved_amount, spent_amount, status) values");
  p(raw.savings.map((s) => "  " + row([
    lit(uuid(s.id)), lit(UUID.user), lit(s.kind), lit(s.name),
    lit(s.targetAmount), lit(s.weeklyAmount), lit(s.plannedAmount),
    lit(s.reservedAmount), lit(s.spentAmount), lit(s.status),
  ])).join(",\n") + ";");
  p("");
}

p("commit;");
p("");
p("-- ── 투입 후 엔진이 내야 하는 값 (src/shared/mock-data.json의 expectedResults) ──");
p(`--   미수금            ${raw.expectedResults.outstandingReceivable.toLocaleString()}원`);
p(`--   시뮬 시작 잔액    ${raw.expectedResults.simulationStartBalance.toLocaleString()}원`);
for (const k of ["optimistic", "baseline", "pessimistic"]) {
  const d = raw.expectedResults.dDay[k];
  p(`--   D-day ${k.padEnd(11)} ${d.date} (${d.daysRemaining}일)`);
}
p("--");
p("-- 위 숫자 확인:  node test/api-smoke.mjs");

process.stdout.write(out.join("\n") + "\n");
