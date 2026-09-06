// 계약 문장의 구조적 위험 신호 탐지 (#49).
// DRI: B. 이 파일은 C가 초안을 냈고 B 검토를 받는다.
//
// [왜 필요한가]
// 지금 AI는 계약 문장에서 값을 뽑는 일만 한다. 뽑을 값이 없으면 missingFields로
// 표시하고 끝이다. 그런데 프리랜서가 돈을 못 받는 원인은 대개 값이 비어서가 아니라
// 계약 문장 자체가 위험하게 쓰여 있어서다.
//
//   "검수 끝나면 정산해드릴게요"  -> 파싱은 성공한다(settlementTerm: UNKNOWN).
//                                사용자가 예정입금일을 직접 넣으면 저장도 된다.
//                                그런데 그 날짜는 근거가 없는 숫자다.
//
// D-day는 정확하게 계산되지만 입력 자체가 위험한 가정 위에 서 있다. 이 파일은
// 그 위험을 계약 등록 "전에" 사용자에게 돌려준다.
//
// [왜 규칙이 아니라 AI인가]
// "검수"라는 단어가 위험한 게 아니다. 정산 시점이 상대 재량에 걸려 있고 기한이 없다는
// 구조가 위험하다. 정상 계약에도 "검수"는 나온다. 그래서 키워드 목록으로 잡으면 오탐이
// 쏟아진다. 아래 결정적 탐지기는 provider가 없을 때 쓰는 fallback이고, 판단 품질은
// LLM 경로가 맡는다.
//
// [환각 가드]
// 어느 경로든 quote는 반드시 원문에 실제로 존재해야 한다. 근거를 지어내면 사용자가
// 검증할 수 없고, 그 순간 이 기능은 경고가 아니라 소음이 된다. validateRiskSignals가
// 원문에 없는 quote를 가진 신호를 버린다.

import { maskContractText } from "./privacy-mask";

export type ContractRiskKind =
  | "open_ended_condition" // 정산 시점이 상대 재량, 기한 없음
  | "amount_unfixed" // 총액 미확정
  | "scope_creep" // 완료 기준이 열려 있음
  | "invoice_dependency" // 세금계산서·청구서 발행이 정산 기산일을 좌우
  | "verbal_only"; // 문서 근거 없이 구두 합의만 언급

export interface ContractRiskSignal {
  kind: ContractRiskKind;
  /** 원문에 실제로 존재하는 구간. 지어내지 않는다 */
  quote: string;
  severity: "info" | "warning";
  /** 등록 전에 거래처에 물어볼 한 문장 */
  suggestedQuestion: string;
}

export interface RiskDetectionResult {
  signals: ContractRiskSignal[];
  source: "ai" | "deterministic_fallback";
  fallbackReason: string | null;
}

export interface ContractRiskProvider {
  detect(maskedText: string): Promise<ContractRiskSignal[]>;
}

export const RISK_LABEL: Record<ContractRiskKind, string> = {
  open_ended_condition: "정산 시점이 열려 있어요",
  amount_unfixed: "금액이 확정되지 않았어요",
  scope_creep: "완료 기준이 열려 있어요",
  invoice_dependency: "정산 시작일이 서류 발행에 걸려 있어요",
  verbal_only: "구두 합의만 언급돼 있어요",
};

// ── 결정적 fallback ──────────────────────────────────────
//
// 각 규칙은 (a) 위험 구조를 가리키는 표현과 (b) 그 위험을 해소하는 표현을 함께 본다.
// (b)가 있으면 신호를 내지 않는다. "검수 후 7일 이내 정산"은 기한이 있으므로 안전하다.

interface Rule {
  kind: ContractRiskKind;
  /** 위험 구조 */
  trigger: RegExp;
  /** 이게 같이 있으면 위험이 해소된 것으로 본다 */
  resolver: RegExp | null;
  severity: "info" | "warning";
  suggestedQuestion: string;
}

/** 기한이 명시됐는지 — "7일 이내", "30일 안에", "9월 10일까지" */
const HAS_DEADLINE = /(\d+\s*(일|영업일|주|개월)\s*(이내|안에|내에|후에|뒤에))|(\d{1,2}\s*월\s*\d{1,2}\s*일)|(말일|익월|당월)/;

const RULES: Rule[] = [
  {
    kind: "open_ended_condition",
    // "검수 끝나면", "확인되면", "승인 나면" — 시점이 상대 행동에 달려 있다
    trigger: /(검수|확인|승인|컨펌|피드백)\s*(가|이|을|를)?\s*(끝나|완료되|되면|나면|마치면|받으면)/,
    resolver: HAS_DEADLINE,
    severity: "warning",
    suggestedQuestion:
      "검수는 보통 며칠 정도 걸릴까요? 검수 완료 후 며칠 안에 정산인지 정해두면 좋겠습니다.",
  },
  {
    kind: "amount_unfixed",
    trigger: /(금액|비용|단가|견적)\s*(은|는|이|가)?\s*(나중에|추후|따로|협의|정해서|미정)/,
    resolver: null,
    severity: "warning",
    suggestedQuestion: "총액을 먼저 확정해 주실 수 있을까요? 금액이 정해져야 일정을 잡을 수 있습니다.",
  },
  {
    kind: "scope_creep",
    trigger: /(수정|피드백|보완)\s*(은|는|이|가)?\s*(몇\s*번|여러\s*번|계속|추가로|더)/,
    // "수정 2회까지" 같이 횟수가 박혀 있으면 해소
    resolver: /\d+\s*회/,
    severity: "info",
    suggestedQuestion: "수정은 몇 회까지로 볼까요? 횟수를 정해두면 완료일을 지킬 수 있습니다.",
  },
  {
    kind: "invoice_dependency",
    trigger: /(세금계산서|계산서|청구서|인보이스)\s*(는|은|를|을)?\s*(다음\s*달|추후|나중에|끊어|발행)/,
    resolver: HAS_DEADLINE,
    severity: "info",
    suggestedQuestion:
      "계산서 발행일이 정산 기산일인가요? 발행 예정일을 알려주시면 입금일을 계산할 수 있습니다.",
  },
  {
    kind: "verbal_only",
    trigger: /(구두|말로|통화|전화)\s*(로|으로)?\s*(합의|이야기|얘기|협의|약속)/,
    resolver: /(계약서|서면|메일|문서)/,
    severity: "info",
    suggestedQuestion: "합의 내용을 메일이나 메시지로 한 번 정리해 남겨두면 좋겠습니다.",
  },
];

/** trigger가 걸린 문장 하나를 근거로 잘라낸다. 원문 그대로여야 한다. */
function sentenceAround(text: string, index: number): string {
  const start = Math.max(
    0,
    ...[". ", "! ", "? ", "\n", ". ", "다. ", "요. "].map((mark) => {
      const found = text.lastIndexOf(mark, index);
      return found === -1 ? 0 : found + mark.length;
    }),
  );
  const tailCandidates = [".", "!", "?", "\n"]
    .map((mark) => text.indexOf(mark, index))
    .filter((found) => found !== -1);
  const end = tailCandidates.length > 0 ? Math.min(...tailCandidates) + 1 : text.length;
  return text.slice(start, end).trim();
}

export function detectContractRisksDeterministically(text: string): ContractRiskSignal[] {
  const signals: ContractRiskSignal[] = [];

  for (const rule of RULES) {
    const match = rule.trigger.exec(text);
    if (!match) continue;

    const quote = sentenceAround(text, match.index);
    // 같은 문장이 위험을 스스로 해소하고 있으면 신호를 내지 않는다.
    if (rule.resolver && rule.resolver.test(quote)) continue;

    signals.push({
      kind: rule.kind,
      quote,
      severity: rule.severity,
      suggestedQuestion: rule.suggestedQuestion,
    });
  }

  return signals;
}

// ── 환각 가드 ────────────────────────────────────────────

/**
 * quote가 원문에 실제로 있는 신호만 남긴다.
 * 공백만 다른 경우까지 버리면 정상 신호가 사라지므로 공백을 접어서 비교한다.
 */
export function validateRiskSignals(
  signals: ContractRiskSignal[],
  originalText: string,
): ContractRiskSignal[] {
  const flat = originalText.replace(/\s+/g, "");
  const seen = new Set<ContractRiskKind>();

  return signals.filter((signal) => {
    if (!signal.quote?.trim()) return false;
    if (!flat.includes(signal.quote.replace(/\s+/g, ""))) return false;
    // 같은 종류를 여러 번 띄우지 않는다. 경고가 많으면 전부 무시된다.
    if (seen.has(signal.kind)) return false;
    seen.add(signal.kind);
    return true;
  });
}

// ── provider 경로 ────────────────────────────────────────

export function buildContractRiskPrompt(maskedText: string): string {
  return [
    "당신은 프리랜서의 계약 문장을 읽고 정산이 지연될 수 있는 구조적 위험만 골라내는 검토자입니다.",
    "",
    "규칙:",
    "- 아래 다섯 종류만 사용합니다: open_ended_condition, amount_unfixed, scope_creep, invoice_dependency, verbal_only",
    "- quote는 원문에 있는 문장을 그대로 복사합니다. 요약하거나 다듬지 않습니다.",
    "- 위험이 없으면 빈 배열을 반환합니다. 억지로 찾지 않습니다.",
    "- 기한이나 횟수가 이미 명시돼 있으면 위험이 아닙니다.",
    "- 법률 판단이나 조언을 하지 않습니다. 관찰과 질문만 씁니다.",
    "- suggestedQuestion은 거래처에 물어볼 한 문장입니다.",
    "",
    'JSON만 출력합니다: {"signals":[{"kind":"","quote":"","severity":"info|warning","suggestedQuestion":""}]}',
    "",
    "계약 문장:",
    maskedText,
  ].join("\n");
}

/**
 * provider가 없거나 실패하면 결정적 탐지기로 떨어진다.
 * 어느 경로든 원문 대조를 통과한 신호만 남는다.
 */
export async function detectContractRisks(
  text: string,
  provider?: ContractRiskProvider,
): Promise<RiskDetectionResult> {
  const fallback = (reason: string | null): RiskDetectionResult => ({
    signals: validateRiskSignals(detectContractRisksDeterministically(text), text),
    source: "deterministic_fallback",
    fallbackReason: reason,
  });

  if (!provider) {
    return fallback("AI provider가 설정되지 않아 로컬 규칙으로 검토했습니다.");
  }

  try {
    // 외부로 나가는 건 마스킹된 본문이다(#11 리뷰에서 확정된 원칙).
    const masked = maskContractText(text);
    const raw = await provider.detect(masked.maskedText);
    // 마스킹된 본문에서 나온 quote를 원문과 대조한다. 마스킹으로 바뀐 구간을 인용했다면
    // 원문에 없으므로 여기서 걸러진다 — 개인정보가 화면으로 되돌아오지 않는다.
    const validated = validateRiskSignals(raw, text);
    return { signals: validated, source: "ai", fallbackReason: null };
  } catch (error) {
    return fallback(
      `AI 호출 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
    );
  }
}
