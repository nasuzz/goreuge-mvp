// test/payment-confirm-verify.ts
// engine-interface.md 3-9 "입금 확인 & 공제율 역산", 3-10 "거래처 지연 통계 갱신"
// 이슈 #55에서 새로 구현한 confirmPayment/recalculateClientStats 회귀 테스트.

import { MOCK } from "../src/shared/mock-data";
import { confirmPayment, recalculateClientStats, calculateExpectedNetAmount } from "../src/engine/index";
import type { Client, Contract } from "../src/shared/types";

let failCount = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failCount++;
  console.log(`${pass ? "✅" : "❌"} ${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

const NOW = "2026-08-25T14:00:00+09:00";

console.log("── confirmPayment: contract-005와 같은 조건 (grossAmount 1,500,000 / actualNetAmount 1,450,500) ──");
{
  // contract-005는 이미 확정된 상태라, 확정 "이전" 상태를 mock에서 복제해 재구성한다.
  const before: Contract = {
    ...MOCK.contracts.find((c) => c.id === "contract-005")!,
    actualDate: null,
    actualNetAmount: null,
    actualRate: null,
    classificationStatus: "user_confirmed",
    status: "waiting",
  };
  const after = confirmPayment(before, { contractId: before.id, actualDate: "2026-08-25", actualNetAmount: 1450500 }, NOW);

  check("actualDate 반영", after.actualDate, "2026-08-25");
  check("actualNetAmount 반영", after.actualNetAmount, 1450500);
  check("actualRate 역산 (mock-data.json의 실측값 0.033과 일치)", after.actualRate, 0.033);
  check("classificationStatus -> actual_confirmed", after.classificationStatus, "actual_confirmed");
  check("status -> completed", after.status, "completed");
  check("statusSource는 system (사용자 판단이 아니라 사실 기록)", after.statusSource, "system");
  check("statusReason은 null", after.statusReason, null);
  check("statusUpdatedAt에 now", after.statusUpdatedAt, NOW);
  check("updatedAt에 now", after.updatedAt, NOW);
  check("원본 객체는 변경되지 않음(불변성)", before.status, "waiting");
  check("원본 actualDate도 그대로", before.actualDate, null);

  check(
    "calculateExpectedNetAmount가 확정 후 actual을 최우선으로 반환 (기존 로직과의 통합 확인)",
    calculateExpectedNetAmount(after),
    { amount: 1450500, status: "actual" },
  );
}

console.log("── confirmPayment: actualRate 반올림 (numeric(5,4) 대비, 이슈 #16과 같은 종류의 원단위 오차 방지) ──");
{
  const c: Contract = { ...MOCK.contracts[0], grossAmount: 3, actualDate: null, actualNetAmount: null, actualRate: null };
  // (3 - 1) / 3 = 0.66666... -> 소수 4자리 반올림하면 0.6667
  const after = confirmPayment(c, { contractId: c.id, actualDate: "2026-09-01", actualNetAmount: 1 }, NOW);
  check("반복소수 actualRate가 소수 4자리로 반올림됨", after.actualRate, 0.6667);
}

console.log("── confirmPayment: 범위 밖 값은 throw (DB chk 제약과 대응) ──");
{
  const c = MOCK.contracts.find((c) => c.id === "contract-001")!;
  let threw = false;
  try {
    confirmPayment(c, { contractId: c.id, actualDate: "2026-09-01", actualNetAmount: c.grossAmount + 1 }, NOW);
  } catch {
    threw = true;
  }
  check("actualNetAmount가 grossAmount 초과면 throw", threw, true);
}
{
  const c = MOCK.contracts.find((c) => c.id === "contract-001")!;
  let threw = false;
  try {
    confirmPayment(c, { contractId: c.id, actualDate: "2026-09-01", actualNetAmount: -1 }, NOW);
  } catch {
    threw = true;
  }
  check("actualNetAmount가 음수면 throw", threw, true);
}
{
  const c = MOCK.contracts.find((c) => c.id === "contract-001")!;
  let threw = false;
  try {
    confirmPayment(c, { contractId: c.id, actualDate: "2026-09-01", actualNetAmount: 1000.5 }, NOW);
  } catch {
    threw = true;
  }
  check("actualNetAmount가 정수가 아니면 throw", threw, true);
}

console.log("\n── recalculateClientStats: 3건 이상이면 중앙값·p90 계산 ──");
{
  const client: Client = { id: "client-001", name: "D에이전시", completedCount: 0, medianDelayDays: null, p90DelayDays: null };
  const completed = [
    { expectedDate: "2026-08-31", actualDate: "2026-09-05" }, // 5일 지연
    { expectedDate: "2026-07-10", actualDate: "2026-07-15" }, // 5일 지연
    { expectedDate: "2026-06-01", actualDate: "2026-06-20" }, // 19일 지연
  ] as Contract[];
  const result = recalculateClientStats(client, completed);
  check("completedCount는 지연일 계산 가능 건수", result.completedCount, 3);
  check("medianDelayDays (정렬: 5,5,19 -> 중앙값 5)", result.medianDelayDays, 5);
  check("p90DelayDays (최근접 순위: ceil(3*0.9)=3번째 -> 19)", result.p90DelayDays, 19);
}

console.log("── recalculateClientStats: 3건 미만이면 null (clientHistoryMinCount) ──");
{
  const client: Client = { id: "client-002", name: "K스튜디오", completedCount: 0, medianDelayDays: null, p90DelayDays: null };
  const completed = [
    { expectedDate: "2026-08-31", actualDate: "2026-09-05" },
    { expectedDate: "2026-07-10", actualDate: "2026-07-15" },
  ] as Contract[];
  const result = recalculateClientStats(client, completed);
  check("completedCount는 지연일 계산 가능 2건", result.completedCount, 2);
  check("medianDelayDays는 null (3건 미만)", result.medianDelayDays, null);
  check("p90DelayDays는 null (3건 미만)", result.p90DelayDays, null);
}

console.log("── recalculateClientStats: 예정보다 일찍 들어온 건은 지연일 0으로 clamp ──");
{
  const client: Client = { id: "client-003", name: "M프로덕션", completedCount: 0, medianDelayDays: null, p90DelayDays: null };
  const completed = [
    { expectedDate: "2026-08-31", actualDate: "2026-09-05" }, // 5일 지연
    { expectedDate: "2026-07-10", actualDate: "2026-07-15" }, // 5일 지연
    { expectedDate: "2026-06-01", actualDate: "2026-06-20" }, // 19일 지연
    { expectedDate: "2026-09-01", actualDate: "2026-08-25" }, // 7일 조기 -> 0으로 clamp
  ] as Contract[];
  const result = recalculateClientStats(client, completed);
  check("completedCount는 지연일 계산 가능 4건", result.completedCount, 4);
  check("조기입금이 섞여도 음수 없이 계산됨 (정렬: 0,5,5,19 -> 중앙값 5)", result.medianDelayDays, 5);
  check("p90도 정상 (ceil(4*0.9)=4번째 -> 19)", result.p90DelayDays, 19);
}

console.log("── recalculateClientStats: expectedDate 없는 완료 계약은 completedCount와 지연일 계산에서 제외 ──");
{
  const client: Client = { id: "client-004", name: "신규 거래처", completedCount: 0, medianDelayDays: null, p90DelayDays: null };
  const completed = [
    { expectedDate: "2026-08-31", actualDate: "2026-09-05" },
    { expectedDate: "2026-07-10", actualDate: "2026-07-15" },
    { expectedDate: "2026-06-01", actualDate: "2026-06-20" },
    { expectedDate: null, actualDate: "2026-08-25" }, // 정산조건 UNKNOWN 등으로 expectedDate가 끝내 없었던 케이스
  ] as Contract[];
  const result = recalculateClientStats(client, completed);
  check("completedCount는 지연일 계산 가능 3건", result.completedCount, 3);
  check("지연일 계산은 유효한 3건만으로 이뤄짐 (median 5)", result.medianDelayDays, 5);
}

console.log("── recalculateClientStats: 지연일 계산 가능 건이 없으면 completedCount도 0 ──");
{
  const client: Client = { id: "client-004b", name: "신규 거래처", completedCount: 3, medianDelayDays: 10, p90DelayDays: 20 };
  const completed = [
    { expectedDate: null, actualDate: "2026-09-01" },
    { expectedDate: null, actualDate: "2026-09-02" },
    { expectedDate: null, actualDate: "2026-09-03" },
  ] as Contract[];
  const result = recalculateClientStats(client, completed);
  check("completedCount는 지연일 계산 가능 0건", result.completedCount, 0);
  check("medianDelayDays는 null", result.medianDelayDays, null);
  check("p90DelayDays는 null", result.p90DelayDays, null);
}

console.log("── recalculateClientStats: 완료 계약이 아예 없으면 전부 null ──");
{
  const client: Client = { id: "client-005", name: "신규", completedCount: 3, medianDelayDays: 10, p90DelayDays: 20 };
  const result = recalculateClientStats(client, []);
  check("completedCount는 0으로 리셋됨", result.completedCount, 0);
  check("medianDelayDays는 null", result.medianDelayDays, null);
  check("p90DelayDays는 null", result.p90DelayDays, null);
}

console.log("\n" + (failCount === 0 ? `✅ 전부 통과 (${failCount}건 실패)` : `❌ ${failCount}건 실패`));
process.exit(failCount === 0 ? 0 : 1);
