import type { AIContractCandidate, DateString } from "../shared/types";
import type { IncomeType, SettlementTerm } from "../shared/enums";
import { CONFIDENCE_THRESHOLD } from "../shared/policy";

export interface ParseContractOptions {
  /** 연도가 생략된 날짜를 해석하는 기준일. 화면/API에서 오늘(KST)을 주입한다. */
  referenceDate: DateString;
}

export interface ParseContractResult {
  candidate: AIContractCandidate;
  source: "deterministic_fallback";
  warnings: string[];
}

const KOREAN_DIGITS: Record<string, number> = {
  영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4,
  오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9,
};

function parseKoreanNumber(value: string): number | null {
  if (!value) return null;
  let section = 0;
  let digit = 0;
  for (const char of value) {
    if (char in KOREAN_DIGITS) {
      digit = KOREAN_DIGITS[char];
    } else if (char === "십") {
      section += (digit || 1) * 10;
      digit = 0;
    } else if (char === "백") {
      section += (digit || 1) * 100;
      digit = 0;
    } else if (char === "천") {
      section += (digit || 1) * 1000;
      digit = 0;
    } else {
      return null;
    }
  }
  return section + digit;
}

interface AmountMention { index: number; amount: number }

function findAmountMentions(text: string): AmountMention[] {
  const matches: { index: number; amount: number }[] = [];
  const numeric = /(\d[\d,]*(?:\.\d+)?)\s*(만원|원)/g;
  for (const match of text.matchAll(numeric)) {
    const value = Number(match[1].replace(/,/g, ""));
    matches.push({ index: match.index ?? 0, amount: Math.round(value * (match[2] === "만원" ? 10_000 : 1)) });
  }
  const korean = /([일이삼사오육칠팔구십백천]+)\s*만원/g;
  for (const match of text.matchAll(korean)) {
    const value = parseKoreanNumber(match[1]);
    if (value != null) matches.push({ index: match.index ?? 0, amount: value * 10_000 });
  }
  return matches.sort((a, b) => a.index - b.index);
}

function isPayerAmountContext(text: string, index: number): boolean {
  // 지급처 금액 라벨은 보통 숫자 앞에 붙는다. 숫자 뒤의 먼 문맥까지 보면
  // "총액 980,000원이고 실수령액 ..."에서 총액까지 잘못 제외된다.
  const context = text.slice(Math.max(0, index - 22), index);
  return /실\s*수령|수령\s*예정|입금\s*예정\s*금액|지급\s*예정\s*금액|공제액|차감액/.test(context);
}

function parseAmountToken(raw: string, unit: string): number | null {
  const value = /^\d/.test(raw) ? Number(raw.replace(/,/g, "")) : parseKoreanNumber(raw);
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value * (unit === "만원" ? 10_000 : 1));
}

function extractAmount(text: string, warnings: string[]): { value: number | null; confidence: number } {
  const amounts = findAmountMentions(text)
    .filter((mention) => !isPayerAmountContext(text, mention.index))
    .map((mention) => mention.amount)
    .filter((amount) => amount >= 10_000);
  if (amounts.length === 0) return { value: null, confidence: 0 };

  const unique = [...new Set(amounts)];
  const totalText = text.match(/(?:총액|계약\s*금액|총)\s*(?:은|는|:)??\s*([일이삼사오육칠팔구십백천]+|\d[\d,]*(?:\.\d+)?)\s*(만원|원)/);
  let value = amounts.at(-1) ?? null;
  if (totalText && !/정정|변경/.test(text)) {
    const raw = /^\d/.test(totalText[1])
      ? Number(totalText[1].replace(/,/g, ""))
      : parseKoreanNumber(totalText[1]);
    value = raw == null ? value : Math.round(raw * (totalText[2] === "만원" ? 10_000 : 1));
  }
  let confidence = unique.length === 1 ? 0.96 : 0.62;
  if (unique.length > 1 && /선금|잔금|분할/.test(text) && totalText) confidence = 0.72;
  if (unique.length > 1) warnings.push("금액 후보가 여러 개라 총액 또는 마지막 정정 금액을 후보로 제시했습니다.");

  if (value != null && /VAT\s*별도|부가세\s*별도/i.test(text)) {
    value = Math.round(value * 1.1);
    confidence = Math.min(confidence, 0.75);
    warnings.push("VAT 별도 문구를 반영해 10%를 더한 후보 금액입니다. 사용자가 확인해야 합니다.");
  }
  if (/선금|잔금|분할/.test(text)) {
    confidence = Math.min(confidence, 0.45);
    warnings.push("분할 지급은 MVP에서 계약을 나눠 등록해야 합니다.");
  }
  return { value, confidence };
}

interface PayerNetExtraction {
  value: number | null;
  confidence: number;
  needsResolution: boolean;
}

/**
 * 지급처가 금액으로 직접 안내한 실수령액만 후보화한다.
 * 공제율만 있는 문장은 의도적으로 null을 유지하며, 공제액 문구는 gross가 있을 때만 차감한다.
 */
function extractPayerStatedNetAmount(
  text: string,
  grossAmount: number | null,
  warnings: string[],
): PayerNetExtraction {
  const amount = "([일이삼사오육칠팔구십백천]+|\\d[\\d,]*(?:\\.\\d+)?)\\s*(만원|원)";
  const directPatterns = [
    new RegExp(`(?:실\\s*수령(?:액)?|실제\\s*수령\\s*예정\\s*금액|수령\\s*예정\\s*금액|입금\\s*예정\\s*금액|지급\\s*예정\\s*금액)(?:은|는|:)?\\s*${amount}`, "g"),
    new RegExp(`${amount}\\s*(?:을|를|이|가)?\\s*(?:실\\s*수령(?:액)?|수령\\s*예정\\s*금액)(?:으로)?`, "g"),
  ];
  const deductionPatterns = [
    new RegExp(`(?:공제액|차감액)(?:은|는|:)?\\s*${amount}`, "g"),
    new RegExp(`${amount}\\s*(?:을|를)?\\s*(?:공제|제외|차감)`, "g"),
  ];

  const direct = collectPatternAmounts(text, directPatterns);
  const deductions = collectPatternAmounts(text, deductionPatterns);
  const uniqueDirect = [...new Set(direct)];
  const uniqueDeductions = [...new Set(deductions)];

  if (uniqueDirect.length > 1 || uniqueDeductions.length > 1) {
    warnings.push("지급처 안내 금액이 서로 달라 실수령액 후보를 확정할 수 없습니다.");
    return { value: null, confidence: 0, needsResolution: true };
  }

  const directValue = uniqueDirect[0] ?? null;
  let deductedValue: number | null = null;
  if (uniqueDeductions.length === 1) {
    if (grossAmount === null) {
      warnings.push("공제액은 안내됐지만 계약 총액이 없어 실수령액 후보를 계산할 수 없습니다.");
      return { value: null, confidence: 0, needsResolution: true };
    }
    deductedValue = grossAmount - uniqueDeductions[0];
  }

  if (directValue !== null && deductedValue !== null && directValue !== deductedValue) {
    warnings.push("직접 안내된 실수령액과 공제액으로 계산한 금액이 일치하지 않습니다.");
    return { value: null, confidence: 0, needsResolution: true };
  }

  const value = directValue ?? deductedValue;
  if (value === null) return { value: null, confidence: 1, needsResolution: false };
  if (!Number.isInteger(value) || value < 0 || (grossAmount !== null && value > grossAmount)) {
    warnings.push("지급처 안내 실수령액이 계약 총액 범위를 벗어나 사용자 확인이 필요합니다.");
    return { value: null, confidence: 0, needsResolution: true };
  }
  return { value, confidence: directValue !== null ? 0.98 : 0.92, needsResolution: false };
}

function collectPatternAmounts(text: string, patterns: RegExp[]): number[] {
  const values: number[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1];
      const unit = match[2];
      const value = parseAmountToken(raw, unit);
      if (value !== null) values.push(value);
    }
  }
  return values;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function validDate(year: number, month: number, day: number): DateString | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function extractCompletionDate(text: string, referenceDate: DateString): { value: DateString | null; confidence: number } {
  const keywordPattern = /(?:(\d{4})[년./-]\s*)?(\d{1,2})[월./-]\s*(\d{1,2})일?\s*(?:납품|완료|마감|검수)/g;
  const reversePattern = /(?:납품|완료|마감|검수)(?:일|일자| 예정| 예정일)?(?:은|는|:)?\s*(?:(\d{4})[년./-]\s*)?(\d{1,2})[월./-]\s*(\d{1,2})일?/g;
  const candidates = [...text.matchAll(keywordPattern), ...text.matchAll(reversePattern)];
  if (candidates.length === 0) return { value: null, confidence: 0 };
  const match = candidates.at(-1)!;
  const year = Number(match[1] || referenceDate.slice(0, 4));
  const value = validDate(year, Number(match[2]), Number(match[3]));
  return { value, confidence: value ? (match[1] ? 0.98 : 0.88) : 0 };
}

function extractSettlement(text: string): { term: SettlementTerm; day: number | null; confidence: number } {
  if (/익월\s*말일|다음\s*달\s*말일/.test(text)) return { term: "NEXT_MONTH_END", day: null, confidence: 0.98 };
  if (/당월\s*말일|이번\s*달\s*말일/.test(text)) return { term: "SAME_MONTH_END", day: null, confidence: 0.98 };
  const nextMonthDay = text.match(/(?:익월|다음\s*달)\s*(\d{1,2})일/);
  if (nextMonthDay) return { term: "NEXT_MONTH_DAY", day: Number(nextMonthDay[1]), confidence: 0.96 };
  const netDays = text.match(/(?:완료|납품|청구)(?:일)?\s*(?:후|로부터)\s*(\d{1,3})일/);
  if (netDays) return { term: "NET_DAYS", day: Number(netDays[1]), confidence: 0.96 };
  if (/완료\s*즉시|납품\s*즉시/.test(text)) return { term: "ON_COMPLETION", day: null, confidence: 0.96 };
  return { term: "UNKNOWN", day: null, confidence: 0 };
}

function extractIncomeType(text: string): { value: IncomeType; confidence: number } {
  if (/3\.3\s*%|사업소득|인적용역/.test(text)) return { value: "business_personal_service", confidence: 0.93 };
  if (/8\.8\s*%|기타소득/.test(text)) return { value: "qualifying_other_income", confidence: 0.82 };
  if (/근로소득|급여/.test(text)) return { value: "employment_income", confidence: 0.9 };
  if (/공제\s*(?:없음|없이|없습니다)|원천징수\s*(?:없음|없이|없습니다)/.test(text)) return { value: "no_withholding", confidence: 0.9 };
  return { value: "needs_review", confidence: 0.2 };
}

function extractClientName(text: string): { value: string | null; confidence: number } {
  const explicitPatterns = [
    /(?:거래처|클라이언트|발신|From)\s*[:：]\s*([가-힣A-Za-z0-9][가-힣A-Za-z0-9&._ -]{1,24})/i,
    /^\s*\[([가-힣A-Za-z0-9][가-힣A-Za-z0-9&._ -]{1,24})\]/,
  ];
  for (const pattern of explicitPatterns) {
    const match = text.match(pattern);
    if (match) return { value: match[1].trim(), confidence: 0.96 };
  }

  // 대괄호·라벨이 없는 카톡은 첫머리의 계약 문맥이 명확할 때만 후보화한다.
  // 낮은 신뢰도로 반환해 확인 모달에서 자동 확정하지 않도록 한다.
  const unlabeledPatterns = [
    /^([가-힣A-Za-z0-9][가-힣A-Za-z0-9&._ -]{1,23}?)\s*측(?:에서|은|이|과|와)?(?:\s|[,.:])*/,
    /^([가-힣A-Za-z0-9&._-]{2,24})에서(?:\s|[,.:])*/,
    /^([가-힣A-Za-z0-9&._-]{2,24})\s+(?:[가-힣A-Za-z0-9&._-]+\s+){1,3}건(?:\s|[,.:])*/,
  ];
  const nonClientLeadingWords = new Set([
    "계약", "작업", "프로젝트", "홍보영상", "영상편집", "웹디자인", "디자인",
    "번역", "촬영", "강의", "원고", "납품", "완료", "마감", "정산",
  ]);
  for (const pattern of unlabeledPatterns) {
    const match = text.match(pattern);
    const candidate = match?.[1]?.trim() ?? "";
    if (candidate && !nonClientLeadingWords.has(candidate)) {
      return { value: candidate, confidence: 0.7 };
    }
  }
  return { value: null, confidence: 0 };
}

/** 외부 AI 전송 전 마스킹에 사용할 로컬 거래처명 후보. 원문 밖의 이름은 만들지 않는다. */
export function extractClientNameCandidate(text: string): string | null {
  return extractClientName(text.replace(/\s+/g, " ").trim()).value;
}

export function parseContractDeterministically(text: string, options: ParseContractOptions): ParseContractResult {
  const normalized = text.replace(/\s+/g, " ").trim();
  const warnings: string[] = [];
  const client = extractClientName(normalized);
  const amount = extractAmount(normalized, warnings);
  const payerNet = extractPayerStatedNetAmount(normalized, amount.value, warnings);
  const completion = extractCompletionDate(normalized, options.referenceDate);
  const settlement = extractSettlement(normalized);
  const incomeType = extractIncomeType(normalized);

  const missingFields: string[] = [];
  if (!client.value) missingFields.push("clientName");
  if (amount.value == null) missingFields.push("grossAmount");
  if (payerNet.needsResolution) missingFields.push("payerStatedNetAmountCandidate");
  if (!completion.value) missingFields.push("completionDate");
  if (settlement.term === "UNKNOWN") missingFields.push("settlementTerm");
  if (incomeType.value === "needs_review") missingFields.push("incomeTypeCandidate");

  const confidence = {
    clientName: client.confidence,
    grossAmount: amount.confidence,
    payerStatedNetAmountCandidate: payerNet.confidence,
    completionDate: completion.confidence,
    settlementTerm: settlement.confidence,
    incomeTypeCandidate: incomeType.confidence,
  };
  const hasLowConfidence = Object.values(confidence).some((value) => value < CONFIDENCE_THRESHOLD.normal);
  const needsReview = missingFields.length > 0 || warnings.length > 0 || hasLowConfidence;

  return {
    source: "deterministic_fallback",
    warnings,
    candidate: {
      clientName: client.value,
      grossAmount: amount.value,
      payerStatedNetAmountCandidate: payerNet.value,
      completionDate: completion.value,
      settlementTerm: settlement.term,
      settlementDay: settlement.day,
      incomeTypeCandidate: incomeType.value,
      confidence,
      missingFields,
      needsReview,
    },
  };
}

export function validateCandidate(candidate: AIContractCandidate): string[] {
  const errors: string[] = [];
  if (!("payerStatedNetAmountCandidate" in candidate)) {
    errors.push("payerStatedNetAmountCandidate 필드가 필요합니다(null 허용).");
  }
  if (!("payerStatedNetAmountCandidate" in candidate.confidence)) {
    errors.push("payerStatedNetAmountCandidate confidence가 필요합니다.");
  }
  const scores = Object.entries(candidate.confidence);
  if (scores.some(([, value]) => !Number.isFinite(value) || value < 0 || value > 1)) errors.push("confidence는 0~1 범위여야 합니다.");
  if (candidate.grossAmount != null && (!Number.isInteger(candidate.grossAmount) || candidate.grossAmount < 0)) errors.push("grossAmount는 0 이상의 원 단위 정수여야 합니다.");
  if (candidate.payerStatedNetAmountCandidate != null && (
    !Number.isInteger(candidate.payerStatedNetAmountCandidate) ||
    candidate.payerStatedNetAmountCandidate < 0 ||
    (candidate.grossAmount != null && candidate.payerStatedNetAmountCandidate > candidate.grossAmount)
  )) errors.push("payerStatedNetAmountCandidate는 0 이상이고 grossAmount 이하인 원 단위 정수여야 합니다.");
  if (candidate.completionDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(candidate.completionDate)) errors.push("completionDate는 YYYY-MM-DD 형식이어야 합니다.");
  if (["NEXT_MONTH_DAY", "NET_DAYS"].includes(candidate.settlementTerm ?? "") && candidate.settlementDay == null) errors.push("선택한 정산조건에는 settlementDay가 필요합니다.");
  if (candidate.needsReview !== (candidate.missingFields.length > 0 || scores.some(([, value]) => value < CONFIDENCE_THRESHOLD.normal))) {
    // AI가 충돌/VAT 등 별도 사유로 review를 올리는 것은 허용한다. 반대 방향만 오류다.
    if (!candidate.needsReview) errors.push("누락 또는 저신뢰 필드가 있으면 needsReview=true여야 합니다.");
  }
  return errors;
}
