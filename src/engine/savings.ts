// engine/savings.ts
// engine-interface.md 3-11 "위시함·세금 준비금 (P1)"
// DRI: A(수경). 이슈 #56 [ENGINE][P1] 위시 적립·세금 준비금 체크 실동작 구현
//
// 원칙(1장): 엔진은 Supabase를 모른다. 이 파일도 마찬가지 — DB 트리거를 신뢰하지 않고
// 같은 불변식을 엔진에서 먼저 검증한다(9-3 무결성, 3-11 "A가 P1에서 추가로 할 일" 4).

import type { Saving, SavingsCheck, WishPlan, DateString, Won } from "../shared/types";
import { addDays } from "./scenarioDate";
import { MVP_POLICY } from "../shared/policy";

// ── 위시함 달성 예정일 (3-11) ─────────────────────────────
//
// targetAmount·weeklyAmount가 없으면(세금 준비금처럼 목표액 개념이 없는 kind="tax")
// 계산 자체가 성립하지 않으므로 전부 null/false로 반환한다.
export function calculateWishPlan(
  saving: Saving, weeklyAvailableAmount: Won, today: DateString,
): WishPlan {
  const { targetAmount, weeklyAmount, reservedAmount } = saving;

  if (targetAmount === null || weeklyAmount === null || weeklyAmount <= 0) {
    return {
      savingId: saving.id,
      targetDate: null,
      weeksRemaining: null,
      exceedsWeeklyWarning: false,
      affordableDate: null,
    };
  }

  // 규격 그대로: 달성 예정일 = ceil(targetAmount ÷ weeklyAmount) 주 후.
  const weeksRemaining = Math.ceil(targetAmount / weeklyAmount);
  const targetDate = addDays(today, weeksRemaining * 7);

  // 경고 조건 = weeklyAmount > weeklyAvailableAmount × 0.30 (저장은 허용, 경고만).
  const exceedsWeeklyWarning = weeklyAmount > weeklyAvailableAmount * MVP_POLICY.wishWeeklyWarningRatio;

  // affordableDate: "보호금과 구매 유출을 상계한 살 수 있는 날" — 이미 체크해 둔
  // reservedAmount만큼은 목표에 반영해 준다(targetDate는 규격 원문의 순수 계산이라
  // reservedAmount를 반영하지 않으므로, 실제 "살 수 있는 날"은 이 값을 따로 둔다).
  const remainingAfterReserved = Math.max(0, targetAmount - reservedAmount);
  const affordableDate = remainingAfterReserved <= 0
    ? today
    : addDays(today, Math.ceil(remainingAfterReserved / weeklyAmount) * 7);

  return { savingId: saving.id, targetDate, weeksRemaining, exceedsWeeklyWarning, affordableDate };
}

// ── 적립 체크 반영 (3-11) ─────────────────────────────────
//
// "체크 완료: plannedAmount 감소, reservedAmount 증가, 추가 차감 없음" (7장).
// planned+reserved 총액은 이 함수 호출 전후로 변하지 않는다 — 새 돈이 생기는 게
// 아니라 "옮기기로 예약한 돈"이 "옮겼다고 확인한 돈"으로 옮겨갈 뿐이다.
//
// DB 트리거(chk_reserved_not_exceeds_checks)가 reservedAmount > 체크이력 합계를
// 막으므로, 여기서도 같은 취지로 "이번 체크가 plannedAmount 잔액을 넘지 않는지"를
// 먼저 검증한다 — 서버 왕복 없이 화면에서 바로 실패를 알 수 있어야 하기 때문(3-11).
//
// [PR #64 리뷰 반영, lyoonji] 이 함수는 saving.status(SavingsStatus)를 의도적으로
// 건드리지 않는다 — engine-interface.md 3-11의 "적립 상태 전이"는 금액 필드 얘기이고,
// status enum의 전이 규칙은 어디에도 정의돼 있지 않다. 화면은 status가 아니라
// reservedAmount/plannedAmount 값으로 적립 중/완료 여부를 판단해야 한다.
// "구매 완료"(reservedAmount 감소·spentAmount 증가) 전이는 이 이슈(#56) 범위 밖이라
// 별도 함수로 두지 않았다 — 필요해지면 후속 이슈로 뺀다.
export function applySavingsCheck(saving: Saving, check: SavingsCheck): Saving {
  if (check.savingId !== saving.id) {
    throw new Error(
      `[engine] applySavingsCheck: check.savingId(${check.savingId})가 saving.id(${saving.id})와 다릅니다`,
    );
  }
  if (check.amount <= 0) {
    throw new Error(`[engine] applySavingsCheck: check.amount는 0보다 커야 합니다 (받은 값: ${check.amount})`);
  }
  if (check.amount > saving.plannedAmount) {
    throw new Error(
      `[engine] applySavingsCheck: 체크 금액(${check.amount})이 plannedAmount 잔액(${saving.plannedAmount})을 초과합니다 (9-3 무결성)`,
    );
  }

  return {
    ...saving,
    plannedAmount: saving.plannedAmount - check.amount,
    reservedAmount: saving.reservedAmount + check.amount,
  };
}
