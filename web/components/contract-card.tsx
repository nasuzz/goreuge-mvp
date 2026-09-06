"use client";

import { useState } from "react";
import { Badge } from "@/components/ui";
import { dateLabel, won } from "@/lib/format";
import {
  STATUS_LABEL,
  STATUS_TONE,
  TERM_LABEL,
  netAmountView,
} from "@/lib/contract-view";
import { useMockStore } from "@/lib/mock/store";
import type { Contract } from "@/shared/types";

export function ContractCard({ contract }: { contract: Contract }) {
  const { input, today, markRisk, cancel, revert, confirmContractPayment } = useMockStore();
  const [action, setAction] = useState<"risk" | "cancel" | "payment" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  // 입금 확인 입력값. 실제일은 오늘을 기본값으로 두고, 실수령액은 비워서
  // 사용자가 통장에 찍힌 금액을 그대로 넣게 한다(잠정값을 미리 채우면 그대로 저장된다).
  const [actualDate, setActualDate] = useState(today);
  const [actualNetAmount, setActualNetAmount] = useState("");

  const clientName =
    input.clients.find((c) => c.id === contract.clientId)?.name ?? "이름 없는 거래처";
  const net = netAmountView(contract);

  function submitPayment() {
    if (!actualDate) {
      setError("입금일을 입력해 주세요.");
      return;
    }
    const amount = Number(actualNetAmount.replace(/[^0-9]/g, ""));
    if (!actualNetAmount.trim() || !Number.isInteger(amount)) {
      setError("실제로 입금된 금액을 입력해 주세요.");
      return;
    }
    // 총액을 넘는 입금은 계약 금액이 잘못된 것이다. 엔진도 막지만 여기서 먼저
    // 사유를 알려준다(엔진 예외가 화면을 깨뜨리지 않게).
    if (amount > contract.grossAmount) {
      setError(`실수령액은 계약 총액 ${won(contract.grossAmount)}을 넘을 수 없습니다.`);
      return;
    }
    confirmContractPayment(contract.id, actualDate, amount);
    setAction(null);
    setActualNetAmount("");
    setError(null);
  }

  function submit() {
    if (action === "payment") {
      submitPayment();
      return;
    }
    if (!reason.trim()) {
      // 수동 상태 변경은 사유가 필수다(DB 제약과 동일).
      setError("사유를 입력해 주세요. 수동 상태 변경은 사유가 필요합니다.");
      return;
    }
    if (action === "risk") markRisk(contract.id, reason.trim());
    if (action === "cancel") cancel(contract.id, reason.trim());
    setAction(null);
    setReason("");
    setError(null);
  }

  return (
    <li className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{clientName}</p>
          <p className="mt-0.5 text-xs text-muted">
            총액 {won(contract.grossAmount)} · {TERM_LABEL[contract.settlementTerm]}
          </p>
        </div>
        <Badge tone={STATUS_TONE[contract.status]}>{STATUS_LABEL[contract.status]}</Badge>
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted">
          {contract.status === "completed" ? "실수령액" : "예상 실수령액"}
        </span>
        <span className="tnum text-base font-semibold">
          {net.amount === null ? "추정 불가" : won(net.amount)}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge tone={net.tone}>{net.sourceLabel}</Badge>
        <span className="text-xs text-muted">
          {contract.status === "completed"
            ? `${dateLabel(contract.actualDate)} 입금`
            : `${dateLabel(contract.expectedDate)} 예정`}
        </span>
        {contract.expectedDateSource === "manual" && (
          <span className="text-xs text-muted">· 직접 입력</span>
        )}
      </div>

      {/* [이슈 #16] 참조율을 적용한 추정치일 때만 붙는다. 지급처 안내 금액에는 붙이지 않는다. */}
      {net.disclaimer && <p className="mt-2 text-xs text-muted">{net.disclaimer}</p>}

      {contract.statusReason && (
        <p className="mt-2 rounded-lg bg-surface-muted px-2.5 py-1.5 text-xs text-muted">
          사유 · {contract.statusReason}
        </p>
      )}

      {action === null ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {contract.status !== "risk" && contract.status !== "cancelled" && (
            <ActionButton onClick={() => setAction("risk")}>위험으로 지정</ActionButton>
          )}
          {contract.statusSource === "user" && contract.status === "risk" && (
            <ActionButton onClick={() => revert(contract.id)}>되돌리기</ActionButton>
          )}
          {contract.status !== "cancelled" && contract.status !== "completed" && (
            <ActionButton onClick={() => setAction("cancel")}>계약 취소</ActionButton>
          )}
          {/* [이슈 #55] 입금 확인 — 잠정값을 실제값으로 교체하고 공제율을 역산한다(3-9). */}
          {contract.status !== "cancelled" && contract.status !== "completed" && (
            <ActionButton onClick={() => setAction("payment")}>입금 확인</ActionButton>
          )}
        </div>
      ) : action === "payment" ? (
        <div className="mt-3 rounded-xl border border-line p-3">
          <p className="text-xs font-medium">입금 확인</p>
          <p className="mt-1 text-xs text-muted">
            통장에 실제로 찍힌 날짜와 금액을 넣어 주세요. 공제율은 총액과 실수령액으로
            역산합니다.
          </p>
          <label className="mt-2 block text-xs text-muted" htmlFor={`paid-date-${contract.id}`}>
            입금일
          </label>
          <input
            id={`paid-date-${contract.id}`}
            type="date"
            value={actualDate}
            onChange={(e) => setActualDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm"
          />
          <label className="mt-2 block text-xs text-muted" htmlFor={`paid-amount-${contract.id}`}>
            실제 입금액 (총액 {won(contract.grossAmount)})
          </label>
          <input
            id={`paid-amount-${contract.id}`}
            inputMode="numeric"
            value={actualNetAmount}
            onChange={(e) => setActualNetAmount(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="2320800"
            className="tnum mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm"
          />
          {error && (
            <p role="alert" className="mt-1.5 text-xs text-danger">
              {error}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={submit}
              className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background"
            >
              확인
            </button>
            <ActionButton
              onClick={() => {
                setAction(null);
                setActualNetAmount("");
                setError(null);
              }}
            >
              취소
            </ActionButton>
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-line p-3">
          <label className="text-xs font-medium" htmlFor={`reason-${contract.id}`}>
            {action === "risk" ? "위험으로 지정하는 사유" : "취소 사유"}
          </label>
          <input
            id={`reason-${contract.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="예: 거래처 연락 두절"
            className="mt-1.5 w-full rounded-lg border border-line bg-background px-3 py-2 text-sm"
          />
          {error && (
            <p role="alert" className="mt-1.5 text-xs text-danger">
              {error}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={submit}
              className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background"
            >
              저장
            </button>
            <ActionButton
              onClick={() => {
                setAction(null);
                setReason("");
                setError(null);
              }}
            >
              취소
            </ActionButton>
          </div>
        </div>
      )}
    </li>
  );
}

function ActionButton({
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
      className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}
