import type { AIContractCandidate, DateString } from "../shared/types";
import { parseContractDeterministically, validateCandidate } from "./contract-parser";
import {
  DEMOTED_CONFIDENCE,
  findCrossContamination,
  type FieldEvidence,
  type EvidenceField,
} from "./evidence";

export interface AIContractProvider {
  parse(text: string, referenceDate: DateString): Promise<AIContractCandidate>;
}

export interface ParseServiceResult {
  candidate: AIContractCandidate;
  source: "ai" | "deterministic_fallback";
  warnings: string[];
  fallbackReason: string | null;
  /** [#48] 필드별 근거 구간. 결정적 파서 경로에서만 채워진다 */
  evidence?: FieldEvidence[];
  /** evidence의 span이 가리키는 대상 */
  normalizedText?: string;
}

/**
 * [#48] AI 출력에도 값 기반 자기 검증을 건다.
 *
 * 근거 구간은 결정적 파서만 만들 수 있어 AI 경로에는 없다. 하지만 교차 오염
 * 규칙은 값만 보면 판정되므로 AI 출력에도 그대로 적용할 수 있다. #35가 보여준
 * "거래처 이름이 금액까지 삼킨" 형태는 모델도 똑같이 낸다 — 모델은 그럴 때
 * confidence를 스스로 낮추지 않는다.
 *
 * 값은 바꾸지 않고 confidence만 내린다.
 */
function verifyAICandidate(candidate: AIContractCandidate): {
  candidate: AIContractCandidate;
  warnings: string[];
} {
  const warnings: string[] = [];
  const confidence = { ...candidate.confidence };
  const values: Partial<Record<EvidenceField, unknown>> = {
    clientName: candidate.clientName,
    grossAmount: candidate.grossAmount,
    payerStatedNetAmountCandidate: candidate.payerStatedNetAmountCandidate,
    completionDate: candidate.completionDate,
    settlementTerm: candidate.settlementTerm,
    incomeTypeCandidate: candidate.incomeTypeCandidate,
  };

  for (const field of Object.keys(confidence) as EvidenceField[]) {
    const reason = findCrossContamination(field, values[field]);
    if (reason === null) continue;
    confidence[field] = Math.min(confidence[field], DEMOTED_CONFIDENCE);
    warnings.push(reason);
  }

  if (warnings.length === 0) return { candidate, warnings };
  const needsReview = true;
  return { candidate: { ...candidate, confidence, needsReview }, warnings };
}

/**
 * 실제 모델 호출은 provider에 주입한다. 모델 실패·잘못된 JSON·스키마 위반 시
 * 사용자가 계약 내용을 수기로 확인할 수 있도록 로컬 후보를 항상 반환한다.
 */
export async function parseContractWithFallback(
  text: string,
  referenceDate: DateString,
  provider?: AIContractProvider,
): Promise<ParseServiceResult> {
  if (provider) {
    try {
      const candidate = await provider.parse(text, referenceDate);
      const errors = validateCandidate(candidate);
      if (errors.length === 0) {
        const verified = verifyAICandidate(candidate);
        return {
          candidate: verified.candidate,
          source: "ai",
          warnings: verified.warnings,
          fallbackReason: null,
        };
      }
      const fallback = parseContractDeterministically(text, { referenceDate });
      return { ...fallback, fallbackReason: `AI 출력 검증 실패: ${errors.join(" ")}` };
    } catch (error) {
      const fallback = parseContractDeterministically(text, { referenceDate });
      return {
        ...fallback,
        fallbackReason: `AI 호출 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
      };
    }
  }

  const fallback = parseContractDeterministically(text, { referenceDate });
  return { ...fallback, fallbackReason: "AI provider가 설정되지 않아 수기 확인용 로컬 파서를 사용했습니다." };
}
