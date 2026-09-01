// shared/mock-data.ts
// DRI: A(수경).
//
// mock-data.json을 그냥 import하면 TypeScript가 문자열 리터럴을 `string`으로 넓혀버려서
// enum 필드가 전부 타입 에러가 난다. (`Type 'string' is not assignable to type 'ContractStatus'`)
// 이 파일이 런타임 검증 + 타입 좁히기를 한 번에 해준다.
//
// B·C는 mock-data.json을 직접 import하지 말고 여기서 가져다 쓸 것.
//
//   import { MOCK, EXPECTED } from "@/shared/mock-data";
//   MOCK.contracts   // Contract[]  (타입 완전히 맞음)
//   EXPECTED.dDay.baseline.date  // "2026-09-30"

import raw from "./mock-data.json";
import type {
  User, Client, Contract, Outflow, Transaction,
  Saving, SavingsCheck, AIContractCandidate, WhatIfAssumption,
  EngineInput, DateString, Won,
} from "./types";
import type {
  ContractStatus, ClassificationStatus, IncomeType, SettlementTerm,
  ExpectedDateSource, StatusSource, OutflowRecurrence,
  SavingsKind, SavingsStatus, SpendClass,
} from "./enums";

// ── 런타임 검증 ──────────────────────────────────────────

const ENUM_VALUES = {
  ContractStatus: ["waiting", "delayed", "risk", "completed", "cancelled"],
  ClassificationStatus: ["ai_candidate", "needs_review", "user_confirmed", "actual_confirmed"],
  IncomeType: [
    "business_personal_service", "qualifying_other_income",
    "employment_income", "no_withholding", "needs_review",
  ],
  SettlementTerm: [
    "ON_COMPLETION", "SAME_MONTH_END", "NEXT_MONTH_END",
    "NEXT_MONTH_DAY", "NET_DAYS", "UNKNOWN",
  ],
  ExpectedDateSource: ["calculated", "manual"],
  StatusSource: ["system", "user"],
  OutflowRecurrence: ["monthly", "once"],
  SavingsKind: ["wish", "tax"],
  SavingsStatus: ["waiting", "active", "completed", "paused", "cancelled"],
  SpendClass: ["essential", "hobby", "stress", "unclassified"],
} as const;

function assertEnum<T extends string>(
  value: unknown, kind: keyof typeof ENUM_VALUES, where: string,
): T {
  const allowed = ENUM_VALUES[kind] as readonly string[];
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(
      `[mock-data] ${where}: "${String(value)}"는 ${kind}의 값이 아닙니다. ` +
      `허용값: ${allowed.join(" | ")}`,
    );
  }
  return value as T;
}

/** `_case`, `_comment` 같은 주석 키를 제거한다 */
function stripNotes<T extends object>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).filter(([k]) => !k.startsWith("_")),
  ) as T;
}

// ── 변환 ─────────────────────────────────────────────────

const user: User = stripNotes(raw.user) as User;

const clients: Client[] = raw.clients as Client[];

const contracts: Contract[] = raw.contracts.map((c) => {
  const o = stripNotes(c) as Record<string, unknown>;
  return {
    ...o,
    settlementTerm: assertEnum<SettlementTerm>(o.settlementTerm, "SettlementTerm", `${o.id}.settlementTerm`),
    expectedDateSource: assertEnum<ExpectedDateSource>(o.expectedDateSource, "ExpectedDateSource", `${o.id}.expectedDateSource`),
    incomeType: assertEnum<IncomeType>(o.incomeType, "IncomeType", `${o.id}.incomeType`),
    classificationStatus: assertEnum<ClassificationStatus>(o.classificationStatus, "ClassificationStatus", `${o.id}.classificationStatus`),
    status: assertEnum<ContractStatus>(o.status, "ContractStatus", `${o.id}.status`),
    statusSource: assertEnum<StatusSource>(o.statusSource, "StatusSource", `${o.id}.statusSource`),
  } as Contract;
});

const outflows: Outflow[] = raw.outflows.map((o) => {
  const x = stripNotes(o) as Record<string, unknown>;
  return {
    ...x,
    recurrence: assertEnum<OutflowRecurrence>(x.recurrence, "OutflowRecurrence", `${x.id}.recurrence`),
  } as Outflow;
});

const transactions: Transaction[] = raw.transactions.map((t) => ({
  ...t,
  spendClass: assertEnum<SpendClass>(t.spendClass, "SpendClass", `${t.id}.spendClass`),
})) as Transaction[];

const savings: Saving[] = raw.savings.map((s) => {
  const x = stripNotes(s) as Record<string, unknown>;
  return {
    ...x,
    kind: assertEnum<SavingsKind>(x.kind, "SavingsKind", `${x.id}.kind`),
    status: assertEnum<SavingsStatus>(x.status, "SavingsStatus", `${x.id}.status`),
  } as Saving;
});

const savingsChecks: SavingsCheck[] = raw.savingsChecks as SavingsCheck[];

const aiCandidates: AIContractCandidate[] = raw.aiCandidateExamples.map((a, i) => {
  const x = stripNotes(a) as Record<string, unknown>;
  return {
    ...x,
    settlementTerm: x.settlementTerm === null
      ? null
      : assertEnum<SettlementTerm>(x.settlementTerm, "SettlementTerm", `ai[${i}].settlementTerm`),
    incomeTypeCandidate: assertEnum<IncomeType>(x.incomeTypeCandidate, "IncomeType", `ai[${i}].incomeTypeCandidate`),
  } as AIContractCandidate;
});

const whatIfExamples = raw.whatIfExamples.map(stripNotes) as WhatIfAssumption[];

// ── 무결성 검증 (기획서 9-3). 위반하면 즉시 throw ────────

function validateIntegrity(): void {
  for (const c of contracts) {
    if ((c.actualDate === null) !== (c.actualNetAmount === null)) {
      throw new Error(`[9-3 위반] ${c.id}: actualDate와 actualNetAmount는 함께 있거나 함께 없어야 합니다`);
    }
    if (c.classificationStatus === "ai_candidate") {
      throw new Error(`[8-1 위반] ${c.id}: 사용자 확인 전(ai_candidate) 계약은 저장할 수 없습니다`);
    }
    if (c.statusSource === "user" && !c.statusReason) {
      throw new Error(`[규칙 위반] ${c.id}: 사용자가 상태를 지정했으면 사유가 필요합니다`);
    }
    if (
      (c.settlementTerm === "NEXT_MONTH_DAY" || c.settlementTerm === "NET_DAYS") &&
      c.settlementDay === null
    ) {
      throw new Error(`[규칙 위반] ${c.id}: ${c.settlementTerm}에는 settlementDay가 필요합니다`);
    }
    for (const f of ["expectedNetAmount", "actualNetAmount"] as const) {
      const v = c[f];
      if (v !== null && v > c.grossAmount) {
        throw new Error(`[규칙 위반] ${c.id}: ${f}가 grossAmount를 초과합니다`);
      }
    }
  }
  for (const s of savings) {
    if (s.spentAmount > s.reservedAmount) {
      throw new Error(`[9-3 위반] ${s.id}: spentAmount가 reservedAmount를 초과합니다`);
    }
    const checkTotal = savingsChecks
      .filter((k) => k.savingId === s.id)
      .reduce((sum, k) => sum + k.amount, 0);
    if (s.reservedAmount > checkTotal) {
      throw new Error(
        `[9-3 위반] ${s.id}: reservedAmount(${s.reservedAmount})가 체크 이력 합계(${checkTotal})를 초과합니다`,
      );
    }
  }
}

validateIntegrity();

// ── 내보내기 ─────────────────────────────────────────────

/** 데모 기준 날짜. 엔진은 Date.now()를 쓰지 않고 이 값을 주입받는다 */
export const TODAY: DateString = raw._meta.today;

export const MOCK = {
  user, clients, contracts, outflows,
  transactions, savings, savingsChecks,
  aiCandidates, whatIfExamples,
} as const;

/** 엔진에 그대로 넣을 수 있는 스냅샷 */
export const MOCK_ENGINE_INPUT: EngineInput = {
  today: TODAY,
  user, contracts, clients, outflows, savings,
};

/**
 * 엔진이 반드시 내야 하는 값. A의 단위 테스트 기준선.
 * 이 숫자가 안 나오면 엔진 버그다.
 */
export const EXPECTED = raw.expectedResults as {
  simulationStartBalance: Won;
  dailyBaselineOutflow: Won;
  outstandingReceivable: Won;
  dDay: Record<"optimistic" | "baseline" | "pessimistic", { date: DateString; daysRemaining: number }>;
  weekly: { safeFund28Days: Won; weeklyAvailableAmount: Won };
  balanceLevel: {
    referenceAmount: Won;
    baseline60Days: { safe: number; caution: number; danger: number };
    firstCaution: DateString;
    firstDanger: DateString;
  };
  demoBeats: Record<string, { before: DateString; after: DateString } & Record<string, unknown>>;
};
