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

import type { Contract, DateString } from "../shared/types";
import type { ContractStatus, StatusSource } from "../shared/enums";
import { MVP_POLICY } from "../shared/policy";
import { diffDays } from "./scenarioDate";

// ── 자동 전이 (waiting → delayed → risk) ──────────────────

/**
 * 예정일 경과 / 60일 이상 미입금 여부를 오늘 날짜 기준으로 재판정한다.
 * 정산함 화면 진입 시, 그리고 "지연 전환 즉시 재계산" 요구사항에 따라
 * 계약 목록을 그릴 때마다(또는 상태 변경 API 호출 시) 이 함수를 통과시킨다.
 *
 * 전이가 없으면 원본 객체를 그대로 반환한다(불필요한 리렌더/UPDATE 방지용 참조 동일성).
 */
export function recalculateContractStatus(contract: Contract, today: DateString): Contract {
  // [3-4 핵심] 사용자가 직접 지정한 상태는 시스템이 되돌리지 않는다.
  if (contract.statusSource === "user") return contract;

  // 종료 상태(완료/취소)는 자동 전이 대상이 아니다.
  if (contract.status === "completed" || contract.status === "cancelled") return contract;

  // expectedDate가 없으면(UNKNOWN 정산조건 등) 경과 판정 자체가 불가능 — 상태 유지.
  if (contract.expectedDate === null) return contract;

  const overdueDays = diffDays(contract.expectedDate, today);

  if (contract.status === "waiting") {
    // 예정일이 아직 안 지났으면(overdueDays <= 0) 대기 유지.
    if (overdueDays > 0) {
      return transitionTo(contract, "delayed", "system", null, today);
    }
    return contract;
  }

  if (contract.status === "delayed") {
    if (overdueDays >= MVP_POLICY.riskStatusOverdueDays) {
      return transitionTo(contract, "risk", "system", null, today);
    }
    return contract;
  }

  // status === "risk"(system)인데 여기 또 들어온 경우 — 이미 위험이므로 유지.
  return contract;
}

/**
 * 목록 전체를 한 번에 재계산할 때 쓰는 편의 함수.
 * C가 정산함 화면 진입 시 계약 배열 통째로 넘기면 된다.
 */
export function recalculateContractStatuses(contracts: Contract[], today: DateString): Contract[] {
  return contracts.map((c) => recalculateContractStatus(c, today));
}

// ── 수동 전이 (사용자 액션) ────────────────────────────────

/**
 * 사용자가 위험으로 수동 지정. statusReason 필수.
 * (DB 제약 chk_user_status_reason: status_source='system' OR status_reason IS NOT NULL 과 1:1 대응)
 * 이후 recalculateContractStatus가 이 상태를 절대 덮어쓰지 않는다.
 */
export function markContractAsRisk(contract: Contract, reason: string, today: DateString): Contract {
  assertReason(reason, "markContractAsRisk");
  return transitionTo(contract, "risk", "user", reason, today);
}

/**
 * 계약 취소. 어떤 상태에서든 가능하다(기획서 4-5).
 * 취소는 사용자 액션이므로 statusSource="user" + 사유를 남긴다(DB 제약과 일치시키기 위함).
 */
export function cancelContract(contract: Contract, reason: string, today: DateString): Contract {
  assertReason(reason, "cancelContract");
  return transitionTo(contract, "cancelled", "user", reason, today);
}

/**
 * 사용자가 수동 지정했던 위험 상태를 되돌리고 싶을 때(오지정 정정 등).
 * 자동 판정으로 되돌리는 게 아니라, 사용자 액션으로 waiting/delayed 중 하나로
 * 명시적으로 되돌리게 한다 — recalculateContractStatus가 이후 다시 자동으로 굴린다.
 */
export function revertManualStatus(
  contract: Contract,
  nextStatus: Extract<ContractStatus, "waiting" | "delayed">,
  today: DateString,
): Contract {
  return transitionTo(contract, nextStatus, "system", null, today);
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
  today: DateString,
): Contract {
  return {
    ...contract,
    status,
    statusSource,
    statusReason,
    statusUpdatedAt: today,
    updatedAt: today,
  };
}
