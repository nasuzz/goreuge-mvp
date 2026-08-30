export type ContractStatus =
  | "waiting"
  | "delayed"
  | "risk"
  | "completed"
  | "cancelled";

export type StatusSource = "system" | "user";

export type IncomeType =
  | "business_personal_service"
  | "qualifying_other_income"
  | "employment_income"
  | "no_withholding"
  | "needs_review";

export type ClassificationStatus =
  | "ai_candidate"
  | "user_confirmed"
  | "needs_review"
  | "actual_confirmed";

export type Scenario = "optimistic" | "baseline" | "pessimistic";

