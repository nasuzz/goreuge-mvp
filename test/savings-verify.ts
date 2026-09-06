// test/savings-verify.ts — 위시 적립·세금 준비금 (이슈 #56)
// engine-interface.md 3-11, 기획서 7장

import { applySavingsCheck, calculateWishPlan, runAllScenarios } from "../src/engine/index";
import { EXPECTED, MOCK_ENGINE_INPUT } from "../src/shared/mock-data";
import type { Saving, SavingsCheck } from "../src/shared/types";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "✅" : "❌"} ${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

function throws(label: string, fn: () => unknown): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  check(label, threw, true);
}

function saving(patch: Partial<Saving> = {}): Saving {
  return {
    id: "saving-x", kind: "wish", name: "모니터 교체",
    targetAmount: 600_000, weeklyAmount: 50_000,
    plannedAmount: 0, reservedAmount: 0, spentAmount: 0, status: "waiting",
    ...patch,
  };
}

function savingsCheck(patch: Partial<SavingsCheck> = {}): SavingsCheck {
  return {
    id: "check-x", savingId: "saving-x",
    checkedAt: "2026-09-01T09:00:00+09:00", amount: 50_000, transferConfirmed: true,
    ...patch,
  };
}

console.log("── calculateWishPlan (3-11) ──");

// 달성 예정일 = ceil(targetAmount / weeklyAmount) 주 후. 600,000 / 50,000 = 12주.
check("목표 60만원·주 5만원이면 12주 후",
  calculateWishPlan(saving(), 1_000_000, "2026-09-01").targetDate, "2026-11-24");

// 경고 조건 = weeklyAmount > weeklyAvailableAmount x 0.30. 저장은 허용한다.
check("주간 적립액이 가용금액의 30%를 넘으면 경고 (50,000 > 15,100 x 0.3)",
  calculateWishPlan(saving(), 15_100, "2026-09-01").exceedsWeeklyWarning, true);
check("30% 이하면 경고 없음 (50,000 <= 200,000 x 0.3)",
  calculateWishPlan(saving(), 200_000, "2026-09-01").exceedsWeeklyWarning, false);
check("경고는 저장을 막지 않는다 — 날짜는 그대로 계산된다",
  calculateWishPlan(saving(), 15_100, "2026-09-01").targetDate, "2026-11-24");

// "살 수 있는 날"은 이미 모아둔 만큼을 뺀 잔여분 기준이라 목표일보다 앞선다.
const halfway = calculateWishPlan(saving({ reservedAmount: 300_000 }), 200_000, "2026-09-01");
check("30만원을 이미 모았으면 잔여 6주", halfway.weeksRemaining, 6);
check("살 수 있는 날은 목표일보다 앞선다", [halfway.affordableDate, halfway.targetDate], ["2026-10-13", "2026-11-24"]);
check("목표를 이미 채웠으면 오늘 살 수 있다",
  calculateWishPlan(saving({ reservedAmount: 600_000 }), 200_000, "2026-09-01").affordableDate, "2026-09-01");
check("초과 적립도 오늘로 clamp (음수 주가 되지 않는다)",
  calculateWishPlan(saving({ reservedAmount: 900_000 }), 200_000, "2026-09-01").weeksRemaining, 0);

// 세금 준비금은 목표액 없이 굴린다. 0으로 나눠 Infinity가 새면 안 된다.
const tax = calculateWishPlan(saving({ kind: "tax", targetAmount: null, weeklyAmount: null }), 15_100, "2026-09-01");
check("목표액·주간액이 없으면 날짜는 null", [tax.targetDate, tax.weeksRemaining, tax.affordableDate], [null, null, null]);
check("목표액이 없으면 경고도 없다", tax.exceedsWeeklyWarning, false);

console.log("\n── applySavingsCheck (3-11, 기획서 7장) ──");

// 체크 완료: planned 감소, reserved 증가, 추가 차감 없음
const before = saving({ plannedAmount: 288_000 });
const after = applySavingsCheck(before, savingsCheck({ amount: 288_000 }));
check("planned 감소 / reserved 증가", [after.plannedAmount, after.reservedAmount], [0, 288_000]);
check("spentAmount는 건드리지 않는다", after.spentAmount, before.spentAmount);
check("목표액을 채우면 completed", applySavingsCheck(saving({ plannedAmount: 600_000 }), savingsCheck({ amount: 600_000 })).status, "completed");
check("아직 못 채웠으면 active", applySavingsCheck(saving({ plannedAmount: 600_000 }), savingsCheck({ amount: 50_000 })).status, "active");
check("목표액이 없는 준비금은 계속 active", after.status, "active");

throws("예약액을 초과해 체크하면 throw (DB planned_amount >= 0과 동일 기준)",
  () => applySavingsCheck(saving({ plannedAmount: 100 }), savingsCheck({ amount: 101 })));
throws("0원 체크는 throw", () => applySavingsCheck(before, savingsCheck({ amount: 0 })));
throws("원 단위 정수가 아니면 throw", () => applySavingsCheck(before, savingsCheck({ amount: 1.5 })));
throws("savingId가 다르면 throw", () => applySavingsCheck(before, savingsCheck({ savingId: "other" })));

console.log("\n── 데모 비트: 세금 준비금 288,000원 체크 (3-11) ──");
// 3-11이 "P1이 완성되면 생기는 데모 비트"로 실측값을 적어둔 장면이다.
// reservedAmount가 simulationStartBalance에서 빠지면서 D-day가 앞당겨진다.
const beat = EXPECTED.demoBeats.taxReserveCheck288k;
const taxSaving = MOCK_ENGINE_INPUT.savings.find((s) => s.kind === "tax");
if (!taxSaving) {
  failures++;
  console.log("❌ mock-data에 세금 준비금이 없습니다");
} else {
  const dDayBefore = runAllScenarios(MOCK_ENGINE_INPUT);
  const checked = applySavingsCheck(taxSaving, savingsCheck({ savingId: taxSaving.id, amount: 288_000 }));
  const dDayAfter = runAllScenarios({
    ...MOCK_ENGINE_INPUT,
    savings: MOCK_ENGINE_INPUT.savings.map((s) => (s.id === taxSaving.id ? checked : s)),
  });

  check("체크 전 기준 D-day", dDayBefore.baseline.dDay, beat.before);
  check("체크 후 기준 D-day", dDayAfter.baseline.dDay, beat.after);
  check("앞당겨진 일수", (dDayBefore.baseline.daysRemaining ?? 0) - (dDayAfter.baseline.daysRemaining ?? 0), beat.daysEarlier);
  // 보호금이 시작 잔액에서 실제로 빠졌는지 — 이게 안 빠지면 D-day가 움직일 리 없다.
  check("보호금만큼 시뮬 시작잔액 감소",
    dDayBefore.balanceBreakdown.simulationStartBalance - dDayAfter.balanceBreakdown.simulationStartBalance,
    288_000);
}

if (failures > 0) {
  console.error(`\n❌ ${failures}건 실패`);
  process.exit(1);
}
console.log("\n✅ 전부 통과 (0건 실패)");
