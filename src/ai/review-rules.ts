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
  if (["NEXT_MONTH_DAY", "NET_DAYS"].includes(candidate.settlementTerm ?? "") && candidate.settlementDay == null) {
    errors.push("정산일수를 입력해 주세요.");
  }
  if (candidate.incomeTypeCandidate === "needs_review") errors.push("소득유형을 선택해 주세요.");
  if (!userReviewed) errors.push("AI 후보를 확인해 주세요.");

  return { canSave: errors.length === 0, errors };
}
