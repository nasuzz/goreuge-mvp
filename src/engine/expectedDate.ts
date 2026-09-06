// engine/expectedDate.ts
// engine-interface.md 3-1 "예정입금일 계산"
// DRI: A(수경). 이슈 #14 [ENGINE][P0] 예정입금일·예상 실수령액 계산 함수
//
// 원칙:
//   - 이 함수는 순수함수다. contract.expectedDate를 직접 수정하지 않고 새 값을 반환만 한다.
//   - expectedDateSource === "manual"인 계약을 이 함수 결과로 덮어쓰지 않는 건 호출부 책임이다
//     (기획서 [확정 D1-a]: manual이면 엔진이 재계산으로 덮어쓰지 않는다).
//     이 함수 자체는 그 판단을 하지 않고 settlementTerm 기준으로 항상 계산한다.
//   - 주말·공휴일 보정(이슈 #57, 3-1)은 P1이고 MVP는 기본 OFF다. options.adjustWeekendHoliday를
//     명시적으로 true로 넘기지 않으면 계산된 날짜를 그대로 반환한다 — 기존 호출부·검증값은 그대로 유지된다.

import type { Contract, DateString } from "../shared/types";
import {
  isHoliday,
  isHolidayYearCovered,
  KR_HOLIDAYS_CACHE,
  KR_HOLIDAYS_COVERED_YEARS,
} from "../shared/holidays";

const MIN_SETTLEMENT_DAY = 1;
const MAX_SETTLEMENT_DAY = 365;

export interface CalculateExpectedDateOptions {
  /**
   * 예정입금일이 토·일·공휴일이면 다음 영업일로 이동시킬지 여부.
   * 기본 false (MVP는 OFF, engine-interface.md 3-1 "주말·공휴일 보정 (P1, 기본 OFF)").
   */
  adjustWeekendHoliday?: boolean;
  /** 공휴일 판정에 쓸 데이터. 기본은 shared/holidays.ts의 사전 캐시. */
  holidays?: ReadonlySet<string>;
  /**
   * 그 캐시가 공휴일을 빠짐없이 담고 있는 연도. 이 밖의 날짜는 보정하지 않는다.
   * holidays를 직접 넘길 때는 이 값도 같이 넘겨야 커버 범위가 어긋나지 않는다.
   */
  coveredYears?: ReadonlySet<number>;
}

export function calculateExpectedDate(
  contract: Pick<Contract, "settlementTerm" | "settlementDay" | "completionDate" | "invoiceDate">,
  options: CalculateExpectedDateOptions = {},
): DateString | null {
  const date = calculateRawExpectedDate(contract);
  if (date === null) return null;
  if (!options.adjustWeekendHoliday) return date;
  return adjustToNextBusinessDay(
    date,
    options.holidays ?? KR_HOLIDAYS_CACHE,
    options.coveredYears ?? KR_HOLIDAYS_COVERED_YEARS,
  );
}

function calculateRawExpectedDate(
  contract: Pick<Contract, "settlementTerm" | "settlementDay" | "completionDate" | "invoiceDate">,
): DateString | null {
  switch (contract.settlementTerm) {
    case "ON_COMPLETION":
      return contract.completionDate;

    case "SAME_MONTH_END":
      return lastDayOfMonthOffset(contract.completionDate, 0);

    case "NEXT_MONTH_END":
      return lastDayOfMonthOffset(contract.completionDate, 1);

    case "NEXT_MONTH_DAY": {
      const day = requireSettlementDay(contract.settlementDay, "NEXT_MONTH_DAY");
      // 익월에 그 날짜가 없으면 말일로 clamp (예: 1/31 완료 + 익월 31일 → 2월엔 31일이 없어 2/28)
      return dayOfMonthOffsetClamped(contract.completionDate, 1, day);
    }

    case "NET_DAYS": {
      const day = requireSettlementDay(contract.settlementDay, "NET_DAYS");
      // 청구일을 기준일로 우선 사용, 없으면 완료일 (Contract.invoiceDate 주석과 동일)
      const base = contract.invoiceDate ?? contract.completionDate;
      return addDays(base, day);
    }

    case "UNKNOWN":
      return null;
  }
}

/**
 * 토·일·공휴일이면 다음 영업일까지 하루씩 민다 (연휴 연속도 처리).
 *
 * [PR #63 리뷰 반영] 공휴일 캐시가 커버하지 않는 연도는 보정하지 않고 원래 날짜를
 * 그대로 돌려준다. 커버 밖에서 주말 보정만 돌면 "보정된 영업일"처럼 보이지만
 * 공휴일이 조용히 빠진다 — 실제로 2027-02-28(일)이 2027-03-01(삼일절)로 이동해
 * 공휴일을 예정입금일로 내놓았다. 틀린 답을 확신 있게 주는 것보다 손대지 않는 편이
 * 낫다. 커버 연도를 늘리면(shared/holidays.ts) 자동으로 보정 대상이 된다.
 *
 * 연말 계약이 다음 해로 넘어가는 경우(예: 12/31 → 1/1)도 같은 이유로, 미는 도중
 * 커버 밖 연도로 넘어가면 그 시점에 멈추고 원래 날짜를 돌려준다.
 */
function adjustToNextBusinessDay(
  date: DateString,
  holidays: ReadonlySet<string>,
  coveredYears: ReadonlySet<number>,
): DateString {
  if (!isHolidayYearCovered(date, coveredYears)) return date;

  let result = date;
  while (isWeekend(result) || isHoliday(result, holidays)) {
    const next = addDays(result, 1);
    if (!isHolidayYearCovered(next, coveredYears)) return date;
    result = next;
  }
  return result;
}

function isWeekend(date: DateString): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 || day === 6;
}

// ── 내부 헬퍼 ──────────────────────────────────────────────

function requireSettlementDay(
  settlementDay: number | null,
  term: "NEXT_MONTH_DAY" | "NET_DAYS",
): number {
  if (settlementDay === null) {
    throw new Error(
      `[engine] calculateExpectedDate: settlementTerm이 ${term}이면 settlementDay가 필수입니다 (schema chk_settlement_day)`,
    );
  }
  if (settlementDay < MIN_SETTLEMENT_DAY || settlementDay > MAX_SETTLEMENT_DAY) {
    throw new Error(
      `[engine] calculateExpectedDate: settlementDay(${settlementDay})는 ${MIN_SETTLEMENT_DAY}~${MAX_SETTLEMENT_DAY} 범위여야 합니다`,
    );
  }
  return settlementDay;
}

/** date + monthOffset개월 뒤 그 달의 말일 */
function lastDayOfMonthOffset(date: DateString, monthOffset: number): DateString {
  const [y, m] = date.split("-").map(Number);
  // 다음 달 1일에서 하루를 빼면 이번(대상) 달의 말일이 된다.
  const dt = new Date(Date.UTC(y, m - 1 + monthOffset + 1, 1));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return toDateString(dt);
}

/** date + monthOffset개월 뒤 그 달의 day일. day가 그 달 일수를 넘으면 말일로 clamp. */
function dayOfMonthOffsetClamped(date: DateString, monthOffset: number, day: number): DateString {
  const [y, m] = date.split("-").map(Number);
  const daysInTargetMonth = new Date(Date.UTC(y, m - 1 + monthOffset + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  const dt = new Date(Date.UTC(y, m - 1 + monthOffset, clampedDay));
  return toDateString(dt);
}

function addDays(date: DateString, days: number): DateString {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return toDateString(dt);
}

function toDateString(dt: Date): DateString {
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
