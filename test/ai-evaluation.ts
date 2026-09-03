import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AIContractCandidate } from "../src/shared/types";
import { parseContractDeterministically, validateCandidate } from "../src/ai/contract-parser";
import { parseContractWithFallback } from "../src/ai/parser-service";
import { OpenAIContractProvider } from "../src/ai/openai-provider";
import { getCandidateFieldReviews, getConfidenceTone, getConfirmationGate } from "../src/ai/review-rules";

type Expected = Pick<
  AIContractCandidate,
  "clientName" | "grossAmount" | "completionDate" | "settlementTerm" |
  "settlementDay" | "incomeTypeCandidate" | "needsReview"
>;

interface EvaluationCase {
  id: string;
  text: string;
  expected: Expected;
}

interface EvaluationDataset {
  synthetic: boolean;
  referenceDate: string;
  cases: EvaluationCase[];
}

const path = resolve(process.cwd(), "data/ground-truth/contract-evaluation.json");
const dataset = JSON.parse(readFileSync(path, "utf8")) as EvaluationDataset;
const fields: (keyof Expected)[] = [
  "clientName", "grossAmount", "completionDate", "settlementTerm",
  "settlementDay", "incomeTypeCandidate", "needsReview",
];

let correct = 0;
let total = 0;
let invalidOutputs = 0;
const failures: string[] = [];

if (!dataset.synthetic) failures.push("데이터셋 synthetic 표기가 true가 아닙니다.");
if (dataset.cases.length !== 20) failures.push(`평가 문장은 정확히 20건이어야 합니다. 현재 ${dataset.cases.length}건`);

for (const testCase of dataset.cases) {
  const { candidate } = parseContractDeterministically(testCase.text, { referenceDate: dataset.referenceDate });
  const validationErrors = validateCandidate(candidate);
  if (validationErrors.length > 0) {
    invalidOutputs++;
    failures.push(`${testCase.id} 스키마 오류: ${validationErrors.join(" ")}`);
  }
  for (const field of fields) {
    total++;
    if (candidate[field] === testCase.expected[field]) {
      correct++;
    } else {
      failures.push(`${testCase.id}.${field}: 실제=${JSON.stringify(candidate[field])}, 기대=${JSON.stringify(testCase.expected[field])}`);
    }
  }
}

async function main() {
  // AI provider가 실패해도 사용자 확인 가능한 후보가 반환되는지 검증한다.
  const fallbackResult = await parseContractWithFallback(
    dataset.cases[0].text,
    dataset.referenceDate,
    { parse: async () => { throw new Error("simulated provider outage"); } },
  );
  if (fallbackResult.source !== "deterministic_fallback" || !fallbackResult.fallbackReason?.includes("simulated provider outage")) {
    failures.push("AI provider 실패 시 fallback이 동작하지 않았습니다.");
  }

  const mockAIOutput = parseContractDeterministically(dataset.cases[0].text, { referenceDate: dataset.referenceDate }).candidate;
  const provider = new OpenAIContractProvider({
    apiKey: "test-key",
    fetchImpl: async () => new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(mockAIOutput) }] }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });
  const aiResult = await parseContractWithFallback(dataset.cases[0].text, dataset.referenceDate, provider);
  if (aiResult.source !== "ai" || aiResult.candidate.clientName !== "D에이전시") {
    failures.push("OpenAI provider의 구조화 출력 연결이 동작하지 않았습니다.");
  }

  if (getConfidenceTone(0.8) !== "normal" || getConfidenceTone(0.5) !== "warning" || getConfidenceTone(0.49) !== "danger") {
    failures.push("confidence 3단계 경계값이 공용 정책과 일치하지 않습니다.");
  }
  const fieldReviews = getCandidateFieldReviews(mockAIOutput);
  if (fieldReviews.length !== 5 || fieldReviews.some((field) => field.missing)) {
    failures.push("확인 모달용 필드 상태 계산이 올바르지 않습니다.");
  }
  if (getConfirmationGate(mockAIOutput, false).canSave) {
    failures.push("사용자 확인 전에는 저장이 차단되어야 합니다.");
  }
  if (!getConfirmationGate(mockAIOutput, true).canSave) {
    failures.push("필수값이 있고 사용자가 확인한 후보는 저장 가능해야 합니다.");
  }
  const missingAmount = { ...mockAIOutput, grossAmount: null };
  if (getConfirmationGate(missingAmount, true).canSave) {
    failures.push("필수 금액 누락 시 저장이 차단되어야 합니다.");
  }

  const accuracy = total === 0 ? 0 : correct / total;
  console.log("고르게 합성 데이터 기준 AI 파싱 평가");
  console.log(`- 평가 문장: ${dataset.cases.length}건`);
  console.log(`- 필드 일치: ${correct}/${total} (${(accuracy * 100).toFixed(1)}%)`);
  console.log(`- 스키마 오류: ${invalidOutputs}건`);
  console.log(`- fallback: ${fallbackResult.source}`);
  console.log(`- OpenAI provider mock: ${aiResult.source}`);
  console.log("- 확인 모달 규칙: confidence 경계·사용자 확인·필수값 차단 통과");

  if (failures.length > 0) {
    console.error("\n실패 항목");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log("✅ 합성 데이터 평가 전부 통과");
}

void main();
