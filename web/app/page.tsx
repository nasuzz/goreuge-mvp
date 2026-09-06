"use client";

import Link from "next/link";
import { addDays } from "@/engine/index";
import { Badge, Card, EmptyState, Row, toneOfLevel } from "@/components/ui";
import { RecoveryCards } from "@/components/recovery-cards";
import { WhatIfPanel } from "@/components/what-if-panel";
import { ddayLabel, dateLabel, longDateLabel, signedDays, won } from "@/lib/format";
import { useMockStore, useRecovery } from "@/lib/mock/store";
import type { CashflowResult } from "@/shared/types";

export default function HomePage() {
  const { summary, input, today, onboarded } = useMockStore();
  // 협상 카드는 홈에서만 쓴다. 스냅샷에 미리 계산해 넣으면 다른 화면의 모든 액션이
  // 쓰지 않을 결과를 계산한다(findRecovery는 runAllScenarios의 약 12배).
  const recovery = useRecovery();
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

  return (
    <main className="flex flex-col gap-4">
      <header className="mb-1 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">홈</h1>
          <p className="text-sm text-muted">{longDateLabel(today)} 기준</p>
        </div>
        {!onboarded && (
          <Link
            href="/onboarding"
            className="rounded-full border border-line px-3 py-1.5 text-xs text-muted hover:text-foreground"
          >
            내 숫자로 바꾸기
          </Link>
        )}
      </header>

      {/* 기준 D-day — 홈에서 가장 크게 보여준다(기획서 2장) */}
      <section className="rounded-2xl border border-line bg-surface p-6">
        <div className="mb-1 flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-muted">기준 시나리오 D-day</p>
          <span className="shrink-0">
            <Badge tone={toneOfLevel(todayLevel)}>
              오늘 잔액{" "}
              {todayLevel === "safe" ? "안전" : todayLevel === "caution" ? "주의" : "위험"}
            </Badge>
          </span>
        </div>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="tnum text-5xl font-bold tracking-tight">
            {ddayLabel(baseline.daysRemaining)}
          </span>
          {baseline.dDay && (
            <span className="text-sm opacity-80">남았어요 · {dateLabel(baseline.dDay)}</span>
          )}
        </p>
        <p className="mt-3 text-sm text-muted">
          시작 잔액 {won(baseline.simulationStartBalance)}에서 예상 입금과 지출을 하루씩 적용한
          결과입니다.
        </p>
      </section>

      <Card title="세 가지 시나리오" aside="입금 지연 가정만 다릅니다">
        <ul className="grid grid-cols-3 gap-2">
          <ScenarioCell label="낙관" result={optimistic} baseline={baseline} />
          <ScenarioCell label="기준" result={baseline} baseline={baseline} highlight />
          <ScenarioCell label="비관" result={pessimistic} baseline={baseline} />
        </ul>
        <p className="mt-3 text-xs text-muted">
          정시율을 금액에 곱하지 않고 시나리오별로 입금일만 이동시킵니다. 금액은 세 시나리오
          모두 같습니다.
        </p>
      </Card>

      <Card title="이번 주 가용금액" aside="28일 안전자금 ÷ 4">
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

      <Card title="이번 주 입금" aside={`${dateLabel(today)} ~ ${dateLabel(weekEnd)}`}>
        {thisWeekInflows.length > 0 ? (
          <ul className="flex flex-col divide-y divide-line">
            {thisWeekInflows.map((inflow) => (
              <li
                key={inflow.contractId}
                className="flex items-baseline justify-between gap-3 py-2.5"
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

      <Card title="위험 원인">
        <div className="flex flex-col gap-3">
          {riskCause.nextLargeOutflow ? (
            <p className="text-sm">
              <span className="font-medium">{dateLabel(riskCause.nextLargeOutflow.date)}</span>에{" "}
              {riskCause.nextLargeOutflow.name} {won(riskCause.nextLargeOutflow.amount)}이
              빠져나갑니다.
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
                    <span className="ml-1.5 text-xs text-danger">{c.overdueDays}일 지연</span>
                  </span>
                  <span className="tnum text-sm">{won(c.amount)}</span>
                </li>
              ))}
            </ul>
          )}

          {riskCause.shortfallAmount !== null && (
            <p className="rounded-xl bg-surface-muted px-3 py-2.5 text-sm">
              D-day를 넘기려면 <b className="tnum">{won(riskCause.shortfallAmount)}</b>이 더
              필요합니다.
            </p>
          )}
        </div>
      </Card>

      <RecoveryCards finding={recovery} />

      <WhatIfPanel />

      <Card title="보호 중 준비금" aside="계산에서 건드리지 않는 금액">
        <Row label="세금 준비금" value={won(balanceBreakdown.reservedTaxAmount)} />
        <Row label="위시 준비금" value={won(balanceBreakdown.reservedWishAmount)} />
        <p className="mt-2 text-xs text-muted">
          세금 준비율 {(input.user.taxReserveRate * 100).toFixed(0)}%는 사용자가 현금흐름 관리를
          위해 설정하는 준비 비율이며, 세율 또는 예상 세액이 아닙니다.
        </p>
      </Card>

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
      className={`rounded-xl border p-3 text-center ${
        highlight ? "border-accent" : "border-line"
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
