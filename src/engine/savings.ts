// engine/savings.ts
// engine-interface.md 3-11 "위시함·세금 준비금 (P1)", 기획서 7장 "적립·준비금 상태 모델"
// DRI: A. 이슈 #56.
//
// 이 파일은 순수함수만 담는다. Supabase를 모른다(engine-interface.md 1절 분리 원칙).
//
// 상태 3개를 분리하는 이유는 이중 차감을 막기 위해서다(기획서 7장).
//   plannedAmount  앞으로 옮기기로 예약   -> 예정일의 미래 유출
//   reservedAmount 옮겼다고 체크한 누적액 -> 현재 가용잔액에서 제외
//   spentAmount    실제 구매·납부에 사용  -> 보호금 감소 + 실제 유출
//
// reservedAmount는 이미 computeSimulationStartBalance가 빼고 있다(3-11 "엔진에서
// 실제로 반영되는 지점"). P0에서는 값이 항상 0이라 결과가 같았을 뿐이고,
// 이 파일이 값을 채우면 D-day가 자동으로 움직인다.

import type { DateString, Saving, SavingsCheck, WishPlan, Won } from "../shared/types";
import { addDays } from "./scenarioDate";

/** 주간 적립액이 이번 주 가용금액의 이 비율을 넘으면 경고한다(저장은 허용) */
const WEEKLY_WARNING_RATIO = 0.3;

const DAYS_PER_WEEK = 7;

/**
 * 위시 적립 계획 (3-11).
 *
 * 달성 예정일 = ceil(targetAmount / weeklyAmount) 주 후 — 규격의 공식을 그대로 쓴다.
 * `affordableDate`("살 수 있는 날")는 이미 모아둔 reservedAmount를 뺀 잔여분 기준이라
 * targetDate보다 앞선다. 목표를 다 채운 뒤라면 오늘이다.
 *
 * targetAmount나 weeklyAmount가 없으면(세금 준비금처럼 목표액 없이 굴리는 경우)
 * 날짜를 만들 수 없으므로 null을 반환한다 — 0으로 나눠 Infinity가 새어나가지 않게 한다.
 */
export function calculateWishPlan(
  saving: Saving,
  weeklyAvailableAmount: Won,
  today: DateString,
): WishPlan {
  const { targetAmount, weeklyAmount } = saving;
  const exceedsWeeklyWarning =
    weeklyAmount !== null && weeklyAmount > weeklyAvailableAmount * WEEKLY_WARNING_RATIO;

  if (targetAmount === null || weeklyAmount === null || weeklyAmount <= 0) {
    return {
      savingId: saving.id,
      targetDate: null,
      weeksRemaining: null,
      exceedsWeeklyWarning,
      affordableDate: null,
    };
  }

  const weeksToTarget = Math.ceil(targetAmount / weeklyAmount);
  // 이미 옮겨둔 만큼은 다시 모을 필요가 없다. 음수가 되면 0(오늘)으로 clamp한다.
  const remaining = Math.max(0, targetAmount - saving.reservedAmount);
  const weeksToAfford = Math.ceil(remaining / weeklyAmount);

  return {
    savingId: saving.id,
    targetDate: addDays(today, weeksToTarget * DAYS_PER_WEEK),
    weeksRemaining: weeksToAfford,
    exceedsWeeklyWarning,
    affordableDate: addDays(today, weeksToAfford * DAYS_PER_WEEK),
  };
}

/**
 * 적립 체크 반영 (3-11, 기획서 7장).
 *
 *   체크 완료: plannedAmount 감소, reservedAmount 증가, 추가 차감 없음
 *
 * 앱은 계좌이체를 실행하지 않는다. 사용자가 "옮겼다"고 체크한 사실만 기록한다.
 *
 * DB가 `reservedAmount > 체크 이력 합계`와 `spentAmount <= reservedAmount`를 막으므로
 * 엔진에서도 같은 검증을 먼저 한다(3-11 "A가 P1에서 추가로 할 일" 4번).
 * DB까지 내려가서 제약에 걸리면 사용자에게는 원인 없는 500으로만 보인다.
 */
export function applySavingsCheck(saving: Saving, check: SavingsCheck): Saving {
  if (check.savingId !== saving.id) {
    throw new Error(
      `[engine] applySavingsCheck: savingId 불일치 (${check.savingId} vs ${saving.id})`,
    );
  }
  if (!Number.isInteger(check.amount) || check.amount <= 0) {
    throw new Error(
      `[engine] applySavingsCheck: amount(${check.amount})는 1 이상의 원 단위 정수여야 합니다`,
    );
  }
  // 예약하지 않은 금액을 옮겼다고 체크하면 planned가 음수가 된다.
  // DB의 planned_amount >= 0 제약과 같은 기준이다.
  if (check.amount > saving.plannedAmount) {
    throw new Error(
      `[engine] applySavingsCheck: 체크 금액(${check.amount})이 예약액(${saving.plannedAmount})을 초과합니다`,
    );
  }

  return {
    ...saving,
    plannedAmount: saving.plannedAmount - check.amount,
    reservedAmount: saving.reservedAmount + check.amount,
    // 목표액이 있고 다 모았으면 완료로 본다. 목표액이 없는 준비금은 계속 active다.
    status:
      saving.targetAmount !== null &&
      saving.reservedAmount + check.amount >= saving.targetAmount
        ? "completed"
        : "active",
  };
}
