// test/api-smoke.mjs — Supabase 실연결 API 스모크 (이슈 #23)
//
// #23에 적어둔 "키 받으면 C가 즉시 돌릴 검증 순서" 5단계를 그대로 자동화한 것이다.
// 지금까지 통과한 검증은 전부 DB에 닿지 않는 경로였다. createServerClient() 이후의
// 코드 — 매퍼(snake_case <-> camelCase), loadEngineInput, 상태 재계산 write-back,
// find-or-create — 는 실행 횟수가 0회다. 이 스크립트가 그 구간을 지난다.
//
// 사전 준비
//   1. db/schema.sql 적용 (+ 이슈 #16 payer_stated_net_amount 마이그레이션)
//   2. db/seed-demo.sql 적용
//   3. web/.env.local 에 SUPABASE_URL / SUPABASE_SECRET_KEY / DEMO_TODAY=2026-09-01
//   4. cd web && npm run dev
//
// 실행
//   node test/api-smoke.mjs
//   node test/api-smoke.mjs --skip-mutating     # 데모 데이터를 건드리는 4단계 제외
//   API_BASE=https://<vercel>.vercel.app node test/api-smoke.mjs
//
// 주의: 4단계는 데모 계약을 실제로 risk로 바꾼다. 끝난 뒤 db/seed-demo.sql을 다시
//       실행하면 원상복구된다(먼저 지우고 넣는 스크립트라 몇 번을 돌려도 같다).
//       데모 직전에는 --skip-mutating 으로 돌리거나, 돌린 뒤 반드시 재시드할 것.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const mock = JSON.parse(readFileSync(path.join(here, "../src/shared/mock-data.json"), "utf8"));
const EXPECTED = mock.expectedResults;

const BASE = (process.env.API_BASE ?? "http://localhost:3000").replace(/\/$/, "");
// db/seed-demo.mjs가 고정한 값. 시드를 바꾸면 여기도 같이 바뀐다.
const DEMO_USER_ID = process.env.DEMO_USER_ID ?? "a0000000-0000-4000-8000-000000000001";
const CONTRACT_002 = "d0000000-0000-4000-8000-000000000002"; // K스튜디오, delayed
const OUTFLOW_002 = "e0000000-0000-4000-8000-000000000002"; // 신용카드 결제, 베이스라인 미포함
const SKIP_MUTATING = process.argv.includes("--skip-mutating");

class SmokeAbort extends Error {}

let failures = 0;
let mutated = false;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) console.log(`       실제=${JSON.stringify(actual)}  기대=${JSON.stringify(expected)}`);
}

function note(label, value) {
  console.log(`     · ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

async function call(method, pathname, body) {
  let res;
  try {
    res = await fetch(`${BASE}${pathname}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    // 서버가 안 떠 있으면 스택을 쏟아내는 대신 무엇을 해야 하는지 알려준다.
    console.error(`\n중단: ${method} ${BASE}${pathname} 에 연결하지 못했습니다.`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    console.error("  cd web && npm run dev 로 서버를 띄웠는지, API_BASE가 맞는지 확인하세요.");
    throw new SmokeAbort();
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    // 본문이 없는 응답
  }
  return { status: res.status, body: json };
}

function section(n, title) {
  console.log(`\n-- ${n}. ${title} ${"-".repeat(Math.max(2, 50 - title.length))}`);
}

async function main() {
  // ── 0. 연결·시드 확인 ────────────────────────────────────
  section(0, "연결과 시드 확인");
  const preflight = await call("GET", `/api/dashboard?userId=${DEMO_USER_ID}`);
  if (preflight.status !== 200) {
    console.error(`\n중단: GET /api/dashboard 가 ${preflight.status}입니다. ${JSON.stringify(preflight.body)}`);
    console.error(`  BASE=${BASE}  DEMO_USER_ID=${DEMO_USER_ID}`);
    console.error("  서버가 떠 있는지, .env.local 키가 들어갔는지, db/seed-demo.sql을 적용했는지 확인하세요.");
    return 1;
  }
  check("DB 연결 + 데모 유저 조회 성공", preflight.status, 200);
  check("잔액 구성 — 시뮬 시작 잔액", preflight.body?.balanceBreakdown?.simulationStartBalance, EXPECTED.simulationStartBalance);

  const listed = await call("GET", `/api/contracts?userId=${DEMO_USER_ID}`);
  check("계약 7건 조회", listed.body?.contracts?.length, mock.contracts.length);
  // 시드가 today=2026-09-01 기준으로 이미 정합하면 자동 전이가 일어나지 않아야 한다.
  check("상태 자동 재계산 write-back 0건 (시드가 기준일과 정합)", listed.body?.updatedCount, 0);

  // 시드 직후 상태여야 3·5단계의 D-day 기대값이 의미가 있다. 이전 실행의 4단계가
  // 남긴 risk 상태로 시작하면 기준 D-day가 09-30이 아니라 09-14라, 아래 검사들이
  // 줄줄이 깨지면서 원인이 엔진 버그처럼 보인다. 여기서 먼저 끊는다.
  const seededStatuses = mock.contracts.map((c) => c.status).sort();
  const liveStatuses = (listed.body?.contracts ?? []).map((c) => c.status).sort();
  check("계약 상태가 시드 직후와 동일 (아니면 db/seed-demo.sql 재실행 필요)", liveStatuses, seededStatuses);
  if (JSON.stringify(liveStatuses) !== JSON.stringify(seededStatuses)) {
    console.error("\n중단: 데모 데이터가 시드 상태가 아닙니다.");
    console.error("  이전 실행의 4단계가 계약을 risk로 바꿔놓은 상태일 수 있습니다.");
    console.error("  Supabase SQL Editor에 db/seed-demo.sql을 다시 실행한 뒤 재시도하세요.");
    return 1;
  }

  // ── 1. POST /api/onboarding ──────────────────────────────
  section(1, "POST /api/onboarding");
  const bad = await call("POST", "/api/onboarding", { totalBalance: -1, monthlyFixedOutflow: 0 });
  check("음수 잔액이면 400", bad.status, 400);

  const onboarded = await call("POST", "/api/onboarding", {
    totalBalance: mock.user.totalBalance,
    monthlyFixedOutflow: mock.user.monthlyFixedOutflow,
    safetyBuffer: 0, // 기획서 3-3: 제안값보다 잔액이 적어 0원을 고른 케이스
  });
  check("온보딩 생성 201", onboarded.status, 201);
  check("안전예비금 0원이 그대로 저장됨", onboarded.body?.user?.safetyBuffer, 0);
  check("세금 준비율 기본값 주입", onboarded.body?.user?.taxReserveRate, mock.user.taxReserveRate);
  const tempUserId = onboarded.body?.user?.id ?? null;
  note("생성된 임시 유저", tempUserId);
  console.log("     (데모 D-day를 오염시키지 않도록 2단계는 이 임시 유저에 등록한다)");

  // ── 2. POST /api/contracts ───────────────────────────────
  section(2, "POST /api/contracts");
  const baseContract = {
    userId: tempUserId,
    clientName: "스모크 거래처",
    grossAmount: 2400000,
    completionDate: "2026-09-03",
    invoiceDate: null,
    settlementTerm: "NEXT_MONTH_END",
    settlementDay: null,
    incomeType: "business_personal_service",
    classificationStatus: "user_confirmed",
    confirmedExpectedRate: 0.033,
    payerStatedNetAmount: null,
  };

  const unconfirmed = await call("POST", "/api/contracts", { ...baseContract, classificationStatus: "needs_review" });
  check("사용자 확인 전(needs_review) 저장 차단 400", unconfirmed.status, 400);

  const overGross = await call("POST", "/api/contracts", { ...baseContract, payerStatedNetAmount: 2400001 });
  check("payerStatedNetAmount > grossAmount 이면 400 (이슈 #16)", overGross.status, 400);

  const created = await call("POST", "/api/contracts", baseContract);
  check("계약 등록 201", created.status, 201);
  check("참조율 계산 실수령액 2,400,000 - 3.3% = 2,320,800", created.body?.contract?.expectedNetAmount, 2320800);
  check("예정입금일 NEXT_MONTH_END -> 2026-10-31", created.body?.contract?.expectedDate, "2026-10-31");
  check("payerStatedNetAmount가 null로 왕복 (undefined 아님)", created.body?.contract?.payerStatedNetAmount, null);
  check("등록 응답에 갱신된 D-day 동봉", typeof created.body?.dashboard?.baseline?.dDay, "string");

  const payerStated = await call("POST", "/api/contracts", {
    ...baseContract,
    payerStatedNetAmount: 912345,
    confirmedExpectedRate: null,
  });
  check("지급처 안내 금액은 rate 환산 없이 원 단위 보존 (이슈 #16)", payerStated.body?.contract?.expectedNetAmount, 912345);

  // 같은 이름으로 두 번 등록했으니 거래처가 하나로 합쳐져야 한다(find-or-create).
  const tempContracts = await call("GET", `/api/contracts?userId=${tempUserId}`);
  const clientIds = new Set((tempContracts.body?.contracts ?? []).map((c) => c.clientId));
  check("같은 이름 거래처는 하나로 재사용 (find-or-create)", clientIds.size, 1);

  // ── 3. GET /api/dashboard ────────────────────────────────
  section(3, "GET /api/dashboard — D-day 3종이 엔진 실측값과 일치하는가");
  const dash = await call("GET", `/api/dashboard?userId=${DEMO_USER_ID}`);
  check("조회 200", dash.status, 200);
  for (const key of ["optimistic", "baseline", "pessimistic"]) {
    check(
      `D-day ${key}`,
      { dDay: dash.body?.[key]?.dDay, daysRemaining: dash.body?.[key]?.daysRemaining },
      { dDay: EXPECTED.dDay[key].date, daysRemaining: EXPECTED.dDay[key].daysRemaining },
    );
  }
  check("이번 주 28일 안전자금", dash.body?.weekly?.safeFund28Days, EXPECTED.weekly.safeFund28Days);
  check("이번 주 가용금액", dash.body?.weekly?.weeklyAvailableAmount, EXPECTED.weekly.weeklyAvailableAmount);
  note("지연 계약 수", dash.body?.riskCause?.delayedContracts?.length);

  // ── 4. PATCH /api/contracts/:id/status ───────────────────
  section(4, "PATCH /api/contracts/:id/status — 위험 지정 후 D-day 변동");
  if (SKIP_MUTATING) {
    console.log("     --skip-mutating 이므로 건너뜁니다.");
  } else {
    const beat = EXPECTED.demoBeats.markContract002AsRisk;
    const noReason = await call("PATCH", `/api/contracts/${CONTRACT_002}/status`, { action: "risk" });
    check("statusReason 없으면 400", noReason.status, 400);

    const patched = await call("PATCH", `/api/contracts/${CONTRACT_002}/status`, {
      action: "risk",
      reason: "클라이언트 연락 두절 (스모크 테스트)",
    });
    mutated = patched.status === 200;
    check("위험 지정 200", patched.status, 200);
    check(
      "상태 risk / 출처 user",
      { status: patched.body?.contract?.status, source: patched.body?.contract?.statusSource },
      { status: "risk", source: "user" },
    );

    const after = await call("GET", `/api/dashboard?userId=${DEMO_USER_ID}`);
    check(`기준 D-day ${beat.before} -> ${beat.after}`, after.body?.baseline?.dDay, beat.after);
  }

  // ── 5. POST /api/whatif ──────────────────────────────────
  // #8 결정: 대응안은 4단계(위험 지정)가 이미 반영된 상태에 "이어서" 확인한다.
  // 사람이 화면을 보며 진행하는 실제 라이브 리허설은 1:35(위험 전환)를 먼저 보여준
  // 뒤에야 2:00(대응안)으로 넘어갈 수 있어서, API 호출 순서를 바꿔 우회하는 이전
  // 방식(#23 코멘트 참고)은 라이브 리허설에 그대로 못 쓴다. 그래서 순서를 원래대로
  // (4 → 5) 되돌리고, 대신 mock-data.json의 whatIfExamples를 "위험 전환 이후에도
  // 정상 동작하는" 값(선금 100만원/9-14, 카드 결제 2주 연기)으로 교체했다.
  section(5, "POST /api/whatif — 대응안(A+B) 비교");
  const whatif = await call("POST", "/api/whatif", {
    userId: DEMO_USER_ID,
    assumptions: [
      { type: "advance_payment", label: "선금 100만원", amount: 1000000, date: "2026-09-14" },
      { type: "delay_outflow", label: "카드 결제 연기", outflowId: OUTFLOW_002, newDate: "2026-09-28" },
    ],
  });
  check("비교 200", whatif.status, 200);
  check("결과 2건", whatif.body?.results?.length, 2);
  for (const r of whatif.body?.results ?? []) {
    note(r.assumption?.label, `${r.dDayBefore} -> ${r.dDayAfter} (${r.dayDelta >= 0 ? "+" : ""}${r.dayDelta}일)`);
  }
  if (!SKIP_MUTATING) {
    const advance = EXPECTED.demoBeats.advancePayment1M;
    const delay = EXPECTED.demoBeats.delayCardPayment2Weeks;
    const advanceResult = whatif.body?.results?.find((r) => r.assumption?.type === "advance_payment");
    const delayResult = whatif.body?.results?.find((r) => r.assumption?.type === "delay_outflow");
    check(
      `선금 100만원 가정 (4단계 위험 지정 이후): ${advance.before} -> ${advance.after}`,
      { before: advanceResult?.dDayBefore, after: advanceResult?.dDayAfter },
      { before: advance.before, after: advance.after },
    );
    check(
      `카드 결제 2주 연기 (4단계 위험 지정 이후): ${delay.before} -> ${delay.after}`,
      { before: delayResult?.dDayBefore, after: delayResult?.dDayAfter },
      { before: delay.before, after: delay.after },
    );
  }

  // ── 결과 ─────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log(failures === 0 ? "전부 통과 (실패 0건)" : `${failures}건 실패`);
  if (mutated) {
    console.log("\n[주의] 4단계가 데모 계약을 risk로 바꿨습니다.");
    console.log("       Supabase SQL Editor에 db/seed-demo.sql을 다시 실행해 원복하세요.");
  }
  if (tempUserId) {
    // 온보딩 API에 멱등성이 없어 실행할 때마다 유저가 하나씩 쌓인다. DEMO_USER_ID가
    // 고정이라 데모 D-day에는 영향이 없지만, 그냥 두면 조용히 누적되므로 이번 것만이
    // 아니라 그동안 쌓인 것을 한 번에 지우는 문장을 낸다. 거래처 이름으로 식별한다.
    console.log(`\n[안내] 1·2단계가 만든 임시 유저(${tempUserId})와 계약 3건이 남습니다.`);
    // contracts -> clients -> users 순서로 지운다. contracts가 clients를
    // on delete restrict로 참조하므로 users부터 지우면 제약에 걸린다.
    console.log("       데모에는 영향이 없지만, 쌓인 스모크 흔적을 지우려면 SQL Editor에:");
    console.log("         create temp table smoke_users as");
    console.log("           select distinct user_id as id from clients where name = '스모크 거래처';");
    console.log("         delete from contracts where user_id in (select id from smoke_users);");
    console.log("         delete from clients   where user_id in (select id from smoke_users);");
    console.log("         delete from users     where id      in (select id from smoke_users);");
  }
  return failures === 0 ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (!(error instanceof SmokeAbort)) throw error;
  process.exitCode = 1;
}
