import type { AIContractCandidate, DateString } from "../shared/types";
import type { AIContractProvider } from "./parser-service";
import { CONTRACT_PARSER_SYSTEM_PROMPT } from "./prompt";

type FetchLike = typeof fetch;

export interface OpenAIProviderOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: FetchLike;
}

const CANDIDATE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    clientName: { type: ["string", "null"] },
    grossAmount: { type: ["integer", "null"], minimum: 0 },
    completionDate: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    settlementTerm: {
      type: ["string", "null"],
      enum: ["ON_COMPLETION", "SAME_MONTH_END", "NEXT_MONTH_END", "NEXT_MONTH_DAY", "NET_DAYS", "UNKNOWN", null],
    },
    settlementDay: { type: ["integer", "null"], minimum: 1, maximum: 365 },
    incomeTypeCandidate: {
      type: "string",
      enum: ["business_personal_service", "qualifying_other_income", "employment_income", "no_withholding", "needs_review"],
    },
    confidence: {
      type: "object",
      additionalProperties: false,
      properties: {
        clientName: { type: "number", minimum: 0, maximum: 1 },
        grossAmount: { type: "number", minimum: 0, maximum: 1 },
        completionDate: { type: "number", minimum: 0, maximum: 1 },
        settlementTerm: { type: "number", minimum: 0, maximum: 1 },
        incomeTypeCandidate: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["clientName", "grossAmount", "completionDate", "settlementTerm", "incomeTypeCandidate"],
    },
    missingFields: { type: "array", items: { type: "string" } },
    needsReview: { type: "boolean" },
  },
  required: [
    "clientName", "grossAmount", "completionDate", "settlementTerm", "settlementDay",
    "incomeTypeCandidate", "confidence", "missingFields", "needsReview",
  ],
} as const;

interface ResponsesPayload {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string };
}

function getOutputText(payload: ResponsesPayload): string | null {
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return null;
}

/** 서버 전용. OPENAI_API_KEY를 브라우저 번들 또는 NEXT_PUBLIC_* 변수에 넣지 않는다. */
export class OpenAIContractProvider implements AIContractProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: OpenAIProviderOptions) {
    if (!options.apiKey) throw new Error("OPENAI_API_KEY가 필요합니다.");
    this.apiKey = options.apiKey;
    this.model = options.model ?? "gpt-5.4-mini";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async parse(text: string, referenceDate: DateString): Promise<AIContractCandidate> {
    const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        store: false,
        instructions: CONTRACT_PARSER_SYSTEM_PROMPT,
        input: `기준일: ${referenceDate}\n계약 메시지:\n${text}`,
        text: {
          format: {
            type: "json_schema",
            name: "goreuge_contract_candidate",
            strict: true,
            schema: CANDIDATE_JSON_SCHEMA,
          },
        },
      }),
    });

    const payload = await response.json() as ResponsesPayload;
    if (!response.ok) throw new Error(payload.error?.message ?? `OpenAI API 오류 (${response.status})`);
    const outputText = getOutputText(payload);
    if (!outputText) throw new Error("OpenAI 응답에 output_text가 없습니다.");
    return JSON.parse(outputText) as AIContractCandidate;
  }
}

export function createOpenAIProviderFromEnv(env: NodeJS.ProcessEnv = process.env): OpenAIContractProvider {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("서버 환경변수 OPENAI_API_KEY가 설정되지 않았습니다.");
  return new OpenAIContractProvider({ apiKey, model: env.OPENAI_MODEL });
}
