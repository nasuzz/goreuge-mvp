import type {
  Client,
  Contract,
  Outflow,
  Saving,
  User,
} from "@/shared/types";

type DbRecord = Record<string, unknown>;

function requiredString(row: DbRecord, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`[db mapper] ${key} must be a string`);
  return value;
}

function nullableString(row: DbRecord, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`[db mapper] ${key} must be a string or null`);
  return value;
}

function numberValue(row: DbRecord, key: string): number {
  const value = row[key];
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`[db mapper] ${key} must be numeric`);
  return parsed;
}

function nullableNumber(row: DbRecord, key: string): number | null {
  return row[key] === null ? null : numberValue(row, key);
}

export function mapUserRow(row: DbRecord): User {
  return {
    id: requiredString(row, "id"),
    totalBalance: numberValue(row, "total_balance"),
    monthlyFixedOutflow: numberValue(row, "monthly_fixed_outflow"),
    safetyBuffer: numberValue(row, "safety_buffer"),
    taxReserveRate: numberValue(row, "tax_reserve_rate"),
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

export function mapClientRow(row: DbRecord): Client {
  return {
    id: requiredString(row, "id"),
    name: requiredString(row, "name"),
    completedCount: numberValue(row, "completed_count"),
    medianDelayDays: nullableNumber(row, "median_delay_days"),
    p90DelayDays: nullableNumber(row, "p90_delay_days"),
  };
}

export function mapContractRow(row: DbRecord): Contract {
  return {
    id: requiredString(row, "id"),
    clientId: requiredString(row, "client_id"),
    grossAmount: numberValue(row, "gross_amount"),
    completionDate: requiredString(row, "completion_date"),
    invoiceDate: nullableString(row, "invoice_date"),
    settlementTerm: requiredString(row, "settlement_term") as Contract["settlementTerm"],
    settlementDay: nullableNumber(row, "settlement_day"),
    expectedDate: nullableString(row, "expected_date"),
    expectedDateSource: requiredString(row, "expected_date_source") as Contract["expectedDateSource"],
    actualDate: nullableString(row, "actual_date"),
    incomeType: requiredString(row, "income_type") as Contract["incomeType"],
    classificationStatus: requiredString(row, "classification_status") as Contract["classificationStatus"],
    referenceRate: nullableNumber(row, "reference_rate"),
    confirmedExpectedRate: nullableNumber(row, "confirmed_expected_rate"),
    actualRate: nullableNumber(row, "actual_rate"),
    payerStatedNetAmount: nullableNumber(row, "payer_stated_net_amount"),
    expectedNetAmount: nullableNumber(row, "expected_net_amount"),
    actualNetAmount: nullableNumber(row, "actual_net_amount"),
    status: requiredString(row, "status") as Contract["status"],
    statusSource: requiredString(row, "status_source") as Contract["statusSource"],
    statusReason: nullableString(row, "status_reason"),
    statusUpdatedAt: requiredString(row, "status_updated_at"),
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

export function mapOutflowRow(row: DbRecord): Outflow {
  return {
    id: requiredString(row, "id"),
    kind: requiredString(row, "kind"),
    name: requiredString(row, "name"),
    amount: numberValue(row, "amount"),
    dueDate: requiredString(row, "due_date"),
    recurrence: requiredString(row, "recurrence") as Outflow["recurrence"],
    includedInBaseline: Boolean(row.included_in_baseline),
  };
}

export function mapSavingRow(row: DbRecord): Saving {
  return {
    id: requiredString(row, "id"),
    kind: requiredString(row, "kind") as Saving["kind"],
    name: requiredString(row, "name"),
    targetAmount: nullableNumber(row, "target_amount"),
    weeklyAmount: nullableNumber(row, "weekly_amount"),
    plannedAmount: numberValue(row, "planned_amount"),
    reservedAmount: numberValue(row, "reserved_amount"),
    spentAmount: numberValue(row, "spent_amount"),
    status: requiredString(row, "status") as Saving["status"],
  };
}

export function contractStatusUpdateRow(contract: Contract) {
  return {
    status: contract.status,
    status_source: contract.statusSource,
    status_reason: contract.statusReason,
    status_updated_at: contract.statusUpdatedAt,
    updated_at: contract.updatedAt,
  };
}

export function userToRow(user: User) {
  return {
    id: user.id,
    total_balance: user.totalBalance,
    monthly_fixed_outflow: user.monthlyFixedOutflow,
    safety_buffer: user.safetyBuffer,
    tax_reserve_rate: user.taxReserveRate,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
  };
}

export function clientToRow(client: Client) {
  return {
    id: client.id,
    name: client.name,
    completed_count: client.completedCount,
    median_delay_days: client.medianDelayDays,
    p90_delay_days: client.p90DelayDays,
  };
}

export function contractToRow(contract: Contract) {
  return {
    id: contract.id,
    client_id: contract.clientId,
    gross_amount: contract.grossAmount,
    completion_date: contract.completionDate,
    invoice_date: contract.invoiceDate,
    settlement_term: contract.settlementTerm,
    settlement_day: contract.settlementDay,
    expected_date: contract.expectedDate,
    expected_date_source: contract.expectedDateSource,
    actual_date: contract.actualDate,
    income_type: contract.incomeType,
    classification_status: contract.classificationStatus,
    reference_rate: contract.referenceRate,
    confirmed_expected_rate: contract.confirmedExpectedRate,
    actual_rate: contract.actualRate,
    payer_stated_net_amount: contract.payerStatedNetAmount,
    expected_net_amount: contract.expectedNetAmount,
    actual_net_amount: contract.actualNetAmount,
    status: contract.status,
    status_source: contract.statusSource,
    status_reason: contract.statusReason,
    status_updated_at: contract.statusUpdatedAt,
    created_at: contract.createdAt,
    updated_at: contract.updatedAt,
  };
}

export function outflowToRow(outflow: Outflow) {
  return {
    id: outflow.id,
    kind: outflow.kind,
    name: outflow.name,
    amount: outflow.amount,
    due_date: outflow.dueDate,
    recurrence: outflow.recurrence,
    included_in_baseline: outflow.includedInBaseline,
  };
}

export function savingToRow(saving: Saving) {
  return {
    id: saving.id,
    kind: saving.kind,
    name: saving.name,
    target_amount: saving.targetAmount,
    weekly_amount: saving.weeklyAmount,
    planned_amount: saving.plannedAmount,
    reserved_amount: saving.reservedAmount,
    spent_amount: saving.spentAmount,
    status: saving.status,
  };
}
