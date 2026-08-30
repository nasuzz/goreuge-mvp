import type {
  ClassificationStatus,
  ContractStatus,
  IncomeType,
  StatusSource,
} from "./enums";

export interface Contract {
  id: string;
  clientName: string;
  grossAmount: number;
  expectedNetAmount: number | null;
  actualNetAmount: number | null;
  completionDate: string;
  invoiceDate: string | null;
  expectedDate: string;
  actualDate: string | null;
  incomeType: IncomeType;
  classificationStatus: ClassificationStatus;
  status: ContractStatus;
  statusSource: StatusSource;
  statusReason: string | null;
  statusUpdatedAt: string;
}

export interface AIContractCandidate {
  clientName: string | null;
  grossAmount: number | null;
  completionDate: string | null;
  settlementTerm: string | null;
  incomeTypeCandidate: IncomeType;
  confidence: Record<string, number>;
  missingFields: string[];
  needsReview: boolean;
}

export interface DailyBalance {
  date: string;
  balance: number;
  inflow: number;
  outflow: number;
}

export interface ActionScenario {
  id: string;
  title: string;
  assumptions: string[];
  extendedDays: number;
  resultingDday: string | null;
}

export interface CashflowResult {
  optimisticDate: string | null;
  baselineDate: string | null;
  pessimisticDate: string | null;
  weeklyAvailable: number;
  dailyBalances: DailyBalance[];
  riskReasons: string[];
  actions: ActionScenario[];
}

