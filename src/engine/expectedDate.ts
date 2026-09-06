// engine/expectedDate.ts
// engine-interface.md 3-1 "예정입금일 계산"
// DRI: A(수경). 이슈 #14 [ENGINE][P0] 예정입금일·예상 실수령액 계산 함수
//
// 원칙:
//   - 이 함수는 순수함수다. contract.expectedDate를 직접 수정하지 않고 새 값을 반환만 한다.
//   - expectedDateSource === "manual"인 계약을 이 함수 결과로 덮어쓰지 않는 건 호출부 책임이다
//     (기획서 [확정 D1-a]: manual이면 엔진이 재계산으로 덮어쓰지 않는다).
//     이 함수 자체는 그 판단을 하지 않고 settlementTerm 기준으로 항상 계산한다.
//   - 주말·공휴일 보정은 P1이고 기본 OFF다(3-1). options.adjustToBusinessDay를 켤 때만
//     다음 영업일로 민다. 기본값을 바꾸면 데모 검증값이 연쇄로 바뀐다 — 2026-10-31이
//     토요일이라 NEXT_MONTH_END 예시가 11/2로 밀린다(이슈 #57).

import type { Contract, DateString } from "../shared/types";
import { nextBusinessDay } from "./businessDay";

export interface ExpectedDateOptions {
  /** true면 토·일·공휴일을 다음 영업일로 민다. 기본 false (3-1, 이슈 #57) */
  adjustToBusinessDay?: boolean;
}

const MIN_SETTLEMENT_DAY = 1;
const MAX_SETTLEMENT_DAY = 365;

export function calculateExpectedDate(
  contract: Pick<Contract, "settlementTerm" | "settlementDay" | "completionDate" | "invoiceDate">,
  options: ExpectedDateOptions = {},
): DateString | null {
  const raw = calculateRawExpectedDate(contract);
  if (raw === null) return null;
  return options.adjustToBusinessDay ? nextBusinessDay(raw) : raw;
}

/** 보정 전 날짜. 정산조건 계산만 한다. */
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
