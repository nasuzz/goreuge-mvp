"use client";

import { useMemo, useState } from "react";
import { buildOutflowSchedule } from "@/engine/index";
import { Card, PageTitle } from "@/components/ui";
import { longDateLabel, won } from "@/lib/format";
import { useMockStore } from "@/lib/mock/store";
import type { DailyProjection } from "@/shared/types";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function ym(date: string) {
  return date.slice(0, 7);
}

export default function CalendarPage() {
  const { summary, input, today } = useMockStore();
  const { baseline } = summary;

  const byDate = useMemo(() => {
    const map = new Map<string, DailyProjection>();
    for (const p of baseline.projections) map.set(p.date, p);
    return map;
  }, [baseline.projections]);

  const months = useMemo(() => {
    const set = new Set<string>();
    for (const p of baseline.projections) set.add(ym(p.date));
    return [...set].sort();
  }, [baseline.projections]);

  const [monthIndex, setMonthIndex] = useState(0);
  const month = months[monthIndex] ?? ym(today);
  const [selected, setSelected] = useState<string>(today);

  // 달력 격자: 1일이 무슨 요일인지에 따라 앞을 빈칸으로 채운다.
  const [year, monthNumber] = month.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from(
      { length: daysInMonth },
      (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
    ),
  ];

  const inflowsByDate = useMemo(() => {
    const map = new Map<string, { name: string; amount: number }[]>();
    for (const inflow of baseline.inflows) {
      if (!inflow.date) continue;
      const list = map.get(inflow.date) ?? [];
      list.push({ name: inflow.clientName, amount: inflow.amount });
      map.set(inflow.date, list);
    }
    return map;
  }, [baseline.inflows]);

  /**
   * 유출 이름을 붙일 날짜는 엔진이 실제로 펼친 날짜를 그대로 쓴다.
   *
   * 예전에는 화면에서 "일(day)"만 비교했는데, buildOutflowSchedule은 매월 반복
   * 유출을 그 달 마지막 날로 clamp한다(31일 지출 → 30일까지인 달에는 30일).
   * 그래서 말일 지출이 있으면 금액은 뜨는데 이름만 사라지는 달이 생겼다.
   * outflow 하나씩 엔진에 넣어 발생일을 받아오면 clamp 규칙이 그대로 따라온다.
   */
  const outflowNamesByDate = useMemo(() => {
    const map = new Map<string, string[]>();
    const start = baseline.projections[0]?.date ?? today;
    const horizonDays = baseline.projections.length;
    if (horizonDays === 0) return map;
    for (const outflow of input.outflows) {
      if (outflow.includedInBaseline) continue;
      for (const date of Object.keys(buildOutflowSchedule([outflow], start, horizonDays))) {
        map.set(date, [...(map.get(date) ?? []), outflow.name]);
      }
    }
    return map;
  }, [input.outflows, baseline.projections, today]);

  function outflowNames(date: string): string[] {
    return outflowNamesByDate.get(date) ?? [];
  }

  const selectedProjection = byDate.get(selected) ?? null;

  return (
    <main className="flex flex-col gap-4">
      <PageTitle title="캘린더" description="입금·유출과 일별 예상잔액을 한 달 단위로 봅니다." />

      <Card
        title={`${year}년 ${monthNumber}월`}
        aside={
          <span className="flex gap-1">
            <NavButton
              disabled={monthIndex === 0}
              onClick={() => setMonthIndex((i) => Math.max(0, i - 1))}
              label="이전 달"
            >
              ‹
            </NavButton>
            <NavButton
              disabled={monthIndex >= months.length - 1}
              onClick={() => setMonthIndex((i) => Math.min(months.length - 1, i + 1))}
              label="다음 달"
            >
              ›
            </NavButton>
          </span>
        }
      >
        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAYS.map((w) => (
            <div key={w} className="pb-1 text-xs text-muted">
              {w}
            </div>
          ))}

          {cells.map((date, index) => {
            if (!date) return <div key={`empty-${index}`} />;

            const projection = byDate.get(date);
            const isDday = baseline.dDay === date;
            const isToday = date === today;
            const hasInflow = inflowsByDate.has(date);
            const hasOutflow = (projection?.fixedOutflow ?? 0) > 0;

            return (
              <button
                key={date}
                type="button"
                onClick={() => setSelected(date)}
                aria-pressed={selected === date}
                className={`relative aspect-square rounded-lg border p-1 text-xs transition-colors ${
                  selected === date ? "border-accent" : "border-transparent"
                } ${
                  !projection
                    ? "bg-surface-muted text-muted"
                    : projection.level === "danger"
                      ? "bg-danger-bg"
                      : projection.level === "caution"
                        ? "bg-caution-bg"
                        : "bg-safe-bg"
                }`}
              >
                <span className={`tnum block ${isToday ? "font-bold underline" : ""}`}>
                  {Number(date.slice(8, 10))}
                </span>
                <span className="mt-0.5 flex items-center justify-center gap-0.5">
                  {hasInflow && <Dot className="bg-[var(--accent)]" />}
                  {hasOutflow && <Dot className="bg-[var(--danger)]" />}
                </span>
                {isDday && (
                  <span className="absolute inset-x-0 bottom-0.5 text-[9px] font-bold text-danger">
                    D-day
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          <li className="flex items-center gap-1">
            <Dot className="bg-[var(--accent)]" /> 예정 입금
          </li>
          <li className="flex items-center gap-1">
            <Dot className="bg-[var(--danger)]" /> 확정 유출
          </li>
          <li>배경색 = 그날의 예상잔액 등급(안전·주의·위험)</li>
        </ul>
      </Card>

      <Card title={longDateLabel(selected)}>
        {selectedProjection ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-muted">예상잔액</span>
              <span
                className={`tnum text-lg font-bold ${
                  selectedProjection.level === "danger"
                    ? "text-danger"
                    : selectedProjection.level === "caution"
                      ? "text-caution"
                      : "text-safe"
                }`}
              >
                {won(selectedProjection.closingBalance)}
              </span>
            </div>

            <div>
              <p className="text-xs font-medium text-muted">입금</p>
              {inflowsByDate.get(selected)?.length ? (
                <ul className="mt-1 flex flex-col gap-1">
                  {inflowsByDate.get(selected)!.map((i) => (
                    <li key={i.name} className="flex justify-between gap-3 text-sm">
                      <span>{i.name}</span>
                      <span className="tnum">{won(i.amount)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-muted">예정된 입금이 없습니다.</p>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-muted">유출</p>
              {selectedProjection.fixedOutflow > 0 ? (
                <div className="mt-1 flex justify-between gap-3 text-sm">
                  <span>{outflowNames(selected).join(", ") || "등록 지출"}</span>
                  <span className="tnum">{won(selectedProjection.fixedOutflow)}</span>
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted">등록된 유출이 없습니다.</p>
              )}
              <div className="mt-1 flex justify-between gap-3 text-sm text-muted">
                <span>필수지출 베이스라인</span>
                <span className="tnum">{won(selectedProjection.baselineOutflow)}</span>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">
            시뮬레이션 기간(오늘부터 90일) 밖의 날짜입니다. 예상잔액을 계산하지 않습니다.
          </p>
        )}
      </Card>

      <p className="px-1 text-xs text-muted">
        5월 종합소득세 신고 확인 일정은 금액 없이 안내만 제공합니다. 공휴일 반영은 P1입니다.
      </p>
    </main>
  );
}

function Dot({ className }: { className: string }) {
  return <span className={`inline-block size-1.5 rounded-full ${className}`} />;
}

function NavButton({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="rounded-lg border border-line px-2 py-1 text-sm disabled:opacity-40"
    >
      {children}
    </button>
  );
}
