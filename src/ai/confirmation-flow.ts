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
    fields: getCandidateFieldReviews(result.candidate),
    gate: getConfirmationGate(result.candidate, userReviewed, manualExpectedDate),
  };
}

/** 사용자가 모달에서 후보를 수정한 뒤 저장 가능 상태를 다시 계산한다. */
export function rebuildAIConfirmationViewModel(
  previous: AIConfirmationViewModel,
  candidate: AIContractCandidate,
  userReviewed: boolean,
  manualExpectedDate: DateString | null = null,
): AIConfirmationViewModel {
  return {
    ...previous,
    candidate,
    fields: getCandidateFieldReviews(candidate),
    gate: getConfirmationGate(candidate, userReviewed, manualExpectedDate),
  };
}
