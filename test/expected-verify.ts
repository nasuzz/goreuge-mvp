// test/expected-verify.ts
// hsoo23 리뷰(PR #15) 요청 반영: 6개 정산조건(UNKNOWN 포함), 월말 clamp/윤년,
// NET_DAYS의 invoiceDate 우선·completionDate fallback, 실제입금 우선·확인율 계산·추정불가.
import { calculateExpectedDate, calculateExpectedNetAmount } from "../src/engine/index";

let failCount = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failCount++;
  console.log(`${pass ? "✅" : "❌"} ${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

console.log("── calculateExpectedDate: 정산조건 6종 ──");

check(
  "ON_COMPLETION",
  calculateExpectedDate({ settlementTerm: "ON_COMPLETION", settlementDay: null, completionDate: "2026-09-03", invoiceDate: null }),
  "2026-09-03",
);
check(
  "SAME_MONTH_END",
  calculateExpectedDate({ settlementTerm: "SAME_MONTH_END", settlementDay: null, completionDate: "2026-09-03", invoiceDate: null }),
  "2026-09-30",
);
check(
  "NEXT_MONTH_END (8-1절 데모 예시, 10/31이 토요일이어도 보정 없이 그대로)",
  calculateExpectedDate({ settlementTerm: "NEXT_MONTH_END", settlementDay: null, completionDate: "2026-09-03", invoiceDate: null }),
  "2026-10-31",
);
check(
  "NEXT_MONTH_DAY 정상",
  calculateExpectedDate({ settlementTerm: "NEXT_MONTH_DAY", settlementDay: 10, completionDate: "2026-09-03", invoiceDate: null }),
  "2026-10-10",
);
check(
  "NET_DAYS 정상",
  calculateExpectedDate({ settlementTerm: "NET_DAYS", settlementDay: 15, completionDate: "2026-09-03", invoiceDate: null }),
  "2026-09-18",
);
check(
  "UNKNOWN -> null",
  calculateExpectedDate({ settlementTerm: "UNKNOWN", settlementDay: null, completionDate: "2026-09-03", invoiceDate: null }),
  null,
);

console.log("\n── 말일 clamp (평년/윤년) ──");
check(
  "평년 2월: 1/31 완료 + 익월 31일 -> 2월엔 28일까지 (2026은 평년)",
  calculateExpectedDate({ settlementTerm: "NEXT_MONTH_DAY", settlementDay: 31, completionDate: "2026-01-31", invoiceDate: null }),
  "2026-02-28",
);
check(
  "윤년 2월: 1/31 완료 + 익월 31일 -> 2028은 윤년이라 29일까지",
  calculateExpectedDate({ settlementTerm: "NEXT_MONTH_DAY", settlementDay: 31, completionDate: "2028-01-31", invoiceDate: null }),
  "2028-02-29",
);
check(
  "SAME_MONTH_END도 윤년 2월엔 29일",
  calculateExpectedDate({ settlementTerm: "SAME_MONTH_END", settlementDay: null, completionDate: "2028-02-05", invoiceDate: null }),
  "2028-02-29",
);
check(
  "SAME_MONTH_END 평년 2월엔 28일",
  calculateExpectedDate({ settlementTerm: "SAME_MONTH_END", settlementDay: null, completionDate: "2026-02-05", invoiceDate: null }),
  "2026-02-28",
);
check(
  "NEXT_MONTH_DAY 30일 지정, 4월(30일까지)엔 clamp 없이 그대로",
  calculateExpectedDate({ settlementTerm: "NEXT_MONTH_DAY", settlementDay: 30, completionDate: "2026-03-15", invoiceDate: null }),
  "2026-04-30",
);

console.log("\n── NET_DAYS: invoiceDate 우선, 없으면 completionDate fallback ──");
check(
  "invoiceDate 있으면 그걸 기준일로 사용",
  calculateExpectedDate({ settlementTerm: "NET_DAYS", settlementDay: 30, completionDate: "2026-09-03", invoiceDate: "2026-09-10" }),
  "2026-10-10",
);
check(
  "invoiceDate 없으면 completionDate로 fallback",
  calculateExpectedDate({ settlementTerm: "NET_DAYS", settlementDay: 30, completionDate: "2026-09-03", invoiceDate: null }),
  "2026-10-03",
);
check(
  "invoiceDate가 completionDate보다 훨씬 이후여도 invoiceDate 우선",
  calculateExpectedDate({ settlementTerm: "NET_DAYS", settlementDay: 7, completionDate: "2026-09-03", invoiceDate: "2026-09-25" }),
  "2026-10-02",
);

console.log("\n── settlementDay 필수/범위 검증 ──");
{
  let threw = false;
  try {
    calculateExpectedDate({ settlementTerm: "NEXT_MONTH_DAY", settlementDay: null, completionDate: "2026-09-03", invoiceDate: null });
  } catch { threw = true; }
  check("NEXT_MONTH_DAY인데 settlementDay 없으면 throw", threw, true);
}
{
  let threw = false;
  try {
    calculateExpectedDate({ settlementTerm: "NET_DAYS", settlementDay: null, completionDate: "2026-09-03", invoiceDate: null });
  } catch { threw = true; }
  check("NET_DAYS인데 settlementDay 없으면 throw", threw, true);
}
{
  let threw = false;
  try {
    calculateExpectedDate({ settlementTerm: "NET_DAYS", settlementDay: 400, completionDate: "2026-09-03", invoiceDate: null });
  } catch { threw = true; }
  check("settlementDay 범위(1~365) 초과(400)면 throw", threw, true);
}
{
  let threw = false;
  try {
    calculateExpectedDate({ settlementTerm: "NEXT_MONTH_DAY", settlementDay: 0, completionDate: "2026-09-03", invoiceDate: null });
  } catch { threw = true; }
  check("settlementDay 0(범위 미만)이면 throw", threw, true);
}

console.log("\n── calculateExpectedNetAmount: actual > calculated > unavailable 우선순위 ──");
check(
  "actualNetAmount 있으면 actual 최우선 (confirmedExpectedRate 있어도)",
  calculateExpectedNetAmount({ grossAmount: 2400000, payerStatedNetAmount: null, confirmedExpectedRate: 0.033, actualNetAmount: 2200000 }),
  { amount: 2200000, status: "actual" },
);
check(
  "confirmedExpectedRate로 계산 (2,400,000 * 3.3% = 79,200 내림 -> 2,320,800)",
  calculateExpectedNetAmount({ grossAmount: 2400000, payerStatedNetAmount: null, confirmedExpectedRate: 0.033, actualNetAmount: null }),
  { amount: 2320800, status: "calculated" },
);
check(
  "confirmedExpectedRate null이면 무조건 unavailable (referenceRate 대체 없음, 5-1 원칙)",
  calculateExpectedNetAmount({ grossAmount: 2400000, payerStatedNetAmount: null, confirmedExpectedRate: null, actualNetAmount: null }),
  { amount: null, status: "unavailable" },
);
check(
  "공제율 0%(no_withholding)도 정상 계산",
  calculateExpectedNetAmount({ grossAmount: 500000, payerStatedNetAmount: null, confirmedExpectedRate: 0, actualNetAmount: null }),
  { amount: 500000, status: "calculated" },
);
check(
  "공제율 8.8%(기타소득) 내림 계산 (1,000,000 * 0.088 = 88,000)",
  calculateExpectedNetAmount({ grossAmount: 1000000, payerStatedNetAmount: null, confirmedExpectedRate: 0.088, actualNetAmount: null }),
  { amount: 912000, status: "calculated" },
);
check(
  "actualNetAmount가 0이어도(전액 공제) actual로 인정 — null이 아니면 actual",
  calculateExpectedNetAmount({ grossAmount: 500000, payerStatedNetAmount: null, confirmedExpectedRate: 0.1, actualNetAmount: 0 }),
  { amount: 0, status: "actual" },
);

console.log("\n" + (failCount === 0 ? `✅ 전부 통과 (${failCount}건 실패)` : `❌ ${failCount}건 실패`));
process.exit(failCount === 0 ? 0 : 1);
