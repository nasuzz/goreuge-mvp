// 화면 표시용 포맷터. 계산은 전부 엔진이 하고 여기서는 문자열만 만든다.
import type { DateString, Won } from "@/shared/types";

const KRW = new Intl.NumberFormat("ko-KR");

export function won(amount: Won | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  return `${KRW.format(amount)}원`;
}

/** "2026-09-30" -> "9월 30일" */
export function dateLabel(date: DateString | null): string {
  if (!date) return "—";
  const [, m, d] = date.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
}

/** "2026-09-30" -> "2026년 9월 30일 (수)" */
export function longDateLabel(date: DateString | null): string {
  if (!date) return "—";
  const [y, m, d] = date.split("-").map(Number);
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][
    new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  ];
  return `${y}년 ${m}월 ${d}일 (${weekday})`;
}

/** 엔진의 daysRemaining을 화면 문구로. 90일 안에 D-day가 없으면 null */
export function ddayLabel(daysRemaining: number | null): string {
  if (daysRemaining === null) return "90일 이상";
  if (daysRemaining <= 0) return "오늘";
  return `${daysRemaining}일`;
}

export function signedDays(delta: number): string {
  if (delta === 0) return "변화 없음";
  return delta > 0 ? `+${delta}일` : `${delta}일`;
}
