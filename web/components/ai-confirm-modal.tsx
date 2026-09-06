"use client";

// AI 계약 후보 확인 모달 (#7).
//
// 원칙 두 가지를 화면 구조로 강제한다.
//  1. AI는 확정하지 않는다 — 후보는 전부 수정 가능하고, 확인 체크 전에는 저장이 열리지 않는다.
//  2. 자동 저장하지 않는다 — 확인을 마쳐도 등록 폼을 채울 뿐, 저장은 사용자가 누른다.
//
// confidence 임계값과 저장 가능 조건은 화면에서 다시 구현하지 않고
// B의 연결 계층(rebuildAIConfirmationViewModel)이 계산한 결과를 그대로 쓴다.

import { useEffect, useRef, useState } from "react";
import { rebuildAIConfirmationViewModel } from "@/ai/confirmation-flow";
import { recomputeMissingFields } from "@/ai/review-rules";
import type { AIConfirmationViewModel } from "@/ai/confirmation-flow";
import type { CandidateField } from "@/ai/review-rules";
import { Badge } from "@/components/ui";
import { TERM_LABEL } from "@/lib/contract-view";
import type { AIContractCandidate, DateString } from "@/shared/types";
import type { IncomeType, SettlementTerm } from "@/shared/enums";

const FIELD_LABEL: Record<CandidateField, string> = {
  clientName: "거래처",
  grossAmount: "계약 총액",
  // [#19] 지급처가 원문에서 직접 안내한 실수령액. 공제율로 만들어낸 값이 아니다.
  payerStatedNetAmountCandidate: "지급처 안내 실수령액",
  completionDate: "완료일",
  settlementTerm: "정산조건",
  incomeTypeCandidate: "소득유형",
};

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
const NEEDS_MANUAL_DATE: Array<SettlementTerm | null> = [null, "UNKNOWN"];

export function AIConfirmModal({
  initial,
  onClose,
  onApply,
}: {
  initial: AIConfirmationViewModel;
  onClose: () => void;
  onApply: (candidate: AIContractCandidate, manualExpectedDate: DateString | null) => void;
}) {
  const [model, setModel] = useState(initial);
  const [reviewed, setReviewed] = useState(false);
  const [manualExpectedDate, setManualExpectedDate] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function update(
    patch: Partial<AIContractCandidate>,
    nextReviewed = reviewed,
    nextManual = manualExpectedDate,
  ) {
    const merged: AIContractCandidate = { ...model.candidate, ...patch };
    const manual = nextManual || null;
    // 누락 여부는 매번 현재 값으로 다시 판정한다. 채운 필드를 깎기만 하면
    // 값을 도로 지웠을 때 배지가 돌아오지 않고, "확인 필요"를 고른 것도
    // 채운 것으로 처리돼 배지와 차단 사유가 어긋난다.
    const candidate: AIContractCandidate = {
      ...merged,
      missingFields: recomputeMissingFields(merged, manual),
    };
    setModel(rebuildAIConfirmationViewModel(model, candidate, nextReviewed, manual));
  }

  const { candidate, fields, gate } = model;
  const needsManualDate = NEEDS_MANUAL_DATE.includes(candidate.settlementTerm);
  const effectiveManualExpectedDate = needsManualDate ? manualExpectedDate : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-confirm-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 sm:rounded-2xl"
      >
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="ai-confirm-title" className="text-base font-bold">
              AI가 찾은 계약 내용
            </h2>
            <p className="mt-1 text-xs text-muted">
              AI는 후보만 제시합니다. 확인하고 고친 값만 등록됩니다.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded-lg border border-line px-2.5 py-1 text-sm text-muted"
          >
            ✕
          </button>
        </header>

        {model.fallbackNotice && (
          <p className="mb-3 rounded-xl bg-caution-bg px-3 py-2.5 text-xs text-caution">
            {model.fallbackNotice}
          </p>
        )}

        {model.warnings.length > 0 && (
          <ul className="mb-3 flex flex-col gap-1 rounded-xl bg-surface-muted px-3 py-2.5 text-xs text-muted">
            {model.warnings.map((w) => (
              <li key={w}>· {w}</li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-3">
          <FieldRow review={findField(fields, "clientName")}>
            <input
              aria-label={FIELD_LABEL.clientName}
              value={candidate.clientName ?? ""}
              onChange={(e) => update({ clientName: e.target.value || null })}
              placeholder="거래처 이름"
              className={inputClass}
            />
          </FieldRow>

          <FieldRow review={findField(fields, "grossAmount")}>
            <input
              aria-label={FIELD_LABEL.grossAmount}
              inputMode="numeric"
              value={candidate.grossAmount ?? ""}
              onChange={(e) => {
                const digits = e.target.value.replace(/[^0-9]/g, "");
                update({ grossAmount: digits ? Number(digits) : null });
              }}
              placeholder="2400000"
              className={`${inputClass} tnum`}
            />
          </FieldRow>

          <FieldRow review={findField(fields, "payerStatedNetAmountCandidate")}>
            <input
              aria-label={FIELD_LABEL.payerStatedNetAmountCandidate}
              inputMode="numeric"
              value={candidate.payerStatedNetAmountCandidate ?? ""}
              onChange={(e) => {
                const digits = e.target.value.replace(/[^0-9]/g, "");
                update({ payerStatedNetAmountCandidate: digits ? Number(digits) : null });
              }}
              placeholder="안내받은 금액이 있을 때만"
              className={`${inputClass} tnum`}
            />
            <span className="text-xs text-muted">
              지급처가 알려준 금액입니다. 있으면 참조율 계산보다 우선합니다.
            </span>
          </FieldRow>

          <FieldRow review={findField(fields, "completionDate")}>
            <input
              aria-label={FIELD_LABEL.completionDate}
              type="date"
              value={candidate.completionDate ?? ""}
              onChange={(e) =>
                update({ completionDate: e.target.value || null })
              }
              className={inputClass}
            />
          </FieldRow>

          <FieldRow review={findField(fields, "settlementTerm")}>
            <select
              aria-label={FIELD_LABEL.settlementTerm}
              value={candidate.settlementTerm ?? "UNKNOWN"}
              onChange={(e) => {
                const settlementTerm = e.target.value as SettlementTerm;
                if (!NEEDS_MANUAL_DATE.includes(settlementTerm)) {
                  setManualExpectedDate("");
                }
                update(
                  { settlementTerm },
                  reviewed,
                  NEEDS_MANUAL_DATE.includes(settlementTerm) ? manualExpectedDate : "",
                );
              }}
              className={inputClass}
            >
              {TERMS.map((term) => (
                <option key={term} value={term}>
                  {TERM_LABEL[term]}
                </option>
              ))}
            </select>
          </FieldRow>

          {NEEDS_DAY.includes(candidate.settlementTerm ?? "UNKNOWN") && (
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">
                {candidate.settlementTerm === "NEXT_MONTH_DAY" ? "익월 며칠" : "며칠 뒤"}
              </span>
              <input
                inputMode="numeric"
                value={candidate.settlementDay ?? ""}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^0-9]/g, "");
                  update({ settlementDay: digits ? Number(digits) : null });
                }}
                className={`${inputClass} tnum`}
              />
            </label>
          )}

          {needsManualDate && (
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">예정입금일 직접 입력</span>
              <input
                type="date"
                value={manualExpectedDate}
                onChange={(e) => {
                  setManualExpectedDate(e.target.value);
                  update({}, reviewed, e.target.value);
                }}
                className={inputClass}
              />
              <span className="text-xs text-muted">
                정산조건을 확인할 수 없어요. 예정입금일을 직접 입력해 주세요.
              </span>
            </label>
          )}

          <FieldRow review={findField(fields, "incomeTypeCandidate")}>
            <select
              aria-label={FIELD_LABEL.incomeTypeCandidate}
              value={candidate.incomeTypeCandidate}
              onChange={(e) =>
                update({ incomeTypeCandidate: e.target.value as IncomeType })
              }
              className={inputClass}
            >
              {INCOME_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FieldRow>
        </div>

        <label className="mt-4 flex items-start gap-2.5 rounded-xl border border-line p-3 text-sm">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => {
              setReviewed(e.target.checked);
              update({}, e.target.checked);
            }}
            className="mt-0.5 size-4 accent-[var(--accent)]"
          />
          <span>
            위 내용을 확인했습니다.
            <span className="block text-xs text-muted">
              확인해야 등록 폼에 값을 채울 수 있습니다.
            </span>
          </span>
        </label>

        {!gate.canSave && gate.errors.length > 0 && (
          <ul role="alert" className="mt-3 rounded-xl bg-danger-bg px-3 py-2.5 text-xs text-danger">
            {gate.errors.map((error) => (
              <li key={error}>· {error}</li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={!gate.canSave}
            onClick={() => onApply(candidate, effectiveManualExpectedDate || null)}
            className="flex-1 rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-background disabled:opacity-40"
          >
            확인한 값으로 폼 채우기
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-line px-4 py-3 text-sm text-muted"
          >
            취소
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          이 단계에서는 저장하지 않습니다. 폼에서 최종 확인 후 저장하기를 눌러 주세요.
        </p>
      </div>
    </div>
  );
}

const inputClass = "w-full rounded-lg border border-line bg-background px-3 py-2.5 text-sm";

function findField(fields: AIConfirmationViewModel["fields"], field: CandidateField) {
  return fields.find((f) => f.field === field)!;
}

function FieldRow({
  review,
  children,
}: {
  review: AIConfirmationViewModel["fields"][number];
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="flex items-center justify-between gap-2">
        <span className="font-medium">{FIELD_LABEL[review.field]}</span>
        <span className="flex items-center gap-1.5">
          {review.missing && <Badge tone="danger">누락</Badge>}
          <Badge
            tone={
              review.tone === "normal"
                ? "safe"
                : review.tone === "warning"
                  ? "caution"
                  : "danger"
            }
          >
            확신도 {Math.round(review.confidence * 100)}%
          </Badge>
        </span>
      </span>
      {children}
    </label>
  );
}
