// test/businessday-verify.ts — 주말·공휴일 보정 (이슈 #57)
// engine-interface.md 3-1 "주말·공휴일 보정 (P1, 기본 OFF)"

import { calculateExpectedDate, isBusinessDay, nextBusinessDay } from "../src/engine/index";
import { MOCK_ENGINE_INPUT } from "../src/shared/mock-data";
import type { Contract } from "../src/shared/types";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "✅" : "❌"} ${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

const nextMonthEnd: Pick<Contract, "settlementTerm" | "settlementDay" | "completionDate" | "invoiceDate"> = {
  settlementTerm: "NEXT_MONTH_END", settlementDay: null,
  completionDate: "2026-09-03", invoiceDate: null,
};

console.log("── 기본 OFF: 기존 검증값이 흔들리지 않아야 한다 ──");
// 이게 이 이슈의 핵심 제약이다. 2026-10-31은 토요일이라, 기본값을 ON으로 바꾸면
// 데모의 기준 D-day·미수금·주간 가용금액이 전부 재산출된다.
check("NEXT_MONTH_END 2026-10-31(토)을 보정 없이 그대로", calculateExpectedDate(nextMonthEnd), "2026-10-31");
check("options를 넘기지 않아도 동일", calculateExpectedDate(nextMonthEnd, {}), "2026-10-31");
check("adjustToBusinessDay:false도 동일", calculateExpectedDate(nextMonthEnd, { adjustToBusinessDay: false }), "2026-10-31");

// 이 이슈가 보장하는 것은 "옵션을 켜지 않으면 계산 결과가 이전과 동일하다"이다.
// mock 계약 전체에 대해 세 호출 형태가 같은 값을 내는지 본다.
// (저장된 expectedDate와 공식값이 다른 건은 이 이슈 밖의 mock 데이터 문제라 여기서 보지 않는다.)
const inconsistent = MOCK_ENGINE_INPUT.contracts.filter((c) => {
  const bare = calculateExpectedDate(c);
  return (
    bare !== calculateExpectedDate(c, {}) ||
    bare !== calculateExpectedDate(c, { adjustToBusinessDay: false })
  );
});
check("mock 계약 전체에서 기본 호출과 OFF 호출의 결과가 같다", inconsistent.map((c) => c.id), []);

console.log("\n── 옵션 ON: 다음 영업일로 민다 ──");
check("토요일이면 월요일로", calculateExpectedDate(nextMonthEnd, { adjustToBusinessDay: true }), "2026-11-02");
check("이미 영업일이면 그대로",
  calculateExpectedDate({ ...nextMonthEnd, settlementTerm: "ON_COMPLETION", completionDate: "2026-09-23" }, { adjustToBusinessDay: true }),
  "2026-09-23");
check("UNKNOWN은 보정 대상이 아니다(null 유지)",
  calculateExpectedDate({ ...nextMonthEnd, settlementTerm: "UNKNOWN" }, { adjustToBusinessDay: true }), null);

console.log("\n── isBusinessDay / nextBusinessDay ──");
check("토요일", isBusinessDay("2026-10-31"), false);
check("일요일", isBusinessDay("2026-11-01"), false);
check("월요일", isBusinessDay("2026-11-02"), true);
check("개천절(토)", isBusinessDay("2026-10-03"), false);
check("개천절 대체공휴일(월)", isBusinessDay("2026-10-05"), false);
check("평일", isBusinessDay("2026-09-23"), true);

// 돈이 늦게 들어온다고 보는 쪽이 보수적이므로 뒤로만 민다.
check("주말은 다음 월요일로", nextBusinessDay("2026-10-31"), "2026-11-02");
check("개천절 연휴는 대체공휴일 다음날로", nextBusinessDay("2026-10-03"), "2026-10-06");
check("추석 연휴를 관통해 다음 영업일로", nextBusinessDay("2026-09-24"), "2026-09-28");
check("영업일은 그대로", nextBusinessDay("2026-09-23"), "2026-09-23");

if (failures > 0) {
  console.error(`\n❌ ${failures}건 실패`);
  process.exit(1);
}
console.log("\n✅ 전부 통과 (0건 실패)");
