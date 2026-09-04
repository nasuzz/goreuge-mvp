"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, PageTitle } from "@/components/ui";
import { won } from "@/lib/format";
import { useMockStore } from "@/lib/mock/store";
import { FIXED_COPY, MVP_POLICY } from "@/shared/policy";

export default function OnboardingPage() {
  const router = useRouter();
  const { input, completeOnboarding, reset } = useMockStore();

  const [totalBalance, setTotalBalance] = useState(String(input.user.totalBalance));
  const [monthlyFixedOutflow, setMonthlyFixedOutflow] = useState(
    String(input.user.monthlyFixedOutflow),
  );
  const [safetyBuffer, setSafetyBuffer] = useState(String(input.user.safetyBuffer));
  const [taxReserveRate, setTaxReserveRate] = useState(input.user.taxReserveRate);
  const [errors, setErrors] = useState<string[]>([]);

  // 제안값 = 월 필수지출 × 1.0개월 (기획서 3-3)
  const suggested = Math.round(
    (Number(monthlyFixedOutflow) || 0) * MVP_POLICY.safetyBufferMonths,
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const found: string[] = [];
    if (!totalBalance) found.push("현재 잔액을 입력해 주세요.");
    if (!monthlyFixedOutflow) found.push("월 필수지출을 입력해 주세요.");
    if (Number(safetyBuffer) < 0) found.push("안전예비금은 0원 이상이어야 합니다.");

    setErrors(found);
    if (found.length > 0) return;

    completeOnboarding({
      totalBalance: Number(totalBalance),
      monthlyFixedOutflow: Number(monthlyFixedOutflow),
      safetyBuffer: Number(safetyBuffer) || 0,
      taxReserveRate,
    });
    router.push("/");
  }

  return (
    <main className="flex flex-col gap-4">
      <PageTitle
        title="시작하기"
        description="첫 결과를 만드는 데 필요한 값만 받습니다. 계약은 등록 후 정산함에서 추가합니다."
      />

      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Card title="현재 잔액">
          <p className="mb-2 text-sm text-muted">
            생활비 계좌, 세금 준비 계좌, 위시 적립 계좌 등 현재 보유한 입출금 가능 계좌의
            잔액을 모두 합산해 입력해 주세요.
          </p>
          <input
            aria-label="현재 잔액"
            inputMode="numeric"
            value={totalBalance}
            onChange={(e) => setTotalBalance(e.target.value.replace(/[^0-9]/g, ""))}
            className={`${inputClass} tnum`}
          />
          <p className="mt-1 text-xs text-muted">
            투자계좌, 해지 전 사용할 수 없는 예·적금, 신용카드 한도는 포함하지 않습니다.
          </p>
        </Card>

        <Card title="월 필수지출">
          <p className="mb-2 text-sm text-muted">
            매달 고정적으로 나가는 돈이 얼마나 되나요? 월세, 통신비, 보험료, 구독료, 대출
            상환 등을 대략 합산해 주세요.
          </p>
          <input
            aria-label="월 필수지출"
            inputMode="numeric"
            value={monthlyFixedOutflow}
            onChange={(e) => setMonthlyFixedOutflow(e.target.value.replace(/[^0-9]/g, ""))}
            className={`${inputClass} tnum`}
          />
          <p className="mt-1 text-xs text-muted">
            나중에 정확한 항목과 날짜를 추가할 수 있어요. 하루 단위로 나눠서 반영합니다.
          </p>
        </Card>

        <Card title="안전예비금">
          <p className="mb-2 text-sm text-muted">
            {FIXED_COPY.safetyBufferSuggest.replace(
              "{amount}",
              suggested.toLocaleString("ko-KR"),
            )}
          </p>
          <input
            aria-label="안전예비금"
            inputMode="numeric"
            value={safetyBuffer}
            onChange={(e) => setSafetyBuffer(e.target.value.replace(/[^0-9]/g, ""))}
            className={`${inputClass} tnum`}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <ChoiceButton onClick={() => setSafetyBuffer(String(suggested))}>
              제안값 {won(suggested)} 사용
            </ChoiceButton>
            <ChoiceButton onClick={() => setSafetyBuffer("0")}>0원으로 시작</ChoiceButton>
          </div>
        </Card>

        <Card title="세금 준비율" aside="건너뛸 수 있어요">
          <div className="flex flex-wrap gap-2">
            {MVP_POLICY.taxReservePresets.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setTaxReserveRate(preset)}
                aria-pressed={taxReserveRate === preset}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  taxReserveRate === preset ? "border-accent font-semibold" : "border-line"
                }`}
              >
                {(preset * 100).toFixed(0)}%
                {preset === MVP_POLICY.defaultTaxReserveRate && (
                  <span className="ml-1 text-xs text-muted">기본</span>
                )}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">{FIXED_COPY.taxReserveDisclaimer}</p>
        </Card>

        {errors.length > 0 && (
          <ul role="alert" className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}

        <button
          type="submit"
          className="rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-background"
        >
          내 D-day 보기
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          reset();
          router.push("/");
        }}
        className="self-center text-xs text-muted underline"
      >
        데모 기본값으로 되돌리기
      </button>

      <p className="px-1 text-xs text-muted">{FIXED_COPY.serviceDisclaimer}</p>
    </main>
  );
}

const inputClass =
  "w-full rounded-lg border border-line bg-background px-3 py-2.5 text-base";

function ChoiceButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}
