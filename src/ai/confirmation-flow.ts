import type { AIContractCandidate, DateString } from "../shared/types";
import type { ParseServiceResult } from "./parser-service";
import {
  getCandidateFieldReviews,
  getConfirmationGate,
  type CandidateFieldReview,
  type ConfirmationGate,
} from "./review-rules";

export interface AIConfirmationViewModel {
  candidate: AIContractCandidate;
  source: ParseServiceResult["source"];
  warnings: string[];
  /** provider 오류 원문은 브라우저에 전달하지 않고 고정 안내만 표시한다. */
  fallbackNotice: string | null;
  fields: CandidateFieldReview[];
  gate: ConfirmationGate;
  /**
   * [#48] 근거 구간이 가리키는 원문(공백 정규화본). 확인 모달이 이 문자열 위에
   * `fields[].evidence.span`을 강조한다. AI 경로에는 근거 구간이 없어 null이다.
   */
  evidenceText: string | null;
}

const FALLBACK_NOTICE =
  "AI 자동 분석을 사용할 수 없어 로컬 분석 결과를 표시했습니다. 내용을 직접 확인해 주세요.";

/**
 * B의 파싱 결과를 C의 확인 모달이 그대로 렌더링할 수 있는 형태로 조립한다.
 * confidence 임계값과 저장 조건을 화면에서 다시 구현하지 않도록 이 함수만 사용한다.
 */
export function buildAIConfirmationViewModel(
  result: ParseServiceResult,
  userReviewed = false,
  manualExpectedDate: DateString | null = null,
): AIConfirmationViewModel {
  return {
    candidate: result.candidate,
    source: result.source,
    warnings: [...result.warnings],
    fallbackNotice: result.source === "deterministic_fallback" ? FALLBACK_NOTICE : null,
    fields: getCandidateFieldReviews(result.candidate, result.evidence),
    gate: getConfirmationGate(result.candidate, userReviewed, manualExpectedDate),
    evidenceText: result.normalizedText ?? null,
  };
}

/** 사용자가 모달에서 후보를 수정한 뒤 저장 가능 상태를 다시 계산한다. */
export function rebuildAIConfirmationViewModel(
  previous: AIConfirmationViewModel,
  candidate: AIContractCandidate,
  userReviewed: boolean,
  manualExpectedDate: DateString | null = null,
): AIConfirmationViewModel {
  // [#48] 사용자가 고친 필드의 근거는 더 이상 그 값을 설명하지 않는다. 그대로 두면
  // 원문 하이라이트가 사용자가 지운 값을 계속 가리킨다. 값이 그대로인 필드의
  // 근거만 넘긴다.
  const keptEvidence = previous.fields
    .filter((field) => field.evidence !== null && !isFieldEdited(previous.candidate, candidate, field.field))
    .map((field) => field.evidence!);

  return {
    ...previous,
    candidate,
    fields: getCandidateFieldReviews(candidate, keptEvidence),
    gate: getConfirmationGate(candidate, userReviewed, manualExpectedDate),
  };
}

function isFieldEdited(
  before: AIContractCandidate,
  after: AIContractCandidate,
  field: CandidateFieldReview["field"],
): boolean {
  switch (field) {
    case "clientName": return before.clientName !== after.clientName;
    case "grossAmount": return before.grossAmount !== after.grossAmount;
    case "payerStatedNetAmountCandidate":
      return before.payerStatedNetAmountCandidate !== after.payerStatedNetAmountCandidate;
    case "completionDate": return before.completionDate !== after.completionDate;
    case "settlementTerm":
      return before.settlementTerm !== after.settlementTerm || before.settlementDay !== after.settlementDay;
    case "incomeTypeCandidate": return before.incomeTypeCandidate !== after.incomeTypeCandidate;
    default: return true;
  }
}
