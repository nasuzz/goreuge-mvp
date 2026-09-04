import type { DateString } from "../shared/types";

export interface ContractParseRequest {
  text: string;
  referenceDate: DateString;
}

export type ContractParseRequestResult =
  | { ok: true; value: ContractParseRequest }
  | { ok: false; error: string };

const MAX_TEXT_LENGTH = 10_000;

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** API와 테스트가 공유하는 입력 검증. 원문은 trim 외에 변형하지 않는다. */
export function parseContractParseRequest(input: unknown): ContractParseRequestResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "요청 본문이 필요합니다." };
  }

  const body = input as Record<string, unknown>;
  if (typeof body.text !== "string" || !body.text.trim()) {
    return { ok: false, error: "분석할 카톡 또는 메일 내용을 입력해 주세요." };
  }
  if (body.text.length > MAX_TEXT_LENGTH) {
    return { ok: false, error: `입력 내용은 ${MAX_TEXT_LENGTH.toLocaleString("ko-KR")}자 이하여야 합니다.` };
  }
  if (typeof body.referenceDate !== "string" || !isValidDateString(body.referenceDate)) {
    return { ok: false, error: "기준일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다." };
  }

  return {
    ok: true,
    value: { text: body.text.trim(), referenceDate: body.referenceDate },
  };
}

