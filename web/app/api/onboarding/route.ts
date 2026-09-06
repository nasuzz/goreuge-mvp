import { NextRequest, NextResponse } from "next/server";
import { MVP_POLICY } from "@/shared/policy";
import { asObject, errorResponse, nonNegativeNumber } from "@/lib/api/errors";
import { mapUserRow } from "@/lib/db/mappers";
import { createServerClient } from "@/lib/supabase/server";

// POST Create the initial users row: totalBalance / monthlyFixedOutflow / safetyBuffer
export async function POST(request: NextRequest) {
  try {
    const body = asObject(await request.json());
    const totalBalance = nonNegativeNumber(body, "totalBalance");
    const monthlyFixedOutflow = nonNegativeNumber(body, "monthlyFixedOutflow");
    const safetyBuffer = body.safetyBuffer === undefined
      ? Math.round(monthlyFixedOutflow * MVP_POLICY.safetyBufferMonths)
      : nonNegativeNumber(body, "safetyBuffer");
    const { data, error } = await createServerClient().from("users").insert({
      total_balance: totalBalance,
      monthly_fixed_outflow: monthlyFixedOutflow,
      safety_buffer: safetyBuffer,
      tax_reserve_rate: MVP_POLICY.defaultTaxReserveRate,
    }).select("*").single();
    if (error) throw new Error(`[supabase] ${error.message}`);
    return NextResponse.json({ user: mapUserRow(data) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
