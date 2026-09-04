// shared/types.ts
// DRI: A(수경). 협업자 B·C.  상태: 1일차 오전 확정본
//
// [규약]
//  날짜  "YYYY-MM-DD" KST 달력일. Date 객체를 함수 경계에서 주고받지 않는다.
//  일시  ISO 8601 ("2026-08-31T09:00:00+09:00")
//  금액  원 단위 정수. 소수 금액을 저장하지 않는다.
//  비율  0~1 소수 (3.3% -> 0.033)

import {
  ContractStatus, ClassificationStatus, IncomeType,
  SettlementTerm, ExpectedDateSource,
  SavingsKind, SavingsStatus, SpendClass,
  Scenario, StatusSource, OutflowRecurrence,
  DelayBasis, NetAmountStatus, BalanceLevel,
} from "./enums";

export type DateString = string;
export type DateTimeString = string;
export type Won = number;
export type Rate = number;

// ═══ 1. users ═══════════════════════════════════════════
export interface User {
  id: string;
  /** 온보딩 필수1: 입출금 가능 계좌 합계. 투자·예적금·카드한도 제외(3-2) */
  totalBalance: Won;
  /** 온보딩 필수2: 월 필수지출 총액 1개. 항목별로 받지 않음(3-4) */
  monthlyFixedOutflow: Won;
  /** 온보딩 필수3: 안전예비금. 제안값 = monthlyFixedOutflow x 1.0, 0원 선택 가능(3-3) */
  safetyBuffer: Won;
  /** 세금 준비율. 기본 0.12, 범위 0~0.5. 세율이 아니라 현금 보호 정책(3-5) */
  taxReserveRate: Rate;
  createdAt: DateTimeString;
  updatedAt: DateTimeString;
}

// ═══ 2. clients ═════════════════════════════════════════
export interface Client {
  id: string;
  name: string;
  /** 입금 확인 완료 건수. 3건 미만이면 cold_start 정책값 사용(4-4) */
  completedCount: number;
  medianDelayDays: number | null;
  p90DelayDays: number | null;
}

// ═══ 3. contracts ═══════════════════════════════════════
export interface Contract {
  id: string;
  clientId: string;

  grossAmount: Won;
  completionDate: DateString;
  /** 청구일. NET_DAYS의 기준일로 우선 사용. 없으면 completionDate */
  invoiceDate: DateString | null;

  // [확정 D2] 예정입금일 재계산을 위해 반드시 저장
  settlementTerm: SettlementTerm;
  settlementDay: number | null;

  expectedDate: DateString | null;
  /** [확정 D1-a] manual이면 엔진이 재계산으로 덮어쓰지 않는다 */
  expectedDateSource: ExpectedDateSource;

  /** 있으면 actualNetAmount도 반드시 있어야 함(9-3 무결성) */
  actualDate: DateString | null;

  incomeType: IncomeType;
  classificationStatus: ClassificationStatus;

  // 공제율 3종. 절대 혼용하지 않는다(9-3 무결성)
  /** 시스템 참조 공제율(5-2 테이블). 추정 불가면 null */
  referenceRate: Rate | null;
  /** 사용자가 확인한 뒤 실제 적용된 잠정 공제율 */
  confirmedExpectedRate: Rate | null;
  /** 실제 입금액으로 역산(5-3). (총액-실수령액) / 총액 */
  actualRate: Rate | null;

  /** [이슈 #16] 지급처가 직접 알려준 정확한 실수령액(예: "실수령액 2,320,800원"으로 안내받음).
   * 공제액이 아니라 실수령액이다 — B의 AI 파서가 "공제액 79,200원"처럼 공제액 원문을
   * 받으면 grossAmount에서 차감해 이 필드(실수령액 후보)로 변환한 뒤 저장한다.
   * rate로 환산해 confirmedExpectedRate에 넣지 않는다 — DB의 confirmed_expected_rate가
   * numeric(5,4)라 왕복 시 원 단위 오차가 난다(실측: 임의 금액 기준 최대 241원 차).
   * 있으면 confirmedExpectedRate 계산보다 우선한다. 반드시 null로 명시할 것(undefined
   * 금지 — mock-data.ts validateIntegrity가 검사한다). */
  payerStatedNetAmount: Won | null;

  /** 잠정 실수령액. confirmedExpectedRate 없으면 null -> "추정 불가" 배지 */
  expectedNetAmount: Won | null;
  actualNetAmount: Won | null;

  status: ContractStatus;
  statusSource: StatusSource;
  /** statusSource가 user일 때 필수 */
  statusReason: string | null;
  statusUpdatedAt: DateTimeString;

  createdAt: DateTimeString;
  updatedAt: DateTimeString;
}

// ═══ 4. outflows ════════════════════════════════════════
export interface Outflow {
  id: string;
  kind: string;
  name: string;
  amount: Won;
  /** 실제 빠져나가는 날짜. 월 총액 1일 일괄차감 금지(3-4) */
  dueDate: DateString;
  /** monthly면 엔진이 시뮬레이션 기간 전체로 펼쳐야 함 */
  recurrence: OutflowRecurrence;
  /** true면 이미 monthlyFixedOutflow에 포함 -> 개별 차감 금지(9-3) */
  includedInBaseline: boolean;
}

// ═══ 5. transactions ════════════════════════════════════
export interface Transaction {
  id: string;
  amount: Won;
  occurredAt: DateTimeString;
  category: string;
  /** 생필·취미·스트레스. 자동 분류 학습은 P2 */
  spendClass: SpendClass;
  note: string | null;
}

// ═══ 6. savings  (P1 구현 대상) ═════════════════════════
export interface Saving {
  id: string;
  kind: SavingsKind;
  name: string;
  targetAmount: Won | null;
  weeklyAmount: Won | null;

  /** 앞으로 옮기기로 예약. 예정일의 미래 유출로 한 번만 반영 */
  plannedAmount: Won;
  /** 옮겼다고 체크한 누적액. 현재 가용잔액에서 제외. 체크 이력 합계 초과 불가(9-3) */
  reservedAmount: Won;
  /** 실제 구매·납부에 사용. 보호금 감소와 실제 유출을 동시 기록 */
  spentAmount: Won;

  status: SavingsStatus;
}

// ═══ 7. savings_checks ══════════════════════════════════
export interface SavingsCheck {
  id: string;
  savingId: string;
  checkedAt: DateTimeString;
  amount: Won;
  /** 앱은 계좌이체를 실행하지 않는다. 사용자 체크만 기록(7장) */
  transferConfirmed: boolean;
}

// ═══ AI 출력 (DRI: B. A는 인터페이스만 고정) ════════════
export interface AIContractCandidate {
  clientName: string | null;
  grossAmount: Won | null;
  completionDate: DateString | null;
  settlementTerm: SettlementTerm | null;
  settlementDay: number | null;
  /** AI는 후보만 제시한다. 확정하지 않는다(5-1, 13장) */
  incomeTypeCandidate: IncomeType;

  confidence: {
    clientName: number;
    grossAmount: number;
    completionDate: number;
    settlementTerm: number;
    incomeTypeCandidate: number;
  };

  missingFields: string[];
  needsReview: boolean;
}

// ═══ D-day 엔진 입출력 (DRI: A) ═════════════════════════

/** 엔진은 이 스냅샷 외에 아무것도 참조하지 않는 순수함수여야 한다 */
export interface EngineInput {
  today: DateString;
  user: User;
  contracts: Contract[];
  clients: Client[];
  outflows: Outflow[];
  savings: Saving[];
}

export interface ProjectedInflow {
  contractId: string;
  clientName: string;
  /** 시나리오별 입금 예정일. 유입 없음이면 null */
  date: DateString | null;
  amount: Won;
  netAmountStatus: NetAmountStatus;
  /** 화면 근거 문구용(4-4) */
  delayBasis: DelayBasis;
  delayDays: number;
  excludedReason: string | null;
}

export interface DailyProjection {
  date: DateString;
  openingBalance: Won;
  inflow: Won;
  /** includedInBaseline=false 인 outflow 중 이 날짜 해당분 */
  fixedOutflow: Won;
  /** monthlyFixedOutflow / 30 (3-4) */
  baselineOutflow: Won;
  /** savings.plannedAmount 중 이 날짜 예정분 */
  newSavingsOutflow: Won;
  closingBalance: Won;
  level: BalanceLevel;
}

export interface CashflowResult {
  scenario: Scenario;
  /** closingBalance <= 0 인 최초 날짜. 기간 내 없으면 null */
  dDay: DateString | null;
  daysRemaining: number | null;
  simulationStartBalance: Won;
  projections: DailyProjection[];
  inflows: ProjectedInflow[];
}

/** 홈 위험 원인(6-1) */
export interface RiskCause {
  nextLargeOutflow: { name: string; amount: Won; date: DateString } | null;
  delayedContracts: {
    contractId: string; clientName: string; amount: Won; overdueDays: number;
  }[];
  /** D-day를 넘기려면 얼마가 더 필요한가 */
  shortfallAmount: Won | null;
}

export interface CashflowSummary {
  optimistic: CashflowResult;
  baseline: CashflowResult;
  pessimistic: CashflowResult;

  weekly: {
    safeFund28Days: Won;
    weeklyAvailableAmount: Won;
  };

  /** 화면에서 합계가 맞아떨어져야 함(4-6 마지막 줄) */
  balanceBreakdown: {
    totalBalance: Won;
    reservedTaxAmount: Won;
    reservedWishAmount: Won;
    safetyBuffer: Won;
    simulationStartBalance: Won;
  };

  riskCause: RiskCause;
}

// ═══ 대응안 가정 비교 (P0, 최대 3개) ════════════════════
export type WhatIfAssumption =
  | { type: "advance_payment"; label: string; amount: Won; date: DateString }
  | { type: "delay_outflow"; label: string; outflowId: string; newDate: DateString }
  | { type: "reduce_spending"; label: string; monthlyReduction: Won };

export interface WhatIfResult {
  assumption: WhatIfAssumption;
  dDayBefore: DateString | null;
  dDayAfter: DateString | null;
  /** 양수면 D-day가 늦춰짐(좋아짐). "+12일" 표시용 */
  dayDelta: number;
}

// ═══ 위시함 계산 (P1) ═══════════════════════════════════
export interface WishPlan {
  savingId: string;
  /** ceil(targetAmount / weeklyAmount) 주 후 */
  targetDate: DateString | null;
  weeksRemaining: number | null;
  /** weeklyAmount > 이번 주 가용금액 x 0.30 이면 true. 저장은 허용(경고만) */
  exceedsWeeklyWarning: boolean;
  /** 보호금과 구매 유출을 상계한 "살 수 있는 날" */
  affordableDate: DateString | null;
}

// ═══ 저장/조회 DTO ══════════════════════════════════════
export interface ContractCreateInput {
  clientName: string;
  grossAmount: Won;
  completionDate: DateString;
  invoiceDate: DateString | null;
  settlementTerm: SettlementTerm;
  settlementDay: number | null;
  /** UNKNOWN이거나 사용자가 직접 지정할 때 사용 */
  manualExpectedDate: DateString | null;
  incomeType: IncomeType;
  /** user_confirmed 미만이면 저장 거부 */
  classificationStatus: Extract<ClassificationStatus, "user_confirmed">;
  /** [이슈 #16] 지급처가 알려준 금액. 있으면 confirmedExpectedRate보다 우선 적용됨 */
  payerStatedNetAmount: Won | null;
  confirmedExpectedRate: Rate | null;
}

export interface PaymentConfirmInput {
  contractId: string;
  actualDate: DateString;
  actualNetAmount: Won;
}
