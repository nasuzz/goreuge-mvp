// test/payment-verify.ts — 입금 확인 & 공제율 역산, 거래처 지연 통계 (이슈 #55)
// engine-interface.md 3-9, 3-10

import { confirmPayment, recalculateClientStats, calculateExpectedNetAmount } from "../src/engine/index";
import type { Client, Contract } from "../src/shared/types";

const NOW = "2026-11-02T10:00:00+09:00";
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

function contract(patch: Partial<Contract> = {}): Contract {
  return {
    id: "contract-x", clientId: "client-x", grossAmount: 2_400_000,
    completionDate: "2026-09-03", invoiceDate: null,
    settlementTerm: "NEXT_MONTH_END", settlementDay: null,
    expectedDate: "2026-10-31", expectedDateSource: "calculated", actualDate: null,
    incomeType: "business_personal_service", classificationStatus: "user_confirmed",
    referenceRate: 0.033, confirmedExpectedRate: 0.033, actualRate: null,
    payerStatedNetAmount: null, expectedNetAmount: 2_320_800, actualNetAmount: null,
    status: "waiting", statusSource: "system", statusReason: null,
    statusUpdatedAt: "2026-09-01T09:00:00+09:00",
    createdAt: "2026-08-20T09:00:00+09:00", updatedAt: "2026-09-01T09:00:00+09:00",
    ...patch,
  };
}

console.log("── confirmPayment: 상태 전이와 공제율 역산 (3-9) ──");

const confirmed = confirmPayment(
  contract(),
  { contractId: "contract-x", actualDate: "2026-11-02", actualNetAmount: 2_320_800 },
  NOW,
);
check("classificationStatus -> actual_confirmed", confirmed.classificationStatus, "actual_confirmed");
check("status -> completed", confirmed.status, "completed");
check("actualRate 역산 (2,400,000 -> 2,320,800 = 3.3%)", confirmed.actualRate, 0.033);
check("statusUpdatedAt/updatedAt에 now 주입", [confirmed.statusUpdatedAt, confirmed.updatedAt], [NOW, NOW]);
// 잠정값은 지우지 않는다 — "예상과 실제가 얼마나 달랐나"의 근거가 된다.
check("expectedNetAmount는 남긴다", confirmed.expectedNetAmount, 2_320_800);
// 3-3 우선순위상 actualNetAmount가 최우선이라 화면은 자동으로 실제값을 쓴다.
check("화면 표시값은 actual", calculateExpectedNetAmount(confirmed), { amount: 2_320_800, status: "actual" });

// 예상과 실제가 다른 경우 — 지급처가 8.8%를 뗀 케이스
const different = confirmPayment(
  contract(),
  { contractId: "contract-x", actualDate: "2026-11-02", actualNetAmount: 2_188_800 },
  NOW,
);
check("실제 공제율이 참조율과 달라도 그대로 역산 (8.8%)", different.actualRate, 0.088);
check("잠정값과 실제값이 함께 남는다", [different.expectedNetAmount, different.actualNetAmount], [2_320_800, 2_188_800]);

// 전액 입금(공제 없음)과 전액 공제(0원) 경계
check("공제 없이 전액 입금이면 actualRate 0", confirmPayment(contract(), { contractId: "contract-x", actualDate: "2026-11-02", actualNetAmount: 2_400_000 }, NOW).actualRate, 0);
check("0원 입금도 허용(actualRate 1)", confirmPayment(contract(), { contractId: "contract-x", actualDate: "2026-11-02", actualNetAmount: 0 }, NOW).actualRate, 1);

console.log("\n── confirmPayment: 방어 ──");
throws("총액 초과 입금이면 throw (DB chk_net_le_gross와 동일 기준)", () =>
  confirmPayment(contract(), { contractId: "contract-x", actualDate: "2026-11-02", actualNetAmount: 2_400_001 }, NOW));
throws("음수 입금이면 throw", () =>
  confirmPayment(contract(), { contractId: "contract-x", actualDate: "2026-11-02", actualNetAmount: -1 }, NOW));
throws("원 단위 정수가 아니면 throw", () =>
  confirmPayment(contract(), { contractId: "contract-x", actualDate: "2026-11-02", actualNetAmount: 100.5 }, NOW));
throws("contractId가 다르면 throw", () =>
  confirmPayment(contract(), { contractId: "other", actualDate: "2026-11-02", actualNetAmount: 1 }, NOW));
throws("취소된 계약은 입금 확인 불가", () =>
  confirmPayment(contract({ status: "cancelled" }), { contractId: "contract-x", actualDate: "2026-11-02", actualNetAmount: 1 }, NOW));

console.log("\n── recalculateClientStats: 지연 통계 (3-10) ──");

const client: Client = { id: "client-x", name: "D에이전시", completedCount: 0, medianDelayDays: null, p90DelayDays: null };
const done = (id: string, expected: string, actual: string): Contract =>
  contract({ id, expectedDate: expected, actualDate: actual, actualNetAmount: 1, status: "completed", classificationStatus: "actual_confirmed" });

check("완료 0건이면 통계 없음",
  recalculateClientStats(client, []),
  { ...client, completedCount: 0, medianDelayDays: null, p90DelayDays: null });

// 4-4 cold start: 3건 미만이면 신뢰하지 않는다.
check("완료 2건(3건 미만)이면 중앙값·p90은 null",
  recalculateClientStats(client, [done("a", "2026-01-10", "2026-01-15"), done("b", "2026-02-10", "2026-02-12")]),
  { ...client, completedCount: 2, medianDelayDays: null, p90DelayDays: null });

// 지연일 1,2,5,8,20 -> 중앙값 5, p90(최근접 순위) 20
const five = [
  done("a", "2026-01-10", "2026-01-15"), // 5
  done("b", "2026-02-10", "2026-02-12"), // 2
  done("c", "2026-03-10", "2026-03-30"), // 20
  done("d", "2026-04-10", "2026-04-11"), // 1
  done("e", "2026-05-10", "2026-05-18"), // 8
];
check("완료 5건이면 중앙값·p90 계산",
  recalculateClientStats(client, five),
  { ...client, completedCount: 5, medianDelayDays: 5, p90DelayDays: 20 });

// 예정보다 일찍 들어온 건 "음수 지연"이 아니라 0이다.
check("일찍 입금된 건은 지연 0으로 clamp",
  recalculateClientStats(client, [done("a", "2026-01-10", "2026-01-05"), done("b", "2026-02-10", "2026-02-01"), done("c", "2026-03-10", "2026-03-10")]),
  { ...client, completedCount: 3, medianDelayDays: 0, p90DelayDays: 0 });

check("다른 거래처 계약은 세지 않는다",
  recalculateClientStats(client, [{ ...done("z", "2026-01-10", "2026-01-20"), clientId: "other" }]),
  { ...client, completedCount: 0, medianDelayDays: null, p90DelayDays: null });

// 입금 미확인 건은 통계 대상이 아니다.
check("actualDate가 없는 계약은 제외",
  recalculateClientStats(client, [contract({ id: "p", actualDate: null })]),
  { ...client, completedCount: 0, medianDelayDays: null, p90DelayDays: null });

console.log("\n── confirmPayment -> recalculateClientStats 연결 ──");
// 3-9가 "clients 지연 통계 재계산 트리거"라고 적은 흐름을 그대로 태운다.
const history = [done("a", "2026-01-10", "2026-01-13"), done("b", "2026-02-10", "2026-02-13")];
const justConfirmed = confirmPayment(
  contract({ id: "c3", expectedDate: "2026-03-10" }),
  { contractId: "c3", actualDate: "2026-03-13", actualNetAmount: 2_320_800 },
  NOW,
);
check("입금 확인 직후 3건이 되어 통계가 생긴다",
  recalculateClientStats(client, [...history, justConfirmed]),
  { ...client, completedCount: 3, medianDelayDays: 3, p90DelayDays: 3 });

if (failures > 0) {
  console.error(`\n❌ ${failures}건 실패`);
  process.exit(1);
}
console.log("\n✅ 전부 통과 (0건 실패)");
