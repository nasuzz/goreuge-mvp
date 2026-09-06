import { NextRequest, NextResponse } from "next/server";
import { buildAIConfirmationViewModel } from "@/ai/confirmation-flow";
import { createGeminiProviderFromEnv } from "@/ai/gemini-provider";
import { createOpenAIProviderFromEnv } from "@/ai/openai-provider";
import { parseContractParseRequest } from "@/ai/parse-request";
import { parseContractWithFallback, type AIContractProvider } from "@/ai/parser-service";

export const runtime = "nodejs";

function providerFromEnvironment(): AIContractProvider | undefined {
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return createGeminiProviderFromEnv();
  return process.env.OPENAI_API_KEY ? createOpenAIProviderFromEnv() : undefined;
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON 요청 본문을 확인해 주세요." }, { status: 400 });
  }

  const parsed = parseContractParseRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await parseContractWithFallback(
    parsed.value.text,
    parsed.value.referenceDate,
    providerFromEnvironment(),
  );

  // 모든 후보는 최초 응답에서 미확인 상태다. 사용자가 모달에서 확인하기 전 저장하지 않는다.
  return NextResponse.json(buildAIConfirmationViewModel(result, false));
}
