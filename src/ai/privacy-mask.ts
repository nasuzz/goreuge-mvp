import { extractClientNameCandidate } from "./contract-parser";

export interface MaskedContractText {
  maskedText: string;
  /** 모델 응답 뒤 확인 모달에 복원할 로컬 추출값. 외부 API에는 보내지 않는다. */
  clientName: string | null;
}

const CLIENT_PLACEHOLDER = "[거래처]";
const ACCOUNT_PLACEHOLDER = "[계좌번호]";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskClientName(text: string, clientName: string | null): string {
  if (!clientName) return text;
  const escaped = escapeRegExp(clientName);
  return text
    .replace(new RegExp(`\\[\\s*${escaped}\\s*\\]`, "g"), CLIENT_PLACEHOLDER)
    .replace(new RegExp(escaped, "g"), CLIENT_PLACEHOLDER);
}

function maskAccountNumbers(text: string): string {
  // 하이픈/공백으로 구분된 계좌·전화번호 형태. 날짜(총 8자리)는 제외한다.
  const formatted = text.replace(/(?<!\d)\d{2,6}(?:[- ]\d{2,6}){2,4}(?!\d)/g, (value) => {
    const digitCount = value.replace(/\D/g, "").length;
    return digitCount >= 10 && digitCount <= 16 ? ACCOUNT_PLACEHOLDER : value;
  });

  // 구분자 없는 숫자는 금액과 혼동할 수 있어 계좌번호 문맥에 있을 때만 가린다.
  return formatted.replace(
    /((?:계좌(?:번호)?|입금\s*계좌)\s*[:：]?\s*)\d{8,16}(?!\d)/gi,
    `$1${ACCOUNT_PLACEHOLDER}`,
  );
}

/** 거래처 실명과 계좌번호를 제거한 문자열만 외부 AI에 전달한다. */
export function maskContractText(text: string): MaskedContractText {
  const clientName = extractClientNameCandidate(text);
  const maskedText = maskAccountNumbers(maskClientName(text, clientName));
  return { maskedText, clientName };
}
