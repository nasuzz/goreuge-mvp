// test/issue16-verify.ts — 이슈 #16 반영 검증: payerStatedNetAmount 우선순위
import { calculateExpectedNetAmount } from "../src/engine/index";

let failCount = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failCount++;
  console.log(`${pass ? "✅" : "❌"} ${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

check(
  "actualNetAmount가 최우선 (payerStated·confirmedRate 둘 다 있어도)",
  calculateExpectedNetAmount({ grossAmount: 1000000, payerStatedNetAmount: 900000, confirmedExpectedRate: 0.1, actualNetAmount: 880000 }),
  { amount: 880000, status: "actual" },
);
check(
  "payerStatedNetAmount가 confirmedExpectedRate보다 우선",
  calculateExpectedNetAmount({ grossAmount: 1000000, payerStatedNetAmount: 912345, confirmedExpectedRate: 0.088, actualNetAmount: null }),
  { amount: 912345, status: "calculated" },
);
check(
  "payerStatedNetAmount 없으면 confirmedExpectedRate로 계산 (기존 동작 유지)",
  calculateExpectedNetAmount({ grossAmount: 2400000, payerStatedNetAmount: null, confirmedExpectedRate: 0.033, actualNetAmount: null }),
  { amount: 2320800, status: "calculated" },
);
check(
  "B가 지적한 원단위 오차 케이스 — rate 환산 없이 그대로 보존됨 (912,345원, 임의 금액)",
  calculateExpectedNetAmount({ grossAmount: 1000000, payerStatedNetAmount: 912345, confirmedExpectedRate: null, actualNetAmount: null }),
  { amount: 912345, status: "calculated" },
);
check(
  "셋 다 null이면 unavailable",
  calculateExpectedNetAmount({ grossAmount: 1000000, payerStatedNetAmount: null, confirmedExpectedRate: null, actualNetAmount: null }),
  { amount: null, status: "unavailable" },
);

console.log("\n" + (failCount === 0 ? `✅ 전부 통과 (${failCount}건 실패)` : `❌ ${failCount}건 실패`));
process.exit(failCount === 0 ? 0 : 1);
