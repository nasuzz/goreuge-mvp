"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { calculateExpectedDate, calculateExpectedNetAmount } from "@/engine/index";
import { Card, PageTitle } from "@/components/ui";
import { TERM_LABEL } from "@/lib/contract-view";
import { dateLabel, won } from "@/lib/format";
import { useMockStore } from "@/lib/mock/store";
import { getWithholdingReference } from "@/shared/policy";
import type { IncomeType, SettlementTerm } from "@/shared/enums";

const TERMS: SettlementTerm[] = [
  "ON_COMPLETION",
  "SAME_MONTH_END",
  "NEXT_MONTH_END",
  "NEXT_MONTH_DAY",
  "NET_DAYS",
  "UNKNOWN",
];

const INCOME_TYPES: { value: IncomeType; label: string }[] = [
  { value: "business_personal_service", label: "인적용역 사업소득" },
  { value: "qualifying_other_income", label: "일부 기타소득" },
  { value: "employment_income", label: "근로소득" },
  { value: "no_withholding", label: "공제 없는 수입" },
  { value: "needs_review", label: "확인 필요" },
];

const NEEDS_DAY: SettlementTerm[] = ["NEXT_MONTH_DAY", "NET_DAYS"];

export default function NewContractPage() {
  const router = useRouter();
  const { addContract, today } = useMockStore();

  const [clientName, setClientName] = useState("");
  const [grossAmount, setGrossAmount] = useState("");
  const [completionDate, setCompletionDate] = useState(today);
  const [invoiceDate, setInvoiceDate] = useState("");
  const [settlementTerm, setSettlementTerm] = useState<SettlementTerm>("NEXT_MONTH_END");
  const [settlementDay, setSettlementDay] = useState("");
  const [manualExpectedDate, setManualExpectedDate] = useState("");
  const [incomeType, setIncomeType] = useState<IncomeType>("business_personal_service");
  const [rateConfirmed, setRateConfirmed] = useState(true);
  const [payerStated, setPayerStated] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const reference = getWithholdingReference(incomeType);

  // 예정입금일은 입력하는 동안 계속 다시 계산해서 보여준다(기획서 5-3).
  const calculatedDate = useMemo(() => {
    if (!completionDate) return null;
    return calculateExpectedDate({
      settlementTerm,
      settlementDay: settlementDay ? Number(settlementDay) : null,
      completionDate,
      invoiceDate: invoiceDate || null,
    });
  }, [settlementTerm, settlementDay, completionDate, invoiceDate]);

  const expectedDate = manualExpectedDate || calculatedDate;

  const confirmedExpectedRate =
    rateConfirmed && reference.referenceRate !== null ? reference.referenceRate : null;

  const netPreview = useMemo(
    () =>
      calculateExpectedNetAmount({
        grossAmount: Number(grossAmount) || 0,
        payerStatedNetAmount: payerStated ? Number(payerStated) : null,
        confirmedExpectedRate,
        actualNetAmount: null,
      }),
    [grossAmount, payerStated, confirmedExpectedRate],
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const found: string[] = [];
    if (!clientName.trim()) found.push("거래처 이름을 입력해 주세요.");
    if (!grossAmount || Number(grossAmount) <= 0) found.push("계약 총액을 입력해 주세요.");
    if (!completionDate) found.push("완료일을 입력해 주세요.");
    if (NEEDS_DAY.includes(settlementTerm) && !settlementDay) {
      found.push(`${TERM_LABEL[settlementTerm]} 조건은 일자 또는 일수가 필요합니다.`);
    }
    if (!expectedDate) {
      found.push("예정입금일을 계산할 수 없습니다. 직접 입력해 주세요.");
    }

    setErrors(found);
    if (found.length > 0) return;

    addContract({
      clientName: clientName.trim(),
      grossAmount: Number(grossAmount),
      completionDate,
      invoiceDate: invoiceDate || null,
      settlementTerm,
      settlementDay: settlementDay ? Number(settlementDay) : null,
      manualExpectedDate: manualExpectedDate || null,
      incomeType,
      // AI 후보를 그대로 저장하지 않는다. 이 화면은 사용자가 확인한 값만 넘긴다.
      classificationStatus: "user_confirmed",
      payerStatedNetAmount: payerStated ? Number(payerStated) : null,
      confirmedExpectedRate,
    });

    router.push("/settlements");
  }

  return (
    <main className="flex flex-col gap-4">
      <PageTitle
        title="계약 등록"
        description="입력한 값으로 예정입금일과 예상 실수령액을 계산합니다."
      />

      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Card title="계약 정보">
          <Field label="거래처" htmlFor="clientName">
            <input
              id="clientName"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="예: D에이전시"
              className={inputClass}
            />
          </Field>

          <Field label="계약 총액 (원)" htmlFor="grossAmount">
            <input
              id="grossAmount"
              inputMode="numeric"
              value={grossAmount}
              onChange={(e) => setGrossAmount(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="2400000"
              className={`${inputClass} tnum`}
            />
          </Field>

          <Field label="완료일" htmlFor="completionDate">
            <input
              id="completionDate"
              type="date"
              value={completionDate}
              onChange={(e) => setCompletionDate(e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="청구일 (선택)" htmlFor="invoiceDate" hint="기준일 + N일 조건에서 먼저 사용됩니다">
            <input
              id="invoiceDate"
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className={inputClass}
            />
          </Field>
        </Card>

        <Card title="정산 조건">
          <Field label="정산조건" htmlFor="settlementTerm">
            <select
              id="settlementTerm"
              value={settlementTerm}
              onChange={(e) => setSettlementTerm(e.target.value as SettlementTerm)}
              className={inputClass}
            >
              {TERMS.map((term) => (
                <option key={term} value={term}>
                  {TERM_LABEL[term]}
                </option>
              ))}
            </select>
          </Field>

          {NEEDS_DAY.includes(settlementTerm) && (
            <Field
              label={settlementTerm === "NEXT_MONTH_DAY" ? "익월 며칠" : "며칠 뒤"}
              htmlFor="settlementDay"
            >
              <input
                id="settlementDay"
                inputMode="numeric"
                value={settlementDay}
                onChange={(e) => setSettlementDay(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder={settlementTerm === "NEXT_MONTH_DAY" ? "10" : "30"}
                className={`${inputClass} tnum`}
              />
            </Field>
          )}

          <div className="mt-1 rounded-xl bg-surface-muted px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-muted">예정입금일</span>
              <span className="text-sm font-semibold">
                {expectedDate ? dateLabel(expectedDate) : "계산 불가"}
              </span>
            </div>
            {!calculatedDate && (
              <p className="mt-1 text-xs text-muted">
                이 조건으로는 예정입금일을 계산할 수 없습니다. 아래에서 직접 입력해 주세요.
              </p>
            )}
          </div>

          <Field
            label="예정입금일 직접 입력 (선택)"
            htmlFor="manualExpectedDate"
            hint="입력하면 엔진이 다시 계산해도 덮어쓰지 않습니다"
          >
            <input
              id="manualExpectedDate"
              type="date"
              value={manualExpectedDate}
              onChange={(e) => setManualExpectedDate(e.target.value)}
              className={inputClass}
            />
          </Field>
        </Card>

        <Card title="예상 실수령액">
          <Field label="소득유형" htmlFor="incomeType">
            <select
              id="incomeType"
              value={incomeType}
              onChange={(e) => setIncomeType(e.target.value as IncomeType)}
              className={inputClass}
            >
              {INCOME_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="rounded-xl bg-surface-muted px-3 py-2.5 text-xs text-muted">
            {reference.referenceRate !== null ? (
              <>
                <p>
                  시스템 참조 공제율 {(reference.referenceRate * 100).toFixed(1)}%
                  {reference.source && ` · 출처 ${reference.source} ${reference.checkedAt ?? ""}`}
                </p>
                {reference.note && <p className="mt-1">{reference.note}</p>}
              </>
            ) : (
              <p>이 소득유형은 참조 공제율을 제공하지 않습니다. 총액만 표시됩니다.</p>
            )}
          </div>

          {reference.referenceRate !== null && (
            <label className="mt-2 flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={rateConfirmed}
                onChange={(e) => setRateConfirmed(e.target.checked)}
                className="mt-0.5 size-4 accent-[var(--accent)]"
              />
              <span>
                이 참조율을 적용해 잠정 실수령액을 계산합니다.
                <span className="block text-xs text-muted">
                  시스템이 자동 확정하지 않습니다. 사용자가 확인해야 적용됩니다.
                </span>
              </span>
            </label>
          )}

          <Field
            label="지급처가 알려준 실수령액 (선택)"
            htmlFor="payerStated"
            hint="안내받은 금액이 있으면 참조율보다 우선합니다"
          >
            <input
              id="payerStated"
              inputMode="numeric"
              value={payerStated}
              onChange={(e) => setPayerStated(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="2320800"
              className={`${inputClass} tnum`}
            />
          </Field>

          <div className="mt-1 rounded-xl bg-surface-muted px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-muted">예상 실수령액</span>
              <span className="tnum text-sm font-semibold">
                {netPreview.amount === null ? "추정 불가" : won(netPreview.amount)}
              </span>
            </div>
            {netPreview.status === "calculated" && !payerStated && (
              <p className="mt-1 text-xs text-muted">
                ※ 확인 전 추정치이며 {(confirmedExpectedRate ?? 0) * 100}% 참조율을 적용했습니다.
              </p>
            )}
          </div>
        </Card>

        {errors.length > 0 && (
          <ul role="alert" className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            className="flex-1 rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-background"
          >
            저장하기
          </button>
          <Link
            href="/settlements"
            className="rounded-xl border border-line px-4 py-3 text-sm text-muted"
          >
            취소
          </Link>
        </div>
      </form>

      <Card title="카톡·메일 붙여넣기" aside="#7에서 연결">
        <p className="text-sm text-muted">
          AI 계약 초안 추출과 확인 모달은 별도 이슈(#7)에서 B의 파서에 연결합니다. 연결 후에도
          AI가 값을 확정하지 않고, 이 화면과 같은 확인 단계를 거쳐 저장합니다.
        </p>
      </Card>
    </main>
  );
}

const inputClass =
  "w-full rounded-lg border border-line bg-background px-3 py-2.5 text-sm";

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
