// engine/findRecovery.ts — 협상 카드: D-day를 되돌리는 최소 조건 탐색
// 이슈 #50 [AI][P1]. DRI: C(탐색·화면), A(엔진 API), B(문구).
//
// [무엇을 푸는가]
// 대응안 비교(6-1)는 사용자가 이미 정한 가정을 넣으면 며칠인지 계산해준다.
// 그래서 "얼마를 언제까지 받아야 하는가"는 여전히 사용자가 맞혀야 한다.
// 그게 어렵다는 건 우리가 직접 겪었다 — 기획서 예시였던 "선금 500,000원 9/15"는
// 위험 전환 이후 상태에서 효과가 정확히 0일이었다(이슈 #8). 그날 유출이
// 820,000원인데 500,000원으로는 못 넘겼다. 기획한 사람도 못 맞힌 숫자다.
//
// 이 파일은 그 반대 방향을 푼다: D-day를 받아서 그것을 되돌리는 최소 조건을 찾는다.
//
// [설계 원칙]
//   - 엔진 계산을 재구현하지 않는다. 후보를 만들어 compareWhatIf에 넘기고
//     결과를 고르기만 한다. 가정 반영 규칙(가상 거래처 생성, monthly outflow 분할)은
//     whatIf.ts 안에 있고 이 파일은 모른다.
//   - 순수함수. 같은 입력이면 항상 같은 결과가 나온다. 후보 사다리는 상수로 고정한다.
//   - 숫자는 전부 엔진 반환값이다. 이 파일이 금액·날짜·일수를 지어내지 않는다.
//   - 선금 "요청"을 실제 입금으로 처리하지 않는다(기획서 13장). 결과는 가정일 뿐이다.
//
// [날짜 프레이밍 — (나) 최대 유예]
// 가장 이른 날짜를 고르면 "내일까지 300,000원 주세요"가 되는데 협상에서 쓸 수 없다.
// 거래처에 하는 말은 "언제까지 주시면 됩니다"이므로, 금액을 정한 뒤 그 금액으로
// 아직 효과가 있는 **가장 늦은 날짜**를 찾아 latestDate로 싣는다(이슈 #50 6절).

import type {
  EngineInput, WhatIfAssumption, DateString, DateTimeString, Won,
} from "../shared/types";
import { runScenario } from "./simulate";
import { compareWhatIf } from "./whatIf";
import { addDays, diffDays } from "./scenarioDate";
import { MVP_POLICY } from "../shared/policy";

export interface RecoveryOption {
  /** 엔진이 실제로 평가한 가정 그대로. 화면은 이걸 그대로 compareWhatIf에 다시 넘길 수 있다 */
  assumption: WhatIfAssumption;
  dayDelta: number;
  dDayBefore: DateString | null;
  dDayAfter: DateString | null;
  /** (나) 프레이밍: 이 금액이면 언제까지 들어와야 하는가. 선금 가정에만 있다 */
  latestDate: DateString | null;
  /** 화면에 그대로 쓰는 근거. 숫자는 전부 엔진 결과에서 온다 */
  rationale: string[];
  /** 사용자가 치러야 하는 것 */
  effortLabel: string;
}

export interface RecoveryFinding {
  dDay: DateString | null;
  daysRemaining: number | null;
  /** 최대 3개(maxWhatIfAssumptions). dayDelta 내림차순 */
  options: RecoveryOption[];
  /** 제안할 게 없을 때의 이유. 있으면 options는 빈 배열 */
  emptyReason: string | null;
}

// ── 후보 사다리 ────────────────────────────────────────────
// 결정적 탐색을 위해 상수로 고정한다. 잔액이나 유출액에서 파생시키면 입력이 조금만
// 달라져도 후보가 통째로 바뀌어 회귀 테스트로 고정할 수 없다.

const ADVANCE_AMOUNTS: Won[] = [
  100_000, 200_000, 300_000, 500_000, 800_000,
  1_000_000, 1_500_000, 2_000_000, 3_000_000,
];

const DELAY_DAYS: number[] = [7, 14, 21, 30];

const REDUCE_AMOUNTS: Won[] = [50_000, 100_000, 200_000, 300_000, 500_000];

/**
 * [선택 정책 — 이슈 #50 실측 근거]
 *
 * 세 가정은 "요구를 키울 때 드는 비용"의 성격이 다르다. 그래서 하나의 목표
 * 일수로 통일하면 둘 중 하나는 반드시 틀린다.
 *
 *   선금      요구를 키워도 비용이 거의 안 는다. 전화 한 통과 관계 부담은
 *             100,000원이든 300,000원이든 같다. 오히려 너무 적게 부르는 게
 *             손해다 — 총액 2,400,000원짜리 계약에 100,000원(4%)을 달라는 건
 *             같은 관계 자본을 쓰고 3일밖에 못 사는 요청이다.
 *             -> 효과 기준. ADVANCE_TARGET_DAYS까지 올린다.
 *
 *   유출 연기 연기 일수가 곧 비용이다(연체이자·수수료·신용). 실측에서 위험
 *             전환 후 카드 연기는 7일이든 30일이든 똑같이 +6일이었다. 여기서
 *             30일을 고르면 아무 이득 없이 요구만 키우는 것이다.
 *             -> 최소 기준.
 *
 *   지출 절감 절감액에 생활 부담이 거의 비례한다.
 *             -> 최소 기준.
 *
 * 한 줄로: **더 요구해도 비용이 안 느는 건 효과 기준, 요구할수록 비용이 느는
 * 건 최소 기준.**
 */
const ADVANCE_TARGET_DAYS = 7;

/**
 * 종류와 무관한 하한. 하루 이틀짜리는 협상 카드가 되지 않는다 — "월 지출
 * 50,000원을 줄이면 하루 벌어요"는 전화를 걸거나 생활을 바꿀 이유가 못 된다.
 * 게다가 실측상 효율도 가장 나빴다(50,000원/일, 사다리 최악).
 *
 * 선택 규칙이 아니라 화면 하한으로 두는 방법도 있지만, 그러면 엔진이 "쓸 수
 * 없는 카드"를 만들어 놓고 화면이 지우는 구조가 된다. 애초에 후보가 아니라고
 * 보는 편이 설명하기 쉽다.
 */
const MIN_MEANINGFUL_DAYS = 3;

/**
 * 사다리를 오름차순으로 훑어 (1) targetDays를 넘기는 첫 값, (2) 없으면 하한을
 * 넘긴 첫 값을 고른다. targetDays에 MIN_MEANINGFUL_DAYS를 넘기면 "하한을 넘긴
 * 최소값"이 되고, 더 큰 값을 넘기면 "그만큼 벌어주는 최소값"이 된다.
 * 사다리가 상수라 결과는 결정적이다.
 */
function pickFromLadder<T>(
  ladder: T[],
  deltaOf: (candidate: T) => number,
  targetDays: number,
): { picked: T; delta: number; reachedTarget: boolean } | null {
  let fallback: { picked: T; delta: number } | null = null;
  for (const candidate of ladder) {
    const delta = deltaOf(candidate);
    if (delta < MIN_MEANINGFUL_DAYS) continue;
    if (fallback === null) fallback = { picked: candidate, delta };
    if (delta >= targetDays) {
      return { picked: candidate, delta, reachedTarget: true };
    }
  }
  return fallback === null ? null : { ...fallback, reachedTarget: false };
}

export function findRecovery(input: EngineInput, now: DateTimeString): RecoveryFinding {
  const baseline = runScenario(input, "baseline");

  if (baseline.dDay === null) {
    return {
      dDay: null,
      daysRemaining: null,
      options: [],
      emptyReason: `지금 계획으로는 ${MVP_POLICY.simulationHorizonDays}일 안에 잔액이 바닥나지 않아요. 되돌릴 조건을 찾을 필요가 없습니다.`,
    };
  }

  const evaluate = makeEvaluator(input, now);

  const options: RecoveryOption[] = [];
  const advance = findAdvancePayment(input, baseline.dDay, evaluate);
  if (advance) options.push(advance);
  const delay = findDelayOutflow(input, baseline.dDay, evaluate);
  if (delay) options.push(delay);
  const reduce = findReduceSpending(evaluate);
  if (reduce) options.push(reduce);

  options.sort((a, b) => b.dayDelta - a.dayDelta);
  const trimmed = options.slice(0, MVP_POLICY.maxWhatIfAssumptions);

  return {
    dDay: baseline.dDay,
    daysRemaining: baseline.daysRemaining,
    options: trimmed,
    emptyReason: trimmed.length > 0
      ? null
      : `지금 조건으로는 D-day를 ${MIN_MEANINGFUL_DAYS}일 이상 되돌리는 방법을 찾지 못했어요. 금액을 더 올리거나 다른 유출을 조정해 보세요.`,
  };
}

// ── 평가기 ─────────────────────────────────────────────────

interface Evaluation {
  dayDelta: number;
  dDayBefore: DateString | null;
  dDayAfter: DateString | null;
}

/**
 * 가정 하나를 엔진에 태워 결과만 돌려준다. compareWhatIf가 baseline을 매번 다시
 * 계산하지만, 후보 수십 개 기준 실측 60~170ms라 브라우저에서 문제 없다(이슈 #50 2절).
 */
function makeEvaluator(input: EngineInput, now: DateTimeString) {
  return (assumption: WhatIfAssumption): Evaluation => {
    const [result] = compareWhatIf(input, [assumption], now);
    return {
      dayDelta: result.dayDelta,
      dDayBefore: result.dDayBefore,
      dDayAfter: result.dDayAfter,
    };
  };
}

// ── 1. 선금 ────────────────────────────────────────────────

function findAdvancePayment(
  input: EngineInput,
  dDay: DateString,
  evaluate: (a: WhatIfAssumption) => Evaluation,
): RecoveryOption | null {
  const earliest = addDays(input.today, 1);

  // 선금은 요구를 키워도 비용이 거의 안 늘어난다 -> 효과 기준(선택 정책 주석).
  const chosen = pickFromLadder(ADVANCE_AMOUNTS, (amount) =>
    evaluate(advanceAssumption(amount, earliest)).dayDelta, ADVANCE_TARGET_DAYS);
  if (chosen === null) return null;
  const chosenAmount = chosen.picked;

  // (나) 최대 유예: 그 금액으로 아직 효과가 있는 가장 늦은 날짜.
  const latestDate = findLatestEffectiveDate(chosenAmount, earliest, dDay, evaluate);
  const finalDate = latestDate ?? earliest;
  const evaluation = evaluate(advanceAssumption(chosenAmount, finalDate));

  return {
    assumption: advanceAssumption(chosenAmount, finalDate),
    dayDelta: evaluation.dayDelta,
    dDayBefore: evaluation.dDayBefore,
    dDayAfter: evaluation.dDayAfter,
    latestDate: finalDate,
    rationale: [
      `${formatWon(chosenAmount)}이 ${finalDate}까지 들어오면 ${describeAfter(evaluation.dDayAfter, evaluation.dayDelta)}.`,
      `${finalDate}보다 늦어지면 이 금액으로는 D-day가 움직이지 않아요.`,
      ...(chosen.reachedTarget
        ? []
        : [`이 금액으로 벌 수 있는 건 ${evaluation.dayDelta}일까지예요. 더 필요하면 금액을 올려야 해요.`]),
    ],
    effortLabel: "거래처에 선금 요청",
  };
}

function advanceAssumption(amount: Won, date: DateString): WhatIfAssumption {
  return { type: "advance_payment", label: `선금 ${formatWon(amount)}`, amount, date };
}

/**
 * 같은 금액이면 일찍 들어올수록 D-day에 유리하다(늦게 들어온 돈은 그 전에 이미
 * 잔액이 0을 지났으면 아무 효과가 없다). 즉 dayDelta는 날짜에 대해 비증가라
 * 이분 탐색으로 "효과가 있는 가장 늦은 날"을 찾을 수 있다. 선형 스캔이면 최대
 * 90회인데 이분 탐색은 7회면 끝난다.
 */
function findLatestEffectiveDate(
  amount: Won,
  earliest: DateString,
  dDay: DateString,
  evaluate: (a: WhatIfAssumption) => Evaluation,
): DateString | null {
  let lo = 0;                          // earliest 기준 오프셋. 여기는 효과 있음이 보장됨
  let hi = diffDays(earliest, dDay);   // D-day 당일까지만 본다. 그 뒤 입금은 의미가 없다
  if (hi < 0) return null;

  let best: DateString | null = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const date = addDays(earliest, mid);
    if (evaluate(advanceAssumption(amount, date)).dayDelta > 0) {
      best = date;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

// ── 2. 유출 연기 ───────────────────────────────────────────

function findDelayOutflow(
  input: EngineInput,
  dDay: DateString,
  evaluate: (a: WhatIfAssumption) => Evaluation,
): RecoveryOption | null {
  // D-day 전에 빠져나가는 유출만 병목이 될 수 있다.
  // baseline에 이미 포함된 항목은 개별 차감 대상이 아니므로 제외한다(기획서 9-3).
  //
  // [PR #58 리뷰, hsoo23] 예전에는 금액이 가장 큰 유출 하나만 평가했는데,
  // "가장 큰 유출"이 항상 D-day를 만드는 병목은 아니다. 초반 큰 지출은 며칠
  // 미뤄도 여전히 D-day 앞에서 빠져나가 delta가 0이고, 정작 D-day 당일의 작은
  // 지출을 미뤄야 D-day가 밀리는 현금흐름이 있다. 그래서 후보 전체를 평가한다.
  const candidates = input.outflows
    .filter((o) => !o.includedInBaseline)
    .filter((o) => o.dueDate >= input.today && o.dueDate <= dDay)
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));

  // 후보마다 "효과가 나는 최소 연기일"을 구한 뒤 그중 하나를 고른다.
  const evaluated = candidates
    .map((outflow) => {
      // 연기 일수가 곧 비용이다 -> 최소 기준(하한만 넘기면 바로 채택).
      const picked = pickFromLadder(DELAY_DAYS, (days) =>
        evaluate(delayAssumption(outflow, days)).dayDelta, MIN_MEANINGFUL_DAYS);
      return picked === null ? null : { outflow, ...picked };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (evaluated.length === 0) return null;

  // 선택 규칙: (1) 연기 일수가 짧을수록 좋다 — 거래처·카드사에 요구하는 폭이
  // 작다, (2) 그래도 같으면 효과가 큰 쪽, (3) 마지막은 id로 고정해 결정성을 보장한다.
  //
  // [PR #70, nasuzz-dev] 원래 여기 reachedTarget 우선 조건이 있었는데 죽은 코드였다.
  // 유출 연기는 pickFromLadder에 targetDays로 MIN_MEANINGFUL_DAYS를 그대로 넘기고,
  // 같은 함수가 delta < MIN_MEANINGFUL_DAYS를 건너뛰므로, 살아남은 후보는 전부
  // delta >= targetDays라 reachedTarget이 항상 true다. 정렬에서 늘 0이 되는 항이었다.
  // (선금만 ADVANCE_TARGET_DAYS로 하한보다 높은 목표를 쓰므로 거기서는 의미가 있다.)
  evaluated.sort((a, b) =>
    a.picked - b.picked
    || b.delta - a.delta
    || a.outflow.id.localeCompare(b.outflow.id));

  const best = evaluated[0];
  const target = best.outflow;
  const chosen = best;

  {
    const days = chosen.picked;
    const newDate = addDays(target.dueDate, days);
    const assumption = delayAssumption(target, days);
    const evaluation = evaluate(assumption);
    {
      return {
        assumption,
        dayDelta: evaluation.dayDelta,
        dDayBefore: evaluation.dDayBefore,
        dDayAfter: evaluation.dDayAfter,
        latestDate: null,
        rationale: [
          `${target.name} ${formatWon(target.amount)}을 ${target.dueDate}에서 ${newDate}로 미루면 ${describeAfter(evaluation.dDayAfter, evaluation.dayDelta)}.`,
          `${days}일보다 짧게 미루면 D-day가 움직이지 않아요.`,
        ],
        effortLabel: `${target.name} 결제일 변경 요청`,
      };
    }
  }
}

function delayAssumption(
  target: { id: string; name: string; dueDate: DateString },
  days: number,
): WhatIfAssumption {
  return {
    type: "delay_outflow",
    label: `${target.name} ${days}일 연기`,
    outflowId: target.id,
    newDate: addDays(target.dueDate, days),
  };
}

// ── 3. 지출 절감 ───────────────────────────────────────────

function findReduceSpending(
  evaluate: (a: WhatIfAssumption) => Evaluation,
): RecoveryOption | null {
  // 절감액에 생활 부담이 비례한다 -> 최소 기준.
  const chosen = pickFromLadder(REDUCE_AMOUNTS, (amount) =>
    evaluate(reduceAssumption(amount)).dayDelta, MIN_MEANINGFUL_DAYS);
  if (chosen === null) return null;

  {
    const monthlyReduction = chosen.picked;
    const assumption = reduceAssumption(monthlyReduction);
    const evaluation = evaluate(assumption);
    {
      return {
        assumption,
        dayDelta: evaluation.dayDelta,
        dDayBefore: evaluation.dDayBefore,
        dDayAfter: evaluation.dDayAfter,
        latestDate: null,
        rationale: [
          `월 지출을 ${formatWon(monthlyReduction)} 줄이면 ${describeAfter(evaluation.dDayAfter, evaluation.dayDelta)}.`,
          `하루로 치면 ${formatWon(Math.floor(monthlyReduction / MVP_POLICY.fixedOutflowDailyDivisor))} 수준이에요.`,
        ],
        effortLabel: "이번 달 지출 줄이기",
      };
    }
  }
}

function reduceAssumption(monthlyReduction: Won): WhatIfAssumption {
  return {
    type: "reduce_spending",
    label: `월 지출 ${formatWon(monthlyReduction)} 절감`,
    monthlyReduction,
  };
}

// ── 표시 보조 ──────────────────────────────────────────────

/**
 * 가정 덕분에 90일 안에서 D-day가 사라지는 경우가 있다(computeDayDelta가 정상
 * 케이스로 처리한다). 이때 dDayAfter는 null이라 그대로 문자열에 넣으면
 * "D-day가 2026-10-05에서 null로 56일 늦춰져요"가 나온다.
 * formatWhatIfMessage와 같은 취지로 분기한다. [PR #58 리뷰, hsoo23]
 */
function describeAfter(dDayAfter: DateString | null, dayDelta: number): string {
  if (dDayAfter === null) {
    return `${MVP_POLICY.simulationHorizonDays}일 안에서는 D-day가 사라져요`;
  }
  return `D-day가 ${dDayAfter}로 ${dayDelta}일 늦춰져요`;
}

function formatWon(amount: Won): string {
  return `${amount.toLocaleString("ko-KR")}원`;
}
