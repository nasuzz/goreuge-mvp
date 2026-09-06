// Mock 상태 저장소 (#6). API·DB 없이 화면을 완성하기 위한 저장소다.
//
// 계산은 하나도 직접 하지 않는다 — 전부 A의 엔진(@/engine/index)을 그대로 호출한다.
// 그래야 나중에 API가 붙었을 때 화면에 나오던 숫자가 바뀌지 않는다.
// #23(Supabase 실연결)이 풀리면 이 파일의 내부만 fetch로 교체하면 된다.
//
// React state가 아니라 모듈 수준 외부 저장소로 두고 useSyncExternalStore로 구독한다.
// localStorage 복원을 effect 안의 setState로 하면 렌더가 연쇄로 도는데,
// 외부 저장소로 두면 구독 시점에 한 번만 복원하면 되기 때문이다.

import { useCallback, useSyncExternalStore } from "react";
import {
  calculateExpectedDate,
  calculateExpectedNetAmount,
  cancelContract,
  compareWhatIf,
  confirmPayment,
  markContractAsRisk,
  recalculateClientStats,
  recalculateContractStatuses,
  revertManualStatus,
  runAllScenarios,
} from "@/engine/index";
import { normalizeClientName } from "@/lib/client-name";
import { MOCK_ENGINE_INPUT, TODAY } from "@/shared/mock-data";
import { getWithholdingReference } from "@/shared/policy";
import type {
  CashflowSummary,
  Client,
  Contract,
  ContractCreateInput,
  DateString,
  EngineInput,
  WhatIfAssumption,
  WhatIfResult,
} from "@/shared/types";

/** 데모 기준일은 shared-spec D11에 따라 2026-09-01로 고정한다. */
const NOW = TODAY + "T09:00:00+09:00";
const STORAGE_KEY = "goreuge.mock.v1";

export interface OnboardingInput {
  totalBalance: number;
  monthlyFixedOutflow: number;
  safetyBuffer: number;
  taxReserveRate: number;
}

export interface StoreSnapshot {
  input: EngineInput;
  summary: CashflowSummary;
  today: string;
  onboarded: boolean;
}

function build(input: EngineInput, onboarded: boolean): StoreSnapshot {
  const settled: EngineInput = {
    ...input,
    // 상태 판정은 화면이 아니라 엔진이 한다. 불러올 때마다 오늘 기준으로 다시 계산한다.
    contracts: recalculateContractStatuses(input.contracts, TODAY, NOW),
  };
  return {
    input: settled,
    summary: runAllScenarios(settled),
    today: TODAY,
    onboarded,
  };
}

/** 서버 렌더와 첫 클라이언트 렌더가 같아야 하므로 참조까지 고정한다. */
const SERVER_SNAPSHOT = build(MOCK_ENGINE_INPUT, false);

let snapshot: StoreSnapshot = SERVER_SNAPSHOT;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function commit(input: EngineInput, onboarded: boolean) {
  snapshot = build(input, onboarded);
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ input: snapshot.input, onboarded }),
    );
  } catch {
    // 사생활 보호 모드·저장소 차단 등에서 던질 수 있다. Mock이므로 저장 실패는 무시한다.
  }
  emit();
}

function hydrate() {
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { input: EngineInput; onboarded: boolean };
    if (!parsed?.input?.user) return;
    snapshot = build(parsed.input, parsed.onboarded);
    emit();
  } catch {
    // 저장된 값이 깨졌으면 기본 mock으로 계속 간다.
  }
}

function subscribe(listener: () => void) {
  if (!hydrated) hydrate();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => SERVER_SNAPSHOT;

// ── 액션 ────────────────────────────────────────────────

export function completeOnboarding(values: OnboardingInput) {
  commit(
    {
      ...snapshot.input,
      user: {
        ...snapshot.input.user,
        totalBalance: values.totalBalance,
        monthlyFixedOutflow: values.monthlyFixedOutflow,
        safetyBuffer: values.safetyBuffer,
        taxReserveRate: values.taxReserveRate,
        updatedAt: NOW,
      },
    },
    true,
  );
}

export function addContract(values: ContractCreateInput): Contract {
  const { input } = snapshot;

  // 거래처는 이름으로 find-or-create 한다. 비교는 정규화한 값으로,
  // 저장은 사용자가 입력한 원문 그대로 — API 라우트(#21)와 같은 규칙이다.
  const displayName = values.clientName.trim();
  const normalized = normalizeClientName(displayName);
  const existing = input.clients.find((c) => normalizeClientName(c.name) === normalized);
  const client: Client = existing ?? {
    id: "client-local-" + Date.now(),
    name: displayName,
    completedCount: 0,
    medianDelayDays: null,
    p90DelayDays: null,
  };

  const calculated = calculateExpectedDate({
    settlementTerm: values.settlementTerm,
    settlementDay: values.settlementDay,
    completionDate: values.completionDate,
    invoiceDate: values.invoiceDate,
  });

  const net = calculateExpectedNetAmount({
    grossAmount: values.grossAmount,
    payerStatedNetAmount: values.payerStatedNetAmount,
    confirmedExpectedRate: values.confirmedExpectedRate,
    actualNetAmount: null,
  });

  const contract: Contract = {
    id: "contract-local-" + Date.now(),
    clientId: client.id,
    grossAmount: values.grossAmount,
    completionDate: values.completionDate,
    invoiceDate: values.invoiceDate,
    settlementTerm: values.settlementTerm,
    settlementDay: values.settlementDay,
    expectedDate: values.manualExpectedDate ?? calculated,
    expectedDateSource: values.manualExpectedDate ? "manual" : "calculated",
    actualDate: null,
    incomeType: values.incomeType,
    classificationStatus: values.classificationStatus,
    // [PR #25 리뷰 - A] #21 API 라우트(reference_rate)와 같은 값을 저장한다. 계산에는 안 쓰이지만
    // (expectedNetAmount.ts 5-1) "저장 당시 시스템 참조 공제율" 감사 필드라 Mock도 비워두면 안 된다.
    referenceRate: getWithholdingReference(values.incomeType).referenceRate,
    confirmedExpectedRate: values.confirmedExpectedRate,
    actualRate: null,
    payerStatedNetAmount: values.payerStatedNetAmount,
    expectedNetAmount: net.amount,
    actualNetAmount: null,
    status: "waiting",
    statusSource: "system",
    statusReason: null,
    statusUpdatedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };

  commit(
    {
      ...input,
      clients: existing ? input.clients : [...input.clients, client],
      contracts: [...input.contracts, contract],
    },
    snapshot.onboarded,
  );

  return contract;
}

function applyToContract(contractId: string, recipe: (c: Contract) => Contract) {
  commit(
    {
      ...snapshot.input,
      contracts: snapshot.input.contracts.map((c) => (c.id === contractId ? recipe(c) : c)),
    },
    snapshot.onboarded,
  );
}

export function markRisk(contractId: string, reason: string) {
  applyToContract(contractId, (c) => markContractAsRisk(c, reason, NOW));
}

export function cancel(contractId: string, reason: string) {
  applyToContract(contractId, (c) => cancelContract(c, reason, NOW));
}

export function revert(contractId: string) {
  // 되돌린 뒤의 상태는 build()가 엔진으로 다시 판정한다.
  applyToContract(contractId, (c) => revertManualStatus(c, "waiting", NOW));
}

/**
 * 입금 확인 (engine-interface.md 3-9, 이슈 #55).
 *
 * 계약을 완료로 확정하고 공제율을 역산한 뒤, 그 거래처의 지연 통계를 다시 계산한다(3-10).
 * 통계는 D-day 시나리오가 쓰는 입금일 추정 근거라, 같이 갱신하지 않으면 방금 확인한
 * 입금이 다음 계산에 반영되지 않는다.
 */
export function confirmContractPayment(
  contractId: string,
  actualDate: DateString,
  actualNetAmount: number,
) {
  const contracts = snapshot.input.contracts.map((c) =>
    c.id === contractId
      ? confirmPayment(c, { contractId, actualDate, actualNetAmount }, NOW)
      : c,
  );
  const target = contracts.find((c) => c.id === contractId);
  // recalculateClientStats는 넘긴 배열을 "이 거래처의 완료 계약"으로 그대로 센다.
  // clientId를 스스로 거르지 않으므로 호출부가 걸러 넘겨야 completedCount가 맞는다.
  const clients = target
    ? snapshot.input.clients.map((cl) =>
        cl.id === target.clientId
          ? recalculateClientStats(
              cl,
              contracts.filter((c) => c.clientId === cl.id && c.actualDate !== null),
            )
          : cl,
      )
    : snapshot.input.clients;

  commit({ ...snapshot.input, contracts, clients }, snapshot.onboarded);
}

export function runWhatIf(assumptions: WhatIfAssumption[]): WhatIfResult[] {
  return compareWhatIf(snapshot.input, assumptions, NOW);
}

export function reset() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 무시
  }
  snapshot = build(MOCK_ENGINE_INPUT, false);
  emit();
}

// ── 훅 ──────────────────────────────────────────────────

export function useMockStore() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    ...state,
    completeOnboarding,
    addContract,
    markRisk,
    cancel,
    revert,
    confirmContractPayment,
    runWhatIf,
    reset,
  };
}

/** 계약이 가진 거래처 이름을 찾는다. */
export function useClientName(): (clientId: string) => string {
  const { input } = useMockStore();
  return useCallback(
    (clientId: string) =>
      input.clients.find((c) => c.id === clientId)?.name ?? "이름 없는 거래처",
    [input.clients],
  );
}
