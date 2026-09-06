// 근거 구간(span) 기반 confidence 자기 검증 — 이슈 #48. DRI: B.
//
// 기존 confidence는 "어떤 패턴으로 잡았는가"로 정해진다. 대괄호면 0.96, 무라벨이면
// 0.70 같은 식이다. 이건 추출 방법에 대한 자신감이지 결과가 맞는지에 대한 자신감이
// 아니다. 그래서 값이 틀렸는데 confidence가 높은 경우가 반복해서 나왔다.
//
//   #35  "거래처: M프로덕션 총 180만원, ..."  -> clientName="M프로덕션 총 180만원"  0.96
//   #41  "실수령액 96만 7천원입니다"          -> payerStated=null                 1.0
//
// 둘 다 개별 패턴을 고쳐 막았지만 같은 종류가 계속 나온다. 실제로 #35를 고친 뒤에도
// 대괄호 형식에서 그대로 재현된다.
//
//   "[A스튜디오 편집 240만원] 9월 3일 납품"  -> clientName="A스튜디오 편집 240만원"  0.96
//
// 이 모듈은 개별 패턴을 하나 더 고치는 대신, 추출 결과를 원문과 대조해 신뢰할 수
// 없는 값의 confidence를 내린다. 값 자체는 바꾸지 않는다 — 확인 모달이 사용자에게
// 어디를 보라고 알려주는 것이 목적이다.

import type { AIContractCandidate } from "../shared/types";
import { CONFIDENCE_THRESHOLD } from "../shared/policy";

export type EvidenceField = keyof AIContractCandidate["confidence"];

/** 원문(정규화본) 안에서 이 값의 근거가 된 구간. */
export interface TextSpan {
  start: number;
  end: number;
  text: string;
}

export interface FieldEvidence {
  field: EvidenceField;
  span: TextSpan | null;
  /** span의 text를 다시 파싱하면 같은 값이 나오는가. span이 없으면 false가 아니라 null */
  roundTripOk: boolean | null;
  /** confidence를 내렸다면 그 이유. 내리지 않았으면 null */
  demotedReason: string | null;
  /** 자기 검증 전 confidence. 화면에는 쓰지 않고 회귀 테스트가 본다 */
  rawConfidence: number;
}

/** 추출기가 값과 함께 돌려주는 근거. span이 null이면 "원문에서 짚을 곳이 없다"는 뜻이다. */
export interface Extracted<T> {
  value: T;
  confidence: number;
  span: TextSpan | null;
}

export function spanOf(text: string, index: number, length: number): TextSpan {
  const start = Math.max(0, index);
  const end = Math.min(text.length, start + length);
  return { start, end, text: text.slice(start, end) };
}


// ── 자기 검증 규칙 ──────────────────────────────────────

/**
 * 이 필드 값 안에 다른 필드의 값이 섞여 들어갔는지 본다(#35형 과다 캡처).
 *
 * 거래처 이름은 사람이 붙인 상호이지 금액이나 날짜를 품지 않는다. 값 안에서
 * 금액·날짜가 다시 파싱되면 추출 구간이 필요한 것보다 넓게 잡힌 것이다.
 */
const AMOUNT_IN_VALUE = /(\d[\d,]*(?:\.\d+)?|[일이삼사오육칠팔구십백천]+)\s*(?:만원|원)/;
const DATE_IN_VALUE = /\d{1,2}\s*[월./-]\s*\d{1,2}\s*일?/;

export function findCrossContamination(field: EvidenceField, value: unknown): string | null {
  if (field !== "clientName" || typeof value !== "string") return null;
  if (AMOUNT_IN_VALUE.test(value)) {
    return "거래처 이름 안에 금액 표현이 들어 있어 추출 구간이 넓게 잡혔을 수 있습니다.";
  }
  if (DATE_IN_VALUE.test(value)) {
    return "거래처 이름 안에 날짜 표현이 들어 있어 추출 구간이 넓게 잡혔을 수 있습니다.";
  }
  return null;
}

/**
 * 값이 없는데 confidence가 높은 경우를 본다(#41형 놓친 값).
 *
 * "원문에 없어서 null"과 "원문에 있는데 못 읽어서 null"은 다르다. 후자에 높은
 * confidence가 붙으면 확인 모달이 초록 배지로 그려서 사용자가 그냥 넘어간다.
 * 해당 필드의 어휘가 원문에 있는데 근거 구간을 하나도 잡지 못했다면, "없다"고
 * 확신할 근거가 없는 것이다.
 */
const FIELD_LEXICON: Partial<Record<EvidenceField, RegExp>> = {
  grossAmount: /(?:총액|계약\s*금액|총)\s*[:：]?\s*(?:\d|[일이삼사오육칠팔구십백천])/,
  completionDate: /납품|완료|마감|검수/,
  settlementTerm: /정산|지급|입금|말일|결제/,
};

export function findUnsupportedCertainty(
  field: EvidenceField,
  value: unknown,
  confidence: number,
  span: TextSpan | null,
  sourceText: string,
): string | null {
  const isEmpty = value === null || value === undefined || value === "UNKNOWN";
  if (!isEmpty) return null;
  if (span !== null) return null;
  if (confidence < CONFIDENCE_THRESHOLD.normal) return null;
  const lexicon = FIELD_LEXICON[field];
  if (!lexicon || !lexicon.test(sourceText)) return null;
  return "원문에 관련 표현이 있는데 근거 구간을 찾지 못했습니다. 값이 없다고 확신할 수 없습니다.";
}

/**
 * 근거 구간만 다시 파싱했을 때 같은 값이 나오는지 본다(round-trip).
 *
 * 값이 원문의 다른 곳에서 온 것이거나 구간이 잘못 잡혔으면 여기서 어긋난다.
 * 판정은 호출부가 실제 추출 함수를 넘겨서 한다 — 이 모듈이 파서를 다시 구현하지
 * 않기 위해서다.
 */
export function checkRoundTrip<T>(
  span: TextSpan | null,
  expected: T,
  reparse: (text: string) => T,
): boolean | null {
  if (span === null) return null;
  try {
    return reparse(span.text) === expected;
  } catch {
    return false;
  }
}

// ── 적용 ────────────────────────────────────────────────

/** 자기 검증에 걸린 필드를 내려앉힐 상한. warning 구간 아래로 보내 확인 모달이 빨간 톤으로 그린다. */
export const DEMOTED_CONFIDENCE = 0.4;

export interface VerifyInput {
  field: EvidenceField;
  value: unknown;
  confidence: number;
  span: TextSpan | null;
  roundTripOk: boolean | null;
}

export interface VerifyResult {
  confidence: number;
  evidence: FieldEvidence;
}

/**
 * 규칙 3종을 적용해 confidence를 조정한다. 값은 건드리지 않는다.
 *
 * confidence는 내리기만 하고 올리지 않는다. 자기 검증은 "이 값을 믿어도 된다"를
 * 보증하는 장치가 아니라 "이 값은 의심스럽다"를 잡아내는 장치다.
 */
export function verifyField(input: VerifyInput, sourceText: string): VerifyResult {
  const { field, value, confidence, span, roundTripOk } = input;

  const reason =
    findCrossContamination(field, value) ??
    findUnsupportedCertainty(field, value, confidence, span, sourceText) ??
    (roundTripOk === false
      ? "근거 구간만 다시 읽으면 다른 값이 나옵니다. 구간이 잘못 잡혔을 수 있습니다."
      : null);

  return {
    confidence: reason === null ? confidence : Math.min(confidence, DEMOTED_CONFIDENCE),
    evidence: {
      field,
      span,
      roundTripOk,
      demotedReason: reason,
      rawConfidence: confidence,
    },
  };
}
