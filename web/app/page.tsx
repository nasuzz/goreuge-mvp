"use client";

import Image from "next/image";
import Link from "next/link";
import { addDays } from "@/engine/index";
import { Badge, Card, EmptyState, Row, toneOfLevel } from "@/components/ui";
import { WhatIfPanel } from "@/components/what-if-panel";
import { ddayLabel, dateLabel, longDateLabel, signedDays, won } from "@/lib/format";
import { useMockStore } from "@/lib/mock/store";
import type { CashflowResult } from "@/shared/types";

export default function HomePage() {
  const { summary, input, today, onboarded } = useMockStore();
  const { baseline, optimistic, pessimistic, weekly, balanceBreakdown, riskCause } = summary;

  // 오늘의 예상잔액 등급. 캘린더 배경색과 같은 기준(엔진의 level)을 쓴다.
  //
  // 처음에는 D-day 당일의 등급을 썼는데, D-day는 정의상 잔액이 0 이하가 되는 날이라
  // D-day가 있으면 무조건 "위험"이 나왔다. 세 시나리오 배지가 전부 위험으로 찍혀서
  // 낙관과 비관을 구분하지 못했다.
  const todayLevel =
    baseline.projections.find((p) => p.date === today)?.level ?? "safe";

  const weekEnd = addDays(today, 7);
  const thisWeekInflows = baseline.inflows.filter(
    (i) => i.date !== null && i.date <= weekEnd && i.date >= today,
  );
  const upcoming = baseline.inflows
    .filter((i) => i.date !== null)
    .sort((a, b) => (a.date! < b.date! ? -1 : 1))[0];
  const totalThisWeekInflows = thisWeekInflows.reduce((sum, inflow) => sum + inflow.amount, 0);
  const runwayPercent =
    baseline.daysRemaining === null ? 100 : Math.max(8, Math.min(100, baseline.daysRemaining));

  return (
    <main className="flex flex-col gap-5">
      <header className="mb-1 flex items-start justify-between gap-4">
        <div>
          <p className="brand-kicker mb-2">Goreuge</p>
          <h1 className="text-[28px] font-semibold leading-tight sm:text-[32px]">
            일한 돈이 들어오는 길
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            {longDateLabel(today)} 기준 · 수금, 지출, 보호금을 가볍게 정리합니다
          </p>
        </div>
        {!onboarded && (
          <Link
            href="/onboarding"
            className="shrink-0 rounded-md border border-line bg-surface px-3 py-2 text-xs font-medium text-muted shadow-sm hover:text-foreground"
          >
            내 숫자 입력
          </Link>
        )}
      </header>

      <section className="desk-panel object-frame overflow-hidden rounded-[32px]">
        <span className="toy-orbit right-20 top-16 hidden lg:block" aria-hidden />
        <span className="toy-orbit bottom-22 left-12 hidden rotate-45 lg:block" aria-hidden />
        <div className="border-b border-line/70 bg-white/45 px-5 py-3">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold text-muted">Receivable runway</span>
            <Badge tone={toneOfLevel(todayLevel)}>
              오늘 {todayLevel === "safe" ? "안전" : todayLevel === "caution" ? "주의" : "위험"}
            </Badge>
          </div>
        </div>
        <div className="grid items-stretch gap-0 lg:grid-cols-[minmax(420px,0.9fr)_minmax(0,1.1fr)]">
          <div className="relative z-10 px-5 py-7 sm:px-7 sm:py-8">
            <p className="tape-label text-xs font-semibold text-foreground">
              기준 시나리오 D-day
            </p>
            <p className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
              <span className="tnum text-7xl font-black leading-none text-accent-strong drop-shadow-[0_7px_0_rgba(255,85,173,0.14)] sm:text-8xl">
                {ddayLabel(baseline.daysRemaining)}
              </span>
              {baseline.dDay && (
                <span className="pb-1 text-sm text-muted">{dateLabel(baseline.dDay)}</span>
              )}
            </p>
            <p className="mt-4 max-w-md text-sm leading-6 text-muted">
              현재 잔액에서 세금, 위시, 안전예비금을 보호하고 계약별 예정 입금을 반영한
              버틸 수 있는 기간입니다.
            </p>
            <RunwayMeter percent={runwayPercent} />
            <div className="mt-5 flex flex-wrap gap-2">
              <HeroChip
                label="보호금"
                value={won(
                  balanceBreakdown.reservedTaxAmount + balanceBreakdown.reservedWishAmount,
                )}
              />
              <HeroChip label="이번 주 입금건" value={`${thisWeekInflows.length}건`} />
              <HeroChip label="위험 계약" value={`${riskCause.delayedContracts.length}건`} />
            </div>
          </div>
          <div className="relative min-h-[320px] border-t border-white/60 bg-[#fff3ad] lg:border-l lg:border-t-0">
            <Image
              src="/brand-hero.png"
              alt=""
              fill
              priority
              sizes="(min-width: 1024px) 620px, 100vw"
              className="object-cover object-center"
            />
            <div className="absolute inset-x-4 bottom-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <HeroStat label="이번 주 가용" value={won(weekly.weeklyAvailableAmount)} />
              <HeroStat label="예정 입금" value={won(totalThisWeekInflows)} />
              <HeroStat label="시작 잔액" value={won(baseline.simulationStartBalance)} />
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <div className="flex flex-col gap-5">
          <Card
            title="세 가지 시나리오"
            aside="입금 지연 가정만 다릅니다"
            className="receipt-panel object-frame rounded-[26px]"
          >
            <ul className="grid grid-cols-3 gap-2">
              <ScenarioCell label="낙관" result={optimistic} baseline={baseline} />
              <ScenarioCell label="기준" result={baseline} baseline={baseline} highlight />
              <ScenarioCell label="비관" result={pessimistic} baseline={baseline} />
            </ul>
            <p className="mt-3 text-xs text-muted">
              정시율을 금액에 곱하지 않고 시나리오별로 입금일만 이동시킵니다. 금액은 세
              시나리오 모두 같습니다.
            </p>
          </Card>

          <Card
            title="이번 주 입금"
            aside={`${dateLabel(today)} ~ ${dateLabel(weekEnd)}`}
            className="desk-panel object-frame rounded-[26px]"
          >
            {thisWeekInflows.length > 0 ? (
              <ul className="flex flex-col divide-y divide-line">
                {thisWeekInflows.map((inflow) => (
                  <li
                    key={inflow.contractId}
                    className="flex items-baseline justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{inflow.clientName}</p>
                      <p className="text-xs text-muted">
                        {dateLabel(inflow.date)} 예상
                        {inflow.delayDays > 0 && ` · 지연 가정 ${inflow.delayDays}일`}
                      </p>
                    </div>
                    <span className="tnum text-sm font-medium">{won(inflow.amount)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title="이번 주에 예정된 입금이 없어요"
                description={
                  upcoming
                    ? `가장 가까운 입금은 ${upcoming.clientName} · ${dateLabel(upcoming.date)}에 ${won(upcoming.amount)}입니다.`
                    : "정산함에서 계약을 등록하면 예정 입금이 여기에 표시됩니다."
                }
              />
            )}
          </Card>

          <WhatIfPanel />
        </div>

        <div className="flex flex-col gap-5">
          <Card
            title="이번 주 가용금액"
            aside="28일 안전자금 ÷ 4"
            className="receipt-panel object-frame rounded-[26px]"
          >
            <p className="tnum text-3xl font-bold">{won(weekly.weeklyAvailableAmount)}</p>
            <div className="mt-4 border-t border-line pt-3">
              <Row label="현재 잔액" value={won(balanceBreakdown.totalBalance)} />
              <Row
                label="세금 준비금"
                value={won(balanceBreakdown.reservedTaxAmount)}
                tone="minus"
                note="보호 중"
              />
              <Row
                label="위시 준비금"
                value={won(balanceBreakdown.reservedWishAmount)}
                tone="minus"
                note="보호 중"
              />
              <Row label="안전예비금" value={won(balanceBreakdown.safetyBuffer)} tone="minus" />
              <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-line pt-2">
                <span className="text-sm font-medium">시뮬레이션 시작 잔액</span>
                <span className="tnum text-sm font-semibold">
                  {won(balanceBreakdown.simulationStartBalance)}
                </span>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted">
              28일 안전자금 {won(weekly.safeFund28Days)}을 4주로 나눈 값입니다.
            </p>
          </Card>

          <Card title="위험 원인" className="desk-panel object-frame rounded-[26px]">
            <div className="flex flex-col gap-3">
              {riskCause.nextLargeOutflow ? (
                <p className="text-sm">
                  <span className="font-medium">{dateLabel(riskCause.nextLargeOutflow.date)}</span>
                  에 {riskCause.nextLargeOutflow.name}{" "}
                  {won(riskCause.nextLargeOutflow.amount)}이 빠져나갑니다.
                </p>
              ) : (
                <p className="text-sm text-muted">예정된 큰 유출이 없습니다.</p>
              )}

              {riskCause.delayedContracts.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {riskCause.delayedContracts.map((c) => (
                    <li key={c.contractId} className="flex items-baseline justify-between gap-3">
                      <span className="text-sm">
                        {c.clientName}
                        <span className="ml-1.5 text-xs text-danger">
                          {c.overdueDays}일 지연
                        </span>
                      </span>
                      <span className="tnum text-sm">{won(c.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}

              {riskCause.shortfallAmount !== null && (
                <p className="rounded-lg bg-surface-muted px-3 py-2.5 text-sm">
                  D-day를 넘기려면 <b className="tnum">{won(riskCause.shortfallAmount)}</b>이 더
                  필요합니다.
                </p>
              )}
            </div>
          </Card>

          <Card
            title="보호 중 준비금"
            aside="계산에서 건드리지 않는 금액"
            className="receipt-panel object-frame rounded-[26px]"
          >
            <Row label="세금 준비금" value={won(balanceBreakdown.reservedTaxAmount)} />
            <Row label="위시 준비금" value={won(balanceBreakdown.reservedWishAmount)} />
            <p className="mt-2 text-xs text-muted">
              세금 준비율 {(input.user.taxReserveRate * 100).toFixed(0)}%는 사용자가 현금흐름
              관리를 위해 설정하는 준비 비율이며, 세율 또는 예상 세액이 아닙니다.
            </p>
          </Card>
        </div>
      </div>

      <p className="px-1 text-xs text-muted">
        합성 데이터 기반 Mock 화면입니다. 실제 금융·메신저 데이터를 사용하지 않습니다.
      </p>
    </main>
  );
}
function ScenarioCell({
  label,
  result,
  baseline,
  highlight = false,
}: {
  label: string;
  result: CashflowResult;
  baseline: CashflowResult;
  highlight?: boolean;
}) {
  // 잔액 등급 배지 대신 기준 시나리오와의 차이를 보여준다.
  // 세 시나리오의 차이는 "며칠 더/덜 버티는가"이고, 그게 비교의 목적이다.
  const gap =
    result.daysRemaining !== null && baseline.daysRemaining !== null
      ? result.daysRemaining - baseline.daysRemaining
      : null;

  return (
    <li
      className={`rounded-2xl border p-4 text-center shadow-[inset_0_2px_0_rgba(255,255,255,0.85),0_12px_20px_rgba(95,72,202,0.1)] transition-colors ${
        highlight
          ? "border-white/80 bg-[linear-gradient(145deg,var(--accent-warm-soft),var(--lavender-soft))]"
          : "border-white/70 bg-white/76"
      }`}
    >
      <p className="text-xs text-muted">{label}</p>
      <p className="tnum mt-1 text-lg font-bold">{ddayLabel(result.daysRemaining)}</p>
      <p className="mt-1 text-xs text-muted">{dateLabel(result.dDay)}</p>
      <p
        className={`tnum mt-1.5 text-xs ${
          gap === null || gap === 0
            ? "text-muted"
            : gap > 0
              ? "text-safe"
              : "text-danger"
        }`}
      >
        {highlight ? "기준" : gap === null ? "비교 불가" : signedDays(gap)}
      </p>
    </li>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/75 bg-white/86 px-4 py-3 shadow-[0_8px_0_rgba(244,201,79,0.18),0_18px_30px_rgba(128,106,45,0.14)] backdrop-blur">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="tnum mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

function RunwayMeter({ percent }: { percent: number }) {
  return (
    <div className="mt-6">
      <div className="h-4 overflow-hidden rounded-full bg-white/70 shadow-[inset_0_2px_6px_rgba(56,50,76,0.12)]">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent-warm),var(--mint),var(--lavender))]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted">
        <span>오늘</span>
        <span>90일 전망</span>
      </div>
    </div>
  );
}

function HeroChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/78 px-3 py-2 text-xs text-muted shadow-[0_9px_18px_rgba(128,106,45,0.12)]">
      <span>{label}</span>
      <b className="tnum font-semibold text-foreground">{value}</b>
    </span>
  );
}
