// test/whatif-verify.ts
import { MOCK_ENGINE_INPUT, EXPECTED, MOCK } from "../src/shared/mock-data";
import { runAllScenarios, compareWhatIf, recalculateContractStatus, markContractAsRisk, splitDelayedMonthlyOutflow, buildOutflowSchedule } from "../src/engine/index";
import type { WhatIfAssumption, Outflow } from "../src/shared/types";

let failCount = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failCount++;
  console.log(`${pass ? "✅" : "❌"} ${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

// [hsoo23 리뷰 반영] today(YYYY-MM-DD)와 now(ISO 8601)를 분리 — 테스트용 합성 시각.
const NOW = "2026-09-01T09:00:00+09:00";
const NOW_FAR_FUTURE = "2026-11-01T09:00:00+09:00";
const NOW_YEAR_END = "2026-12-31T09:00:00+09:00";

console.log("── compareWhatIf: mock-data.json의 whatIfExamples 3종을, 격리 상태(위험 전환 전)에서 그대로 실행 ──");
const isolatedResults = compareWhatIf(MOCK_ENGINE_INPUT, MOCK.whatIfExamples as WhatIfAssumption[], NOW);
for (const r of isolatedResults) {
  console.log(`  [${r.assumption.type}] before=${r.dDayBefore} after=${r.dDayAfter} dayDelta=${r.dayDelta}`);
}

console.log("── compareWhatIf: 실제 데모 순서(1:35 위험 전환 → 2:00 대응안)로 체이닝해서 실행 (#8) ──");
{
  // 1:35과 동일한 입력을 만든다 — contract-002를 위험으로 전환한 "이후" 상태.
  const chainedInput = structuredClone(MOCK_ENGINE_INPUT);
  const idx = chainedInput.contracts.findIndex((c) => c.id === "contract-002");
  chainedInput.contracts[idx] = markContractAsRisk(chainedInput.contracts[idx], "60일 이상 지연 예상, 수동 위험 지정", NOW);

  const chainedResults = compareWhatIf(chainedInput, MOCK.whatIfExamples as WhatIfAssumption[], NOW);
  for (const r of chainedResults) {
    console.log(`  [${r.assumption.type}] before=${r.dDayBefore} after=${r.dDayAfter} dayDelta=${r.dayDelta}`);
  }

  const advanceResult = chainedResults.find((r) => r.assumption.type === "advance_payment")!;
  check("advancePayment1M.after (1:35 이후 이어서 적용, EXPECTED.demoBeats 대조)", advanceResult.dDayAfter, EXPECTED.demoBeats.advancePayment1M.after);
  check("advancePayment1M.dayDelta", advanceResult.dayDelta, (EXPECTED.demoBeats.advancePayment1M as any).daysRecovered);

  const delayResult = chainedResults.find((r) => r.assumption.type === "delay_outflow")!;
  check("delayCardPayment2Weeks.after (1:35 이후 이어서 적용, EXPECTED.demoBeats 대조)", delayResult.dDayAfter, EXPECTED.demoBeats.delayCardPayment2Weeks.after);
  check("delayCardPayment2Weeks.dayDelta", delayResult.dayDelta, (EXPECTED.demoBeats.delayCardPayment2Weeks as any).daysRecovered);
}

console.log("\n── 원본 input 불변 확인 (compareWhatIf 실행 후) ──");
check("contracts.length 원본 유지", MOCK_ENGINE_INPUT.contracts.length, 7);
check("outflows[1].dueDate 원본 유지", MOCK_ENGINE_INPUT.outflows[1].dueDate, "2026-09-14");
check("user.monthlyFixedOutflow 원본 유지", MOCK_ENGINE_INPUT.user.monthlyFixedOutflow, 1200000);

console.log("── recalculateContractStatus: 60일 이상 지난 waiting은 한 번의 호출로 바로 risk (hsoo23 리뷰) ──");
{
  const c1 = MOCK.contracts.find((c) => c.id === "contract-001")!;
  const severelyOverdue = { ...c1, status: "waiting" as const, expectedDate: "2026-06-28" }; // today=2026-09-01 기준 65일 경과
  const recalced = recalculateContractStatus(severelyOverdue, MOCK_ENGINE_INPUT.today, NOW);
  check("waiting -> risk 즉시 전이 (delayed를 거치지 않음)", recalced.status, "risk");
  check("statusSource는 system", recalced.statusSource, "system");
  check("statusUpdatedAt에 now(ISO 8601)가 찍힘", recalced.statusUpdatedAt, NOW);
}
{
  const c1 = MOCK.contracts.find((c) => c.id === "contract-001")!;
  const exactlySixty = { ...c1, status: "waiting" as const, expectedDate: "2026-07-03" }; // 60일 경과 경계값
  const recalced = recalculateContractStatus(exactlySixty, MOCK_ENGINE_INPUT.today, NOW);
  check("정확히 60일 경과한 waiting도 risk (경계값)", recalced.status, "risk");
}
{
  const c1 = MOCK.contracts.find((c) => c.id === "contract-001")!;
  const fiftyNine = { ...c1, status: "waiting" as const, expectedDate: "2026-07-04" }; // 59일 경과
  const recalced = recalculateContractStatus(fiftyNine, MOCK_ENGINE_INPUT.today, NOW);
  check("59일 경과는 아직 delayed (60일 미만)", recalced.status, "delayed");
}

console.log("\n── recalculateContractStatus: contract-001(waiting, 예정일 10-31, 아직 안 지남) ──");
{
  const c1 = MOCK.contracts.find((c) => c.id === "contract-001")!;
  const recalced = recalculateContractStatus(c1, MOCK_ENGINE_INPUT.today, NOW);
  check("contract-001 상태 변화 없음(예정일 전)", recalced.status, "waiting");
}

console.log("── recalculateContractStatus: 예정일을 오늘 이전으로 바꾼 가짜 계약 (waiting → delayed) ──");
{
  const c1 = MOCK.contracts.find((c) => c.id === "contract-001")!;
  const overdue = { ...c1, expectedDate: "2026-08-01" };
  const recalced = recalculateContractStatus(overdue, MOCK_ENGINE_INPUT.today, NOW);
  check("waiting → delayed 자동 전이", recalced.status, "delayed");
  check("statusSource는 system", recalced.statusSource, "system");
}

console.log("── recalculateContractStatus: delayed 상태, 60일 이상 경과 (delayed → risk) ──");
{
  const c2 = MOCK.contracts.find((c) => c.id === "contract-002")!;
  // [이슈 #69 수정] contract-002 expectedDate = 2026-08-31(이전엔 08-22로 잘못 저장돼 있었음),
  // today = 2026-09-01 → 1일 경과, 아직 60일 미만
  const stillDelayed = recalculateContractStatus(c2, MOCK_ENGINE_INPUT.today, NOW);
  check("아직 60일 미만이면 delayed 유지", stillDelayed.status, "delayed");

  const farFuture = "2026-11-01"; // 2026-08-31 대비 62일 경과
  const becameRisk = recalculateContractStatus(c2, farFuture, NOW_FAR_FUTURE);
  check("60일 이상 경과 시 delayed → risk", becameRisk.status, "risk");
  check("자동 전이의 statusSource는 system", becameRisk.statusSource, "system");
}

console.log("── statusSource='user'인 계약은 자동전이가 덮어쓰지 않음 (contract-006, 취소/user) ──");
{
  const c6 = MOCK.contracts.find((c) => c.id === "contract-006")!;
  const recalced = recalculateContractStatus(c6, "2026-12-31", NOW_YEAR_END);
  check("user 지정 상태 그대로 유지", recalced.status, "cancelled");
  check("statusSource 그대로 user", recalced.statusSource, "user");
}

console.log("── markContractAsRisk: 사유 없이 호출하면 throw ──");
{
  const c1 = MOCK.contracts.find((c) => c.id === "contract-001")!;
  let threw = false;
  try {
    markContractAsRisk(c1, "", NOW);
  } catch {
    threw = true;
  }
  check("빈 사유는 throw", threw, true);
}

console.log("── markContractAsRisk 이후 recalculateContractStatus가 덮어쓰지 않는지 (핵심 원칙) ──");
{
  const c1 = MOCK.contracts.find((c) => c.id === "contract-001")!;
  const marked = markContractAsRisk(c1, "고객 연락 두절", NOW);
  check("markContractAsRisk 직후 상태", marked.status, "risk");
  check("markContractAsRisk 직후 statusSource", marked.statusSource, "user");
  check("markContractAsRisk의 statusUpdatedAt도 now(ISO 8601)", marked.statusUpdatedAt, NOW);
  const recalced = recalculateContractStatus(marked, "2026-12-31", NOW_YEAR_END); // 시간이 한참 지나도
  check("자동 전이가 수동 지정을 덮어쓰지 않음", recalced.status, "risk");
  check("statusReason 유지", recalced.statusReason, "고객 연락 두절");
}

console.log("── delay_outflow: monthly 항목을 미뤄도 다음 회차부터는 원래 일자 유지 (hsoo23 리뷰, 최소 2개월 검증) ──");
{
  const cardOutflow: Outflow = {
    id: "outflow-card-test",
    kind: "card",
    name: "카드값",
    amount: 780000,
    dueDate: "2026-09-14",
    recurrence: "monthly",
    includedInBaseline: false,
  };
  const today = "2026-09-01";
  const newDate = "2026-09-21"; // 9/14 -> 9/21로 미루는 가정

  const [delayedOnce, continuingMonthly] = splitDelayedMonthlyOutflow(cardOutflow, newDate, today);
  check("이번 회차는 once로 분리, newDate 그대로", delayedOnce.dueDate, "2026-09-21");
  check("이번 회차 recurrence는 once", delayedOnce.recurrence, "once");
  check("다음 회차부터는 원래 일자(14일) 유지, 10월로 이동", continuingMonthly.dueDate, "2026-10-14");
  check("다음 회차도 recurrence는 monthly", continuingMonthly.recurrence, "monthly");

  const schedule = buildOutflowSchedule([delayedOnce, continuingMonthly], today, 90);
  check("원래 9/14는 스케줄에서 제외됨(중복 방지)", schedule["2026-09-14"] ?? null, null);
  check("지연분 9/21만 이번 달에 반영", schedule["2026-09-21"], 780000);
  check("다음 회차 10/14는 원래 일자 유지", schedule["2026-10-14"], 780000);
  check("그 다음 회차 11/14도 원래 일자 유지 (2개월 이상 범위 검증)", schedule["2026-11-14"], 780000);
  check("지연된 21일이 10월로 전파되지 않음", schedule["2026-10-21"] ?? null, null);
  check("지연된 21일이 11월로도 전파되지 않음", schedule["2026-11-21"] ?? null, null);
}

console.log("── compareWhatIf: 4개 이상 가정 넘기면 throw ──");
{
  const four: WhatIfAssumption[] = [
    ...(MOCK.whatIfExamples as WhatIfAssumption[]),
    { type: "reduce_spending", label: "추가 절감", monthlyReduction: 10000 },
  ];
  let threw = false;
  try {
    compareWhatIf(MOCK_ENGINE_INPUT, four, NOW);
  } catch {
    threw = true;
  }
  check("4개 이상은 throw", threw, true);
}

console.log("\n" + (failCount === 0 ? `✅ 전부 통과 (${failCount}건 실패)` : `❌ ${failCount}건 실패`));
process.exit(failCount === 0 ? 0 : 1);
