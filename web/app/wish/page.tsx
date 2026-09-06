"use client";

// 위시함 (기획서 2장 4번째 메뉴, 6-4절 / engine-interface.md 3-11). 이슈 #56.
//
// 3-11이 "화면만 만드는 건 P2다. 실제로 동작하게 만드는 걸 목표로 한다"고 못박아서,
// 체크하면 D-day가 실제로 움직이는 화면으로 만든다. 계산은 전부 엔진을 호출한다.

import { useState } from "react";
import { Card, EmptyState, PageTitle, Badge } from "@/components/ui";
import { dateLabel, won } from "@/lib/format";
import { useMockStore } from "@/lib/mock/store";
import { calculateWishPlan } from "@/engine/index";
import { FIXED_COPY } from "@/shared/policy";
import type { Saving } from "@/shared/types";

export default function WishPage() {
  const { input, summary, today, checkSaving } = useMockStore();
  const weeklyAvailable = summary.weekly.weeklyAvailableAmount;

  const wishes = input.savings.filter((s) => s.kind === "wish");
  const taxReserves = input.savings.filter((s) => s.kind === "tax");

  return (
    <main className="flex flex-col gap-4">
      <PageTitle
        title="위시함"
        description="옮겨둔 돈은 가용잔액에서 빠집니다. 보호가 D-day를 어떻게 바꾸는지 함께 봅니다."
      />

      <Card title="세금 준비금">
        {taxReserves.length === 0 ? (
          <EmptyState title="준비금이 없습니다" description="세금 준비금을 만들면 여기에 표시됩니다." />
        ) : (
          <ul className="flex flex-col gap-3">
            {taxReserves.map((saving) => (
              <SavingRow
                key={saving.id}
                saving={saving}
                weeklyAvailable={weeklyAvailable}
                today={today}
                onCheck={checkSaving}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card title="위시 적립">
        {wishes.length === 0 ? (
          <EmptyState title="적립 중인 위시가 없습니다" description="사고 싶은 것을 등록하면 여기에 표시됩니다." />
        ) : (
          <ul className="flex flex-col gap-3">
            {wishes.map((saving) => (
              <SavingRow
                key={saving.id}
                saving={saving}
                weeklyAvailable={weeklyAvailable}
                today={today}
                onCheck={checkSaving}
              />
            ))}
          </ul>
        )}
      </Card>

      {/* 기획서 7장이 지정한 고정 문구. 앱은 계좌이체를 실행하지 않는다. */}
      <p className="px-1 text-xs text-muted">{FIXED_COPY.transferDisclaimer}</p>
    </main>
  );
}

function SavingRow({
  saving,
  weeklyAvailable,
  today,
  onCheck,
}: {
  saving: Saving;
  weeklyAvailable: number;
  today: string;
  onCheck: (savingId: string, amount: number) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const plan = calculateWishPlan(saving, weeklyAvailable, today);
  const progress =
    saving.targetAmount !== null && saving.targetAmount > 0
      ? Math.min(100, Math.round((saving.reservedAmount / saving.targetAmount) * 100))
      : null;

  function check() {
    // 예약해둔 금액이 없으면 체크할 것이 없다. 엔진도 막지만 여기서 먼저 사유를 알려준다.
    if (saving.plannedAmount <= 0) {
      setError("옮기기로 예약한 금액이 없습니다.");
      return;
    }
    setError(null);
    onCheck(saving.id, saving.plannedAmount);
  }

  return (
    <li className="rounded-xl border border-line p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{saving.name}</p>
          <p className="mt-0.5 text-xs text-muted">
            {saving.targetAmount !== null ? `목표 ${won(saving.targetAmount)}` : "목표액 없음"}
            {saving.weeklyAmount !== null && ` · 주 ${won(saving.weeklyAmount)}`}
          </p>
        </div>
        {progress !== null && <Badge tone="neutral">{progress}%</Badge>}
      </div>

      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted">예약</dt>
          <dd className="tnum font-medium">{won(saving.plannedAmount)}</dd>
        </div>
        <div>
          <dt className="text-muted">보호 중</dt>
          <dd className="tnum font-medium">{won(saving.reservedAmount)}</dd>
        </div>
        <div>
          <dt className="text-muted">사용</dt>
          <dd className="tnum font-medium">{won(saving.spentAmount)}</dd>
        </div>
      </dl>

      {plan.affordableDate && (
        <p className="mt-2 text-xs text-muted">
          살 수 있는 날 {dateLabel(plan.affordableDate)}
          {plan.weeksRemaining !== null && ` · ${plan.weeksRemaining}주 남음`}
        </p>
      )}

      {/* 경고는 저장을 막지 않는다(3-11). 알려주기만 한다. */}
      {plan.exceedsWeeklyWarning && (
        <p className="mt-1.5 rounded-lg bg-caution-bg px-2.5 py-1.5 text-xs text-caution">
          주간 적립액이 이번 주 가용금액({won(weeklyAvailable)})의 30%를 넘습니다. 그래도 적립할
          수 있지만 D-day가 앞당겨집니다.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}

      {saving.plannedAmount > 0 && (
        <button
          type="button"
          onClick={check}
          className="mt-2 rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background"
        >
          {won(saving.plannedAmount)} 옮겼다고 체크
        </button>
      )}
    </li>
  );
}
