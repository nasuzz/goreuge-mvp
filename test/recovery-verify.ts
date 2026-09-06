// test/recovery-verify.ts — 이슈 #50 회귀 검증
//
// 두 가지를 고정한다.
//   1. compareWhatIfCombined — 조합은 개별 delta의 합이 아니다
//   2. findRecovery — 탐색 결과 스냅샷(기준 / 위험 전환 후 / 잔액 넉넉)
//
// 여기 적힌 기대값은 손으로 쓴 게 아니라 전부 엔진 실측이고, 이슈 #50에
// @nasuzz-dev가 `compareWhatIf`로 재현 확인한 값과 같다. 초안에서 손으로 쓴
// 예시 두 줄이 틀렸던 전례가 있어서(#50 3절) 이 파일은 실측만 담는다.

import { MOCK_ENGINE_INPUT } from "../src/shared/mock-data";
import {
  compareWhatIf, compareWhatIfCombined, findRecovery, markContractAsRisk, runScenario,
} from "../src/engine/index";
import { addDays } from "../src/engine/scenarioDate";
import type { EngineInput, WhatIfAssumption } from "../src/shared/types";

const NOW = "2026-09-01T09:00:00+09:00";

let failCount = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failCount++;
  console.log(`${pass ? "✅" : "❌"} ${label}`);
  if (!pass) console.log(`     actual=${JSON.stringify(actual)}\n     expected=${JSON.stringify(expected)}`);
}

const BASE: EngineInput = MOCK_ENGINE_INPUT;

// 데모 1:35 비트와 같은 상태 — contract-002를 사용자가 위험으로 지정한 뒤.
const RISKY: EngineInput = {
  ...BASE,
  contracts: BASE.contracts.map((c) =>
    c.id === "contract-002" ? markContractAsRisk(c, "회귀 테스트", NOW) : c),
};

const RICH: EngineInput = { ...BASE, user: { ...BASE.user, totalBalance: 50_000_000 } };

function delta(input: EngineInput, assumption: WhatIfAssumption): number {
  return compareWhatIf(input, [assumption], NOW)[0].dayDelta;
}

const advance = (amount: number, date: string): WhatIfAssumption =>
  ({ type: "advance_payment", label: `선금 ${amount}`, amount, date });

console.log("\n── 전제: 두 기준 상태의 D-day ──────────────────────");
check("기준 D-day", runScenario(BASE, "baseline").dDay, "2026-09-30");
check("위험 전환 후 D-day", runScenario(RISKY, "baseline").dDay, "2026-09-14");

console.log("\n── 1. 사용자가 감으로 맞힐 수 없다는 근거 (#8, #50) ──");
// 기획서가 예시로 쓴 숫자가 실제로는 0일이었다. 이 이슈의 출발점이라 고정한다.
check(
  "위험 전환 후 선금 500,000원 @ 9/15 → +0일 (그날 유출 820,000원을 못 넘김)",
  delta(RISKY, advance(500_000, "2026-09-15")),
  0,
);
// 초안이 "+0일"이라고 잘못 적었던 값. 실측은 +4일이다(#50 3절).
check(
  "위험 전환 후 선금 700,000원 @ 9/13 → +4일 (초안이 틀렸던 값)",
  delta(RISKY, advance(700_000, "2026-09-13")),
  4,
);

console.log("\n── 2. 조합은 덧셈이 아니다 (compareWhatIfCombined) ──");
const big = advance(1_500_000, "2026-09-14");
const cardDelay: WhatIfAssumption = {
  type: "delay_outflow", label: "카드 결제 연기", outflowId: "outflow-002", newDate: "2026-09-28",
};
check("선금 1,500,000원 단독 → +24일", delta(RISKY, big), 24);
check("카드 결제 연기 단독 → +6일", delta(RISKY, cardDelay), 6);
// 24 + 6 = 30이 아니다. 선금만으로 D-day가 10/8까지 밀리면 9/14 카드 청구는
// 더 이상 병목이 아니라서 연기 효과가 통째로 사라진다.
check(
  "둘 다 적용 → +24일 (합산 30일이 아님)",
  compareWhatIfCombined(RISKY, [big, cardDelay], NOW).dayDelta,
  24,
);
check(
  "조합 결과의 D-day도 선금 단독과 같다",
  compareWhatIfCombined(RISKY, [big, cardDelay], NOW).dDayAfter,
  "2026-10-08",
);
check("가정 0개면 기준선 그대로", compareWhatIfCombined(RISKY, [], NOW).dayDelta, 0);
check(
  "최대 개수(3) 초과면 throw",
  (() => {
    try {
      compareWhatIfCombined(RISKY, [big, cardDelay, big, cardDelay], NOW);
      return false;
    } catch {
      return true;
    }
  })(),
  true,
);

console.log("\n── 3. findRecovery 스냅샷 ──────────────────────────");

function snapshot(input: EngineInput) {
  const finding = findRecovery(input, NOW);
  return {
    dDay: finding.dDay,
    options: finding.options.map((o) => ({
      type: o.assumption.type,
      label: o.assumption.label,
      dayDelta: o.dayDelta,
      latestDate: o.latestDate,
      dDayAfter: o.dDayAfter,
    })),
    emptyReason: finding.emptyReason,
  };
}

// 선택 정책(#50): 선금은 효과 기준(7일까지 올림), 유출 연기·지출 절감은 최소 기준.
// 그래서 카드 연기는 +14일이 나오는 30일이 아니라 하한을 처음 넘긴 21일(+5일)을,
// 지출 절감은 +1일짜리 50,000원이 아니라 100,000원(+3일)을 고른다.
check("기준 상태 탐색 결과", snapshot(BASE), {
  dDay: "2026-09-30",
  options: [
    { type: "advance_payment", label: "선금 300,000원", dayDelta: 8, latestDate: "2026-09-30", dDayAfter: "2026-10-08" },
    { type: "delay_outflow", label: "신용카드 결제 21일 연기", dayDelta: 5, latestDate: null, dDayAfter: "2026-10-05" },
    { type: "reduce_spending", label: "월 지출 100,000원 절감", dayDelta: 3, latestDate: null, dDayAfter: "2026-10-03" },
  ],
  emptyReason: null,
});

check("위험 전환 후 탐색 결과", snapshot(RISKY), {
  dDay: "2026-09-14",
  options: [
    { type: "advance_payment", label: "선금 800,000원", dayDelta: 7, latestDate: "2026-09-14", dDayAfter: "2026-09-21" },
    { type: "delay_outflow", label: "신용카드 결제 7일 연기", dayDelta: 6, latestDate: null, dDayAfter: "2026-09-20" },
  ],
  emptyReason: null,
});

check("잔액이 넉넉하면 제안하지 않는다", snapshot(RICH), {
  dDay: null,
  options: [],
  emptyReason: "지금 계획으로는 90일 안에 잔액이 바닥나지 않아요. 되돌릴 조건을 찾을 필요가 없습니다.",
});

console.log("\n── 4. 불변식 ──────────────────────────────────────");
for (const [name, input] of [["기준", BASE], ["위험 전환 후", RISKY]] as const) {
  const finding = findRecovery(input, NOW);
  check(`${name}: 옵션 수가 최대 3개 이하`, finding.options.length <= 3, true);
  check(`${name}: 모든 옵션의 dayDelta > 0`, finding.options.every((o) => o.dayDelta > 0), true);
  check(
    `${name}: dayDelta 내림차순 정렬`,
    finding.options.every((o, i, arr) => i === 0 || arr[i - 1].dayDelta >= o.dayDelta),
    true,
  );
  // 제안한 가정을 그대로 엔진에 다시 넣으면 같은 숫자가 나와야 한다.
  // 화면이 "가정해 보기"를 누르면 실제로 이 경로를 탄다.
  check(
    `${name}: 제안한 가정을 다시 평가해도 같은 dayDelta`,
    finding.options.map((o) => delta(input, o.assumption)),
    finding.options.map((o) => o.dayDelta),
  );
  // latestDate는 "효과가 있는 가장 늦은 날"이므로 그 다음 날은 효과가 없어야 한다.
  for (const option of finding.options) {
    if (option.assumption.type !== "advance_payment" || option.latestDate === null) continue;
    const nextDay = new Date(`${option.latestDate}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const after = nextDay.toISOString().slice(0, 10);
    check(
      `${name}: ${option.latestDate} 다음 날(${after})에는 효과가 사라진다`,
      delta(input, advance(option.assumption.amount, after)) > 0,
      false,
    );
  }
}

console.log("\n── 5. 합성 입력 — PR #58 리뷰(hsoo23) 지적 2건 ─────");

// mock 스냅샷만으로는 아래 두 케이스가 안 나온다. 합성 현금흐름으로 고정한다.
//   - 금액이 가장 큰 유출이 병목이 아닌 경우 (1위만 보면 유출 연기 카드를 통째로 놓친다)
//   - 가정 덕분에 90일 내 D-day가 사라지는 경우 (dDayAfter가 null)
const SYNTHETIC: EngineInput = {
  today: "2026-09-01",
  user: {
    id: "synthetic-user",
    totalBalance: 2_000_000,
    monthlyFixedOutflow: 0, // 일일 베이스라인 차감을 0으로 둬야 아래 두 유출만 남는다
    safetyBuffer: 0,
    taxReserveRate: 0,
    createdAt: NOW,
    updatedAt: NOW,
  },
  contracts: [],
  clients: [],
  savings: [],
  outflows: [
    // 금액은 크지만 D-day(10/5)보다 한참 앞이라 30일을 미뤄도 여전히 앞에서 빠진다.
    {
      id: "outflow-big", kind: "기타", name: "초기 큰 지출", amount: 1_500_000,
      dueDate: "2026-09-02", recurrence: "once", includedInBaseline: false,
    },
    // 금액은 작지만 이게 D-day를 만드는 병목이다.
    {
      id: "outflow-small", kind: "기타", name: "후반 작은 지출", amount: 600_000,
      dueDate: "2026-10-05", recurrence: "once", includedInBaseline: false,
    },
  ],
};

check("합성: baseline D-day", runScenario(SYNTHETIC, "baseline").dDay, "2026-10-05");

// 금액 1위(초기 큰 지출)는 사다리 전체를 훑어도 D-day를 못 움직인다.
check(
  "합성: 초기 큰 지출은 7/14/21/30일 어느 쪽으로 미뤄도 +0일",
  [7, 14, 21, 30].map((days) => delta(SYNTHETIC, {
    type: "delay_outflow", label: "초기 큰 지출", outflowId: "outflow-big",
    newDate: addDays("2026-09-02", days),
  })),
  [0, 0, 0, 0],
);

const syntheticFinding = findRecovery(SYNTHETIC, NOW);
const syntheticDelay = syntheticFinding.options.find((o) => o.assumption.type === "delay_outflow");

check("합성: 유출 연기 카드를 놓치지 않는다", syntheticDelay !== undefined, true);
check(
  "합성: 금액 1위가 아니라 병목인 작은 유출을 고른다",
  syntheticDelay && syntheticDelay.assumption.type === "delay_outflow"
    ? { outflowId: syntheticDelay.assumption.outflowId, dayDelta: syntheticDelay.dayDelta }
    : null,
  { outflowId: "outflow-small", dayDelta: 7 },
);

// D-day가 사라지는 경우 rationale에 "null"이 새면 안 된다.
const syntheticAdvance = syntheticFinding.options.find((o) => o.assumption.type === "advance_payment");
// dDayAfter가 null인 것 자체가 확인 대상이므로 ?? 로 기본값을 씌우면 안 된다.
check(
  "합성: 선금 가정이 D-day를 90일 밖으로 밀어낸다",
  syntheticAdvance === undefined ? "선금 옵션 없음" : syntheticAdvance.dDayAfter,
  null,
);
check(
  "합성: 어떤 문구에도 null이 새지 않는다",
  syntheticFinding.options.some((o) => o.rationale.some((line) => line.includes("null"))),
  false,
);
check(
  "합성: D-day가 사라지면 그렇게 말한다",
  syntheticAdvance?.rationale[0],
  "200,000원이 2026-10-05까지 들어오면 90일 안에서는 D-day가 사라져요.",
);

console.log("\n── 6. 선택 정책이 실제로 다르게 동작하는가 (#50) ───");

// 세 가정은 "요구를 키울 때 드는 비용"이 달라 선택 기준을 달리 뒀다.
// 그 차이가 출력에 실제로 나타나는지 고정한다. 통일 기준으로 되돌리면 깨진다.
{
  const finding = findRecovery(BASE, NOW);
  const advanceOpt = finding.options.find((o) => o.assumption.type === "advance_payment");
  const delayOpt = finding.options.find((o) => o.assumption.type === "delay_outflow");
  const reduceOpt = finding.options.find((o) => o.assumption.type === "reduce_spending");

  // 선금: 효과 기준. 100,000원(+3일)도 하한은 넘지만 7일 목표까지 올려 300,000원(+8일)을 고른다.
  check("선금은 하한을 넘는 최소값이 아니라 목표(7일)를 넘는 값을 고른다", advanceOpt?.dayDelta, 8);
  check("선금 하한값 100,000원도 효과는 있다(그래도 안 고른다)", delta(BASE, advance(100_000, "2026-09-02")), 3);

  // 유출 연기: 최소 기준. 30일이면 +14일이지만 21일(+5일)에서 멈춘다 — 더 미루면 이자를 낸다.
  check("유출 연기는 효과가 더 큰 30일이 아니라 하한을 넘긴 21일을 고른다", delayOpt?.dayDelta, 5);
  check("30일을 미루면 실제로 효과는 더 크다(그래도 안 고른다)", delta(BASE, {
    type: "delay_outflow", label: "신용카드 결제", outflowId: "outflow-002", newDate: addDays("2026-09-14", 30),
  }), 14);

  // 지출 절감: 최소 기준 + 하한. 50,000원(+1일)은 하한 미달이라 후보에서 빠진다.
  check("지출 절감에서 +1일짜리(50,000원)는 후보가 아니다", reduceOpt?.dayDelta, 3);
  check("50,000원도 효과 자체는 있다(하한 미달이라 뺀 것)", delta(BASE, {
    type: "reduce_spending", label: "월 지출 절감", monthlyReduction: 50_000,
  }), 1);

  check("모든 옵션이 하한(3일) 이상", finding.options.every((o) => o.dayDelta >= 3), true);
}

console.log("\n── 7. 이분 탐색의 전제 — 단조성 ───────────────────");

// findLatestEffectiveDate는 "같은 금액이면 늦게 들어올수록 효과가 같거나 작다"에
// 기대어 이분 탐색을 한다. 이게 깨지면 latestDate가 조용히 틀린 날짜가 된다.
// 엔진이 바뀌어도 전제가 유지되는지 여기서 잡는다.
for (const [name, input] of [["기준", BASE], ["위험 전환 후", RISKY]] as const) {
  for (const amount of [100_000, 300_000, 800_000, 1_500_000, 3_000_000]) {
    const series: number[] = [];
    for (let offset = 1; offset <= 60; offset += 1) {
      series.push(delta(input, advance(amount, addDays("2026-09-01", offset))));
    }
    const rising = series.filter((v, i) => i > 0 && v > series[i - 1]).length;
    check(`${name} ${amount.toLocaleString("ko-KR")}원: 날짜가 늦어질수록 효과가 늘지 않는다`, rising, 0);
  }
}

console.log("\n── 8. 결정성 ──────────────────────────────────────");
check(
  "같은 입력이면 항상 같은 결과",
  JSON.stringify(findRecovery(RISKY, NOW)),
  JSON.stringify(findRecovery(RISKY, NOW)),
);
check(
  "합성 입력도 결정적",
  JSON.stringify(findRecovery(SYNTHETIC, NOW)),
  JSON.stringify(findRecovery(SYNTHETIC, NOW)),
);

console.log("\n" + (failCount === 0 ? `✅ findRecovery 회귀 전부 통과 (${failCount}건 실패)` : `❌ ${failCount}건 실패`));
process.exit(failCount === 0 ? 0 : 1);
