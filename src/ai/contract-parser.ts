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

function findAmounts(text: string): number[] {
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
  return matches.sort((a, b) => a.index - b.index).map((item) => item.amount);
}

function extractAmount(text: string, warnings: string[]): { value: number | null; confidence: number } {
  const amounts = findAmounts(text).filter((amount) => amount >= 10_000);
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
  const patterns = [
    /(?:거래처|클라이언트|발신|From)\s*[:：]\s*([가-힣A-Za-z0-9][가-힣A-Za-z0-9&._ -]{1,24})/i,
    /^\s*\[([가-힣A-Za-z0-9][가-힣A-Za-z0-9&._ -]{1,24})\]/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return { value: match[1].trim(), confidence: 0.96 };
  }
  return { value: null, confidence: 0 };
}

export function parseContractDeterministically(text: string, options: ParseContractOptions): ParseContractResult {
  const normalized = text.replace(/\s+/g, " ").trim();
  const warnings: string[] = [];
  const client = extractClientName(normalized);
  const amount = extractAmount(normalized, warnings);
  const completion = extractCompletionDate(normalized, options.referenceDate);
  const settlement = extractSettlement(normalized);
  const incomeType = extractIncomeType(normalized);

  const missingFields: string[] = [];
  if (!client.value) missingFields.push("clientName");
  if (amount.value == null) missingFields.push("grossAmount");
  if (!completion.value) missingFields.push("completionDate");
  if (settlement.term === "UNKNOWN") missingFields.push("settlementTerm");
  if (incomeType.value === "needs_review") missingFields.push("incomeTypeCandidate");

  const confidence = {
    clientName: client.confidence,
    grossAmount: amount.confidence,
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
  const scores = Object.entries(candidate.confidence);
  if (scores.some(([, value]) => !Number.isFinite(value) || value < 0 || value > 1)) errors.push("confidence는 0~1 범위여야 합니다.");
  if (candidate.grossAmount != null && (!Number.isInteger(candidate.grossAmount) || candidate.grossAmount < 0)) errors.push("grossAmount는 0 이상의 원 단위 정수여야 합니다.");
  if (candidate.completionDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(candidate.completionDate)) errors.push("completionDate는 YYYY-MM-DD 형식이어야 합니다.");
  if (["NEXT_MONTH_DAY", "NET_DAYS"].includes(candidate.settlementTerm ?? "") && candidate.settlementDay == null) errors.push("선택한 정산조건에는 settlementDay가 필요합니다.");
  if (candidate.needsReview !== (candidate.missingFields.length > 0 || scores.some(([, value]) => value < CONFIDENCE_THRESHOLD.normal))) {
    // AI가 충돌/VAT 등 별도 사유로 review를 올리는 것은 허용한다. 반대 방향만 오류다.
    if (!candidate.needsReview) errors.push("누락 또는 저신뢰 필드가 있으면 needsReview=true여야 합니다.");
  }
  return errors;
}
