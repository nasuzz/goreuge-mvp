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
export { calculateExpectedNetAmount } from "./expectedNetAmount";
export type { ExpectedNetAmountResult } from "./expectedNetAmount";

// [이슈 #50 추가]
export { compareWhatIfCombined } from "./whatIf";
export type { CombinedWhatIfResult } from "./whatIf";
export { findRecovery } from "./findRecovery";
export type { RecoveryOption, RecoveryFinding } from "./findRecovery";

// [이슈 #56 추가]
export { calculateWishPlan, applySavingsCheck } from "./savings";
