// engine/whatIf.ts
// engine-interface.md 3-8 "대응안 가정 비교 (P0, 최대 3개)"
// shared/types.ts의 WhatIfAssumption(3종) / WhatIfResult 시그니처를 그대로 따른다.
// DRI: A(수경). 이슈 #3 [ENGINE][P0] 정산 상태 전환 및 대응안 계산
//
// 원칙:
//   - 원본 EngineInput을 절대 변경하지 않는다. structuredClone 후 가정만 반영한다.
//   - 버튼명은 "적용"이 아니라 "가정해 보기"/"시뮬레이션에 반영"(6-1) — 이 함수는
//     계산만 하고 저장하지 않는다. 실제 화면 문구 조립은 C 몫이다(WhatIfResult에
//     message 필드가 없다 — 필요하면 아래 formatWhatIfMessage를 참고용으로 쓸 것).
//
// [설계 결정 — 확인 필요]
//   advance_payment 타입에는 clientId가 없다. 즉 "이 거래처 이력에 따른 지연 확률"이
//   아니라 "이 날짜에 정확히 들어온다"는 순수 가정으로 해석했다. 엔진 내부적으로는
//   Contract(clientId 필수)를 만들어야 시뮬레이션에 태울 수 있어서, 지연이 전혀
//   붙지 않도록 이력 3건·중앙값/p90 0일짜리 "가상 거래처"를 임시로 끼워 넣는다.
//   실제 거래처 이력을 반영해야 한다는 합의가 있으면(예: PR #2 데모 테스트처럼
//   client-001 이력을 태우는 방식) 이 부분을 바꿔야 한다 — B·C 확인 요망.

import type {
  Contract, Client, Outflow, EngineInput, CashflowResult,
  WhatIfAssumption, WhatIfResult, DateString, DateTimeString,
} from "../shared/types";
import { runScenario } from "./simulate";
import { diffDays } from "./scenarioDate";
import { MVP_POLICY } from "../shared/policy";

const VIRTUAL_CLIENT_ID = "whatif-advance-payment-client";

/**
 * @param now 가상 계약의 createdAt/updatedAt/statusUpdatedAt에 찍을 시각(ISO 8601).
 *   compareWhatIf 자체는 D-day 날짜 비교만 하므로 today만 있으면 계산은 가능하지만,
 *   가상 Contract 객체를 만드는 이상 DateTimeString 필드엔 진짜 일시가 필요하다
 *   (hsoo23 리뷰: statusTransition.ts와 동일한 DateString/DateTimeString 혼용 문제).
 */
export function compareWhatIf(
  input: EngineInput,
  assumptions: WhatIfAssumption[],
  now: DateTimeString,
): WhatIfResult[] {
  if (assumptions.length === 0) return [];
  if (assumptions.length > MVP_POLICY.maxWhatIfAssumptions) {
    throw new Error(
      `[engine] compareWhatIf: 대응안은 최대 ${MVP_POLICY.maxWhatIfAssumptions}개까지입니다 (기획서 6-1, 실제 ${assumptions.length}개 전달됨)`,
    );
  }

  // 기준선은 원본 input으로 baseline 1번만 계산하면 됨 (가정마다 다시 돌릴 필요 없음).
  const before = runScenario(input, "baseline");

  return assumptions.map((assumption) => {
    // 원본을 절대 변경하지 않는다 — 가정마다 깨끗한 복사본에서 새로 시작.
    const modifiedInput = structuredClone(input);
    applyAssumption(modifiedInput, assumption, input.today, now);

    const after = runScenario(modifiedInput, "baseline");

    return {
      assumption,
      dDayBefore: before.dDay,
      dDayAfter: after.dDay,
      dayDelta: computeDayDelta(before, after),
    };
  });
}

// ── 가정 반영 ──────────────────────────────────────────────

function applyAssumption(
  input: EngineInput,
  assumption: WhatIfAssumption,
  today: DateString,
  now: DateTimeString,
): void {
  if (assumption.type === "advance_payment") {
    applyAdvancePayment(input, assumption, today, now);
    return;
  }
  if (assumption.type === "delay_outflow") {
    applyDelayOutflow(input, assumption, today);
    return;
  }
  // reduce_spending
  applyReduceSpending(input, assumption);
}

function applyAdvancePayment(
  input: EngineInput,
  assumption: Extract<WhatIfAssumption, { type: "advance_payment" }>,
  today: DateString,
  now: DateTimeString,
): void {
  // clientId가 없는 가정이므로, 지연이 전혀 붙지 않는 가상 거래처를 하나 만든다.
  // (completedCount >= 3 → client_history 경로를 타되, medianDelayDays/p90DelayDays를
  //  0으로 둬서 낙관·기준·비관 모두 지정한 date 그대로 들어오게 한다.)
  if (!input.clients.some((c) => c.id === VIRTUAL_CLIENT_ID)) {
    const virtualClient: Client = {
      id: VIRTUAL_CLIENT_ID,
      name: assumption.label,
      completedCount: MVP_POLICY.clientHistoryMinCount,
      medianDelayDays: 0,
      p90DelayDays: 0,
    };
    input.clients.push(virtualClient);
  }

  const contract: Contract = {
    id: `whatif-advance-payment-${input.contracts.length}`,
    clientId: VIRTUAL_CLIENT_ID,
    grossAmount: assumption.amount,
    completionDate: today,
    invoiceDate: null,
    settlementTerm: "ON_COMPLETION",
    settlementDay: null,
    expectedDate: assumption.date,
    expectedDateSource: "manual",
    actualDate: null,
    // 가정 단계는 세전/세후 구분이 의미 없어 전액 유입으로 취급한다.
    incomeType: "no_withholding",
    classificationStatus: "user_confirmed",
    referenceRate: 0,
    confirmedExpectedRate: 0,
    actualRate: null,
    expectedNetAmount: assumption.amount,
    actualNetAmount: null,
    status: "waiting",
    statusSource: "system",
    statusReason: null,
    // [hsoo23 리뷰 반영] DateTimeString 필드엔 today가 아니라 now를 쓴다.
    statusUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  input.contracts.push(contract);
}

function applyDelayOutflow(
  input: EngineInput,
  assumption: Extract<WhatIfAssumption, { type: "delay_outflow" }>,
  today: DateString,
): void {
  const idx = input.outflows.findIndex((o) => o.id === assumption.outflowId);
  if (idx === -1) {
    throw new Error(`[engine] compareWhatIf: outflow ${assumption.outflowId}를 찾을 수 없습니다`);
  }
  const outflow = input.outflows[idx];

  if (outflow.recurrence === "once") {
    // 단발성 유출은 그 날 하루뿐이라 dueDate만 옮기면 끝.
    input.outflows[idx] = { ...outflow, dueDate: assumption.newDate };
    return;
  }

  // [hsoo23 리뷰 반영] recurrence === "monthly"인 항목의 dueDate를 그대로 newDate로
  // 바꾸면 outflowSchedule.ts가 그 "일(day)"을 앵커로 매달 다시 펼친다 — 9/14 카드값을
  // 9/21로 미루는 가정이 10/21, 11/21까지 전부 밀려버려서 D-day 개선폭이 과대 계산된다.
  // outflowSchedule.ts(#2 소관)는 건드리지 않고, 여기서 "이번 회차 1건(once)"과
  // "다음 회차부터 이어지는 monthly"로 분리해서 이번 한 번만 옮긴다.
  const [split1, split2] = splitDelayedMonthlyOutflow(outflow, assumption.newDate, today);
  input.outflows.splice(idx, 1, split1, split2);
}

/**
 * monthly outflow를 "이번에 미루는 1건(once, newDate)"과
 * "다음 회차부터는 원래 일자를 유지하는 monthly"로 분리한다.
 * outflowSchedule.ts의 필터가 `candidate >= o.dueDate`라는 점을 이용 —
 * continuing 항목의 dueDate를 "다음 회차"로 두면 이번 회차(원래 일자)는 자동으로 제외되고
 * targetDay(=day-of-month)는 원본 그대로 유지되어 그 다음 회차부터 정상적으로 이어진다.
 * (테스트에서 직접 검증할 수 있도록 export한다.)
 */
export function splitDelayedMonthlyOutflow(
  outflow: Outflow,
  newDate: DateString,
  today: DateString,
): [Outflow, Outflow] {
  const anchorDay = Number(outflow.dueDate.split("-")[2]);
  const nextOccurrence = nextMonthlyOccurrenceOnOrAfter(outflow.dueDate, today);
  const followingOccurrence = occurrenceInMonthOffset(nextOccurrence, anchorDay, 1);

  const delayedOnce: Outflow = {
    ...outflow,
    id: `${outflow.id}-whatif-delayed-once`,
    recurrence: "once",
    dueDate: newDate,
  };
  const continuingMonthly: Outflow = {
    ...outflow,
    id: `${outflow.id}-whatif-continuing`,
    recurrence: "monthly",
    dueDate: followingOccurrence,
  };
  return [delayedOnce, continuingMonthly];
}

/** anchorDueDate의 day-of-month를 기준으로, today 이후 가장 가까운 발생일(clamp 포함) */
function nextMonthlyOccurrenceOnOrAfter(anchorDueDate: DateString, today: DateString): DateString {
  const anchorDay = Number(anchorDueDate.split("-")[2]);
  const thisMonth = occurrenceInMonthOffset(today, anchorDay, 0);
  if (thisMonth >= today) return thisMonth;
  return occurrenceInMonthOffset(today, anchorDay, 1);
}

/** baseDate가 속한 달 기준 monthOffset만큼 이동한 달의 day일 (그 달 일수 초과 시 말일로 clamp) */
function occurrenceInMonthOffset(baseDate: DateString, day: number, monthOffset: number): DateString {
  const [y, m] = baseDate.split("-").map(Number);
  let year = y;
  let month = m + monthOffset;
  while (month < 1) { month += 12; year -= 1; }
  while (month > 12) { month -= 12; year += 1; }
  const daysInTarget = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTarget);
  return `${year}-${String(month).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

function applyReduceSpending(
  input: EngineInput,
  assumption: Extract<WhatIfAssumption, { type: "reduce_spending" }>,
): void {
  input.user = {
    ...input.user,
    monthlyFixedOutflow: Math.max(0, input.user.monthlyFixedOutflow - assumption.monthlyReduction),
  };
}

// ── 결과 가공 ──────────────────────────────────────────────

/**
 * dayDelta는 WhatIfResult 타입상 nullable이 아니므로, dDay가 기간(90일) 밖으로
 * 사라지는 경우(더 좋아짐)에도 숫자를 만들어야 한다. daysRemaining을 활용해
 * "적어도 이만큼은 개선됐다"는 하한값으로 표기한다.
 */
function computeDayDelta(before: CashflowResult, after: CashflowResult): number {
  if (before.dDay !== null && after.dDay !== null) {
    return diffDays(before.dDay, after.dDay);
  }
  if (before.dDay !== null && after.dDay === null) {
    // 가정 덕분에 90일 내 D-day가 사라짐 — 측정 가능한 최소 개선폭으로 표기.
    return MVP_POLICY.simulationHorizonDays - (before.daysRemaining ?? 0);
  }
  if (before.dDay === null && after.dDay !== null) {
    // 원래 없던 위험이 가정 이후 생김 — 이 3종 가정(선금·지출연기·지출감소)에서는
    // 정상적으로 발생하면 안 되는 케이스지만, 방어적으로 음수를 반환한다.
    return -(MVP_POLICY.simulationHorizonDays - (after.daysRemaining ?? 0));
  }
  // 둘 다 null: 애초에 90일 내 위험이 없어 가정도 의미가 없음.
  return 0;
}

// ── 화면 문구 (선택 — WhatIfResult 타입엔 없음, C 편의용 헬퍼) ─────

/** 6-1 예시 문구 형식("D-day가 13일 늘어나요")을 그대로 재현한 참고 구현. 필수 아님. */
export function formatWhatIfMessage(result: WhatIfResult): string {
  const premise = describeAssumption(result.assumption);
  if (result.dDayAfter === null && result.dDayBefore === null) {
    return `${premise} 90일 안에서는 D-day가 원래 없어요.`;
  }
  if (result.dayDelta === 0) {
    return `${premise} D-day는 변하지 않아요.`;
  }
  const verb = result.dayDelta > 0 ? "늘어나요" : "줄어들어요";
  return `${premise} D-day가 ${Math.abs(result.dayDelta)}일 ${verb}.`;
}

function describeAssumption(assumption: WhatIfAssumption): string {
  if (assumption.type === "advance_payment") {
    return `${assumption.label} ${assumption.amount.toLocaleString("ko-KR")}원이 ${formatDateKo(assumption.date)}에 입금된다고 가정하면`;
  }
  if (assumption.type === "delay_outflow") {
    return `${assumption.label}을(를) ${formatDateKo(assumption.newDate)}로 미루면`;
  }
  return `${assumption.label}을(를) 월 ${assumption.monthlyReduction.toLocaleString("ko-KR")}원 줄이면`;
}

function formatDateKo(date: DateString): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}월 ${d}일`;
}
