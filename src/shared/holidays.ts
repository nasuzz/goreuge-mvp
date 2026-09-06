// shared/holidays.ts
// 이슈 #57: 공휴일 API는 P1이고 MVP는 사전 캐시 데이터로 대체한다 (mvp-spec-v3.md 394줄).
// 실제 공휴일 API 연동 전까지, 데모/테스트에 필요한 연도의 대한민국 법정공휴일만 하드코딩한다.
// 대체공휴일 포함. 필요한 연도가 늘어나면 이 목록에 추가한다.
//
// [PR #63 리뷰 반영 — lyoonji] 캐시에 없는 연도(예: 2027)에서 주말 보정만 적용하면
// "삼일절(3/1)인데 평일이라 그대로 반환"처럼 조용히 틀린 날짜가 나온다. 아무 신호도
// 없이 틀리는 게 가장 나쁘므로, KR_HOLIDAYS_COVERED_YEARS에 없는 연도는 보정 자체를
// 하지 않는다(engine/expectedDate.ts의 adjustToNextBusinessDay 참고).
// 2028은 "2028-01-01" 하나만 윤년 테스트용으로 넣어둔 것이라 커버 대상이 아니다.
export const KR_HOLIDAYS_COVERED_YEARS: ReadonlySet<number> = new Set([2026]);

export const KR_HOLIDAYS_CACHE: ReadonlySet<string> = new Set([
  // 2026
  "2026-01-01", // 신정
  "2026-02-16",
  "2026-02-17",
  "2026-02-18", // 설 연휴
  "2026-03-01", // 삼일절
  "2026-03-02", // 삼일절 대체공휴일
  "2026-05-05", // 어린이날
  "2026-05-24",
  "2026-05-25", // 부처님오신날 및 대체공휴일
  "2026-06-06", // 현충일
  "2026-08-15", // 광복절
  "2026-08-17", // 광복절 대체공휴일
  "2026-09-24",
  "2026-09-25",
  "2026-09-26", // 추석 연휴
  "2026-10-03", // 개천절
  "2026-10-05", // 개천절 대체공휴일
  "2026-10-09", // 한글날
  "2026-12-25", // 성탄절
  // 2028 (윤년 테스트용)
  "2028-01-01",
]);

export function isHoliday(date: string, holidays: ReadonlySet<string> = KR_HOLIDAYS_CACHE): boolean {
  return holidays.has(date);
}
