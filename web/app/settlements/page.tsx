"use client";

import Link from "next/link";
import { useState } from "react";
import { ContractCard } from "@/components/contract-card";
import { Card, EmptyState, PageTitle } from "@/components/ui";
import {
  QUEUE_COLUMNS,
  outstandingNetAmount,
  outstandingReceivable,
  unavailableCount,
} from "@/lib/contract-view";
import { won } from "@/lib/format";
import { useMockStore } from "@/lib/mock/store";
import type { ContractStatus } from "@/shared/enums";

type Queue = ContractStatus | "closed";

export default function SettlementsPage() {
  const { input } = useMockStore();
  const [queue, setQueue] = useState<Queue>("waiting");
  const unavailable = unavailableCount(input.contracts);

  const counts = (status: ContractStatus) =>
    input.contracts.filter((c) => c.status === status).length;

  const closed = input.contracts.filter(
    (c) => c.status === "completed" || c.status === "cancelled",
  );

  const visible =
    queue === "closed"
      ? closed
      : input.contracts.filter((c) => c.status === queue);

  return (
    <main className="flex flex-col gap-5">
      <PageTitle title="정산함" description="계약을 등록하고 대기·지연·위험을 관리합니다." />

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-4 lg:sticky lg:top-8 lg:self-start">
          <Card
            title="미수금 총액"
            aside="대기·지연·위험"
            className="receipt-panel object-frame rounded-[26px]"
          >
            <p className="tnum text-3xl font-bold">
              {won(outstandingReceivable(input.contracts))}
            </p>
            <div className="mt-3 border-t border-line pt-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-muted">예상 실수령액</span>
                <span className="tnum text-sm font-medium">
                  {won(outstandingNetAmount(input.contracts))}
                </span>
              </div>
              {unavailable > 0 && (
                <p className="mt-1 text-xs text-muted">
                  공제 방식을 확인할 수 없는 {unavailable}건은 합계에서 빠져 있습니다.
                </p>
              )}
            </div>
          </Card>

          <Link
            href="/settlements/new"
            className="rounded-lg bg-accent-strong px-4 py-3 text-center text-sm font-semibold text-white"
          >
            계약 등록하기
          </Link>

          <div className="grid grid-cols-3 gap-2 lg:grid-cols-1">
            {QUEUE_COLUMNS.map((column) => {
              const active = queue === column.status;
              return (
                <button
                  key={column.status}
                  type="button"
                  onClick={() => setQueue(column.status)}
                  aria-pressed={active}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    active ? "border-accent bg-accent-soft/70" : "border-line bg-surface"
                  }`}
                >
                  <span className="text-xs text-muted">{column.title}</span>
                  <span className="tnum block text-xl font-bold">{counts(column.status)}</span>
                  <span className="block text-[11px] text-muted">{column.hint}</span>
                </button>
              );
            })}
          </div>

          {closed.length > 0 && (
            <button
              type="button"
              onClick={() => setQueue("closed")}
              aria-pressed={queue === "closed"}
              className={`self-start rounded-md border px-3 py-1.5 text-xs transition-colors ${
                queue === "closed" ? "border-accent text-foreground" : "border-line text-muted"
              }`}
            >
              완료·취소 {closed.length}건 보기
            </button>
          )}
        </aside>

        <section>
          {visible.length > 0 ? (
            <ul className="grid gap-3 xl:grid-cols-2">
              {visible.map((contract) => (
                <ContractCard key={contract.id} contract={contract} />
              ))}
            </ul>
          ) : (
            <EmptyState
              title="이 대기열에 계약이 없어요"
              description="계약을 등록하면 예정입금일에 따라 대기·지연·위험으로 자동 분류됩니다."
              action={
                <Link
                  href="/settlements/new"
                  className="inline-block rounded-lg border border-line px-3 py-2 text-sm"
                >
                  계약 등록하기
                </Link>
              }
            />
          )}
        </section>
      </div>
    </main>
  );
}
