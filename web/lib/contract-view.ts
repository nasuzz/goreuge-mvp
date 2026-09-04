// 계약 1건을 화면에 어떻게 보여줄지 결정하는 규칙 모음.
//
// [이슈 #16] 실수령액 표시 상태는 4개인데 엔진의 NetAmountStatus는 3값이다.
// "지급처 안내"와 "참조율 승인"이 둘 다 calculated로 나오기 때문에,
// status만 보고 분기하면 둘 중 하나가 반드시 틀린다.
// 그래서 payerStatedNetAmount !== null 을 직접 본다 (A의 #16 결정 코멘트).

import { calculateExpectedNetAmount } from "@/engine/index";
import type { ContractStatus, SettlementTerm } from "@/shared/enums";
import { FIXED_COPY } from "@/shared/policy";
import type { Contract } from "@/shared/types";
import type { Tone } from "@/components/ui";

export type NetAmountView = {
  amount: number | null;
  /** 카드에 붙일 출처 배지 */
  sourceLabel: string;
  /** 참조율을 적용한 추정치일 때만 붙는 문구(기획서 5-3). 그 외에는 null */
  disclaimer: string | null;
  tone: Tone;
};

export function netAmountView(contract: Contract): NetAmountView {
  const result = calculateExpectedNetAmount(contract);

  if (result.status === "actual") {
    return {
      amount: result.amount,
      sourceLabel: "입금 확인",
      disclaimer: null,
      tone: "safe",
    };
  }

  if (result.status === "unavailable") {
    return {
      amount: null,
      sourceLabel: "추정 불가",
      disclaimer: FIXED_COPY.netAmountUnavailable,
      tone: "neutral",
    };
  }

  // 여기부터 calculated. 2순위(지급처 안내)와 3순위(참조율 승인)를 갈라준다.
  if (contract.payerStatedNetAmount !== null) {
    return {
      amount: result.amount,
      sourceLabel: "지급처 안내",
      disclaimer: null,
      tone: "neutral",
    };
  }

  const percent = contract.confirmedExpectedRate
    ? (contract.confirmedExpectedRate * 100).toFixed(1).replace(/\.0$/, "")
    : null;

  return {
    amount: result.amount,
    sourceLabel: "참조율 적용",
    // 문구는 임의로 바꾸지 않고 policy.ts의 고정 문구를 그대로 쓴다.
    disclaimer: percent
      ? "※ " + FIXED_COPY.referenceRateApplied.replace("{rate}", percent)
      : "※ 확인 전 추정치입니다.",
    tone: "neutral",
  };
}

export const STATUS_LABEL: Record<ContractStatus, string> = {
  waiting: "대기",
  delayed: "지연",
  risk: "위험",
  completed: "완료",
  cancelled: "취소",
};

export const STATUS_TONE: Record<ContractStatus, Tone> = {
  waiting: "neutral",
  delayed: "caution",
  risk: "danger",
  completed: "safe",
  cancelled: "neutral",
};

export const TERM_LABEL: Record<SettlementTerm, string> = {
  ON_COMPLETION: "완료 즉시",
  SAME_MONTH_END: "당월 말일",
  NEXT_MONTH_END: "익월 말일",
  NEXT_MONTH_DAY: "익월 지정일",
  NET_DAYS: "기준일 + N일",
  UNKNOWN: "확인 필요",
};

/** 정산함 대기열 3열(기획서 6-3). 완료·취소는 열에 넣지 않는다. */
export const QUEUE_COLUMNS = [
  { status: "waiting" as const, title: "대기", hint: "예정일 전" },
  { status: "delayed" as const, title: "지연", hint: "예정일 경과" },
  { status: "risk" as const, title: "위험", hint: "60일 이상 또는 수동 지정" },
];

const OPEN_STATUSES: ContractStatus[] = ["waiting", "delayed", "risk"];

/**
 * 미수금 총액 — 대기·지연·위험 계약의 **총액** 합계다.
 * 실수령액 합계가 아니다: 팀이 검증값으로 고정한 9,120,000원(test/smoke.ts,
 * engine-interface.md, 데모 대본)이 총액 기준이므로 화면도 같은 정의를 쓴다.
 */
export function outstandingReceivable(contracts: Contract[]): number {
  return contracts
    .filter((c) => OPEN_STATUSES.includes(c.status))
    .reduce((sum, c) => sum + c.grossAmount, 0);
}

/** 같은 계약들의 예상 실수령액 합계. 추정 불가 건은 0으로 빠진다. */
export function outstandingNetAmount(contracts: Contract[]): number {
  return contracts
    .filter((c) => OPEN_STATUSES.includes(c.status))
    .reduce((sum, c) => sum + (calculateExpectedNetAmount(c).amount ?? 0), 0);
}

/** 예상 실수령액을 계산할 수 없는 계약 수 — 합계 아래에 근거로 적는다. */
export function unavailableCount(contracts: Contract[]): number {
  return contracts.filter(
    (c) => OPEN_STATUSES.includes(c.status) && calculateExpectedNetAmount(c).amount === null,
  ).length;
}
