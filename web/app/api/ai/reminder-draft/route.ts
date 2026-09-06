import { NextRequest, NextResponse } from "next/server";
import { createReminderDraftProviderFromEnv } from "@/ai/reminder-provider";
import { createReminderDraftWithFallback, type ReminderChannel, type ReminderTone } from "@/ai/reminder-draft";
import { recalculateContractStatuses } from "@/engine/index";
import { ApiError, asObject, assertUuid, errorResponse, requiredString } from "@/lib/api/errors";
import { clock } from "@/lib/clock";
import { loadEngineInput, requestedUserId } from "@/lib/db/data";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const TONES = new Set<ReminderTone>(["soft", "standard", "firm"]);
const CHANNELS = new Set<ReminderChannel>(["message", "email"]);

export async function POST(request: NextRequest) {
  try {
    const body = asObject(await request.json());
    const contractId = assertUuid(requiredString(body, "contractId"), "contract id");
    const tone = parseTone(body.tone);
    const channel = parseChannel(body.channel);

    const { today, now } = clock();
    const input = await loadEngineInput(createServerClient(), today, requestedUserId(request));
    const settledInput = {
      ...input,
      contracts: recalculateContractStatuses(input.contracts, today, now),
    };

    const result = await createReminderDraftWithFallback(
      settledInput,
      { contractId, tone, channel },
      createReminderDraftProviderFromEnv(),
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "contract not found") {
      return errorResponse(new ApiError(404, "contract not found"));
    }
    if (
      error instanceof Error &&
      error.message === "reminder draft is only available for delayed or risk contracts"
    ) {
      return errorResponse(new ApiError(400, error.message));
    }
    if (error instanceof Error && error.message === "expectedDate is required for reminder draft") {
      return errorResponse(new ApiError(400, error.message));
    }
    return errorResponse(error);
  }
}

function parseTone(value: unknown): ReminderTone {
  if (value === undefined || value === null || value === "") return "soft";
  if (typeof value !== "string" || !TONES.has(value as ReminderTone)) {
    throw new ApiError(400, "tone must be soft, standard, or firm");
  }
  return value as ReminderTone;
}

function parseChannel(value: unknown): ReminderChannel {
  if (value === undefined || value === null || value === "") return "message";
  if (typeof value !== "string" || !CHANNELS.has(value as ReminderChannel)) {
    throw new ApiError(400, "channel must be message or email");
  }
  return value as ReminderChannel;
}
