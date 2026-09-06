import type { AIContractCandidate, DateString } from "../shared/types";
import type { AIContractProvider } from "./parser-service";
import { CONTRACT_PARSER_SYSTEM_PROMPT } from "./prompt";
import { maskContractText } from "./privacy-mask";

type FetchLike = typeof fetch;

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: FetchLike;
}

interface GeminiPayload {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: { message?: string };
}

function getOutputText(payload: GeminiPayload): string | null {
  for (const candidate of payload.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.text) return part.text;
    }
  }
  return null;
}

/** 서버 전용. GEMINI_API_KEY를 브라우저 번들 또는 NEXT_PUBLIC_* 변수에 넣지 않는다. */
export class GeminiContractProvider implements AIContractProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: GeminiProviderOptions) {
    if (!options.apiKey) throw new Error("GEMINI_API_KEY가 필요합니다.");
    this.apiKey = options.apiKey;
    this.model = options.model ?? "gemini-3-flash-preview";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async parse(text: string, referenceDate: DateString): Promise<AIContractCandidate> {
    const { maskedText, clientName } = maskContractText(text);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: CONTRACT_PARSER_SYSTEM_PROMPT }],
        },
        contents: [{
          role: "user",
          parts: [{ text: `기준일: ${referenceDate}\n계약 메시지:\n${maskedText}` }],
        }],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    });

    const payload = await response.json() as GeminiPayload;
    if (!response.ok) throw new Error(payload.error?.message ?? `Gemini API 오류 (${response.status})`);
    const outputText = getOutputText(payload);
    if (!outputText) throw new Error("Gemini 응답에 텍스트가 없습니다.");
    const candidate = JSON.parse(outputText) as AIContractCandidate;

    // 모델에는 placeholder만 보낸다. 거래처명은 원문에서 로컬로 추출한 후보를 복원한다.
    if (clientName) {
      candidate.clientName = clientName;
      candidate.confidence.clientName = 0.96;
      candidate.missingFields = candidate.missingFields.filter((field) => field !== "clientName");
    }
    return candidate;
  }
}

export function createGeminiProviderFromEnv(env: NodeJS.ProcessEnv = process.env): GeminiContractProvider {
  const apiKey = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("서버 환경변수 GEMINI_API_KEY가 설정되지 않았습니다.");
  return new GeminiContractProvider({ apiKey, model: env.GEMINI_MODEL });
}
