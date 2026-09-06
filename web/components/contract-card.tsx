"use client";

import { useState } from "react";
import {
  createReminderDraft,
  type ReminderChannel,
  type ReminderDraft,
  type ReminderTone,
} from "@/ai/reminder-draft";
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
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderTone, setReminderTone] = useState<ReminderTone>("soft");
  const [reminderChannel, setReminderChannel] = useState<ReminderChannel>("message");
  const [reminderDraft, setReminderDraft] = useState<ReminderDraft | null>(null);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  function generateReminder(tone: ReminderTone, channel: ReminderChannel) {
    try {
      const result = createReminderDraft(input, {
        contractId: contract.id,
        tone,
        channel,
      });
      setReminderDraft(result.draft);
      setReminderError(null);
      setCopied(false);
      return result;
    } catch {
      setReminderDraft(null);
      setReminderError("독촉 초안을 만들 수 없는 계약입니다.");
      return null;
    }
  }

  function openReminder() {
    const initial = generateReminder("soft", reminderChannel);
    const tone = initial?.recommendedTone ?? "soft";
    setReminderTone(tone);
    if (tone !== "soft") generateReminder(tone, reminderChannel);
    setReminderOpen(true);
  }

  function changeTone(tone: ReminderTone) {
    setReminderTone(tone);
    generateReminder(tone, reminderChannel);
  }

  function changeChannel(channel: ReminderChannel) {
    setReminderChannel(channel);
    generateReminder(reminderTone, channel);
  }

  async function copyReminder() {
    if (!reminderDraft) return;
    const text = reminderDraft.subject
      ? `${reminderDraft.subject}\n\n${reminderDraft.body}`
      : reminderDraft.body;
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

  return (
    <li className="relative overflow-hidden rounded-2xl border border-white/75 bg-white/82 p-4 shadow-[0_8px_0_rgba(244,201,79,0.2),0_18px_28px_rgba(128,106,45,0.12),inset_0_2px_0_rgba(255,255,255,0.9)]">
      <span
        className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,var(--accent),var(--accent-warm),var(--deep-lemon))]"
        aria-hidden
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{clientName}</p>
          <p className="mt-0.5 text-xs text-muted">
            총액 {won(contract.grossAmount)} · {TERM_LABEL[contract.settlementTerm]}
          </p>
        </div>
        <Badge tone={STATUS_TONE[contract.status]}>{STATUS_LABEL[contract.status]}</Badge>
      </div>

      <div className="mt-4 rounded-2xl bg-[linear-gradient(135deg,var(--accent-warm-soft),var(--cream-soft))] px-3 py-2.5 shadow-[inset_0_2px_0_rgba(255,255,255,0.75)] ring-1 ring-white/70">
        <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted">
          {contract.status === "completed" ? "실수령액" : "예상 실수령액"}
        </span>
        <span className="tnum text-lg font-semibold">
          {net.amount === null ? "추정 불가" : won(net.amount)}
        </span>
        </div>
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
          {(contract.status === "delayed" || contract.status === "risk") && (
            <ActionButton onClick={openReminder}>독촉 문구 만들기</ActionButton>
          )}
        </div>
      ) : action === "payment" ? (
        <div className="mt-3 rounded-lg border border-line p-3">
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
              className="rounded-lg bg-accent-strong px-3 py-1.5 text-xs font-semibold text-white"
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
        <div className="mt-3 rounded-lg border border-line p-3">
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
              className="rounded-lg bg-accent-strong px-3 py-1.5 text-xs font-semibold text-white"
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

      {reminderOpen && (
        <div className="mt-3 rounded-lg border border-line p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold">독촉 초안</p>
              <p className="mt-0.5 text-xs text-muted">
                자동 발송하지 않습니다. 내용 확인 후 복사만 할 수 있습니다.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setReminderOpen(false)}
              className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:text-foreground"
            >
              닫기
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <SegmentedControl
              label="어조"
              value={reminderTone}
              options={[
                ["soft", "부드럽게"],
                ["standard", "일반"],
                ["firm", "단호하게"],
              ]}
              onChange={(value) => changeTone(value as ReminderTone)}
            />
            <SegmentedControl
              label="채널"
              value={reminderChannel}
              options={[
                ["message", "카톡"],
                ["email", "메일"],
              ]}
              onChange={(value) => changeChannel(value as ReminderChannel)}
            />
          </div>

          {reminderError && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {reminderError}
            </p>
          )}

          {reminderDraft && (
            <>
              {reminderDraft.subject && (
                <div className="mt-3 rounded-lg bg-surface-muted px-3 py-2 text-sm">
                  <span className="text-xs text-muted">제목 · </span>
                  {reminderDraft.subject}
                </div>
              )}
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-surface-muted px-3 py-2 text-sm leading-6 font-sans">
                {reminderDraft.body}
              </pre>
              <p className="mt-2 text-xs text-muted">{reminderDraft.toneReason}</p>
              <dl className="mt-3 grid grid-cols-2 gap-2">
                {reminderDraft.facts.map((fact) => (
                  <div key={fact.label} className="rounded-lg border border-line px-2.5 py-2">
                    <dt className="text-[11px] text-muted">{fact.label}</dt>
                    <dd className="tnum mt-0.5 text-xs font-medium">{fact.value}</dd>
                  </div>
                ))}
              </dl>
              <button
                type="button"
                onClick={copyReminder}
                className="mt-3 w-full rounded-lg bg-accent-strong px-3 py-2 text-xs font-semibold text-white"
              >
                {copied ? "복사됨" : "복사하기"}
              </button>
            </>
          )}
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

function SegmentedControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium text-muted">{label}</p>
      <div className="grid grid-cols-[repeat(var(--segment-count),minmax(0,1fr))] rounded-lg border border-line p-0.5" style={{ "--segment-count": options.length } as React.CSSProperties}>
        {options.map(([key, text]) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={value === key}
            className={`rounded-md px-2 py-1.5 text-xs ${
              value === key ? "bg-accent-strong text-white" : "text-muted hover:text-foreground"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
