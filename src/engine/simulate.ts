// engine/simulate.ts
// engine-interface.md 3-5 "D-day 시뮬레이션 ★핵심★", 3-6 "이번 주 가용금액", 3-7 "잔액 3단계"
// DRI: A(수경). 이슈 #2 [ENGINE][P0] D-day 기본 엔진 및 3시나리오 구현
//
// 원칙(1장): 엔진은 Supabase를 모른다. 스냅샷(EngineInput)을 인자로 받아 계산만 한다.

import type {
  EngineInput, Contract, DailyProjection, ProjectedInflow,
  CashflowResult, CashflowSummary, DateString, Won,
} from "../shared/types";
import type { Scenario } from "../shared/enums";
import { MVP_POLICY, round, getBalanceLevel } from "../shared/policy";
import { addDays, calculateScenarioDate } from "./scenarioDate";
import { buildOutflowSchedule } from "./outflowSchedule";

// ── 시작 잔액 (4-1, 4-2) ─────────────────────────────────
//
// 안전예비금은 여기서 "한 번만" 뺀다. D-day 판정을 다시 <= safetyBuffer로 하면
// 이중 차감이 된다. 판정은 반드시 <= 0으로 한다.
// plannedAmount는 여기서 빼지 않는다 (예정일의 미래 유출로 한 번만 반영. P1).
export function computeSimulationStartBalance(input: EngineInput): Won {
  const { user, savings } = input;
  const reservedTax = savings
    .filter((s) => s.kind === "tax")
    .reduce((sum, s) => sum + s.reservedAmount, 0);
  const reservedWish = savings
    .filter((s) => s.kind === "wish")
    .reduce((sum, s) => sum + s.reservedAmount, 0);

  return user.totalBalance - reservedTax - reservedWish - user.safetyBuffer;
}

// ── 시나리오별 계약 유입 산출 (4-4, 4-5) ─────────────────

function projectContractInflow(
  contract: Contract,
  client: EngineInput["clients"][number],
  scenario: Scenario,
  today: DateString,
): ProjectedInflow {
  const base = {
    contractId: contract.id,
    clientName: client.name,
  };

  // 완료·취소 계약은 유입에 다시 포함하지 않는다 (9-3 무결성 원칙).
  if (contract.status === "completed") {
    return {
      ...base, date: null, amount: 0, netAmountStatus: "actual",
      delayBasis: "client_history", delayDays: 0,
      excludedReason: "이미 입금 완료되어 잔액에 반영됨",
    };
  }
  if (contract.status === "cancelled") {
    return {
      ...base, date: null, amount: 0, netAmountStatus: "unavailable",
      delayBasis: "client_history", delayDays: 0,
      excludedReason: "계약 취소",
    };
  }

  // [hsoo23 리뷰 반영] 사용자 확인 전(needs_review/ai_candidate) 계약은 expectedNetAmount에
  // 값이 들어있어도(데이터 오류로 잘못 채워졌더라도) 유입에 포함하지 않는다.
  // DB도 needs_review 저장 자체는 허용하고(ai_candidate만 chk_no_unconfirmed_save로 막음),
  // Contract 타입도 "needs_review인데 expectedNetAmount가 non-null"인 조합을 막지 않으므로
  // 이 함수가 명시적으로 방어한다.
  if (
    contract.classificationStatus === "needs_review" ||
    contract.classificationStatus === "ai_candidate"
  ) {
    return {
      ...base, date: null, amount: 0, netAmountStatus: "unavailable",
      delayBasis: "client_history", delayDays: 0,
      excludedReason: "사용자 확인 전 계약 — 유입에 반영하지 않음",
    };
  }

  // 실수령액을 추정할 수 없으면 시나리오와 무관하게 0원 + 사유 표시.
  if (contract.expectedNetAmount === null) {
    return {
      ...base, date: null, amount: 0, netAmountStatus: "unavailable",
      delayBasis: "client_history", delayDays: 0,
      excludedReason: "소득유형 미확인으로 실수령액 추정 불가",
    };
  }

  const { date, delayBasis, delayDays } = calculateScenarioDate(contract, client, scenario, today);

  if (date === null) {
    return {
      ...base, date: null, amount: 0, netAmountStatus: "unavailable",
      delayBasis, delayDays, excludedReason: "예정입금일을 확인할 수 없음",
    };
  }

  // 위험(risk) 계약: 낙관에서만 오늘 포함, 기준·비관에서는 기간 내 유입 제외.
  if (contract.status === "risk" && scenario !== "optimistic") {
    return {
      ...base, date: null, amount: 0, netAmountStatus: "calculated",
      delayBasis, delayDays, excludedReason: "위험 상태 — 기준·비관 시나리오 유입 제외",
    };
  }

  return {
    ...base,
    date,
    amount: contract.expectedNetAmount,
    netAmountStatus: contract.classificationStatus === "actual_confirmed" ? "actual" : "calculated",
    delayBasis,
    delayDays,
    excludedReason: null,
  };
}

// ── 단일 시나리오 실행 ───────────────────────────────────

export function runScenario(input: EngineInput, scenario: Scenario): CashflowResult {
  const { today, contracts, clients, outflows, user } = input;
  const horizonDays = MVP_POLICY.simulationHorizonDays;

  const simulationStartBalance = computeSimulationStartBalance(input);

  const inflows: ProjectedInflow[] = contracts.map((c) => {
    const client = clients.find((cl) => cl.id === c.clientId);
    if (!client) throw new Error(`[engine] contract ${c.id}: client ${c.clientId}를 찾을 수 없습니다`);
    return projectContractInflow(c, client, scenario, today);
  });

  const inflowByDate: Record<DateString, number> = {};
  for (const inf of inflows) {
    if (inf.date === null) continue;
    inflowByDate[inf.date] = (inflowByDate[inf.date] ?? 0) + inf.amount;
  }

  const outflowByDate = buildOutflowSchedule(outflows, today, horizonDays);

  // 내부 계산은 소수를 유지하고, 반환 직전(화면 표시)에만 반올림한다 (D8).
  const dailyBaselineRaw = user.monthlyFixedOutflow / MVP_POLICY.fixedOutflowDailyDivisor;

  const projections: DailyProjection[] = [];
  let dDay: DateString | null = null;
  let daysRemaining: number | null = null;

  let runningBalance = simulationStartBalance;

  for (let d = 0; d < horizonDays; d++) {
    const date = addDays(today, d);
    const openingBalance = round.display(runningBalance);

    const inflow = inflowByDate[date] ?? 0;
    const fixedOutflow = outflowByDate[date] ?? 0;
    // [PR #64 흡수 — 이슈 #56] engine-interface.md 3-11 "A가 P1에서 추가로 할 일" 2번은
    // plannedAmount를 "예정일의 미래 유출"로 반영하라고 하지만, shared/types.ts의 Saving에는
    // 그 예정일을 담을 필드가 없다(DB savings 테이블도 마찬가지 — db/schema.sql 확인).
    // 날짜 없이 엔진이 임의로 어느 날짜에 얼마를 뺄지 정하면 잘못된 날짜에 이중 차감하는
    // 쪽이 더 위험해서 보류한다. 3-11이 명시한 데모 비트(세금 준비금 288,000원 체크 ->
    // D-day 09-30 -> 09-23)는 applySavingsCheck가 plannedAmount를 reservedAmount로 옮기는
    // 것만으로 이미 재현된다 — computeSimulationStartBalance가 reservedAmount를 항상 즉시
    // 반영하기 때문이다. Saving에 plannedDate 같은 필드가 생기면 그때 이 자리를 채운다.
    const newSavingsOutflow = 0;

    runningBalance = runningBalance + inflow - fixedOutflow - dailyBaselineRaw - newSavingsOutflow;
    const closingBalance = round.display(runningBalance);

    projections.push({
      date,
      openingBalance,
      inflow,
      fixedOutflow,
      baselineOutflow: round.display(dailyBaselineRaw),
      newSavingsOutflow,
      closingBalance,
      level: getBalanceLevel(closingBalance, user.safetyBuffer, user.monthlyFixedOutflow),
    });

    if (dDay === null && closingBalance <= 0) {
      dDay = date;
      daysRemaining = d;
    }
  }

  return { scenario, dDay, daysRemaining, simulationStartBalance, projections, inflows };
}

// ── 이번 주(28일) 가용금액 (4-6) ─────────────────────────

function computeWeekly(
  input: EngineInput,
  baselineResult: CashflowResult,
): { safeFund28Days: Won; weeklyAvailableAmount: Won } {
  const windowDays = MVP_POLICY.weeklyWindowDays; // 28
  const window = baselineResult.projections.slice(0, windowDays);

  const inflow28 = window.reduce((s, p) => s + p.inflow, 0);
  const fixedOutflow28 = window.reduce((s, p) => s + p.fixedOutflow, 0);
  const baseline28 = window.reduce((s, p) => s + p.baselineOutflow, 0);
  const newSavings28 = window.reduce((s, p) => s + p.newSavingsOutflow, 0);

  const safeFund28Days =
    input.user.totalBalance === input.user.totalBalance // no-op to keep shape obvious
      ? baselineResult.simulationStartBalance + inflow28 - fixedOutflow28 - baseline28 - newSavings28
      : 0;

  const weeklyAvailableAmount = round.divide(Math.max(0, safeFund28Days), 4);

  return { safeFund28Days: round.display(safeFund28Days), weeklyAvailableAmount };
}

// ── 위험 원인 (홈 6-1). 최소 구현 ─────────────────────────

function computeRiskCause(input: EngineInput, baselineResult: CashflowResult) {
  const { today, contracts, clients, outflows } = input;

  const delayedContracts = contracts
    .filter((c) => c.status === "delayed" || c.status === "risk")
    .map((c) => {
      const client = clients.find((cl) => cl.id === c.clientId);
      const overdueDays = c.expectedDate
        ? Math.max(0, daysBetween(c.expectedDate, today))
        : 0;
      return {
        contractId: c.id,
        clientName: client?.name ?? "알 수 없음",
        amount: c.expectedNetAmount ?? c.grossAmount,
        overdueDays,
      };
    });

  const upcoming = outflows
    .filter((o) => !o.includedInBaseline && o.dueDate >= today)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const nextLargeOutflow = upcoming.length > 0
    ? { name: upcoming[0].name, amount: upcoming[0].amount, date: upcoming[0].dueDate }
    : null;

  const shortfallAmount = baselineResult.dDay !== null
    ? Math.abs(Math.min(0, ...baselineResult.projections.map((p) => p.closingBalance)))
    : null;

  return { nextLargeOutflow, delayedContracts, shortfallAmount };
}

function daysBetween(from: DateString, to: DateString): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86_400_000);
}

// ── 3시나리오 전체 실행 (C가 홈 화면에서 부르는 진입점) ───

export function runAllScenarios(input: EngineInput): CashflowSummary {
  const optimistic = runScenario(input, "optimistic");
  const baseline = runScenario(input, "baseline");
  const pessimistic = runScenario(input, "pessimistic");

  const weekly = computeWeekly(input, baseline);

  const reservedTax = input.savings
    .filter((s) => s.kind === "tax")
    .reduce((sum, s) => sum + s.reservedAmount, 0);
  const reservedWish = input.savings
    .filter((s) => s.kind === "wish")
    .reduce((sum, s) => sum + s.reservedAmount, 0);

  const balanceBreakdown = {
    totalBalance: input.user.totalBalance,
    reservedTaxAmount: reservedTax,
    reservedWishAmount: reservedWish,
    safetyBuffer: input.user.safetyBuffer,
    simulationStartBalance: baseline.simulationStartBalance,
  };

  const riskCause = computeRiskCause(input, baseline);

  return { optimistic, baseline, pessimistic, weekly, balanceBreakdown, riskCause };
}
