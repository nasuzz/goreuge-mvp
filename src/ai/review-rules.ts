import type { AIContractCandidate, DateString } from "../shared/types";
import { CONFIDENCE_THRESHOLD } from "../shared/policy";

export type ConfidenceTone = "normal" | "warning" | "danger";
export type CandidateField = keyof AIContractCandidate["confidence"];

export interface CandidateFieldReview {
  field: CandidateField;
  confidence: number;
  tone: ConfidenceTone;
  missing: boolean;
}

export interface ConfirmationGate {
  canSave: boolean;
  errors: string[];
}

export function getConfidenceTone(confidence: number): ConfidenceTone {
  if (confidence >= CONFIDENCE_THRESHOLD.normal) return "normal";
  if (confidence >= CONFIDENCE_THRESHOLD.warning) return "warning";
  return "danger";
}

/**
 * 정산일수 허용 범위. engine/expectedDate.ts가 이 범위를 벗어나면 예외를 던지고
 * #21의 계약 저장 API도 같은 범위로 400을 낸다. 지금은 세 곳에 각자 상수가 있어
 * shared로 한 번 모으는 게 맞지만, 그건 A·B·C 파일을 동시에 건드리므로 별도로 뺀다.
 */
export const SETTLEMENT_DAY_RANGE = { min: 1, max: 365 } as const;

const NEEDS_SETTLEMENT_DAY: string[] = ["NEXT_MONTH_DAY", "NET_DAYS"];

function isSettlementDayInRange(day: number): boolean {
  return (
    Number.isInteger(day) && day >= SETTLEMENT_DAY_RANGE.min && day <= SETTLEMENT_DAY_RANGE.max
  );
}

/**
 * 확인 모달이 "누락" 배지를 붙여야 하는 값인지 판정한다.
 *
 * getConfirmationGate가 저장을 막는 조건과 같은 기준을 쓴다. 모달이 사용자의 수정에
 * 맞춰 missingFields를 직접 깎으면, 채웠다가 다시 지웠을 때 배지가 돌아오지 않아
 * 배지와 차단 사유가 서로 다른 말을 하게 된다("다 채웠다" 배지 + "거래처를 입력해
 * 주세요" 오류). 드롭다운에서 "확인 필요"(needs_review / UNKNOWN)를 고르는 것도
 * 마찬가지라, 매번 현재 값으로 다시 판정한다.
 */
export function isCandidateFieldMissing(
  candidate: AIContractCandidate,
  field: CandidateField,
  manualExpectedDate: DateString | null = null,
): boolean {
  switch (field) {
    case "clientName":
      return !candidate.clientName?.trim();
    case "grossAmount":
      return candidate.grossAmount == null || candidate.grossAmount <= 0;
    case "completionDate":
      return !candidate.completionDate;
    case "settlementTerm":
      // UNKNOWN이어도 예정입금일을 직접 넣었으면 누락이 아니다(gate와 동일).
      return (
        (!candidate.settlementTerm || candidate.settlementTerm === "UNKNOWN") &&
        !manualExpectedDate
      );
    case "incomeTypeCandidate":
      return candidate.incomeTypeCandidate === "needs_review";
    case "payerStatedNetAmountCandidate":
      // [#19] 이 필드는 "값이 없다 = 누락"이 아니다. 원문에 지급처 안내가 아예
      // 없으면 candidate=null + confidence=1.0이고, 그건 정상이라 저장을 막지
      // 않는다. 안내 금액이 서로 충돌하거나 총액 범위를 벗어나 계산이 불가능한
      // 경우에만 confidence=0으로 내려오고, 그때만 사용자 확인이 필요하다.
      // 사용자가 모달에서 금액을 직접 넣으면 해소된 것으로 본다.
      return (
        candidate.payerStatedNetAmountCandidate === null &&
        candidate.confidence.payerStatedNetAmountCandidate === 0
      );
    default:
      return false;
  }
}

/** 현재 후보 값 기준으로 missingFields를 다시 계산한다. 모달이 값을 고칠 때마다 쓴다. */
export function recomputeMissingFields(
  candidate: AIContractCandidate,
  manualExpectedDate: DateString | null = null,
): string[] {
  return (Object.keys(candidate.confidence) as CandidateField[]).filter((field) =>
    isCandidateFieldMissing(candidate, field, manualExpectedDate),
  );
}

export function getCandidateFieldReviews(candidate: AIContractCandidate): CandidateFieldReview[] {
  return (Object.keys(candidate.confidence) as CandidateField[]).map((field) => ({
    field,
    confidence: candidate.confidence[field],
    tone: getConfidenceTone(candidate.confidence[field]),
    missing: candidate.missingFields.includes(field),
  }));
}

/**
 * C의 확인 모달이 최종 저장 버튼을 열어도 되는지 계산한다.
 * 낮은 confidence는 사용자가 명시적으로 검토하면 통과할 수 있지만,
 * 필수값 누락은 검토 여부와 관계없이 저장할 수 없다.
 */
export function getConfirmationGate(
  candidate: AIContractCandidate,
  userReviewed: boolean,
  manualExpectedDate: DateString | null = null,
): ConfirmationGate {
  const errors: string[] = [];

  if (!candidate.clientName?.trim()) errors.push("거래처를 입력해 주세요.");
  if (candidate.grossAmount == null || candidate.grossAmount <= 0) errors.push("계약 금액을 입력해 주세요.");
  if (!candidate.completionDate) errors.push("완료일을 입력해 주세요.");

  if (!candidate.settlementTerm || candidate.settlementTerm === "UNKNOWN") {
    if (!manualExpectedDate) errors.push("정산조건 또는 예정입금일을 입력해 주세요.");
  }
  if (NEEDS_SETTLEMENT_DAY.includes(candidate.settlementTerm ?? "")) {
    if (candidate.settlementDay == null) {
      errors.push("정산일수를 입력해 주세요.");
    } else if (!isSettlementDayInRange(candidate.settlementDay)) {
      // 범위 밖이면 calculateExpectedDate가 예외를 던지고 #21 API도 400을 낸다.
      // 모달에서 먼저 막지 않으면 "저장 가능"으로 보이던 값이 폼에서 바로 오류가 된다.
      errors.push(
        `정산일수는 ${SETTLEMENT_DAY_RANGE.min}~${SETTLEMENT_DAY_RANGE.max} 사이의 정수여야 합니다.`,
      );
    }
  }
  if (candidate.incomeTypeCandidate === "needs_review") errors.push("소득유형을 선택해 주세요.");
  if (!userReviewed) errors.push("AI 후보를 확인해 주세요.");

  return { canSave: errors.length === 0, errors };
}
