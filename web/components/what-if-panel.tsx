"use client";

import { useState } from "react";
import { formatWhatIfMessage } from "@/engine/index";
import { MOCK } from "@/shared/mock-data";
import { Card } from "@/components/ui";
import { dateLabel, signedDays } from "@/lib/format";
import { useMockStore } from "@/lib/mock/store";
import { MVP_POLICY } from "@/shared/policy";
import type { WhatIfAssumption, WhatIfResult } from "@/shared/types";

const PRESETS = MOCK.whatIfExamples as readonly WhatIfAssumption[];

export function WhatIfPanel() {
  const { runWhatIf } = useMockStore();
  const [selected, setSelected] = useState<number[]>([0]);
  const [results, setResults] = useState<WhatIfResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const max = MVP_POLICY.maxWhatIfAssumptions;

  function toggle(index: number) {
    setResults(null);
    setError(null);
    setSelected((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
  }

  function simulate() {
    if (selected.length === 0) {
      setError("가정을 한 개 이상 선택해 주세요.");
      setResults(null);
      return;
    }
    try {
      setResults(runWhatIf(selected.map((i) => PRESETS[i])));
      setError(null);
    } catch (e) {
      // 엔진이 최대 개수를 직접 막는다. 메시지를 그대로 보여준다.
      setError(e instanceof Error ? e.message : "가정을 계산하지 못했습니다.");
      setResults(null);
    }
  }

  return (
    <Card title="대응안 비교" aside={`최대 ${max}개`}>
      <ul className="flex flex-col gap-2">
        {PRESETS.map((preset, index) => {
          const checked = selected.includes(index);
          return (
            <li key={preset.label}>
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  checked
                    ? "border-white/80 bg-[linear-gradient(135deg,var(--accent-soft),var(--lavender-soft))] shadow-[inset_0_2px_0_rgba(255,255,255,0.86),0_12px_20px_rgba(255,85,173,0.13)]"
                    : "border-white/70 bg-white/72 hover:bg-surface-raised"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(index)}
                  className="mt-0.5 size-4 accent-[var(--accent)]"
                />
                <span className="text-sm">{preset.label}</span>
              </label>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={simulate}
        className="mt-3 w-full rounded-lg bg-accent-strong px-4 py-3 text-sm font-semibold text-white"
      >
        가정해 보기
      </button>
      <p className="mt-2 text-xs text-muted">
        가정을 눌러도 실제로 적용되지 않습니다. 계산 결과만 비교합니다.
      </p>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-danger-bg px-3 py-2.5 text-sm text-danger"
        >
          {error}
        </p>
      )}

      {results && results.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
          {results.map((result) => (
            <li
              key={result.assumption.label}
              className="rounded-2xl border border-white/70 bg-white/76 p-3 shadow-[0_10px_18px_rgba(54,125,255,0.1)]"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{result.assumption.label}</span>
                <span
                  className={`tnum text-sm font-semibold ${
                    result.dayDelta > 0
                      ? "text-safe"
                      : result.dayDelta < 0
                        ? "text-danger"
                        : "text-muted"
                  }`}
                >
                  {signedDays(result.dayDelta)}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">{formatWhatIfMessage(result)}</p>
              <p className="mt-1 text-xs text-muted">
                {dateLabel(result.dDayBefore)} → {dateLabel(result.dDayAfter)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
