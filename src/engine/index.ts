// engine/index.ts — C가 import하는 진입점
export { runScenario, runAllScenarios, computeSimulationStartBalance } from "./simulate";
export { calculateScenarioDate, addDays, diffDays } from "./scenarioDate";
export { buildOutflowSchedule } from "./outflowSchedule";
export { getBalanceLevel } from "../shared/policy";

// [이슈 #3 추가]
export {
  recalculateContractStatus,
  recalculateContractStatuses,
  markContractAsRisk,
  cancelContract,
  revertManualStatus,
} from "./statusTransition";
export { compareWhatIf, formatWhatIfMessage, splitDelayedMonthlyOutflow } from "./whatIf";
// WhatIfAssumption/WhatIfResult는 shared/types.ts가 원본이다 (whatIf.ts는 재정의하지 않음).
export type { WhatIfAssumption, WhatIfResult } from "../shared/types";

// [이슈 #14 추가]
export { calculateExpectedDate } from "./expectedDate";
export type { CalculateExpectedDateOptions } from "./expectedDate";
export { calculateExpectedNetAmount } from "./expectedNetAmount";
export type { ExpectedNetAmountResult } from "./expectedNetAmount";

// [이슈 #57 추가] 주말·공휴일 보정 (기본 OFF, adjustWeekendHoliday 옵션으로 켠다)
export { isHoliday, KR_HOLIDAYS_CACHE, KR_HOLIDAYS_COVERED_YEARS } from "../shared/holidays";

// [이슈 #50 추가]
export { compareWhatIfCombined } from "./whatIf";
export type { CombinedWhatIfResult } from "./whatIf";
export { findRecovery } from "./findRecovery";
export type { RecoveryOption, RecoveryFinding } from "./findRecovery";
