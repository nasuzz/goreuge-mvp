// engine/index.ts — C가 import하는 진입점
export { runScenario, runAllScenarios, computeSimulationStartBalance } from "./simulate";
export { calculateScenarioDate, addDays } from "./scenarioDate";
export { buildOutflowSchedule } from "./outflowSchedule";
export { getBalanceLevel } from "../shared/policy";

// [이슈 #14 추가]
export { calculateExpectedDate } from "./expectedDate";
export { calculateExpectedNetAmount } from "./expectedNetAmount";
export type { ExpectedNetAmountResult } from "./expectedNetAmount";
