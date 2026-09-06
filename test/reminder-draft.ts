import { createReminderDraft, createReminderDraftWithFallback, validateReminderDraft } from "../src/ai/reminder-draft";
import type { Client, Contract, EngineInput, User } from "../src/shared/types";

const today = "2026-09-01";
const now = today + "T09:00:00+09:00";

const user: User = {
  id: "user-test",
  totalBalance: 1_000_000,
  monthlyFixedOutflow: 1_000_000,
  safetyBuffer: 1_000_000,
  taxReserveRate: 0.12,
  createdAt: now,
  updatedAt: now,
};

const clients: Client[] = [
  { id: "client-long", name: "장기거래처", completedCount: 5, medianDelayDays: 2, p90DelayDays: 5 },
  { id: "client-new", name: "신규거래처", completedCount: 0, medianDelayDays: null, p90DelayDays: null },
  { id: "client-risk", name: "위험거래처", completedCount: 2, medianDelayDays: 10, p90DelayDays: 30 },
];

function contract(
  id: string,
  clientId: string,
  expectedDate: string,
  status: Contract["status"],
  amount: number,
): Contract {
  return {
    id,
    clientId,
    grossAmount: amount,
    completionDate: "2026-07-01",
    invoiceDate: null,
    settlementTerm: "NET_DAYS",
    settlementDay: 30,
    expectedDate,
    expectedDateSource: "calculated",
    actualDate: null,
    incomeType: "business_personal_service",
    classificationStatus: "user_confirmed",
    referenceRate: 0.033,
    confirmedExpectedRate: 0.033,
    actualRate: null,
    payerStatedNetAmount: null,
    expectedNetAmount: Math.round(amount * 0.967),
    actualNetAmount: null,
    status,
    statusSource: "system",
    statusReason: null,
    statusUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

const input: EngineInput = {
  today,
  user,
  clients,
  contracts: [
    contract("soft-7", "client-long", "2026-08-25", "delayed", 500_000),
    contract("standard-8", "client-new", "2026-08-24", "delayed", 700_000),
    contract("standard-30", "client-long", "2026-08-02", "delayed", 900_000),
    contract("firm-31", "client-new", "2026-08-01", "delayed", 1_100_000),
    contract("risk-5", "client-risk", "2026-08-27", "risk", 5_000_000),
  ],
  outflows: [],
  savings: [],
};

const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown) {
  if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
}

const cases = [
  ["soft-7", "soft", "혹시 483,500원 입금 일정 확인 부탁드려도 될까요?"],
  ["standard-8", "standard", "확인 후 입금 예정일을 회신 부탁드립니다."],
  ["standard-30", "standard", "2026년 8월 2일 예정이었던 870,300원"],
  ["firm-31", "firm", "현재 31일 미입금 상태입니다."],
  ["risk-5", "firm", "오늘 중 회신 부탁드립니다."],
] as const;

for (const [contractId, recommendedTone, expectedBodyPart] of cases) {
  const result = createReminderDraft(input, {
    contractId,
    tone: recommendedTone,
    channel: "message",
  });

  check(`${contractId} 추천 어조`, result.recommendedTone, recommendedTone);
  check(`${contractId} fallback source`, result.source, "deterministic_fallback");
  if (!result.draft.body.includes(expectedBodyPart)) {
    failures.push(`${contractId} 스냅샷 문구 누락: ${expectedBodyPart}`);
  }
  if (!result.draft.facts.some((fact) => fact.label === "요청 금액")) {
    failures.push(`${contractId} facts에 요청 금액이 있어야 합니다.`);
  }
  const validationErrors = validateReminderDraft(result.draft, "message");
  if (validationErrors.length > 0) {
    failures.push(`${contractId} 템플릿 검증 실패: ${validationErrors.join(" ")}`);
  }
}

const email = createReminderDraft(input, {
  contractId: "standard-8",
  tone: "standard",
  channel: "email",
});
check("email subject", email.draft.subject, "[입금 확인 요청] 신규거래처 정산 예정 건");

async function main() {
  const ai = await createReminderDraftWithFallback(
    input,
    { contractId: "standard-8", tone: "standard", channel: "message" },
    {
      async create() {
        return {
          subject: null,
          body: "신규거래처 담당자님, 2026년 8월 24일 예정이었던 676,900원 정산 건 확인 부탁드립니다.",
          toneReason: "금액과 예정일을 명시하는 기본 어조입니다.",
        };
      },
    },
  );
  check("provider source", ai.source, "ai");
  check(
    "provider facts kept server-side",
    ai.draft.facts.find((fact) => fact.label === "요청 금액")?.value,
    "676,900원",
  );

  const unsafe = await createReminderDraftWithFallback(
    input,
    { contractId: "standard-8", tone: "firm", channel: "message" },
    {
      async create() {
        return {
          subject: null,
          body: "입금하지 않으면 법적 조치를 진행하겠습니다.",
          toneReason: "강한 압박이 필요합니다.",
        };
      },
    },
  );
  check("unsafe provider fallback", unsafe.source, "deterministic_fallback");

  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }

  console.log("reminder-draft snapshots ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
