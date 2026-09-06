"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, Card, EmptyState } from "@/components/ui";
import { dateLabel, signedDays, won } from "@/lib/format";
import type { RecoveryFinding, RecoveryOption } from "@/engine/index";

type CopyState = "idle" | "copied" | "failed";

/** 복사 결과 표시를 유지하는 시간. 지나면 버튼이 원래 문구로 돌아온다. */
const COPY_FEEDBACK_MS = 2500;

export function RecoveryCards({ finding }: { finding: RecoveryFinding }) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 표시를 되돌리지 않으면 한 번 복사한 카드가 계속 "복사됨"이라, 다시 복사할 수
  // 있다는 게 보이지 않는다. 언마운트 시 남은 타이머를 정리한다.
  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  function markCopyResult(key: string, state: CopyState) {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setCopiedKey(key);
    setCopyState(state);
    resetTimer.current = setTimeout(() => {
      setCopiedKey(null);
      setCopyState("idle");
    }, COPY_FEEDBACK_MS);
  }

  async function copy(option: RecoveryOption) {
    const draft = buildRequestDraft(option);
    try {
      await navigator.clipboard.writeText(draft);
      markCopyResult(option.assumption.label, "copied");
    } catch {
      // 클립보드 권한이 없거나 비보안 컨텍스트면 던진다. 문구는 화면에 이미 떠 있으니
      // 사용자가 직접 복사할 수 있다는 것만 알린다.
      markCopyResult(option.assumption.label, "failed");
    }
  }

  return (
    <Card
      title="무엇을 바꿔야 할까요?"
      aside={finding.dDay ? `${dateLabel(finding.dDay)} 기준` : "90일 이상"}
    >
      {finding.options.length === 0 ? (
        <EmptyState
          title="지금은 제안할 대응안이 없어요"
          description={finding.emptyReason ?? "현재 조건에서 계산 가능한 대응안을 찾지 못했습니다."}
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-3">
          {finding.options.map((option) => {
            const key = option.assumption.label;
            const copied = copiedKey === key;
            const draft = buildRequestDraft(option);
            return (
              <li key={key} className="rounded-xl border border-line bg-surface-muted p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted">{categoryLabel(option)}</p>
                    <h3 className="mt-1 text-sm font-semibold leading-snug">
                      {summaryLabel(option)}
                    </h3>
                  </div>
                  <Badge tone="safe">{signedDays(option.dayDelta)}</Badge>
                </div>

                <p className="mt-2 text-xs text-muted">
                  {dateLabel(option.dDayBefore)} → {dateLabel(option.dDayAfter)}
                </p>

                <ul className="mt-3 flex flex-col gap-1.5">
                  {option.rationale.map((line) => (
                    <li key={line} className="text-xs text-muted">
                      {line}
                    </li>
                  ))}
                </ul>

                <div className="mt-3 rounded-lg border border-line bg-surface p-3">
                  <p className="line-clamp-4 whitespace-pre-line text-xs leading-relaxed">
                    {draft}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => void copy(option)}
                  className="mt-3 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm font-medium hover:border-accent"
                >
                  {copied ? (copyState === "copied" ? "복사됨" : "직접 복사 필요") : "요청 문구 복사"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">
        실제 입금이나 결제 변경은 실행하지 않습니다. 엔진이 계산한 가정을 복사 가능한 요청 문구로만 바꿉니다.
      </p>
    </Card>
  );
}

function summaryLabel(option: RecoveryOption): string {
  const assumption = option.assumption;
  if (assumption.type === "advance_payment") {
    return `${won(assumption.amount)} 선금 · ${dateLabel(option.latestDate ?? assumption.date)}까지`;
  }
  if (assumption.type === "delay_outflow") {
    return `${assumption.label} · ${dateLabel(assumption.newDate)}까지`;
  }
  return `${won(assumption.monthlyReduction)} 줄이기`;
}

function categoryLabel(option: RecoveryOption): string {
  if (option.assumption.type === "advance_payment") return "거래처에 선금 요청";
  if (option.assumption.type === "delay_outflow") return "결제일 변경 요청";
  return "이번 달 지출 줄이기";
}

function buildRequestDraft(option: RecoveryOption): string {
  const assumption = option.assumption;
  const effect = effectText(option);
  if (assumption.type === "advance_payment") {
    const date = dateLabel(option.latestDate ?? assumption.date);
    return [
      "안녕하세요.",
      `현금흐름 확인 결과 ${date}까지 ${won(assumption.amount)} 선입금이 가능하면 ${effect}`,
      "가능 여부 확인 부탁드립니다.",
    ].join("\n");
  }
  if (assumption.type === "delay_outflow") {
    return [
      "안녕하세요.",
      `결제일을 ${dateLabel(assumption.newDate)}까지 조정할 수 있을지 확인 부탁드립니다.`,
      `조정되면 ${effect}`,
    ].join("\n");
  }
  return [
    `이번 달 고정 지출에서 ${won(assumption.monthlyReduction)}을 줄이면 ${effect}`,
    "우선순위가 낮은 지출부터 보류하겠습니다.",
  ].join("\n");
}

function effectText(option: RecoveryOption): string {
  if (option.dDayAfter === null) return "90일 안에서는 D-day가 사라집니다.";
  return `D-day가 ${dateLabel(option.dDayAfter)}로 ${option.dayDelta}일 늦춰집니다.`;
}
