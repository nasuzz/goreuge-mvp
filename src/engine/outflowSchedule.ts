// engine/outflowSchedule.ts
// engine-interface.md 3-5 "⚠️ 반복 유출 펼치기"
// recurrence === "monthly" 인 outflow는 dueDate 하루만 차감하면 안 되고
// 시뮬레이션 구간 전체에 매월 같은 일자로 펼쳐야 한다. 말일은 그 달 마지막 날로 clamp.

import type { Outflow, DateString } from "../shared/types";
import { addDays } from "./scenarioDate";

function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

function parseDate(date: DateString): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

/**
 * outflows(recurrence === "monthly" 이고 includedInBaseline === false 인 것만)를
 * [today, today+horizonDays) 구간에 매월 같은 일자로 펼쳐 날짜별 합계 맵을 만든다.
 * includedInBaseline === true 인 항목은 이미 monthlyFixedOutflow에 포함돼 있으므로 제외한다(9-3).
 */
export function buildOutflowSchedule(
  outflows: Outflow[],
  today: DateString,
  horizonDays: number,
): Record<DateString, number> {
  const schedule: Record<DateString, number> = {};
  const horizonDates = new Set<DateString>();
  for (let d = 0; d < horizonDays; d++) horizonDates.add(addDays(today, d));

  for (const o of outflows) {
    if (o.includedInBaseline) continue;

    if (o.recurrence === "once") {
      if (horizonDates.has(o.dueDate)) {
        schedule[o.dueDate] = (schedule[o.dueDate] ?? 0) + o.amount;
      }
      continue;
    }

    // monthly: dueDate의 "일"을 기준으로, 시작 월부터 horizon 끝까지 매달 발생
    const { d: targetDay } = parseDate(o.dueDate);
    const { y: startY, m: startM } = parseDate(today);

    // 넉넉하게 today 월부터 today+horizonDays 이후 한 달 뒤까지 순회
    for (let offset = -1; offset <= Math.ceil(horizonDays / 28) + 1; offset++) {
      let year = startY;
      let month = startM + offset;
      while (month < 1) { month += 12; year -= 1; }
      while (month > 12) { month -= 12; year += 1; }

      const clampedDay = Math.min(targetDay, daysInMonth(year, month));
      const candidate = `${year}-${String(month).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;

      if (candidate >= o.dueDate && horizonDates.has(candidate)) {
        schedule[candidate] = (schedule[candidate] ?? 0) + o.amount;
      }
    }
  }

  return schedule;
}
