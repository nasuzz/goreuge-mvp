// engine/paymentConfirm.ts
// engine-interface.md 3-9 "입금 확인 & 공제율 역산", 3-10 "거래처 지연 통계 갱신"
// DRI: A. 이슈 #55.
//
// 이 파일은 순수함수만 담는다. Supabase를 모른다(engine-interface.md 1절 분리 원칙).
// 저장은 호출부(API 라우트)가 반환값을 UPDATE 하는 방식으로 연결한다.
//
// 실제 입금이 확인되면 잠정값(참조율·지급처 안내로 만든 expectedNetAmount)이 아니라
// 실제 실수령액이 진실이 된다. calculateExpectedNetAmount가 actualNetAmount를 최우선으로
// 보도록 이미 만들어져 있어서(3-3), 이 함수가 값을 채우면 화면은 자동으로 실제값을 쓴다.

import type {
  Client,
  Contract,
  DateTimeString,
  PaymentConfirmInput,
  Rate,
} from "../shared/types";
import { diffDays } from "./scenarioDate";

/** 완료 이력이 이 건수 미만이면 지연 통계를 신뢰하지 않고 null로 둔다(4-4 cold start) */
const MIN_COMPLETED_FOR_STATS = 3;

/**
 * 입금 확인. 실제 입금일과 실수령액을 받아 계약을 완료 상태로 확정한다.
 *
 * 공제율은 역산한다 — 지급처가 실제로 얼마를 뗐는지는 입금액으로만 알 수 있다.
 *
 *   actualRate = (grossAmount - actualNetAmount) / grossAmount
 *
 * expectedNetAmount는 지우지 않고 남긴다. 잠정값이 얼마였는지가 나중에 "예상과 실제가
 * 얼마나 달랐나"를 보여주는 근거가 되기 때문이다. 화면은 3-3 우선순위에 따라 실제값을
 * 먼저 쓴다.
 *
 * @param now 상태 전이 시각. 엔진은 Date.now()를 부르지 않는다(순수함수 원칙).
 */
export function confirmPayment(
  contract: Contract,
  input: PaymentConfirmInput,
  now: DateTimeString,
): Contract {
  if (input.contractId !== contract.id) {
    throw new Error(
      `[engine] confirmPayment: contractId 불일치 (${input.contractId} vs ${contract.id})`,
    );
  }
  if (!Number.isInteger(input.actualNetAmount) || input.actualNetAmount < 0) {
    throw new Error(
      `[engine] confirmPayment: actualNetAmount(${input.actualNetAmount})는 0 이상의 원 단위 정수여야 합니다`,
    );
  }
  // DB 제약 chk_net_le_gross와 같은 기준. 총액보다 많이 들어왔다면 계약 금액이 틀린
  // 것이므로 조용히 통과시키지 않는다.
  if (input.actualNetAmount > contract.grossAmount) {
    throw new Error(
      `[engine] confirmPayment: actualNetAmount(${input.actualNetAmount})가 grossAmount(${contract.grossAmount})를 초과합니다`,
    );
  }
  if (contract.status === "cancelled") {
    throw new Error(`[engine] confirmPayment: 취소된 계약(${contract.id})은 입금 확인할 수 없습니다`);
  }

  return {
    ...contract,
    actualDate: input.actualDate,
    actualNetAmount: input.actualNetAmount,
    actualRate: reverseRate(contract.grossAmount, input.actualNetAmount),
    classificationStatus: "actual_confirmed",
    status: "completed",
    // 시스템이 입금 사실로부터 확정한 것이라 statusSource는 system이다.
    // (chk_user_status_reason: system이면 statusReason이 없어도 된다)
    statusSource: "system",
    statusReason: null,
    statusUpdatedAt: now,
    updatedAt: now,
  };
}

/**
 * 총액과 실제 실수령액으로 실제 공제율을 역산한다.
 *
 * grossAmount가 0이면 나눌 수 없다. DB는 gross_amount > 0을 강제하지만 엔진은
 * 방어적으로 null을 반환한다 — 0으로 나눈 Infinity가 rate 필드에 들어가면
 * numeric(5,4) 저장에서 터진다.
 */
function reverseRate(grossAmount: number, actualNetAmount: number): Rate | null {
  if (grossAmount <= 0) return null;
  return (grossAmount - actualNetAmount) / grossAmount;
}

/**
 * 거래처 지연 통계 갱신 (3-10).
 *
 * 입금이 확인될 때마다 그 거래처의 "얼마나 늦게 주는 곳인가"를 다시 계산한다.
 * 이 값이 D-day 시나리오의 지연일 기준이 되므로(3-2), 완료 이력이 3건 미만이면
 * 중앙값·p90을 만들지 않고 null로 둔다. null이면 시나리오가 cold start 기본값을 쓴다.
 *
 * @param completedContracts 이 거래처의 계약 전부를 넘겨도 된다. 입금 확인된 건만 골라 쓴다.
 */
export function recalculateClientStats(
  client: Client,
  completedContracts: Contract[],
): Client {
  const delays = completedContracts
    .filter((c) => c.clientId === client.id)
    .filter((c) => c.actualDate !== null && c.expectedDate !== null)
    // 예정보다 일찍 들어온 건 "음수 지연"이 아니라 지연 0이다.
    .map((c) => Math.max(0, diffDays(c.expectedDate as string, c.actualDate as string)))
    .sort((a, b) => a - b);

  const completedCount = delays.length;
  if (completedCount < MIN_COMPLETED_FOR_STATS) {
    return { ...client, completedCount, medianDelayDays: null, p90DelayDays: null };
  }

  return {
    ...client,
    completedCount,
    medianDelayDays: percentile(delays, 0.5),
    p90DelayDays: percentile(delays, 0.9),
  };
}

/**
 * 오름차순 배열의 퍼센타일. 최근접 순위법(nearest-rank)을 쓴다 —
 * 지연일은 "며칠"이라 보간해서 소수를 만들면 화면과 DB(int) 양쪽에서 어색해진다.
 */
function percentile(sortedAsc: number[], p: number): number {
  const rank = Math.ceil(p * sortedAsc.length);
  return sortedAsc[Math.min(Math.max(rank, 1), sortedAsc.length) - 1];
}
