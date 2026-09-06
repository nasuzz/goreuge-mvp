// engine/clientStats.ts
// engine-interface.md 3-10 "거래처 지연 통계 갱신"
// DRI: A(수경). 이슈 #55
//
// 이 파일도 순수함수만 담는다(statusTransition.ts와 같은 원칙). Client 자체는
// 타임스탬프 필드가 없어서(shared/types.ts) now를 받을 필요가 없다.
//
// 신규 거래처 정책(4-4, MVP_POLICY.clientHistoryMinCount)이 참조하는
// completedCount/medianDelayDays/p90DelayDays를 실제로 채워 넣는 함수다.
// 이 함수가 없으면 계약을 등록·완료해도 거래처 이력이 시드값에 그대로
// 고정된다 — scenarioDate.ts의 cold_start/client_history 분기 자체는 이미
// 구현돼 있고 이 값들을 읽기만 한다(#9에서 확인됨).

import type { Client, Contract, DateString } from "../shared/types";
import { MVP_POLICY } from "../shared/policy";
import { diffDays } from "./scenarioDate";

/**
 * 완료된 계약 목록으로 거래처 지연 통계를 다시 계산한다.
 *
 * @param completedContracts 이 거래처의 완료(status === "completed") 계약들.
 *   호출부가 이미 필터링해서 넘긴다는 전제다 — 이 함수는 상태를 다시 확인하지 않는다.
 *
 * completedCount는 넘어온 배열 길이 그대로다("완료 건수", 3-10).
 * medianDelayDays/p90DelayDays는 그중 지연일을 계산할 수 있는 건(actualDate·
 * expectedDate가 모두 있는 건)이 clientHistoryMinCount(3)건 미만이면 null이다 —
 * completedCount가 3 이상이어도, 지연일 데이터 자체가 3건 미만이면 중앙값·
 * p90을 낼 근거가 없다.
 *
 * 지연일 = actualDate - expectedDate, 음수(예정보다 일찍 입금)는 0으로 clamp한다
 * (기획서에 "일찍 들어온 것"까지 다음 예측에 유리하게 반영한다는 규정이 없어서,
 * 보수적으로 0 미만은 만들지 않는다).
 */
export function recalculateClientStats(client: Client, completedContracts: Contract[]): Client {
  const completedCount = completedContracts.length;

  const delayDays = completedContracts
    .filter((c): c is Contract & { expectedDate: DateString; actualDate: DateString } =>
      c.expectedDate !== null && c.actualDate !== null,
    )
    .map((c) => Math.max(0, diffDays(c.expectedDate, c.actualDate)))
    .sort((a, b) => a - b);

  const hasEnoughHistory = delayDays.length >= MVP_POLICY.clientHistoryMinCount;

  return {
    ...client,
    completedCount,
    medianDelayDays: hasEnoughHistory ? median(delayDays) : null,
    p90DelayDays: hasEnoughHistory ? percentile90(delayDays) : null,
  };
}

/** 오름차순 정렬된 배열의 중앙값. 짝수 개면 가운데 두 값의 평균을 정수로 반올림한다. */
function median(sortedAscending: number[]): number {
  const n = sortedAscending.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 0) {
    return Math.round((sortedAscending[mid - 1] + sortedAscending[mid]) / 2);
  }
  return sortedAscending[mid];
}

/**
 * 오름차순 정렬된 배열의 90퍼센타일(최근접 순위 방식). 지연일은 정수 일수
 * 개념이라 보간하지 않고, ceil(0.9 * n)번째로 큰 값을 그대로 쓴다.
 */
function percentile90(sortedAscending: number[]): number {
  const n = sortedAscending.length;
  const index = Math.min(n - 1, Math.ceil(n * 0.9) - 1);
  return sortedAscending[index];
}
