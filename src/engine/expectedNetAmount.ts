// engine/expectedNetAmount.ts
// engine-interface.md 3-3 "예상 실수령액 계산" / 기획서 4-3, 5-1, 5-3, 9-2(NetAmountStatus)
// DRI: A(수경). 이슈 #14 [ENGINE][P0] 예정입금일·예상 실수령액 계산 함수
// [이슈 #16 반영] 지급처 안내 금액을 별도 필드(payerStatedNetAmount)로 분리.
//
// 결정 경위 (이슈 #16):
//   C: "참조율 승인"과 "지급처 안내"는 화면 문구가 달라야 한다(전자만 "확인 전 추정치" 배지) —
//      구분 안 하면 둘 중 하나는 틀린 문구가 붙는다.
//   B: 지급처가 정확한 실수령액(예: "2,320,800원 드릴게요")을 알려준 걸 rate로 환산해서
//      confirmedExpectedRate에 욱여넣으면, DB의 confirmed_expected_rate가 numeric(5,4)라서
//      왕복 시 원 단위 오차가 난다(실측: 임의 금액 기준 최대 241원 차, schema.sql 확인 결과
//      실제로 numeric(5,4) 맞음 — 그대로 적용). 참고로 payerStatedNetAmount는 공제액이
//      아니라 실수령액이다 — B의 AI 파서가 "공제액 79,200원" 같은 원문을 받으면
//      grossAmount에서 차감해 실수령액 후보로 변환한 뒤 이 필드에 저장한다.
//   → enum으로 "출처만" 구분하는 안은 기각. Won 단위 필드를 따로 둔다(중복 상태 없이,
//     confirmedExpectedRate와 payerStatedNetAmount 둘 다 값이 있으면 우선순위로 자연히 정리됨).
//
// 우선순위 (실제 입금 > 지급처 안내 금액 > 사용자 확인 참조율 > 추정 불가):
//   1. actualNetAmount    있음 → "actual"     (실제 입금 확인, 잠정값 전체를 대체)
//   2. payerStatedNetAmount 있음 → "calculated" (지급처가 알려준 정확한 금액 그대로. 참조율 안내문 없음 — C가
//                                    payerStatedNetAmount !== null로 판별해 문구 분기)
//      confirmedExpectedRate가 null이어도 payerStatedNetAmount만 있으면 이 단계에서 값이 나온다 —
//      confirmedExpectedRate 확인을 기다릴 필요가 없다.
//   3. confirmedExpectedRate 있음 → "calculated" (사용자가 확인한 참조율로 계산. "확인 전 추정치" 안내문 필요)
//   4. 그 외             → "unavailable"

import type { Contract, Won } from "../shared/types";
import type { NetAmountStatus } from "../shared/enums";
import { round } from "../shared/policy";

export interface ExpectedNetAmountResult {
  amount: Won | null;
  status: NetAmountStatus;
}

export function calculateExpectedNetAmount(
  contract: Pick<
    Contract,
    "grossAmount" | "payerStatedNetAmount" | "confirmedExpectedRate" | "actualNetAmount"
  >,
): ExpectedNetAmountResult {
  // 1순위: 실제 입금 확인 완료 — 잠정값을 대체하는 확정값(9-3 무결성: actualDate 있으면 반드시 있음)
  if (contract.actualNetAmount !== null) {
    return { amount: contract.actualNetAmount, status: "actual" };
  }

  // 2순위: 지급처가 알려준 정확한 금액. rate 환산 없이 그대로 쓴다 — 원 단위 오차가 안 생긴다.
  if (contract.payerStatedNetAmount !== null) {
    return { amount: contract.payerStatedNetAmount, status: "calculated" };
  }

  // 3순위: 사용자가 확인한 참조율로 잠정 산출 (referenceRate 자체는 여기서 절대 쓰지 않는다 — 5-1)
  if (contract.confirmedExpectedRate !== null) {
    return {
      amount: round.netAmount(contract.grossAmount, contract.confirmedExpectedRate),
      status: "calculated",
    };
  }

  // 4순위: 확인된 게 없으면 "추정 불가" 배지 대상
  return { amount: null, status: "unavailable" };
}
