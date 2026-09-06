// test/expected-holiday-verify.ts
// 이슈 #57 [ENGINE][P1] 예정입금일 주말·공휴일 보정 (기본 OFF 유지)
// adjustWeekendHoliday 옵션을 켰을 때의 동작만 검증한다.
// 옵션을 주지 않은 기본 동작(OFF)은 test/expected-verify.ts에서 계속 고정 검증된다 —
// 이 파일이 그 기존 계약을 바꾸지 않는다.
import { calculateExpectedDate } from "../src/engine/index";

let failCount = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failCount++;
  console.log(`${pass ? "✅" : "❌"} ${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

console.log("── calculateExpectedDate: adjustWeekendHoliday 옵션 ──");

check(
  "옵션 없으면 기본 OFF (10/31 토요일 그대로) — 기존 계약 회귀 확인",
  calculateExpectedDate({ settlementTerm: "NEXT_MONTH_END", settlementDay: null, completionDate: "2026-09-03", invoiceDate: null }),
  "2026-10-31",
);
check(
  "adjustWeekendHoliday: false를 명시해도 OFF와 동일",
  calculateExpectedDate(
    { settlementTerm: "NEXT_MONTH_END", settlementDay: null, completionDate: "2026-09-03", invoiceDate: null },
    { adjustWeekendHoliday: false },
  ),
  "2026-10-31",
);
check(
  "이슈 #57 데모 예시: ON이면 10/31(토) -> 11/2(월)",
  calculateExpectedDate(
    { settlementTerm: "NEXT_MONTH_END", settlementDay: null, completionDate: "2026-09-03", invoiceDate: null },
    { adjustWeekendHoliday: true },
  ),
  "2026-11-02",
);
check(
  "토요일이면서 공휴일(개천절, 10/3)이고 대체공휴일(10/5, 월)까지 겹치면 그 다음 영업일(10/6, 화)로",
  calculateExpectedDate(
    { settlementTerm: "NEXT_MONTH_DAY", settlementDay: 3, completionDate: "2026-09-03", invoiceDate: null },
    { adjustWeekendHoliday: true },
  ),
  "2026-10-06",
);
check(
  "평일 공휴일(추석 연휴, 9/24 목~9/26 토)에 주말까지 이어지면 다음 영업일(9/28, 월)로",
  calculateExpectedDate(
    { settlementTerm: "ON_COMPLETION", settlementDay: null, completionDate: "2026-09-24", invoiceDate: null },
    { adjustWeekendHoliday: true },
  ),
  "2026-09-28",
);
check(
  "평일·공휴일 아니면 ON이어도 그대로",
  calculateExpectedDate(
    { settlementTerm: "NET_DAYS", settlementDay: 15, completionDate: "2026-09-03", invoiceDate: null },
    { adjustWeekendHoliday: true },
  ),
  "2026-09-18",
);
check(
  "UNKNOWN은 ON이어도 여전히 null",
  calculateExpectedDate(
    { settlementTerm: "UNKNOWN", settlementDay: null, completionDate: "2026-09-03", invoiceDate: null },
    { adjustWeekendHoliday: true },
  ),
  null,
);

// ── [PR #63 리뷰 반영] 공휴일 캐시가 커버하지 않는 연도 ──────────
//
// 커버 밖에서 주말 보정만 돌면 "보정된 영업일"처럼 보이지만 공휴일이 조용히 빠진다.
// 실제로 2027-02-28(일)이 2027-03-01(삼일절)로 이동해 공휴일을 예정입금일로 내놨었다.
// 손대지 않는 쪽이 틀린 답을 확신 있게 주는 것보다 낫다.
check(
  "커버 밖 연도(2027)는 보정하지 않고 원래 날짜 유지",
  calculateExpectedDate(
    { settlementTerm: "NEXT_MONTH_END", settlementDay: null, completionDate: "2027-01-15", invoiceDate: null },
    { adjustWeekendHoliday: true },
  ),
  "2027-02-28",
);
check(
  "공휴일이 1건만 든 연도(2028)도 커버로 치지 않는다",
  calculateExpectedDate(
    { settlementTerm: "NEXT_MONTH_END", settlementDay: null, completionDate: "2028-02-15", invoiceDate: null },
    { adjustWeekendHoliday: true },
  ),
  "2028-03-31",
);
check(
  "커버 연도(2026)는 그대로 보정된다 — 회귀",
  calculateExpectedDate(
    { settlementTerm: "NEXT_MONTH_END", settlementDay: null, completionDate: "2026-09-03", invoiceDate: null },
    { adjustWeekendHoliday: true },
  ),
  "2026-11-02",
);
check(
  "커버 연도를 넘겨주면 그 연도도 보정 대상이 된다",
  calculateExpectedDate(
    { settlementTerm: "NEXT_MONTH_END", settlementDay: null, completionDate: "2027-01-15", invoiceDate: null },
    {
      adjustWeekendHoliday: true,
      holidays: new Set(["2027-03-01"]),
      coveredYears: new Set([2027]),
    },
  ),
  "2027-03-02",
);

console.log("\n" + (failCount === 0 ? `✅ 전부 통과 (${failCount}건 실패)` : `❌ ${failCount}건 실패`));
process.exit(failCount === 0 ? 0 : 1);
