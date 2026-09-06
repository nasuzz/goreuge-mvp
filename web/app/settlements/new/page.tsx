"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { calculateExpectedDate, calculateExpectedNetAmount } from "@/engine/index";
import { Card, PageTitle } from "@/components/ui";
import { TERM_LABEL } from "@/lib/contract-view";
import { dateLabel, won } from "@/lib/format";
import { useMockStore } from "@/lib/mock/store";
import { FIXED_COPY, getWithholdingReference } from "@/shared/policy";
import type { IncomeType, SettlementTerm } from "@/shared/enums";
import type { AIContractCandidate } from "@/shared/types";
import type { AIConfirmationViewModel } from "@/ai/confirmation-flow";
import { AIConfirmModal } from "@/components/ai-confirm-modal";
import type { ContractRiskSignal, RiskDetectionResult } from "@/ai/contract-risk";

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

// 검증 규칙은 #21 API 라우트(parseContractInput)와 같은 값을 쓴다.
// Mock에서 통과한 입력이 실제 API에서 400을 맞으면 안 된다.
const MIN_SETTLEMENT_DAY = 1;
const MAX_SETTLEMENT_DAY = 365;

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
  // 참조율은 사용자가 명시적으로 확인해야 적용된다(5-1 requiresUserConfirmation).
  // 기본 체크로 두면 확인 없이 3.3%가 적용돼 바로 아래 안내 문구와 어긋난다.
  const [rateConfirmed, setRateConfirmed] = useState(false);
  const [payerStated, setPayerStated] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  // AI 초안 (#7)
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [candidateModel, setCandidateModel] = useState<AIConfirmationViewModel | null>(null);
  const [applied, setApplied] = useState(false);
  const [riskSignals, setRiskSignals] = useState<ContractRiskSignal[]>([]);

  async function requestCandidate() {
    setAiLoading(true);
    setAiError(null);
    setApplied(false);
    try {
      const response = await fetch("/api/ai/contract-candidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: aiText, referenceDate: today }),
      });
      const data = await response.json();
      if (!response.ok) {
        // 서버가 사용자에게 보여줄 문구를 이미 정해서 준다. 그대로 쓴다.
        setAiError(typeof data?.error === "string" ? data.error : "후보를 만들지 못했습니다.");
        return;
      }
      setCandidateModel(data as AIConfirmationViewModel);

      // [#49] 위험 신호는 별도 라우트라 실패해도 후보 추출을 막지 않는다.
      // 모달은 이미 떠 있고, 신호가 오면 그 자리에 채워진다.
      fetch("/api/ai/contract-risk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: aiText, referenceDate: today }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((risk: RiskDetectionResult | null) => setRiskSignals(risk?.signals ?? []))
        .catch(() => setRiskSignals([]));
    } catch {
      setAiError("분석 요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setAiLoading(false);
    }
  }

  /** 확인 모달에서 사용자가 확인·수정한 값만 폼에 채운다. 저장은 하지 않는다. */
  function applyCandidate(
    candidate: AIContractCandidate,
    manualDate: string | null,
  ) {
    setClientName(candidate.clientName ?? "");
    setGrossAmount(candidate.grossAmount != null ? String(candidate.grossAmount) : "");
    setCompletionDate(candidate.completionDate ?? today);
    setSettlementTerm(candidate.settlementTerm ?? "UNKNOWN");
    setSettlementDay(candidate.settlementDay != null ? String(candidate.settlementDay) : "");
    setManualExpectedDate(manualDate ?? "");
    setIncomeType(candidate.incomeTypeCandidate);
    // [#19] 지급처가 안내한 금액이 있으면 그대로 넘긴다. 참조율보다 우선한다.
    setPayerStated(
      candidate.payerStatedNetAmountCandidate != null
        ? String(candidate.payerStatedNetAmountCandidate)
        : "",
    );
    // 참조율 확인은 승계하지 않는다. 소득유형이 바뀌었을 수 있다.
    setRateConfirmed(false);
    setErrors([]);
    setCandidateModel(null);
    setApplied(true);
  }

  const reference = getWithholdingReference(incomeType);

  const settlementDayValue = settlementDay === "" ? null : Number(settlementDay);
  const settlementDayInRange =
    settlementDayValue !== null &&
    Number.isInteger(settlementDayValue) &&
    settlementDayValue >= MIN_SETTLEMENT_DAY &&
    settlementDayValue <= MAX_SETTLEMENT_DAY;
  const settlementDayReady = !NEEDS_DAY.includes(settlementTerm) || settlementDayInRange;

  // 예정입금일은 입력하는 동안 계속 다시 계산해서 보여준다(기획서 5-3).
  const calculatedDate = useMemo(() => {
    if (!completionDate) return null;
    // [PR #25 리뷰 P0] settlementDay가 비었거나 범위 밖이면 엔진이 예외를 던진다.
    // 렌더 중에 던지면 사용자가 일수를 채우기도 전에 페이지 전체가 error boundary로
    // 넘어가므로, 값이 준비되기 전에는 엔진을 호출하지 않고 null로 둔다.
    if (!settlementDayReady) return null;
    return calculateExpectedDate({
      settlementTerm,
      settlementDay: settlementDayValue,
      completionDate,
      invoiceDate: invoiceDate || null,
    });
  }, [settlementTerm, settlementDayValue, settlementDayReady, completionDate, invoiceDate]);

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
    // 검증 순서와 조건은 #21 API의 parseContractInput과 맞춘다.
    const found: string[] = [];
    const gross = Number(grossAmount);
    const payer = payerStated === "" ? null : Number(payerStated);

    if (!clientName.trim()) found.push("거래처 이름을 입력해 주세요.");
    if (!grossAmount || !Number.isInteger(gross) || gross <= 0) {
      found.push("계약 총액은 1원 이상의 정수여야 합니다.");
    }
    if (!completionDate) found.push("완료일을 입력해 주세요.");
    if (NEEDS_DAY.includes(settlementTerm) && !settlementDayInRange) {
      found.push(
        `${TERM_LABEL[settlementTerm]} 조건은 ${MIN_SETTLEMENT_DAY}~${MAX_SETTLEMENT_DAY} 사이의 정수가 필요합니다.`,
      );
    }
    if (payer !== null && (!Number.isInteger(payer) || payer < 0 || payer > gross)) {
      found.push("지급처 안내 실수령액은 0원 이상, 계약 총액 이하의 정수여야 합니다.");
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
      settlementDay: settlementDayValue,
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
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageTitle
        title="계약 등록"
        description="입력한 값으로 예정입금일과 예상 실수령액을 계산합니다."
      />

      {/* 카톡·메일 원문 → AI 후보 → 사용자 확인 → 폼 채우기 (#7) */}
      <Card title="카톡·메일 붙여넣기" aside="AI 초안">
        <p className="mb-2 text-sm text-muted">
          받은 메시지를 그대로 붙여넣으면 계약 항목 후보를 뽑아드립니다. AI는 값을 확정하지
          않고, 확인 화면을 거친 값만 아래 폼에 채웁니다.
        </p>
        <textarea
          aria-label="카톡 또는 메일 내용"
          value={aiText}
          onChange={(e) => setAiText(e.target.value)}
          rows={4}
          placeholder="예: 편집본은 9월 3일 납품이고 총 240만원입니다. 정산은 익월 말일에 드릴게요."
          className={`${inputClass} resize-y`}
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={requestCandidate}
            disabled={aiLoading || !aiText.trim()}
            className="rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {aiLoading ? "분석 중…" : "AI로 초안 만들기"}
          </button>
          {applied && (
            <span className="text-xs text-safe">확인한 값을 아래 폼에 채웠습니다.</span>
          )}
        </div>
        {aiError && (
          <p role="alert" className="mt-2 rounded-lg bg-danger-bg px-3 py-2.5 text-sm text-danger">
            {aiError}
          </p>
        )}
      </Card>

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

          <div className="mt-1 rounded-lg bg-surface-muted px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-muted">예정입금일</span>
              <span className="text-sm font-semibold">
                {expectedDate ? dateLabel(expectedDate) : "계산 불가"}
              </span>
            </div>
            {!calculatedDate &&
              (NEEDS_DAY.includes(settlementTerm) && !settlementDayInRange ? (
                <p className="mt-1 text-xs text-caution">
                  {settlementDay === ""
                    ? `${TERM_LABEL[settlementTerm]} 조건은 일자 또는 일수를 입력해야 계산할 수 있습니다.`
                    : `${MIN_SETTLEMENT_DAY}~${MAX_SETTLEMENT_DAY} 사이의 정수를 입력해 주세요.`}
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted">
                  이 조건으로는 예정입금일을 계산할 수 없습니다. 아래에서 직접 입력해 주세요.
                </p>
              ))}
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
              onChange={(e) => {
                setIncomeType(e.target.value as IncomeType);
                // 이전 소득유형에서 확인한 참조율이 새 참조율로 승계되면 안 된다.
                setRateConfirmed(false);
              }}
              className={inputClass}
            >
              {INCOME_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="rounded-lg bg-surface-muted px-3 py-2.5 text-xs text-muted">
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

          <div className="mt-1 rounded-lg bg-surface-muted px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-muted">예상 실수령액</span>
              <span className="tnum text-sm font-semibold">
                {netPreview.amount === null ? "추정 불가" : won(netPreview.amount)}
              </span>
            </div>
            {netPreview.status === "calculated" && !payerStated && confirmedExpectedRate !== null && (
              // 0.033 * 100은 3.3000000000000003이 된다. 문구도 policy.ts 원문을 쓴다.
              <p className="mt-1 text-xs text-muted">
                ※{" "}
                {FIXED_COPY.referenceRateApplied.replace(
                  "{rate}",
                  (confirmedExpectedRate * 100).toFixed(1).replace(/\.0$/, ""),
                )}
              </p>
            )}
            {netPreview.status === "unavailable" && (
              <p className="mt-1 text-xs text-muted">{FIXED_COPY.netAmountUnavailable}</p>
            )}
          </div>
        </Card>

        {errors.length > 0 && (
          <ul role="alert" className="rounded-lg bg-danger-bg px-4 py-3 text-sm text-danger">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            className="flex-1 rounded-lg bg-accent-strong px-4 py-3 text-sm font-semibold text-white"
          >
            저장하기
          </button>
          <Link
            href="/settlements"
            className="rounded-lg border border-line px-4 py-3 text-sm text-muted"
          >
            취소
          </Link>
        </div>
      </form>

      {candidateModel && (
        <AIConfirmModal
          initial={candidateModel}
          riskSignals={riskSignals}
          onClose={() => setCandidateModel(null)}
          onApply={applyCandidate}
        />
      )}
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
