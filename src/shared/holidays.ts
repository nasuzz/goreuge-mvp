// shared/holidays.ts
// 이슈 #57: 공휴일 API는 P1이고 MVP는 사전 캐시 데이터로 대체한다 (mvp-spec-v3.md 394줄).
// 실제 공휴일 API 연동 전까지, 데모/테스트에 필요한 연도의 대한민국 법정공휴일만 하드코딩한다.
// 대체공휴일 포함. 필요한 연도가 늘어나면 이 목록에 추가한다.
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

/**
 * 이 캐시가 "그 해의 공휴일을 빠짐없이 담고 있다"고 보장하는 연도.
 *
 * [PR #63 리뷰 반영] 캐시에 든 날짜에서 연도를 뽑아내는 방식은 쓰지 않는다.
 * 2028은 윤년 테스트용으로 1월 1일 한 건만 들어 있어서, 자동 추출하면 2028이
 * "커버됨"으로 잡히고 2028-03-01(삼일절)을 영업일로 판정한다. 빠짐없이 넣은
 * 연도만 사람이 명시적으로 여기에 추가한다.
 *
 * 연도를 늘릴 때는 음력 기반 공휴일(설·추석·부처님오신날)과 대체공휴일까지
 * 확인된 자료로 채운 뒤에 이 목록에 넣는다. 추측으로 채우면 보정이 조용히
 * 틀리는 것보다 나쁘다.
 */
export const KR_HOLIDAYS_COVERED_YEARS: ReadonlySet<number> = new Set([2026]);

/** 그 날짜가 속한 해의 공휴일을 캐시가 완전히 담고 있는가. */
export function isHolidayYearCovered(
  date: string,
  coveredYears: ReadonlySet<number> = KR_HOLIDAYS_COVERED_YEARS,
): boolean {
  return coveredYears.has(Number(date.slice(0, 4)));
}
