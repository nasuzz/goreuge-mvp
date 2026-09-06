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

console.log("── 캐시에 없는 연도(2027)는 보정하지 않음 (PR #63 리뷰: lyoonji) ──");
check(
  // 완료 2027-01-15 + 익월 말일 = 2027-02-28(일). 커버 밖 연도라 주말이어도 그대로 반환.
  // (보정했다면 2027-03-01(월)이 되는데, 그날은 삼일절이라 실제로는 영업일이 아니다 —
  //  캐시가 2027을 모르므로 "틀리게 보정"하는 대신 아예 손대지 않는다.)
  "2027-02-28(일)도 커버 밖이라 보정 없이 그대로",
  calculateExpectedDate(
    { settlementTerm: "NEXT_MONTH_END", settlementDay: null, completionDate: "2027-01-15", invoiceDate: null },
    { adjustWeekendHoliday: true },
  ),
  "2027-02-28",
);
check(
  // 완료 2026-12-20 + NET_DAYS 60일 = 2027-02-18(목, 평일). 연도가 커버 밖이라
  // 애초에 보정 대상 여부도 판단하지 않고 그대로 반환(우연히 평일이라 결과는 같지만
  // 판단 로직 자체가 스킵되는 걸 확인하는 회귀 케이스).
  "연말 계약이 다음 해로 넘어가는 예정일도 커버 밖이면 그대로",
  calculateExpectedDate(
    { settlementTerm: "NET_DAYS", settlementDay: 60, completionDate: "2026-12-20", invoiceDate: null },
    { adjustWeekendHoliday: true },
  ),
  "2027-02-18",
);
check(
  // 연휴가 연말에 이틀 연속(12/30, 12/31)이라고 가정하고 하루씩 밀다 보면 2027-01-01로
  // 넘어간다 — 그 순간 연도가 coveredYears(2026) 밖이 되므로, 1/1 자체가 공휴일인지는
  // 더 확인하지 않고 거기서 멈춘다(실제 신정 여부와 무관하게 "더는 모른다"가 정답).
  "연휴 보정 도중 커버 밖 연도로 넘어가면 그 지점에서 멈춘다",
  calculateExpectedDate(
    { settlementTerm: "ON_COMPLETION", settlementDay: null, completionDate: "2026-12-30", invoiceDate: null },
    {
      adjustWeekendHoliday: true,
      holidays: new Set(["2026-12-30", "2026-12-31"]),
      coveredYears: new Set([2026]),
    },
  ),
  "2027-01-01",
);

console.log("\n" + (failCount === 0 ? `✅ 전부 통과 (${failCount}건 실패)` : `❌ ${failCount}건 실패`));
process.exit(failCount === 0 ? 0 : 1);
