import type { SupabaseClient } from "@supabase/supabase-js";
import type { EngineInput } from "@/shared/types";
import { ApiError } from "@/lib/api/errors";
import {
  mapClientRow,
  mapContractRow,
  mapOutflowRow,
  mapSavingRow,
  mapUserRow,
} from "./mappers";

type DbClient = SupabaseClient;

function throwDb(error: { message: string } | null): void {
  if (error) throw new Error(`[supabase] ${error.message}`);
}

export async function resolveUserId(db: DbClient, requestedId?: string | null): Promise<string> {
  const id = requestedId || process.env.DEMO_USER_ID;
  if (id) return id;

  const { data, error } = await db
    .from("users")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  throwDb(error);
  if (!data) throw new ApiError(404, "Onboarding is required before using this API");
  return String(data.id);
}

export async function loadEngineInput(
  db: DbClient,
  today: string,
  requestedUserId?: string | null,
): Promise<EngineInput> {
  const userId = await resolveUserId(db, requestedUserId);
  const [userResult, clientsResult, contractsResult, outflowsResult, savingsResult] = await Promise.all([
    db.from("users").select("*").eq("id", userId).single(),
    db.from("clients").select("*").eq("user_id", userId),
    db.from("contracts").select("*").eq("user_id", userId).order("created_at"),
    db.from("outflows").select("*").eq("user_id", userId).order("due_date"),
    db.from("savings").select("*").eq("user_id", userId),
  ]);

  for (const result of [userResult, clientsResult, contractsResult, outflowsResult, savingsResult]) {
    throwDb(result.error);
  }

  return {
    today,
    user: mapUserRow(userResult.data as Record<string, unknown>),
    clients: (clientsResult.data ?? []).map((row) => mapClientRow(row as Record<string, unknown>)),
    contracts: (contractsResult.data ?? []).map((row) => mapContractRow(row as Record<string, unknown>)),
    outflows: (outflowsResult.data ?? []).map((row) => mapOutflowRow(row as Record<string, unknown>)),
    savings: (savingsResult.data ?? []).map((row) => mapSavingRow(row as Record<string, unknown>)),
  };
}

export function requestedUserId(request: Request): string | null {
  return new URL(request.url).searchParams.get("userId");
}
