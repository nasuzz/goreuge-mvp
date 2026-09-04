import type { AIContractCandidate, DateString } from "../shared/types";
import { parseContractDeterministically, validateCandidate } from "./contract-parser";

export interface AIContractProvider {
  parse(text: string, referenceDate: DateString): Promise<AIContractCandidate>;
}

export interface ParseServiceResult {
  candidate: AIContractCandidate;
  source: "ai" | "deterministic_fallback";
  warnings: string[];
  fallbackReason: string | null;
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
        return { candidate, source: "ai", warnings: [], fallbackReason: null };
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
