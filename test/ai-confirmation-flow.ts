import type { AIContractCandidate } from "../src/shared/types";
import { parseContractDeterministically } from "../src/ai/contract-parser";
import {
  buildAIConfirmationViewModel,
  rebuildAIConfirmationViewModel,
} from "../src/ai/confirmation-flow";
import { parseContractParseRequest } from "../src/ai/parse-request";
import {
  getConfirmationGate,
  recomputeMissingFields,
  SETTLEMENT_DAY_RANGE,
} from "../src/ai/review-rules";

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

// ── 누락 배지가 현재 값을 따라가는가 (PR #29 리뷰 1·2) ──────────
// 모달이 missingFields를 깎기만 하면, 채웠다가 지운 값이나 드롭다운에서 고른
// "확인 필요"가 누락으로 되돌아오지 않아 배지와 차단 사유가 어긋난다.
const filled = reviewed.candidate;
const missingCases: [string, Partial<AIContractCandidate>, string | null, string[]][] = [
  ["값이 다 있으면 누락 없음", {}, null, []],
  ["거래처를 지우면 누락 복귀", { clientName: null }, null, ["clientName"]],
  ["거래처가 공백뿐이어도 누락", { clientName: "   " }, null, ["clientName"]],
  ["총액 0은 누락", { grossAmount: 0 }, null, ["grossAmount"]],
  ["소득유형 needs_review 선택도 누락", { incomeTypeCandidate: "needs_review" }, null, ["incomeTypeCandidate"]],
  ["정산조건 UNKNOWN 선택도 누락", { settlementTerm: "UNKNOWN" }, null, ["settlementTerm"]],
  ["UNKNOWN이어도 수기 예정일이 있으면 누락 아님", { settlementTerm: "UNKNOWN" }, "2026-10-31", []],
];
for (const [label, patch, manual, expected] of missingCases) {
  const actual = recomputeMissingFields({ ...filled, ...patch }, manual);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${label}: missingFields 실제=${JSON.stringify(actual)} 기대=${JSON.stringify(expected)}`);
  }
}

// ── settlementDay 범위 (PR #29 리뷰 3) ──────────────────────────
// 범위 밖이면 calculateExpectedDate가 예외를 던지고 저장 API도 400을 낸다.
// 모달에서 "저장 가능"으로 보이던 값이 폼에서 바로 오류가 되면 안 된다.
const rangeError = `정산일수는 ${SETTLEMENT_DAY_RANGE.min}~${SETTLEMENT_DAY_RANGE.max} 사이의 정수여야 합니다.`;
const dayCases: [string, Partial<AIContractCandidate>, boolean][] = [
  ["NET_DAYS + 30은 저장 가능", { settlementTerm: "NET_DAYS", settlementDay: 30 }, true],
  ["NET_DAYS + 미입력은 차단", { settlementTerm: "NET_DAYS", settlementDay: null }, false],
  ["NET_DAYS + 400은 차단", { settlementTerm: "NET_DAYS", settlementDay: 400 }, false],
  ["NEXT_MONTH_DAY + 0은 차단", { settlementTerm: "NEXT_MONTH_DAY", settlementDay: 0 }, false],
];
for (const [label, patch, canSave] of dayCases) {
  const gate = getConfirmationGate({ ...filled, ...patch }, true);
  if (gate.canSave !== canSave) failures.push(`${label}: canSave=${gate.canSave}`);
  const day = patch.settlementDay;
  if (day != null && (day < SETTLEMENT_DAY_RANGE.min || day > SETTLEMENT_DAY_RANGE.max)) {
    if (!gate.errors.includes(rangeError)) {
      failures.push(`${label}: 범위 오류 문구가 없습니다 (${JSON.stringify(gate.errors)})`);
    }
  }
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
