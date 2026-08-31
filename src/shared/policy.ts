// shared/policy.ts
// DRI: A(수경).  상태: 1일차 오전 확정본
// 기획서 14장 "최종 확정 정책 상수" + 5-2 "참조 데이터"
// 원칙: 이 숫자를 코드 곳곳에 직접 쓰지 않는다. 항상 여기서 import 한다.

import { IncomeType } from "./enums";
import { Rate, Won } from "./types";

export const MVP_POLICY = {
  balanceScope: "all_liquid_accounts",
  safetyBufferMonths: 1.0,

  defaultTaxReserveRate: 0.12,
  taxReservePresets: [0.10, 0.12, 0.15] as const,
  taxReserveMin: 0,
  taxReserveMax: 0.5,

  wishWeeklyWarningRatio: 0.30,
  fixedOutflowDailyDivisor: 30,
  clientHistoryMinCount: 3,

  coldStartDelayDays: { optimistic: 0, baseline: 7, pessimistic: 21 },

  riskStatusOverdueDays: 60,
  simulationHorizonDays: 90,
  weeklyWindowDays: 28,

  /** 대응안 가정 비교 최대 개수 (P0 항목 11) */
  maxWhatIfAssumptions: 3,

  policyVersion: "mvp-1",
} as const;

// ── 참조 공제율 (기획서 5-2) ──────────────────────────────
// 법령·공제 참조값은 출처와 최종 확인일을 함께 저장한다(14장).

export interface WithholdingReference {
  incomeType: IncomeType;
  displayName: string;
  /** null이면 추정 불가 */
  referenceRate: Rate | null;
  includesLocalIncomeTax: boolean;
  requiresUserConfirmation: boolean;
  note: string | null;
  source: string | null;
  checkedAt: string | null;
}

export const WITHHOLDING_REFERENCES: WithholdingReference[] = [
  {
    incomeType: "business_personal_service",
    displayName: "원천징수 대상 인적용역 사업소득",
    referenceRate: 0.033,
    includesLocalIncomeTax: true,
    requiresUserConfirmation: true,
    note: null,
    source: "국세청",
    checkedAt: "2026-08",
  },
  {
    incomeType: "qualifying_other_income",
    displayName: "일부 기타소득",
    referenceRate: 0.088,
    includesLocalIncomeTax: true,
    requiresUserConfirmation: true,
    note: "모든 기타소득에 동일하게 적용되지 않음",
    source: "국세청",
    checkedAt: "2026-08",
  },
  {
    incomeType: "employment_income",
    displayName: "근로소득",
    referenceRate: null,
    includesLocalIncomeTax: false,
    requiresUserConfirmation: true,
    note: "간이세액표 등에 따라 달라 추정 불가",
    source: null,
    checkedAt: null,
  },
  {
    incomeType: "no_withholding",
    displayName: "공제 없는 수입",
    referenceRate: 0,
    includesLocalIncomeTax: false,
    requiresUserConfirmation: true,
    note: null,
    source: null,
    checkedAt: null,
  },
  {
    incomeType: "needs_review",
    displayName: "확인 필요",
    referenceRate: null,
    includesLocalIncomeTax: false,
    requiresUserConfirmation: true,
    note: "총액 표시, 실수령액 추정 불가",
    source: null,
    checkedAt: null,
  },
];

export function getWithholdingReference(t: IncomeType): WithholdingReference {
  const found = WITHHOLDING_REFERENCES.find((r) => r.incomeType === t);
  if (!found) throw new Error(`Unknown income type: ${t}`);
  return found;
}

// ── confidence 임계값 (업무분담 5장). DRI: B·C 합의, A는 참조만 ──
export const CONFIDENCE_THRESHOLD = {
  normal: 0.8,  // 이상 -> 일반 표시
  warning: 0.5, // 이상 normal 미만 -> 노란색 / 미만 -> 빨간색
} as const;

// ── 잔액 3단계 기준 [확정 D7 + safetyBuffer=0 보정] ──────
//
// 원안: safe >= safetyBuffer / caution >= safetyBuffer x 0.3 / danger 그 미만
// 문제: 데모 계정은 safetyBuffer = 0이라 caution 구간이 [0,0)으로 사라진다.
// 보정: safetyBuffer가 0이면 월 필수지출의 절반을 기준선으로 대체한다.
export const BALANCE_LEVEL = {
  safeMultiplier: 1.0,
  cautionMultiplier: 0.3,
  /** safetyBuffer가 0일 때 쓰는 대체 기준선 배수 */
  fallbackMonthlyRatio: 0.5,
} as const;

export function getBalanceReferenceAmount(
  safetyBuffer: Won,
  monthlyFixedOutflow: Won,
): Won {
  return safetyBuffer > 0
    ? safetyBuffer
    : Math.round(monthlyFixedOutflow * BALANCE_LEVEL.fallbackMonthlyRatio);
}

export function getBalanceLevel(
  balance: Won,
  safetyBuffer: Won,
  monthlyFixedOutflow: Won,
): "safe" | "caution" | "danger" {
  const ref = getBalanceReferenceAmount(safetyBuffer, monthlyFixedOutflow);
  if (balance >= ref * BALANCE_LEVEL.safeMultiplier) return "safe";
  if (balance >= ref * BALANCE_LEVEL.cautionMultiplier) return "caution";
  return "danger";
}

// ── 반올림 규칙 [확정 D8] ────────────────────────────────
// 공제액: 원 단위 내림. 일별 베이스라인: 내부 소수 유지, 반환 직전 반올림.
export const round = {
  /** 공제액 계산 */
  deduction: (gross: Won, rate: Rate): Won => Math.floor(gross * rate),
  /** 실수령액 = 총액 - 공제액 */
  netAmount: (gross: Won, rate: Rate): Won => gross - Math.floor(gross * rate),
  /** 화면 표시용 금액 */
  display: (v: number): Won => Math.round(v),
  /** 주간 가용금액 등 나눗셈 결과 */
  divide: (v: number, d: number): Won => Math.floor(v / d),
} as const;

// ── 고정 안내 문구 (기획서 3-5, 7, 13) ───────────────────
// C가 화면에 그대로 쓰는 문구. 임의로 바꾸지 않는다.
export const FIXED_COPY = {
  taxReserveDisclaimer:
    "사용자가 현금흐름 관리를 위해 설정하는 준비 비율이며, 세율 또는 예상 세액이 아닙니다.",
  transferDisclaimer: "실제 이체는 직접 해주세요.",
  serviceDisclaimer:
    "고르게의 금액은 사용자가 입력하거나 확인한 정보를 바탕으로 한 현금흐름 시뮬레이션입니다. 세금 신고, 소득유형 판정 또는 금융 의사결정을 대신하지 않습니다.",
  coldStartBasis: "거래 이력이 부족해 신규 거래처 기본 지연값을 사용했어요.",
  netAmountUnavailable: "공제 방식을 확인할 수 없어 실수령액을 추정할 수 없어요.",
  settlementTermUnknown: "정산조건을 확인할 수 없어요. 예정입금일을 직접 입력해 주세요.",
  referenceRateApplied: "확인 전 추정치이며 {rate}% 참조율을 적용했습니다.",
  safetyBufferSuggest:
    "월 필수지출을 기준으로 1개월치인 {amount}원을 안전예비금으로 제안해요. 예상 지출이 아니라, 가용자금 계산에서 건드리지 않는 기준선이에요.",
} as const;
