// engine/scenarioDate.ts
// engine-interface.md 3-2 "시나리오별 입금일 [확정 D3]"
// DRI: A(수경)
//
// 핵심 원칙: 정시율을 금액에 곱하지 않는다. 금액은 유지하고 입금일만 이동한다.
//
// [이슈 #3 추가] diffDays — statusTransition.ts(경과일수 판정)와
// whatIf.ts(D-day 변화량 계산)가 공통으로 쓰는 날짜 차 계산 함수.
// 기존 simulate.ts의 로컬 daysBetween과 로직은 동일하되, 여러 파일이
// 각자 재구현하지 않도록 여기로 옮겨 export한다.

import type { Contract, Client, DateString } from "../shared/types";
import type { Scenario, DelayBasis } from "../shared/enums";
import { MVP_POLICY } from "../shared/policy";

export interface ScenarioDateResult {
  date: DateString | null;
  delayBasis: DelayBasis;
  delayDays: number;
}

/** "YYYY-MM-DD" + N일 (달력 계산, KST 기준 문자열 그대로 다룸) */
export function addDays(date: DateString, days: number): DateString {
  const [y, m, d] = date.split("-").map(Number);
  // UTC 고정으로 만들어 로컬 타임존에 의한 하루 밀림을 방지한다.
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * to - from 을 일 단위로 반환한다. (예: diffDays("2026-09-01", "2026-09-15") === 14)
 * 양수면 to가 미래, 음수면 to가 과거.
 */
export function diffDays(from: DateString, to: DateString): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86_400_000);
}

function resolveDelay(
  client: Client,
  scenario: Scenario,
): { days: number; basis: DelayBasis } {
  const hasHistory = client.completedCount >= MVP_POLICY.clientHistoryMinCount;
  const basis: DelayBasis = hasHistory ? "client_history" : "cold_start";

  if (scenario === "optimistic") {
    return { days: hasHistory ? 0 : MVP_POLICY.coldStartDelayDays.optimistic, basis };
  }
  if (scenario === "baseline") {
    const days = hasHistory
      ? client.medianDelayDays ?? MVP_POLICY.coldStartDelayDays.baseline
      : MVP_POLICY.coldStartDelayDays.baseline;
    return { days, basis };
  }
  // pessimistic
  const days = hasHistory
    ? client.p90DelayDays ?? MVP_POLICY.coldStartDelayDays.pessimistic
    : MVP_POLICY.coldStartDelayDays.pessimistic;
  return { days, basis };
}

export function calculateScenarioDate(
  contract: Contract,
  client: Client,
  scenario: Scenario,
  today: DateString,
): ScenarioDateResult {
  // UNKNOWN / manual 미입력 등으로 expectedDate가 없으면 유입 자체가 없다.
  if (contract.expectedDate === null) {
    return { date: null, delayBasis: "cold_start", delayDays: 0 };
  }

  // 대기(waiting) — 예정입금일 기준
  if (contract.status === "waiting") {
    const { days, basis } = resolveDelay(client, scenario);
    return { date: addDays(contract.expectedDate, days), delayBasis: basis, delayDays: days };
  }

  // 지연(delayed) · 위험(risk) — 오늘 기준 [확정 D3]
  if (contract.status === "delayed" || contract.status === "risk") {
    const { days, basis } = resolveDelay(client, scenario);
    if (scenario === "optimistic") {
      return { date: today, delayBasis: basis, delayDays: 0 };
    }
    return { date: addDays(today, days), delayBasis: basis, delayDays: days };
  }

  // completed / cancelled 은 이 함수가 다루는 대상이 아니다. 호출부(runScenario)에서
  // 상태별로 먼저 걸러내지만, 방어적으로 null을 반환한다.
  return { date: null, delayBasis: "cold_start", delayDays: 0 };
}
