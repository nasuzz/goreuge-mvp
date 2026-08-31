// test/smoke.ts
// README의 "검증 결과"를 재현하는 최소 스모크 테스트.
// `npm run verify`가 이 파일을 실행한다.
//
// 목적은 전체 회귀 테스트가 아니라, "이 저장소를 처음 받은 사람이
// README가 주장하는 숫자를 스스로 재현할 수 있는가"를 보장하는 것.

import { MOCK, MOCK_ENGINE_INPUT, EXPECTED, TODAY } from "../src/shared/mock-data";
import { getBalanceLevel, round, getWithholdingReference } from "../src/shared/policy";

let failed = 0;

function assertEqual(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? "✓" : "✗"} ${label}` + (ok ? "" : ` (실제=${JSON.stringify(actual)}, 기대=${JSON.stringify(expected)})`));
  if (!ok) failed++;
}

console.log(`mock-data.ts 로드 — TODAY=${TODAY}, 계약 ${MOCK.contracts.length}건`);

console.log("\n[1] EngineInput 스냅샷 완전성");
assertEqual("EngineInput 키", Object.keys(MOCK_ENGINE_INPUT).sort(),
  ["clients", "contracts", "outflows", "savings", "today", "user"].sort());

console.log("\n[2] 미수금 총액 (README가 명시한 검증값)");
const outstanding = MOCK.contracts
  .filter((c) => ["waiting", "delayed", "risk"].includes(c.status))
  .reduce((sum, c) => sum + c.grossAmount, 0);
assertEqual("미수금 합계", outstanding, 9_120_000);

console.log("\n[3] 실수령액 계산 전건 대조");
for (const c of MOCK.contracts) {
  if (c.confirmedExpectedRate != null && c.expectedNetAmount != null) {
    assertEqual(
      `${c.id} 실수령액`,
      round.netAmount(c.grossAmount, c.confirmedExpectedRate),
      c.expectedNetAmount,
    );
  }
}

console.log("\n[4] 기준 D-day (README가 명시한 검증값)");
assertEqual("기준 시나리오 D-day", EXPECTED.dDay.baseline.date, "2026-09-30");

console.log("\n[5] 잔액 3단계 경계값");
const u = MOCK.user;
assertEqual("900,000 → safe", getBalanceLevel(900000, u.safetyBuffer, u.monthlyFixedOutflow), "safe");
assertEqual("300,000 → caution", getBalanceLevel(300000, u.safetyBuffer, u.monthlyFixedOutflow), "caution");
assertEqual("100,000 → danger", getBalanceLevel(100000, u.safetyBuffer, u.monthlyFixedOutflow), "danger");

console.log("\n[6] 참조 공제율 조회");
assertEqual(
  "business_personal_service 참조율",
  getWithholdingReference("business_personal_service").referenceRate,
  0.033,
);

console.log("\n" + (failed === 0 ? `✅ 전부 통과` : `❌ ${failed}건 실패`));
process.exit(failed === 0 ? 0 : 1);
