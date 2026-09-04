import type { AIContractCandidate } from "../src/shared/types";
import { parseContractDeterministically } from "../src/ai/contract-parser";
import {
  buildAIConfirmationViewModel,
  rebuildAIConfirmationViewModel,
} from "../src/ai/confirmation-flow";
import { parseContractParseRequest } from "../src/ai/parse-request";

const text = "[D에이전시] 납품은 2026년 9월 3일이고 총 240만원입니다. 익월 말일, 3.3% 공제예요.";
const parsed = parseContractDeterministically(text, { referenceDate: "2026-09-04" });
const fallbackResult = {
  ...parsed,
  fallbackReason: "AI provider가 설정되지 않아 수기 확인용 로컬 파서를 사용했습니다.",
};

const initial = buildAIConfirmationViewModel(fallbackResult);
const failures: string[] = [];

if (initial.source !== "deterministic_fallback" || !initial.fallbackNotice) {
  failures.push("fallback 결과에 사용자 확인 안내가 표시되어야 합니다.");
}
if (initial.fallbackNotice?.includes("provider") || initial.fallbackNotice?.includes("API")) {
  failures.push("화면용 fallback 안내에 내부 오류 정보가 노출되면 안 됩니다.");
}
if (initial.gate.canSave || !initial.gate.errors.includes("AI 후보를 확인해 주세요.")) {
  failures.push("최초 AI 후보는 사용자 확인 전 저장이 차단되어야 합니다.");
}
if (initial.fields.length !== 5 || initial.fields.some((field) => field.missing)) {
  failures.push("정상 문장의 필드별 검토 상태가 올바르지 않습니다.");
}

const reviewed = rebuildAIConfirmationViewModel(initial, initial.candidate, true);
if (!reviewed.gate.canSave) failures.push("정상 후보는 사용자 확인 후 저장 가능해야 합니다.");

const missingAmount: AIContractCandidate = {
  ...initial.candidate,
  grossAmount: null,
  missingFields: [...initial.candidate.missingFields, "grossAmount"],
  confidence: { ...initial.candidate.confidence, grossAmount: 0 },
  needsReview: true,
};
const missingAmountView = rebuildAIConfirmationViewModel(initial, missingAmount, true);
if (missingAmountView.gate.canSave || !missingAmountView.fields.find((field) => field.field === "grossAmount")?.missing) {
  failures.push("금액 누락은 강조되고 사용자 확인 후에도 저장이 차단되어야 합니다.");
}

const unknownSettlement: AIContractCandidate = {
  ...initial.candidate,
  settlementTerm: "UNKNOWN",
  settlementDay: null,
  missingFields: ["settlementTerm"],
  confidence: { ...initial.candidate.confidence, settlementTerm: 0 },
  needsReview: true,
};
const withoutManualDate = rebuildAIConfirmationViewModel(initial, unknownSettlement, true);
const withManualDate = rebuildAIConfirmationViewModel(initial, unknownSettlement, true, "2026-10-31");
if (withoutManualDate.gate.canSave || !withManualDate.gate.canSave) {
  failures.push("UNKNOWN 정산조건은 수기 예정입금일이 있을 때만 저장 가능해야 합니다.");
}

const validRequest = parseContractParseRequest({ text: `  ${text}  `, referenceDate: "2026-09-04" });
if (!validRequest.ok || validRequest.value.text !== text) failures.push("정상 API 요청을 trim 후 통과시켜야 합니다.");
if (parseContractParseRequest({ text: "", referenceDate: "2026-09-04" }).ok) failures.push("빈 원문을 차단해야 합니다.");
if (parseContractParseRequest({ text, referenceDate: "2026-02-30" }).ok) failures.push("존재하지 않는 기준일을 차단해야 합니다.");
if (parseContractParseRequest({ text: "가".repeat(10_001), referenceDate: "2026-09-04" }).ok) failures.push("과도하게 긴 원문을 차단해야 합니다.");

if (failures.length > 0) {
  console.error("AI 확인 흐름 검증 실패");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("✅ AI 확인 흐름: fallback·필드 상태·저장 차단·API 입력 검증 통과");
