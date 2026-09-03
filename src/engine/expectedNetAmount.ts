// engine/expectedNetAmount.ts
// engine-interface.md 3-3 "예상 실수령액 계산" / 기획서 4-3, 5-1, 5-3, 9-2(NetAmountStatus)
// DRI: A(수경). 이슈 #14 [ENGINE][P0] 예정입금일·예상 실수령액 계산 함수
//
// [설계 결정 — 확인 필요]
// 완료조건에 "지급처 공제액 > 사용자 확인 참조율 > 실제입금 확인 > 추정불가" 4단계로
// 적혀 있는데, Contract 타입엔 "지급처가 알려준 공제율"과 "사용자가 승인한 참조율"을
// 구분하는 별도 필드가 없다 — confirmedExpectedRate 하나뿐이다(기획서 4-3: 지급처 안내
// 공제액이든 시스템 참조율 승인이든 결국 "사용자가 확인한 값"이라는 점에서 같은 필드로
// 저장되는 걸로 해석했다). 그래서 이 함수는 3단계로 합쳐서 구현했다:
//   1. actualNetAmount 있음      → "actual"     (실제 입금 확인, 최우선 — 잠정값을 대체)
//   2. confirmedExpectedRate 있음 → "calculated" (사용자가 확인한 값. 출처가 지급처든 참조율이든 동일 취급)
//   3. 그 외                     → "unavailable"
// 만약 "지급처 공제액"을 confirmedExpectedRate와 별개 필드로 분리해야 한다는 합의가
// B·C와 있으면(예: contract에 payerStatedRate 같은 필드 추가), 이 함수도 다시 짜야 한다.
//
// 원칙(5-1): referenceRate는 시스템 참조 데이터일 뿐이다. 사용자가 확인하기 전까지는
// 절대 실수령액 계산에 쓰지 않는다 — confirmedExpectedRate가 null이면 referenceRate로
// 대신 계산하지 않고 무조건 "unavailable"이다.

import type { Contract, Won } from "../shared/types";
import type { NetAmountStatus } from "../shared/enums";
import { round } from "../shared/policy";

export interface ExpectedNetAmountResult {
  amount: Won | null;
  status: NetAmountStatus;
}

export function calculateExpectedNetAmount(
  contract: Pick<Contract, "grossAmount" | "confirmedExpectedRate" | "actualNetAmount">,
): ExpectedNetAmountResult {
  // 1순위: 실제 입금 확인 완료 — 잠정값을 대체하는 확정값(9-3 무결성: actualDate 있으면 반드시 있음)
  if (contract.actualNetAmount !== null) {
    return { amount: contract.actualNetAmount, status: "actual" };
  }

  // 2순위: 사용자가 확인한 참조율로 잠정 산출 (referenceRate 자체는 여기서 절대 쓰지 않는다 — 5-1)
  if (contract.confirmedExpectedRate !== null) {
    return {
      amount: round.netAmount(contract.grossAmount, contract.confirmedExpectedRate),
      status: "calculated",
    };
  }

  // 3순위: 확인된 게 없으면 "추정 불가" 배지 대상
  return { amount: null, status: "unavailable" };
}
