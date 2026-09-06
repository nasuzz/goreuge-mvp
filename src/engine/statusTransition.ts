// engine/statusTransition.ts
// engine-interface.md 3-4 "계약 상태 자동 전이"
// DRI: A(수경). 이슈 #3 [ENGINE][P0] 정산 상태 전환 및 대응안 계산
//
// 원칙 (3-4):
//   waiting → delayed → risk 는 시스템이 자동으로 전이한다.
//   statusSource === "user" 인 계약은 자동 전이가 절대 덮어쓰지 않는다.
//     (사용자가 직접 위험으로 지정한 걸 시스템이 되돌리면 안 된다)
//   completed / cancelled 는 종료 상태라 이 함수가 다시 되돌리지 않는다.
//
// 이 파일은 순수함수만 담는다. Supabase를 모른다(engine-interface.md 1절 분리 원칙).
// DB 저장은 C가 API 라우트에서 반환값을 UPDATE 하는 방식으로 연결한다.
//
// [hsoo23 리뷰 반영 — DateString vs DateTimeString]
// today(YYYY-MM-DD, 날짜 연산용)와 now(ISO 8601, 타임스탬프용)를 분리한다.
// statusUpdatedAt/updatedAt은 규약상 DateTimeString이라 today를 그대로 넣으면 안 된다.
// 엔진은 Date.now()를 직접 호출하지 않는 순수함수 원칙(engine-interface.md)을 지키기 위해
// now도 today처럼 호출부(API 계층)가 주입한다 — 엔진 내부에서 실제 시각을 만들지 않는다.

import type { Contract, DateString, DateTimeString, PaymentConfirmInput } from "../shared/types";
import type { ContractStatus, StatusSource } from "../shared/enums";
import { MVP_POLICY } from "../shared/policy";
import { diffDays } from "./scenarioDate";

// ── 자동 전이 (waiting → delayed → risk) ──────────────────

/**
 * 예정일 경과 / 60일 이상 미입금 여부를 오늘 날짜 기준으로 재판정한다.
 * 정산함 화면 진입 시, 그리고 "지연 전환 즉시 재계산" 요구사항에 따라
 * 계약 목록을 그릴 때마다(또는 상태 변경 API 호출 시) 이 함수를 통과시킨다.
 *
 * @param today 날짜 연산(경과일수 판정) 전용. "YYYY-MM-DD"
 * @param now   전이가 실제로 일어났을 때 statusUpdatedAt/updatedAt에 찍을 시각. ISO 8601
 *
 * 전이가 없으면 원본 객체를 그대로 반환한다(불필요한 리렌더/UPDATE 방지용 참조 동일성).
 */
export function recalculateContractStatus(
  contract: Contract,
  today: DateString,
  now: DateTimeString,
): Contract {
  // [3-4 핵심] 사용자가 직접 지정한 상태는 시스템이 되돌리지 않는다.
  if (contract.statusSource === "user") return contract;

  // 종료 상태(완료/취소)는 자동 전이 대상이 아니다.
  if (contract.status === "completed" || contract.status === "cancelled") return contract;

  // 이미 risk인 계약(system)은 더 갈 곳이 없다 — 이 함수가 다루는 전이 대상은 waiting/delayed뿐.
  if (contract.status !== "waiting" && contract.status !== "delayed") return contract;

  // expectedDate가 없으면(UNKNOWN 정산조건 등) 경과 판정 자체가 불가능 — 상태 유지.
  if (contract.expectedDate === null) return contract;

  const overdueDays = diffDays(contract.expectedDate, today);

  // [hsoo23 리뷰 반영] 60일 이상 경과는 waiting이든 delayed든 "즉시" risk로 보낸다.
  // waiting → delayed → risk 를 재계산 호출 두 번에 걸쳐 순차적으로만 전이시키면,
  // 화면이 재계산을 한 번만 호출하는 경우 이미 60일 넘게 지난 계약이 delayed로만
  // 표시되는 채로 남는다(실제로는 risk여야 함). delayed를 거칠 필요 없이 한 번에 판정한다.
  if (overdueDays >= MVP_POLICY.riskStatusOverdueDays) {
    return transitionTo(contract, "risk", "system", null, now);
  }

  if (contract.status === "waiting" && overdueDays > 0) {
    return transitionTo(contract, "delayed", "system", null, now);
  }

  // waiting인데 아직 예정일 전이거나, delayed인데 아직 60일 미만이면 상태 유지.
  return contract;
}

/**
 * 목록 전체를 한 번에 재계산할 때 쓰는 편의 함수.
 * C가 정산함 화면 진입 시 계약 배열 통째로 넘기면 된다.
 */
export function recalculateContractStatuses(
  contracts: Contract[],
  today: DateString,
  now: DateTimeString,
): Contract[] {
  return contracts.map((c) => recalculateContractStatus(c, today, now));
}

// ── 수동 전이 (사용자 액션) ────────────────────────────────

/**
 * 사용자가 위험으로 수동 지정. statusReason 필수.
 * (DB 제약 chk_user_status_reason: status_source='system' OR status_reason IS NOT NULL 과 1:1 대응)
 * 이후 recalculateContractStatus가 이 상태를 절대 덮어쓰지 않는다.
 * 날짜 연산이 필요 없는 함수라 today 없이 now(ISO 8601)만 받는다.
 */
export function markContractAsRisk(contract: Contract, reason: string, now: DateTimeString): Contract {
  assertReason(reason, "markContractAsRisk");
  return transitionTo(contract, "risk", "user", reason, now);
}

/**
 * 계약 취소. 어떤 상태에서든 가능하다(기획서 4-5).
 * 취소는 사용자 액션이므로 statusSource="user" + 사유를 남긴다(DB 제약과 일치시키기 위함).
 */
export function cancelContract(contract: Contract, reason: string, now: DateTimeString): Contract {
  assertReason(reason, "cancelContract");
  return transitionTo(contract, "cancelled", "user", reason, now);
}

/**
 * 사용자가 수동 지정했던 위험 상태를 되돌리고 싶을 때(오지정 정정 등).
 * 자동 판정으로 되돌리는 게 아니라, 사용자 액션으로 waiting/delayed 중 하나로
 * 명시적으로 되돌리게 한다 — recalculateContractStatus가 이후 다시 자동으로 굴린다.
 */
export function revertManualStatus(
  contract: Contract,
  nextStatus: Extract<ContractStatus, "waiting" | "delayed">,
  now: DateTimeString,
): Contract {
  return transitionTo(contract, nextStatus, "system", null, now);
}

// ── 입금 확인 (사용자 액션) ────────────────────────────────

/**
 * 실제 입금을 확인한다(engine-interface.md 3-9, 이슈 #55).
 *
 * [이슈 #55 반영 — 시그니처에 now 추가] engine-interface.md 3-9가 선언한
 * 원 시그니처는 `confirmPayment(contract, input)`로 now가 없다. 그대로 두면
 * statusUpdatedAt/updatedAt(DateTimeString)을 채우려고 함수 내부에서
 * Date.now()를 불러야 하는데, 이 파일 맨 위 원칙("엔진은 Date.now()를 직접
 * 호출하지 않는다")과 다른 모든 전이 함수(markContractAsRisk 등)의 관례를
 * 정면으로 어긴다. 그래서 다른 함수들과 똑같이 now를 호출부 주입으로 받도록
 * 시그니처를 넓혔다 — engine-interface.md 쪽 문서도 같이 갱신이 필요하다.
 *
 * actualRate = (grossAmount - actualNetAmount) / grossAmount. DB의 actual_rate가
 * numeric(5,4)라(이슈 #16에서 confirmedExpectedRate가 겪은 것과 같은 원단위
 * 오차 문제) 소수 4자리로 반올림해서 왕복 오차를 없앤다.
 *
 * classificationStatus -> "actual_confirmed", status -> "completed"로 바꾼다.
 * expectedNetAmount는 그대로 둔다 — calculateExpectedNetAmount가 이미
 * actualNetAmount를 최우선으로 보므로 화면은 실제값을 그대로 쓴다.
 *
 * completed는 종료 상태라 statusSource="system"·statusReason=null로 남긴다
 * (markContractAsRisk/cancelContract처럼 사용자가 사유를 남기는 수동 지정과
 * 달리, 입금 확인은 사실을 기록하는 것이지 판단을 내리는 게 아니다).
 *
 * 거래처 지연 통계(medianDelayDays/p90DelayDays) 재계산은 이 함수의 책임이
 * 아니다 — Client 전체 이력이 필요한 별도 집계라 recalculateClientStats로
 * 분리돼 있다(engine-interface.md 3-10). 호출부가 이 함수 다음에 그쪽도
 * 호출해야 한다.
 */
export function confirmPayment(contract: Contract, input: PaymentConfirmInput, now: DateTimeString): Contract {
  if (!Number.isInteger(input.actualNetAmount) || input.actualNetAmount < 0 || input.actualNetAmount > contract.grossAmount) {
    throw new Error(
      `[engine] confirmPayment: actualNetAmount는 0 이상이고 grossAmount(${contract.grossAmount}) 이하인 원 단위 정수여야 합니다 (실제 ${input.actualNetAmount})`,
    );
  }

  const actualRate = Math.round(((contract.grossAmount - input.actualNetAmount) / contract.grossAmount) * 10_000) / 10_000;

  return {
    ...contract,
    actualDate: input.actualDate,
    actualNetAmount: input.actualNetAmount,
    actualRate,
    classificationStatus: "actual_confirmed",
    status: "completed",
    statusSource: "system",
    statusReason: null,
    statusUpdatedAt: now,
    updatedAt: now,
  };
}

// ── 내부 헬퍼 ──────────────────────────────────────────────

function assertReason(reason: string, callerName: string): void {
  if (!reason || reason.trim().length === 0) {
    throw new Error(`[engine] ${callerName}: statusReason은 필수입니다 (기획서 3-4 / DB chk_user_status_reason)`);
  }
}

function transitionTo(
  contract: Contract,
  status: ContractStatus,
  statusSource: StatusSource,
  statusReason: string | null,
  now: DateTimeString,
): Contract {
  return {
    ...contract,
    status,
    statusSource,
    statusReason,
    statusUpdatedAt: now,
    updatedAt: now,
  };
}
