// test/verify.ts
// mock-data.ts의 EXPECTED 값과 엔진 실제 출력을 비교한다.
// engine-interface.md 6장 "검증된 기대값 — A의 단위 테스트 기준선"

import { MOCK_ENGINE_INPUT, EXPECTED } from "../src/shared/mock-data";
import { runAllScenarios } from "../src/engine/simulate";

let failCount = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failCount++;
  console.log(`${pass ? "✅" : "❌"} ${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

const summary = runAllScenarios(MOCK_ENGINE_INPUT);

console.log("── 기본값 ──");
check("simulationStartBalance", summary.baseline.simulationStartBalance, EXPECTED.simulationStartBalance);
check("dailyBaselineOutflow", summary.baseline.projections[0].baselineOutflow, EXPECTED.dailyBaselineOutflow);

console.log("── D-day (3시나리오) ──");
check("optimistic.dDay", summary.optimistic.dDay, EXPECTED.dDay.optimistic.date);
check("optimistic.daysRemaining", summary.optimistic.daysRemaining, EXPECTED.dDay.optimistic.daysRemaining);
check("baseline.dDay", summary.baseline.dDay, EXPECTED.dDay.baseline.date);
check("baseline.daysRemaining", summary.baseline.daysRemaining, EXPECTED.dDay.baseline.daysRemaining);
check("pessimistic.dDay", summary.pessimistic.dDay, EXPECTED.dDay.pessimistic.date);
check("pessimistic.daysRemaining", summary.pessimistic.daysRemaining, EXPECTED.dDay.pessimistic.daysRemaining);

console.log("── 주간 가용금액 ──");
check("weekly.safeFund28Days", summary.weekly.safeFund28Days, EXPECTED.weekly.safeFund28Days);
check("weekly.weeklyAvailableAmount", summary.weekly.weeklyAvailableAmount, EXPECTED.weekly.weeklyAvailableAmount);

console.log("── 잔액 3단계 (기준 시나리오 60일) ──");
const first60 = summary.baseline.projections.slice(0, 60);
const safeDays = first60.filter((p) => p.level === "safe").length;
const cautionDays = first60.filter((p) => p.level === "caution").length;
const dangerDays = first60.filter((p) => p.level === "danger").length;
check("balanceLevel.safe", safeDays, EXPECTED.balanceLevel.baseline60Days.safe);
check("balanceLevel.caution", cautionDays, EXPECTED.balanceLevel.baseline60Days.caution);
check("balanceLevel.danger", dangerDays, EXPECTED.balanceLevel.baseline60Days.danger);

const firstCaution = first60.find((p) => p.level === "caution")?.date ?? null;
const firstDanger = first60.find((p) => p.level === "danger")?.date ?? null;
check("firstCaution", firstCaution, EXPECTED.balanceLevel.firstCaution);
check("firstDanger", firstDanger, EXPECTED.balanceLevel.firstDanger);

console.log("── 데모 비트 1: contract-002를 위험으로 지정 ──");
{
  const before = summary.baseline.dDay;
  const modifiedInput = structuredClone(MOCK_ENGINE_INPUT);
  const c = modifiedInput.contracts.find((c) => c.id === "contract-002")!;
  c.status = "risk";
  c.statusSource = "user";
  c.statusReason = "60일 이상 지연 예상, 수동 위험 지정";
  const after = runAllScenarios(modifiedInput).baseline.dDay;
  console.log(`   before=${before} after=${after}`);
  check("demoBeat.markContract002AsRisk.before", before, EXPECTED.demoBeats.markContract002AsRisk.before);
  check("demoBeat.markContract002AsRisk.after", after, EXPECTED.demoBeats.markContract002AsRisk.after);
}

console.log("── 데모 비트 2: 선금 500,000원 9/15 입금 가정 ──");
{
  const before = summary.baseline.dDay;
  const modifiedInput = structuredClone(MOCK_ENGINE_INPUT);
  modifiedInput.contracts.push({
    id: "whatif-advance",
    clientId: "client-001",
    grossAmount: 500000,
    completionDate: modifiedInput.today,
    invoiceDate: null,
    settlementTerm: "ON_COMPLETION",
    settlementDay: null,
    expectedDate: "2026-09-15",
    expectedDateSource: "manual",
    actualDate: null,
    incomeType: "no_withholding",
    classificationStatus: "user_confirmed",
    referenceRate: 0,
    confirmedExpectedRate: 0,
    actualRate: null,
    expectedNetAmount: 500000,
    actualNetAmount: null,
    status: "waiting",
    statusSource: "system",
    statusReason: null,
    statusUpdatedAt: modifiedInput.today,
    createdAt: modifiedInput.today,
    updatedAt: modifiedInput.today,
  });
  const after = runAllScenarios(modifiedInput).baseline.dDay;
  console.log(`   before=${before} after=${after}`);
  check("demoBeat.advancePayment500k.before", before, EXPECTED.demoBeats.advancePayment500k.before);
  check("demoBeat.advancePayment500k.after", after, EXPECTED.demoBeats.advancePayment500k.after);
}

console.log("── 엣지 케이스 ──");
{
  // 계약 0건 + 잔액 충분 -> 90일 내 D-day 없음
  const empty = structuredClone(MOCK_ENGINE_INPUT);
  empty.contracts = [];
  empty.user = { ...empty.user, totalBalance: 999_999_999 };
  const r = runAllScenarios(empty);
  check("edge.noContracts.dDayNull", r.baseline.dDay, null);
}
{
  // simulationStartBalance <= 0 -> D-day = 오늘, 크래시 없음
  const negative = structuredClone(MOCK_ENGINE_INPUT);
  negative.user = { ...negative.user, totalBalance: 0, safetyBuffer: 500000 };
  negative.contracts = [];
  const r = runAllScenarios(negative);
  check("edge.negativeStart.dDayIsToday", r.baseline.dDay, negative.today);
}
{
  // settlementTerm UNKNOWN -> expectedDate null -> 유입 제외
  const c4 = MOCK_ENGINE_INPUT.contracts.find((c) => c.id === "contract-004")!;
  const r = runAllScenarios(MOCK_ENGINE_INPUT);
  const inf = r.baseline.inflows.find((i) => i.contractId === "contract-004")!;
  check("edge.needsReview.amountZero", inf.amount, 0);
  check("edge.needsReview.excludedReasonSet", inf.excludedReason !== null, true);
  void c4;
}
{
  // 계약 취소 -> 유입 0원
  const r = runAllScenarios(MOCK_ENGINE_INPUT);
  const inf = r.baseline.inflows.find((i) => i.contractId === "contract-006")!;
  check("edge.cancelled.amountZero", inf.amount, 0);
}
{
  // 완료 계약 -> D-day 유입에 다시 포함되지 않음 (9-3)
  const r = runAllScenarios(MOCK_ENGINE_INPUT);
  const inf = r.baseline.inflows.find((i) => i.contractId === "contract-005")!;
  check("edge.completed.amountZero", inf.amount, 0);
}

console.log("\n" + (failCount === 0 ? `✅ 전부 통과 (${failCount}건 실패)` : `❌ ${failCount}건 실패`));
process.exit(failCount === 0 ? 0 : 1);
