// engine/businessDay.ts
// engine-interface.md 3-1 "주말·공휴일 보정 (P1, 기본 OFF)"
// DRI: A. 이슈 #57.
//
// 예정입금일이 토·일·공휴일이면 다음 영업일로 옮긴다. 돈이 늦게 들어온다고 보는 쪽이
// 보수적이라 뒤로만 민다.
//
// [기본 OFF인 이유]
// 데모 검증값이 이 보정에 직접 걸린다. NEXT_MONTH_END 예시인 2026-10-31이 토요일이라,
// 보정을 켜면 11/2(월)로 밀리고 기준 D-day·미수금·주간 가용금액이 연쇄로 바뀐다.
// test/expected-verify.ts도 "10/31이 토요일이어도 보정 없이 그대로"로 고정돼 있다.
// 그래서 로직은 구현하되 호출부가 명시적으로 켤 때만 동작한다.
//
// [공휴일 데이터]
// 기획서 394줄이 "공휴일 API는 P1이며, MVP에서는 사전 캐시 데이터로 대체할 수 있다"고
// 정했다. 외부 호출 없이 상수 표를 쓴다 — 엔진은 네트워크를 모른다(순수함수 원칙).

import type { DateString } from "../shared/types";
import { addDays } from "./scenarioDate";

/**
 * 한국 공휴일 사전 캐시. 데모 시뮬레이션 구간(2026-09 ~ 2027-03)을 덮는다.
 * 음력 기반 공휴일(설·추석·석가탄신일)은 해마다 날짜가 달라 자동 계산하지 않고 적는다.
 * 대체공휴일까지 포함한다.
 */
const HOLIDAYS: ReadonlySet<DateString> = new Set([
  // 2026
  "2026-09-24", "2026-09-25", "2026-09-26", // 추석 연휴
  "2026-10-03", // 개천절
  "2026-10-05", // 개천절 대체공휴일(10/3 토요일)
  "2026-10-09", // 한글날
  "2026-12-25", // 성탄절
  // 2027
  "2027-01-01", // 신정
  "2027-02-06", "2027-02-07", "2027-02-08", // 설 연휴
  "2027-03-01", // 삼일절
]);

/** 토·일이면 true */
function isWeekend(date: DateString): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 || day === 6;
}

/** 토·일이거나 공휴일 표에 있으면 영업일이 아니다 */
export function isBusinessDay(date: DateString): boolean {
  return !isWeekend(date) && !HOLIDAYS.has(date);
}

/**
 * 영업일이 아니면 다음 영업일로 민다. 이미 영업일이면 그대로 돌려준다.
 *
 * 연휴가 길어도 표에 있는 만큼만 밀린다. 무한 루프를 막기 위해 상한을 둔다 —
 * 공휴일 표에 실수로 긴 구간이 들어가도 엔진이 멈추지 않아야 한다.
 */
export function nextBusinessDay(date: DateString): DateString {
  const MAX_SHIFT_DAYS = 14;
  let cursor = date;
  for (let i = 0; i < MAX_SHIFT_DAYS; i++) {
    if (isBusinessDay(cursor)) return cursor;
    cursor = addDays(cursor, 1);
  }
  throw new Error(
    `[engine] nextBusinessDay: ${date}부터 ${MAX_SHIFT_DAYS}일 안에 영업일이 없습니다. 공휴일 표를 확인하세요.`,
  );
}
