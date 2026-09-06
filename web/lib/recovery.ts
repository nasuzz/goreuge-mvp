// D-day를 되돌리는 "최소 조건"을 찾는다 (#50).
//
// 대응안 비교(기획서 6-1)는 사용자가 이미 답을 알고 와야 동작한다. 가정을 넣으면
// 며칠인지 계산해줄 뿐이라, 얼마를 언제까지 받아야 하는지는 스스로 정해야 한다.
// 그게 실제로 어렵다는 건 이슈 #8에서 확인됐다 — 기획서가 예시로 쓴 선금 50만원은
// 위험 전환 이후 상태에서 효과가 정확히 0일이었다(그날 유출 82만원, 4만원 모자람).
// 기획한 사람도 못 맞힌 숫자를 사용자가 매번 맞힐 수는 없다.
//
// [설계 원칙] 이 파일은 계산을 다시 구현하지 않는다.
// 후보 가정을 만들어 A의 compareWhatIf에 넣고 결과를 고르기만 한다. 가정 반영 규칙
// (가상 거래처 생성, monthly outflow 분할 등)은 전부 엔진 안에 있고 여기서는 모른다.
// 그래서 엔진이 바뀌면 이 탐색 결과도 자동으로 따라간다.

import { compareWhatIf, runAllScenarios, addDays, diffDays } from "@/engine/index";
import { MVP_POLICY } from "@/shared/policy";
import type {
  DateString,
  DateTimeString,
  EngineInput,
  WhatIfAssumption,
  WhatIfResult,
  Won,
} from "@/shared/types";

export interface RecoveryOption {
  assumption: WhatIfAssumption;
  dayDelta: number;
  dDayBefore: DateString | null;
  dDayAfter: DateString | null;
  /** 화면에 그대로 쓰는 근거. 숫자는 전부 엔진 결과에서 나온다 */
  rationale: string[];
  /** 사용자가 치러야 하는 것. 정렬·표시용 */
  effortLabel: string;
}

export interface RecoveryFinding {
  /** 탐색 기준이 된 현재 D-day */
  dDay: DateString | null;
  daysRemaining: number | null;
  options: RecoveryOption[];
  /** 후보를 못 찾았을 때 화면에 띄울 이유 */
  emptyReason: string | null;
}

/** 선금 금액 탐색 격자. 굵게 훑고 그 구간만 10만원 단위로 좁힌다. */
const COARSE_AMOUNTS: Won[] = [500_000, 1_000_000, 1_500_000, 2_000_000, 3_000_000, 5_000_000];
const REFINE_STEP = 100_000;
const DELAY_DAYS = [7, 14, 21];
const REDUCTIONS: Won[] = [100_000, 200_000, 300_000, 500_000];

/** 기본 목표. "며칠은 벌어야 의미가 있다"의 기준선 */
const DEFAULT_MIN_GAIN_DAYS = 7;

const won = (amount: Won) => `${amount.toLocaleString("ko-KR")}원`;
const dateKo = (date: DateString) => {
  const [, m, d] = date.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
};

/**
 * 한 번에 최대 3개까지만 넣을 수 있다(엔진이 강제). 후보를 잘라서 보낸다.
 * before(기준선)는 호출마다 다시 계산되지만 90일 시뮬레이션이라 비용이 작다.
 */
function evaluate(
  input: EngineInput,
  now: DateTimeString,
  candidates: WhatIfAssumption[],
): WhatIfResult[] {
  const max = MVP_POLICY.maxWhatIfAssumptions;
  const results: WhatIfResult[] = [];
  for (let i = 0; i < candidates.length; i += max) {
    results.push(...compareWhatIf(input, candidates.slice(i, i + max), now));
  }
  return results;
}

/** 선금: 날짜를 고정하고, 목표를 넘기는 가장 작은 금액을 찾는다. */
function findMinimalAdvance(
  input: EngineInput,
  now: DateTimeString,
  date: DateString,
  minGainDays: number,
): WhatIfResult | null {
  const label = (amount: Won) => `선금 ${won(amount)} ${dateKo(date)} 입금 가정`;

  const coarse = evaluate(
    input,
    now,
    COARSE_AMOUNTS.map((amount) => ({
      type: "advance_payment" as const,
      label: label(amount),
      amount,
      date,
    })),
  );

  const hitIndex = coarse.findIndex((r) => r.dayDelta >= minGainDays);
  if (hitIndex === -1) return null;

  // 굵은 격자에서 처음 넘긴 지점과 그 직전 사이만 10만원 단위로 좁힌다.
  const upper = COARSE_AMOUNTS[hitIndex];
  const lower = hitIndex === 0 ? REFINE_STEP : COARSE_AMOUNTS[hitIndex - 1] + REFINE_STEP;

  const refineAmounts: Won[] = [];
  for (let amount = lower; amount < upper; amount += REFINE_STEP) refineAmounts.push(amount);

  const refined = evaluate(
    input,
    now,
    refineAmounts.map((amount) => ({
      type: "advance_payment" as const,
      label: label(amount),
      amount,
      date,
    })),
  );

  return refined.find((r) => r.dayDelta >= minGainDays) ?? coarse[hitIndex];
}

export function findRecoveryOptions(
  input: EngineInput,
  now: DateTimeString,
  minGainDays: number = DEFAULT_MIN_GAIN_DAYS,
): RecoveryFinding {
  // 기준선은 엔진에게 묻는다. 여기서 계산하지 않는다.
  const baseline = runAllScenarios(input).baseline;
  const dDay = baseline.dDay;
  const daysRemaining = baseline.daysRemaining;

  if (!dDay) {
    return {
      dDay: null,
      daysRemaining: null,
      options: [],
      emptyReason:
        "지금 계획으로는 90일 안에 잔액이 바닥나지 않아요. 되돌릴 조건을 찾을 필요가 없습니다.",
    };
  }

  const options: RecoveryOption[] = [];

  // ── 1. 선금 ────────────────────────────────────────────
  // D-day 이후에 들어오는 돈은 그날을 못 넘긴다(#8에서 확인된 실패 원인).
  // 그래서 후보 날짜를 D-day 이하로만 잡는다.
  const gap = diffDays(input.today, dDay);
  const candidateDates = [...new Set([
    addDays(input.today, 1),
    addDays(input.today, Math.max(1, Math.floor(gap / 2))),
    dDay,
  ])].filter((date) => date <= dDay);

  let bestAdvance: WhatIfResult | null = null;
  for (const date of candidateDates) {
    const found = findMinimalAdvance(input, now, date, minGainDays);
    if (!found) continue;
    const foundAmount = (found.assumption as Extract<WhatIfAssumption, { type: "advance_payment" }>)
      .amount;
    const bestAmount = bestAdvance
      ? (bestAdvance.assumption as Extract<WhatIfAssumption, { type: "advance_payment" }>).amount
      : Number.POSITIVE_INFINITY;
    // 같은 목표라면 더 적은 금액이 더 현실적인 요청이다.
    if (foundAmount < bestAmount) bestAdvance = found;
  }

  if (bestAdvance) {
    const amount = (bestAdvance.assumption as Extract<WhatIfAssumption, { type: "advance_payment" }>)
      .amount;
    const date = (bestAdvance.assumption as Extract<WhatIfAssumption, { type: "advance_payment" }>)
      .date;
    options.push({
      assumption: bestAdvance.assumption,
      dayDelta: bestAdvance.dayDelta,
      dDayBefore: bestAdvance.dDayBefore,
      dDayAfter: bestAdvance.dDayAfter,
      effortLabel: won(amount),
      rationale: [
        `${dateKo(date)}까지 들어와야 합니다. 하루라도 늦으면 ${dateKo(dDay)}을 못 넘겨 효과가 사라져요.`,
        `이보다 적은 금액으로는 ${minGainDays}일을 벌 수 없습니다.`,
      ],
    });
  }

  // ── 2. 지출 연기 ───────────────────────────────────────
  const delayCandidates: WhatIfAssumption[] = [];
  for (const outflow of input.outflows) {
    if (outflow.includedInBaseline) continue; // 베이스라인에 이미 녹아 있어 옮길 수 없다
    for (const days of DELAY_DAYS) {
      delayCandidates.push({
        type: "delay_outflow",
        label: `${outflow.name} ${days}일 연기`,
        outflowId: outflow.id,
        newDate: addDays(outflow.dueDate, days),
      });
    }
  }
  const delayResults = evaluate(input, now, delayCandidates)
    .filter((r) => r.dayDelta > 0)
    .sort((a, b) => b.dayDelta - a.dayDelta);

  if (delayResults[0]) {
    const best = delayResults[0];
    const assumption = best.assumption as Extract<WhatIfAssumption, { type: "delay_outflow" }>;
    const outflow = input.outflows.find((o) => o.id === assumption.outflowId);
    options.push({
      assumption: best.assumption,
      dayDelta: best.dayDelta,
      dDayBefore: best.dDayBefore,
      dDayAfter: best.dDayAfter,
      effortLabel: outflow ? `${dateKo(outflow.dueDate)} → ${dateKo(assumption.newDate)}` : "일정 조정",
      rationale: [
        outflow
          ? `${outflow.name} ${won(outflow.amount)}이 ${dateKo(outflow.dueDate)}에 빠져나갑니다.`
          : "확정 유출을 뒤로 미룹니다.",
        "돈을 새로 구하지 않아도 되는 방법입니다.",
      ],
    });
  }

  // ── 3. 지출 절감 ───────────────────────────────────────
  const reduceResults = evaluate(
    input,
    now,
    REDUCTIONS.map((monthlyReduction) => ({
      type: "reduce_spending" as const,
      label: `월 지출 ${won(monthlyReduction)} 절감`,
      monthlyReduction,
    })),
  ).filter((r) => r.dayDelta > 0);

  if (reduceResults[0]) {
    const best = reduceResults[0];
    const assumption = best.assumption as Extract<WhatIfAssumption, { type: "reduce_spending" }>;
    options.push({
      assumption: best.assumption,
      dayDelta: best.dayDelta,
      dDayBefore: best.dDayBefore,
      dDayAfter: best.dDayAfter,
      effortLabel: `월 ${won(assumption.monthlyReduction)}`,
      rationale: [
        "거래처에 아무것도 요청하지 않아도 되는 방법입니다.",
        `대신 매달 ${won(assumption.monthlyReduction)}을 계속 줄여야 합니다.`,
      ],
    });
  }

  options.sort((a, b) => b.dayDelta - a.dayDelta);

  return {
    dDay,
    daysRemaining,
    options: options.slice(0, MVP_POLICY.maxWhatIfAssumptions),
    emptyReason:
      options.length === 0
        ? `${minGainDays}일 이상 되돌릴 수 있는 조건을 찾지 못했어요. 지연 계약 회수가 먼저입니다.`
        : null,
  };
}
